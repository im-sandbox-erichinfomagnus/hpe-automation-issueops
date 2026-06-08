'use strict';

const { resolveTeamRepoAccessAttachmentMaxBytes } = require('../actions/team-repo-access-policy');
const { downloadCsvAttachment } = require('./download-csv-attachment');
const { hashAttachmentContent } = require('./hash-attachment-content');
const { normalizeBulkCsvRequestedRepositories } = require('./normalize-bulk-csv-requested-repositories');
const { parseTeamRepoAccessRemovalRequest } = require('./parse-team-repo-access-removal-request');
const { getPermissionRank } = require('./normalize-requested-permission');
const { buildNormalizedRepositoryRemoval, hasPopulatedInput } = require('./normalize-requested-repositories');
const { resolveCsvAttachmentComment } = require('./resolve-csv-attachment-comment');
const { resolveTeamRepoApprover } = require('./resolve-team-repo-approver');

function parseDistinctApproverLogins(value) {
  return [...new Set(
    String(value || '')
      .split(/[\s,;]+/)
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

function classifyRepositoryRemoval(removal, request, repositoryState, currentPermissionApiValue) {
  const currentPermissionRank = getPermissionRank(currentPermissionApiValue || 'none');

  if (!repositoryState || repositoryState.exists === false) {
    return {
      ...removal,
      validation_status: 'missing_repository',
      desired_action: 'reject',
      current_permission_api_value: 'none',
      current_permission_rank: 0,
      failure_reason: 'missing_repository',
    };
  }

  if (repositoryState.repository.owner !== request.organization) {
    return {
      ...removal,
      repository_archived: repositoryState.repository.archived,
      validation_status: 'conflict',
      desired_action: 'reject',
      current_permission_api_value: 'none',
      current_permission_rank: 0,
      failure_reason: 'repository_outside_target_organization',
    };
  }

  if (repositoryState.repository.archived) {
    return {
      ...removal,
      repository_archived: true,
      validation_status: 'archived_blocked',
      desired_action: 'reject',
      current_permission_api_value: currentPermissionApiValue || 'none',
      current_permission_rank: currentPermissionRank,
      failure_reason: 'archived_repository',
    };
  }

  if (currentPermissionRank > 0) {
    return {
      ...removal,
      repository_archived: false,
      validation_status: 'valid',
      desired_action: 'remove_access',
      current_permission_api_value: currentPermissionApiValue,
      current_permission_rank: currentPermissionRank,
      failure_reason: null,
    };
  }

  return {
    ...removal,
    repository_archived: false,
    validation_status: 'already_absent',
    desired_action: 'noop_already_absent',
    current_permission_api_value: currentPermissionApiValue || 'none',
    current_permission_rank: currentPermissionRank,
    execution_result: 'noop',
    failure_reason: null,
  };
}

function describeCsvRowIssue(finding) {
  switch (finding.failure_reason) {
    case 'missing_repository':
      return `CSV row ${finding.row_number} is missing the required repository value.`;
    case 'invalid_repository':
      return `CSV row ${finding.row_number} contains an invalid repository${finding.repository_value ? `: ${finding.repository_value}` : ''}.`;
    case 'repository_outside_target_organization':
      return `CSV row ${finding.row_number} references a repository outside the target organization${finding.normalized_repository_full_name ? `: ${finding.normalized_repository_full_name}` : ''}.`;
    case 'conflicting_repository':
      return `CSV row ${finding.row_number} conflicts with another row after repository normalization${finding.normalized_repository_full_name ? `: ${finding.normalized_repository_full_name}` : ''}.`;
    case 'inconsistent_shape':
      return `CSV row ${finding.row_number} does not match the header column count.`;
    default:
      return `CSV row ${finding.row_number} is invalid.`;
  }
}

function appendCsvValidationErrors(errors, schemaErrors = [], rowFindings = []) {
  for (const schemaError of schemaErrors || []) {
    errors.push(schemaError);
  }

  for (const finding of rowFindings || []) {
    if (finding.validation_status === 'blank') {
      continue;
    }

    if (finding.validation_status === 'duplicate') {
      errors.push(
        `CSV row ${finding.row_number} duplicates repository ${finding.repository_value || 'unknown'}.`
      );
      continue;
    }

    if (finding.validation_status === 'invalid') {
      errors.push(describeCsvRowIssue(finding));
    }
  }
}

async function validateTeamRepoAccessRemovalRequest(input = {}, options = {}) {
  const rawRequest = input.request_id ? input : parseTeamRepoAccessRemovalRequest(input);
  const request = {
    invalid_repositories: [],
    duplicate_repositories: [],
    conflicting_repositories: [],
    requested_repository_removals: [],
    validation_findings: {},
    unsupported_inputs: {},
    ...rawRequest,
  };
  const errors = [];
  const warnings = [];
  const getOrganization = options.getOrganization;
  const getTeamBySlug = options.getTeamBySlug;
  const getRepository = options.getRepository;
  const getTeamRepositoryPermission = options.getTeamRepositoryPermission;
  const getOrganizationMembership = options.getOrganizationMembership;
  const issueComments = options.issueComments || input.issueComments || input.issue_comments || [];
  const latestFailedValidationAt = options.latestFailedValidationAt || input.latestFailedValidationAt || null;
  const latestFailedValidationAttemptId = options.latestFailedValidationAttemptId || input.latestFailedValidationAttemptId || null;
  const terminalStateReached = ['executed', 'partially_executed', 'failed', 'failed_after_approved_execution'].includes(request.request_status);
  const attachmentMaxBytes = resolveTeamRepoAccessAttachmentMaxBytes({
    attachment_max_bytes: options.maxAttachmentBytes,
    repository_policy: options.repositoryPolicy,
  });
  let attachmentRateLimitSnapshot = null;

  request.validation_findings.attachment_max_bytes = attachmentMaxBytes;

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.team_slug) {
    errors.push('An existing target team is required.');
  }

  if (!request.designated_approver_login) {
    errors.push('A single designated repository-access approver is required.');
  }

  const manualPopulated = hasPopulatedInput(request.requested_repositories_input);
  const bulkCsvPopulated = hasPopulatedInput(request.bulk_csv_input);
  const hasAcceptedAttachment = Boolean(
    request.accepted_attachment_submission &&
    request.accepted_attachment_submission.acceptance_status === 'accepted' &&
    request.accepted_attachment_submission.attachment_url
  );

  if (!request.intake_mode) {
    errors.push('Exactly one supported intake mode must be selected: manual or csv_attachment.');
  }

  if (request.intake_mode === 'manual') {
    if (!manualPopulated || bulkCsvPopulated) {
      errors.push('Exactly one intake source must be populated for manual mode: requested_repositories.');
    }
  }

  if (request.intake_mode === 'csv_attachment') {
    if (manualPopulated) {
      errors.push('requested_repositories must be empty when intake_mode is csv_attachment.');
    }

    if (bulkCsvPopulated && !hasAcceptedAttachment) {
      errors.push('bulk_csv_requested_repositories must be empty when intake_mode is csv_attachment.');
    }

    const canReuseAcceptedAttachment =
      hasAcceptedAttachment &&
      request.requested_repository_removals.length > 0 &&
      issueComments.length === 0;

    if (canReuseAcceptedAttachment) {
      request.request_status = request.request_status === 'waiting_for_attachment'
        ? 'submitted'
        : request.request_status;
    } else {
      const attachmentResolution = resolveCsvAttachmentComment({
        requesterLogin: request.requester_login,
        issueComments,
        latestFailedValidationAt,
        terminalStateReached,
      });

      request.validation_findings.attachment_comment_findings = attachmentResolution.findings;

      if (attachmentResolution.resolution_status === 'ignored_terminal_state') {
        warnings.push('Later attachment comments are ignored after the request reaches a terminal execution state.');
        request.accepted_attachment_submission = {
          ...request.accepted_attachment_submission,
          acceptance_status: 'ignored_terminal_state',
          rejection_reason: 'terminal_state_ignored',
        };
        request.attachment_validation_attempt = {
          ...request.attachment_validation_attempt,
          request_id: request.request_id,
          attempt_status: 'ignored_terminal_state',
          evaluated_at: new Date().toISOString(),
        };
      } else if (attachmentResolution.resolution_status === 'waiting_for_attachment' && errors.length === 0) {
        request.request_status = 'waiting_for_attachment';
        request.attachment_validation_attempt = {
          ...request.attachment_validation_attempt,
          request_id: request.request_id,
          attempt_status: 'waiting',
          evaluated_at: new Date().toISOString(),
        };
        warnings.push('Request is waiting for a requester-authored CSV attachment comment.');
      } else if (attachmentResolution.resolution_status === 'attachment_rejected') {
        request.request_status = 'validation_failed';
        const candidate = attachmentResolution.candidate || {};
        request.accepted_attachment_submission = {
          ...request.accepted_attachment_submission,
          comment_id: candidate.comment_id || null,
          comment_created_at: candidate.comment_created_at || null,
          uploader_login: candidate.uploader_login || null,
          attachment_url: candidate.attachment_url || null,
          filename: candidate.filename || null,
          extension: candidate.extension || null,
          acceptance_status: 'rejected',
          rejection_reason: candidate.rejection_reason || 'attachment_rejected',
        };
        request.attachment_validation_attempt = {
          ...request.attachment_validation_attempt,
          request_id: request.request_id,
          candidate_comment_id: candidate.comment_id || null,
          attempt_status: 'attachment_rejected',
          errors: [`Attachment candidate was rejected: ${candidate.rejection_reason || 'attachment_rejected'}.`],
          evaluated_at: new Date().toISOString(),
        };
        errors.push(`Attachment candidate was rejected: ${candidate.rejection_reason || 'attachment_rejected'}.`);
      } else if (attachmentResolution.resolution_status === 'attachment_candidate_selected') {
        request.request_status = 'submitted';
        const candidate = attachmentResolution.candidate;

        try {
          const downloadedAttachment = await downloadCsvAttachment({
            attachmentUrl: candidate.attachment_url,
            token: options.token,
            fetchImpl: options.fetchImpl,
            maxBytes: attachmentMaxBytes,
            maxRetries: options.maxRetries,
            baseDelayMs: options.baseDelayMs,
            maxDelayMs: options.maxDelayMs,
            sleep: options.sleep,
          });
          attachmentRateLimitSnapshot = downloadedAttachment.rate_limit_snapshot;
          const attachmentHash = hashAttachmentContent(downloadedAttachment.text);
          const attachmentNormalization = normalizeBulkCsvRequestedRepositories(downloadedAttachment.text, {
            defaultOwner: request.organization,
          });

          request.bulk_csv_input = downloadedAttachment.text;
          request.bulk_csv_submission = {
            encoding: attachmentNormalization.encoding,
            header_columns: attachmentNormalization.header_columns,
            required_columns: attachmentNormalization.required_columns,
            unsupported_columns: attachmentNormalization.unsupported_columns,
            row_count: attachmentNormalization.row_count,
            valid_row_count: attachmentNormalization.valid_row_count,
            invalid_row_count: attachmentNormalization.invalid_row_count,
            duplicate_row_count: attachmentNormalization.duplicate_row_count,
            schema_status: attachmentNormalization.schema_status,
            schema_errors: attachmentNormalization.schema_errors,
            raw_input: attachmentNormalization.raw_input,
            csv_row_findings: attachmentNormalization.csv_row_findings,
            csv_row_numbering_convention: attachmentNormalization.csv_row_numbering_convention,
          };
          request.requested_repository_removals = attachmentNormalization.normalizedRepositories.map((removal) =>
            buildNormalizedRepositoryRemoval(removal, {
              source_comment_id: candidate.comment_id || null,
              source_row_number: removal.source_row_number || null,
            })
          );
          request.requested_repository_removal_detail = attachmentNormalization.requestedRepositoryDetail.map((detail) => ({
            ...detail,
            source_comment_id: candidate.comment_id || null,
          }));
          request.duplicate_repositories = attachmentNormalization.duplicateRepositories;
          request.conflicting_repositories = attachmentNormalization.conflictingRepositories;
          request.invalid_repositories = attachmentNormalization.invalidRepositories;
          request.csv_row_findings = attachmentNormalization.csv_row_findings;
          request.csv_row_numbering_convention = attachmentNormalization.csv_row_numbering_convention;
          request.validation_findings.duplicate_repositories = attachmentNormalization.duplicateRepositories;
          request.validation_findings.conflicting_repositories = attachmentNormalization.conflictingRepositories;
          request.validation_findings.invalid_repositories = attachmentNormalization.invalidRepositories;
          request.validation_findings.csv_row_findings = attachmentNormalization.csv_row_findings;
          request.validation_findings.csv_row_numbering_convention = attachmentNormalization.csv_row_numbering_convention;
          request.accepted_attachment_submission = {
            ...request.accepted_attachment_submission,
            comment_id: candidate.comment_id || null,
            comment_created_at: candidate.comment_created_at || null,
            uploader_login: candidate.uploader_login || null,
            attachment_url: candidate.attachment_url,
            filename: candidate.filename || null,
            extension: candidate.extension || null,
            content_hash: attachmentHash,
            downloaded_at: downloadedAttachment.downloaded_at,
            byte_size: downloadedAttachment.byte_size,
            acceptance_status: 'accepted',
            rejection_reason: null,
          };
          request.attachment_validation_attempt = {
            ...request.attachment_validation_attempt,
            attempt_id: `${request.request_id}:${candidate.comment_id}`,
            request_id: request.request_id,
            candidate_comment_id: candidate.comment_id || null,
            attempt_status: attachmentNormalization.schema_status === 'valid' ? 'csv_valid' : 'csv_invalid',
            evaluated_at: downloadedAttachment.downloaded_at,
            errors: attachmentNormalization.schema_errors,
            warnings: [],
            supersedes_attempt_id: latestFailedValidationAttemptId,
          };

          appendCsvValidationErrors(
            errors,
            attachmentNormalization.schema_errors,
            attachmentNormalization.csv_row_findings
          );
        } catch (error) {
          attachmentRateLimitSnapshot = error.rate_limit_snapshot || null;
          request.accepted_attachment_submission = {
            ...request.accepted_attachment_submission,
            comment_id: candidate.comment_id || null,
            comment_created_at: candidate.comment_created_at || null,
            uploader_login: candidate.uploader_login || null,
            attachment_url: candidate.attachment_url,
            filename: candidate.filename || null,
            extension: candidate.extension || null,
            acceptance_status: 'rejected',
            rejection_reason: error.failure_reason || 'download_failed',
          };
          request.attachment_validation_attempt = {
            ...request.attachment_validation_attempt,
            attempt_id: `${request.request_id}:${candidate.comment_id}`,
            request_id: request.request_id,
            candidate_comment_id: candidate.comment_id || null,
            attempt_status: 'attachment_rejected',
            evaluated_at: new Date().toISOString(),
            errors: [error.message],
            warnings: [],
            supersedes_attempt_id: latestFailedValidationAttemptId,
          };
          errors.push(error.message);
        }
      }
    }
  }

  if (request.intake_mode === 'manual' && request.requested_repository_removals.length === 0) {
    errors.push('At least one valid requested repository is required.');
  }

  if (
    request.intake_mode === 'csv_attachment' &&
    request.request_status !== 'waiting_for_attachment' &&
    request.requested_repository_removals.length === 0
  ) {
    errors.push('At least one valid requested repository is required from the accepted CSV attachment.');
  }

  if (
    request.intake_mode &&
    request.intake_mode !== 'manual' &&
    request.intake_mode !== 'csv_attachment'
  ) {
    errors.push('Exactly one supported intake mode must be selected: manual or csv_attachment.');
  }

  const distinctApprovers = parseDistinctApproverLogins(request.designated_approver_login);
  if (distinctApprovers.length > 1) {
    errors.push('This request batch requires multiple distinct valid approvers. Split requests so each batch has exactly one designated approver.');
  }

  if (request.intake_mode !== 'manual' && request.intake_mode !== 'csv_attachment') {
    errors.push('Exactly one supported intake mode must be selected: manual or csv_attachment.');
  }

  if (request.duplicate_repositories.length > 0) {
    errors.push(`Duplicate requested repositories were detected: ${request.duplicate_repositories.join(', ')}`);
  }

  if (request.invalid_repositories.length > 0) {
    errors.push(`Invalid requested repositories: ${request.invalid_repositories.join(', ')}`);
  }

  if (request.conflicting_repositories.length > 0) {
    const outsideOrganization = request.conflicting_repositories
      .filter((entry) => !entry.conflict_reason || entry.conflict_reason === 'repository_outside_target_organization')
      .map((entry) => entry.repository_full_name)
      .join(', ');
    if (outsideOrganization) {
      errors.push(`Repositories outside the target organization were detected: ${outsideOrganization}`);
    }

    const normalizedConflicts = request.conflicting_repositories
      .filter((entry) => entry.conflict_reason === 'conflicting_repository_identifier')
      .map((entry) => entry.repository_full_name)
      .join(', ');
    if (normalizedConflicts) {
      errors.push(`Conflicting normalized repository identifiers were detected: ${normalizedConflicts}`);
    }
  }

  if (request.unsupported_inputs.requested_team_names) {
    errors.push('Team-creation input is out of scope for this workflow version and must be removed.');
  }

  if (request.unsupported_inputs.requested_people) {
    errors.push('Member-management input is out of scope for this workflow version and must be removed.');
  }

  if (request.unsupported_inputs.parent_team) {
    errors.push('Team-hierarchy input is out of scope for this workflow version and must be removed.');
  }

  if (request.unsupported_inputs.permission_level) {
    errors.push('Permission-level input is out of scope for repository-access removal and must be removed.');
  }

  let organizationVisible = false;
  if (request.organization && typeof getOrganization === 'function') {
    const organizationResult = await getOrganization({ organization: request.organization });
    organizationVisible = Boolean(organizationResult && organizationResult.exists);
    if (!organizationVisible) {
      errors.push('The target organization does not exist or is not visible to the workflow identity.');
    }
  }

  let teamExists = false;
  if (request.organization && request.team_slug && typeof getTeamBySlug === 'function') {
    const teamResult = await getTeamBySlug({
      organization: request.organization,
      teamSlug: request.team_slug,
    });
    teamExists = Boolean(teamResult && teamResult.exists);
    if (!teamExists) {
      errors.push('The requested target team does not exist in the target organization.');
    }
  }

  const resolvedApprover = await resolveTeamRepoApprover({
    organization: request.organization,
    approverLogin: request.designated_approver_login,
    designatedApproverLogin: request.designated_approver_login,
  }, {
    getOrganizationMembership,
  });

  const designatedApproverAuthorization = {
    login: resolvedApprover.approver_login,
    state: resolvedApprover.approver_authorization_state,
    membership_state: resolvedApprover.approver_membership_state,
    role: resolvedApprover.approver_role,
  };

  if (request.designated_approver_login && designatedApproverAuthorization.state !== 'authorized') {
    errors.push('The designated repository-access approver is not an active owner in the target organization.');
  }

  const validatedRemovals = [];
  const alreadyAbsentRepositoryRemovals = [];

  if (
    errors.length === 0 &&
    request.requested_repository_removals.length > 0 &&
    typeof getRepository === 'function' &&
    typeof getTeamRepositoryPermission === 'function'
  ) {
    for (const removal of request.requested_repository_removals) {
      const repositoryState = await getRepository({
        owner: removal.repository_owner,
        repo: removal.repository_name,
      });
      const teamRepositoryPermission = await getTeamRepositoryPermission({
        organization: request.organization,
        teamSlug: request.team_slug,
        owner: removal.repository_owner,
        repo: removal.repository_name,
      });
      const currentPermissionApiValue = teamRepositoryPermission.current_permission_api_value || 'none';
      const evaluated = classifyRepositoryRemoval(
        removal,
        request,
        repositoryState,
        currentPermissionApiValue
      );

      if (evaluated.desired_action === 'noop_already_absent') {
        alreadyAbsentRepositoryRemovals.push(evaluated);
      }

      validatedRemovals.push(evaluated);
    }
  }

  const rejectedItems = validatedRemovals.filter((entry) => entry.desired_action === 'reject');
  if (rejectedItems.length > 0) {
    errors.push(
      `Some repositories are not eligible for access removal: ${rejectedItems
        .map((item) => item.repository_full_name)
        .join(', ')}`
    );
  }

  const isValid = errors.length === 0 && request.request_status !== 'waiting_for_attachment';
  const requestStatus = request.request_status === 'waiting_for_attachment'
    ? 'waiting_for_attachment'
    : isValid
      ? 'awaiting_approval'
      : 'validation_failed';

  request.requested_repository_removals = validatedRemovals.length > 0
    ? validatedRemovals
    : request.requested_repository_removals;
  request.request_status = requestStatus;

  return {
    is_valid: isValid,
    request_status: requestStatus,
    errors,
    warnings,
    attachment_max_bytes: attachmentMaxBytes,
    attachment_rate_limit_snapshot: attachmentRateLimitSnapshot,
    accepted_attachment_submission: request.accepted_attachment_submission,
    attachment_validation_attempt: request.attachment_validation_attempt,
    bulk_csv_submission: request.bulk_csv_submission,
    csv_row_findings: request.csv_row_findings || [],
    csv_row_numbering_convention: request.csv_row_numbering_convention || null,
    organization_visible: organizationVisible,
    team_exists: teamExists,
    designated_approver_authorization: designatedApproverAuthorization,
    requested_repository_removals: request.requested_repository_removals,
    already_absent_repository_removals: alreadyAbsentRepositoryRemovals,
    request,
  };
}

module.exports = {
  parseDistinctApproverLogins,
  validateTeamRepoAccessRemovalRequest,
};
