'use strict';

const { parseTeamCreationRequest } = require('./parse-team-creation-request');
const { downloadCsvAttachment } = require('./download-csv-attachment');
const { hashAttachmentContent } = require('./hash-attachment-content');
const { normalizeBulkCsvRequestedTeams } = require('./normalize-bulk-csv-requested-teams');
const { resolveCsvAttachmentComment } = require('./resolve-csv-attachment-comment');
const { unwrapCodeFence } = require('./normalize-requested-teams');

function hasPopulatedInput(value) {
  return unwrapCodeFence(value).trim() !== '';
}

function describeCsvRowIssue(finding) {
  switch (finding.failure_reason) {
    case 'missing_team_name':
      return `CSV row ${finding.row_number} is missing the required team_name value.`;
    case 'invalid_team_name':
      return `CSV row ${finding.row_number} contains an invalid team_name${finding.team_name ? `: ${finding.team_name}` : ''}.`;
    case 'conflicting_slug':
      return `CSV row ${finding.row_number} conflicts with another row after slug normalization${finding.normalized_slug ? `: ${finding.normalized_slug}` : ''}.`;
    case 'inconsistent_shape':
      return `CSV row ${finding.row_number} does not match the header column count.`;
    default:
      return `CSV row ${finding.row_number} is invalid.`;
  }
}

function collectCsvRowFindingMessages(rowFindings = []) {
  const errors = [];
  const warnings = [];
  for (const finding of rowFindings) {
    if (finding.validation_status === 'blank') {
      continue;
    }
    if (finding.validation_status === 'duplicate') {
      warnings.push(
        `CSV row ${finding.row_number} duplicates team ${finding.team_name || 'unknown'} and was deduplicated.`
      );
      continue;
    }
    if (finding.validation_status === 'invalid') {
      errors.push(describeCsvRowIssue(finding));
    }
  }
  return { errors, warnings };
}

async function validateTeamCreationRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseTeamCreationRequest(input);
  const errors = [];
  const warnings = [];
  const getOrganization = options.getOrganization;
  const listTeams = options.listTeams;
  const resolveMembership = options.resolveMembership;
  const issueComments = options.issueComments || input.issueComments || input.issue_comments || [];
  const latestFailedValidationAt = options.latestFailedValidationAt || input.latestFailedValidationAt || null;
  const latestFailedValidationAttemptId = options.latestFailedValidationAttemptId || input.latestFailedValidationAttemptId || null;
  const terminalStateReached = ['executed', 'partially_executed', 'failed'].includes(request.request_status);
  let attachmentRateLimitSnapshot = null;

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.intended_owner_login) {
    errors.push('A single intended owner is required.');
  }

  const manualPopulated = hasPopulatedInput(request.requested_team_names_input);
  const bulkCsvPopulated = hasPopulatedInput(request.bulk_csv_input);

  if (manualPopulated === bulkCsvPopulated) {
    if (request.intake_mode !== 'csv_attachment') {
      errors.push('Exactly one intake source must be populated: requested_team_names or bulk_csv_requested_team_names.');
    }
  }

  if (!request.intake_mode) {
    errors.push('Exactly one supported intake mode must be selected: manual, bulk_csv, or csv_attachment.');
  }

  if (request.intake_mode === 'csv_attachment' && manualPopulated) {
    errors.push('requested_team_names must be empty when intake_mode is csv_attachment.');
  }

  if (request.intake_mode === 'csv_attachment' && bulkCsvPopulated) {
    errors.push('bulk_csv_requested_team_names must be empty when intake_mode is csv_attachment.');
  }

  if (request.intake_mode === 'bulk_csv') {
    const bulkCsvSubmission = request.bulk_csv_submission || {};
    for (const schemaError of bulkCsvSubmission.schema_errors || []) {
      errors.push(schemaError);
    }

    const rowMessages = collectCsvRowFindingMessages(request.csv_row_findings);
    errors.push(...rowMessages.errors);
    warnings.push(...rowMessages.warnings);
  }

  if (request.intake_mode === 'csv_attachment') {
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
      const candidate = attachmentResolution.candidate;
      try {
        const downloadedAttachment = await downloadCsvAttachment({
          attachmentUrl: candidate.attachment_url,
          token: options.token,
          fetchImpl: options.fetchImpl,
          maxBytes: options.maxAttachmentBytes,
          maxRetries: options.maxRetries,
          baseDelayMs: options.baseDelayMs,
          maxDelayMs: options.maxDelayMs,
          sleep: options.sleep,
        });
        attachmentRateLimitSnapshot = downloadedAttachment.rate_limit_snapshot;
        const attachmentHash = hashAttachmentContent(downloadedAttachment.text);
        const attachmentNormalization = normalizeBulkCsvRequestedTeams(downloadedAttachment.text);

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
        };
        request.requested_teams = attachmentNormalization.normalizedTeams.map((team) => ({
          ...team,
          intended_owner_login: request.intended_owner_login,
          validation_status: 'valid',
          desired_action: 'create_team',
          execution_result: 'not_started',
          failure_reason: null,
          source_comment_id: candidate.comment_id || null,
        }));
        request.requested_team_detail = attachmentNormalization.requestedTeamDetail.map((detail) => ({
          ...detail,
          intended_owner_login: request.intended_owner_login,
          source_comment_id: candidate.comment_id || null,
        }));
        request.duplicate_team_names = attachmentNormalization.duplicateTeamNames;
        request.conflicting_slugs = attachmentNormalization.conflictingSlugs;
        request.invalid_team_names = attachmentNormalization.invalidTeamNames;
        request.csv_row_findings = attachmentNormalization.csv_row_findings;
        request.validation_findings.duplicate_team_names = attachmentNormalization.duplicateTeamNames;
        request.validation_findings.conflicting_slugs = attachmentNormalization.conflictingSlugs;
        request.validation_findings.invalid_team_names = attachmentNormalization.invalidTeamNames;
        request.validation_findings.csv_row_findings = attachmentNormalization.csv_row_findings;
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

        for (const schemaError of attachmentNormalization.schema_errors || []) {
          errors.push(schemaError);
        }

        const rowMessages = collectCsvRowFindingMessages(attachmentNormalization.csv_row_findings);
        errors.push(...rowMessages.errors);
        warnings.push(...rowMessages.warnings);
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

  if (request.intake_mode === 'csv_attachment' && request.request_status !== 'waiting_for_attachment' && request.requested_teams.length === 0) {
    errors.push('At least one valid requested team name is required from the accepted CSV attachment.');
  }

  if (request.request_status !== 'waiting_for_attachment' && request.requested_teams.length === 0) {
    errors.push('At least one valid requested team name is required.');
  }

  if (!['bulk_csv', 'csv_attachment'].includes(request.intake_mode) && request.invalid_team_names.length > 0) {
    errors.push(`Invalid team names: ${request.invalid_team_names.join(', ')}`);
  }

  if (request.duplicate_team_names.length > 0) {
    warnings.push(
      `Duplicate team names were deduplicated: ${request.duplicate_team_names.join(', ')}`
    );
  }

  if (request.conflicting_slugs.length > 0) {
    const conflicting = request.conflicting_slugs.map((entry) => entry.slug).join(', ');
    errors.push(`Conflicting normalized team slugs were detected: ${conflicting}`);
  }

  const teamOwners = Array.from(new Set(
    (request.requested_teams || [])
      .map((team) => String(team && team.intended_owner_login || request.intended_owner_login || '').trim().toLowerCase())
      .filter(Boolean)
  ));

  if (teamOwners.length > 1) {
    errors.push('A single intended owner is required for the full request batch. Split the batch into separately approvable requests.');
  }

  if (request.unsupported_inputs && request.unsupported_inputs.parent_team) {
    errors.push('Parent-team input is out of scope for this workflow version and must be removed.');
  }

  if (request.unsupported_inputs && request.unsupported_inputs.requested_people) {
    errors.push('This workflow only creates empty teams. Remove team member names or membership instructions from the request.');
  }

  let organizationVisible = false;
  if (request.organization && typeof getOrganization === 'function') {
    const organizationResult = await getOrganization({ organization: request.organization });
    organizationVisible = Boolean(organizationResult && organizationResult.exists);
    if (!organizationVisible) {
      errors.push('The target organization does not exist or is not visible to the workflow identity.');
    }
  }

  let intendedOwnerMembership = {
    exists: false,
    state: 'unknown',
    role: 'unknown',
  };
  if (
    request.organization &&
    request.intended_owner_login &&
    typeof resolveMembership === 'function'
  ) {
    const membershipResult = await resolveMembership({
      organization: request.organization,
      username: request.intended_owner_login,
    });
    intendedOwnerMembership = {
      exists: Boolean(membershipResult && membershipResult.exists),
      state:
        membershipResult && membershipResult.membership
          ? membershipResult.membership.state || 'active'
          : 'absent',
      role:
        membershipResult && membershipResult.membership
          ? membershipResult.membership.role || 'member'
          : 'unknown',
    };

    if (!intendedOwnerMembership.exists || intendedOwnerMembership.state !== 'active') {
      errors.push('The intended owner is not an active member of the target organization.');
    }
  }

  let currentTeams = [];
  if (request.organization && typeof listTeams === 'function') {
    currentTeams = await listTeams({ organization: request.organization });
  }

  const currentTeamMap = new Map(
    currentTeams
      .filter((team) => team && team.slug)
      .map((team) => [String(team.slug).toLowerCase(), team])
  );

  const requestedTeams = request.requested_teams.map((team) => {
    const currentTeam = currentTeamMap.get(team.normalized_slug);
    if (currentTeam) {
      return {
        ...team,
        validation_status: 'existing',
        desired_action: 'noop',
        current_team_id: currentTeam.id || null,
      };
    }

    return {
      ...team,
      validation_status: 'valid',
      desired_action: 'create_team',
      current_team_id: null,
    };
  });

  return {
    is_valid: errors.length === 0 && request.request_status !== 'waiting_for_attachment',
    request_status: request.request_status === 'waiting_for_attachment'
      ? 'waiting_for_attachment'
      : errors.length === 0
        ? 'awaiting_approval'
        : 'validation_failed',
    errors,
    warnings,
    organization_visible: organizationVisible,
    intended_owner_membership: intendedOwnerMembership,
    attachment_rate_limit_snapshot: attachmentRateLimitSnapshot,
    attachment_validation_attempt: request.attachment_validation_attempt,
    accepted_attachment_submission: request.accepted_attachment_submission,
    bulk_csv_submission: request.bulk_csv_submission,
    csv_row_findings: request.csv_row_findings || [],
    csv_row_numbering_convention: request.csv_row_numbering_convention,
    requested_teams: requestedTeams,
    existing_teams: requestedTeams.filter((team) => team.desired_action === 'noop'),
    request: {
      ...request,
      requested_teams: requestedTeams,
      request_status: request.request_status === 'waiting_for_attachment'
        ? 'waiting_for_attachment'
        : errors.length === 0
          ? 'awaiting_approval'
          : 'validation_failed',
    },
  };
}

module.exports = {
  validateTeamCreationRequest,
};