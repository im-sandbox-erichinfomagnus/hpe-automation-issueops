'use strict';

const crypto = require('crypto');

const {
  ALLOWED_REPO_ADMIN_OPERATIONS,
  parseRepoAdminMembershipRequest,
} = require('./parse-repo-admin-membership-request');
const { unwrapCodeFence } = require('./normalize-requested-people');
const {
  describeBulkCsvRowIssue,
  normalizeBulkCsvRequestedPeople,
} = require('./normalize-bulk-csv-requested-people');
const { downloadCsvAttachment } = require('./download-csv-attachment');
const { hashAttachmentContent } = require('./hash-attachment-content');
const { resolveCsvAttachmentComment } = require('./resolve-csv-attachment-comment');
const { readTenantRegistryRecords } = require('./resolve-tenant-context-from-registry');
const { readTopologyView } = require('./resolve-tenant-cicd-context-from-registry');

const REPO_ADMIN_TEAM_SUFFIX = '-repo-admin';

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTenantName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hasPopulatedInput(value) {
  return unwrapCodeFence(value).trim() !== '';
}

// create-tenant-model already provisions <tenantKey>-repo-admin at bootstrap;
// the registry topology slug wins, the suffix derivation is only a fallback.
function deriveRepoAdminTeamSlug(tenantKey) {
  const normalized = normalizeLogin(tenantKey);
  return normalized ? `${normalized}${REPO_ADMIN_TEAM_SUFFIX}` : '';
}

function buildRepoAdminMembershipContextMarker(input = {}) {
  const payload = JSON.stringify({
    operation: 'repo_admin_membership',
    organization: normalizeLogin(input.organization),
    tenant_key: normalizeLogin(input.tenant_key),
    tenant_team_slug: normalizeLogin(input.tenant_team_slug),
    repo_admin_team_slug: normalizeLogin(input.repo_admin_team_slug),
    requested_people: [...(input.requested_people || [])].sort(),
    registry_ref: String(input.registry_ref || 'main'),
  });

  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  return `repo-admin-membership-context:${digest}`;
}

async function validateRepoAdminMembershipRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseRepoAdminMembershipRequest(input);
  // Audit-artifact request payloads do not persist validation_findings, so
  // approved-execution revalidation must re-initialize it before any mutation.
  request.validation_findings = request.validation_findings && typeof request.validation_findings === 'object'
    ? request.validation_findings
    : {};
  const errors = [];
  const warnings = [];

  const registryRef = String(options.registryRef || process.env.TENANT_REGISTRY_REF || 'main');
  const organization = normalizeLogin(request.organization);
  const requesterLogin = normalizeLogin(request.requester_login);
  const tenantNameNormalized = normalizeTenantName(request.tenant_name_normalized || request.tenant_name_input);
  const issueComments = options.issueComments || input.issueComments || input.issue_comments || [];
  const latestFailedValidationAt = options.latestFailedValidationAt || input.latestFailedValidationAt || null;
  const latestFailedValidationAttemptId = options.latestFailedValidationAttemptId || input.latestFailedValidationAttemptId || null;
  const terminalStateReached = ['executed', 'partially_executed', 'failed'].includes(request.request_status);
  let attachmentRateLimitSnapshot = null;

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.tenant_name_input) {
    errors.push('Tenant name is required.');
  }

  if (!ALLOWED_REPO_ADMIN_OPERATIONS.includes(request.repo_admin_operation)) {
    errors.push(`Repo admin operation '${request.repo_admin_operation || ''}' is invalid. Allowed values are: ${ALLOWED_REPO_ADMIN_OPERATIONS.join(', ')}.`);
  }

  const manualPopulated = hasPopulatedInput(request.requested_people_input);

  if (!request.intake_mode) {
    errors.push('Exactly one supported intake mode must be selected: manual or csv_attachment.');
  }

  if (request.intake_mode === 'csv_attachment' && manualPopulated) {
    errors.push('requested_people must be empty when intake_mode is csv_attachment.');
  }

  // Approved-execution revalidation reuses the enriched request whose attachment
  // was already accepted; skip attachment re-resolution in that case.
  const attachmentAlreadyAccepted =
    request.intake_mode === 'csv_attachment' &&
    request.accepted_attachment_submission &&
    request.accepted_attachment_submission.acceptance_status === 'accepted' &&
    Array.isArray(request.requested_people) &&
    request.requested_people.length > 0;

  if (request.intake_mode === 'csv_attachment' && !attachmentAlreadyAccepted) {
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
        const attachmentNormalization = normalizeBulkCsvRequestedPeople(downloadedAttachment.text);

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
        request.requested_people = attachmentNormalization.normalizedPeople;
        request.requested_people_detail = attachmentNormalization.requestedPeopleDetail.map((detail) => ({
          ...detail,
          source_comment_id: candidate.comment_id || null,
        }));
        request.duplicate_people = attachmentNormalization.duplicatePeople;
        request.invalid_people = attachmentNormalization.invalidPeople;
        request.csv_row_findings = attachmentNormalization.csv_row_findings;
        request.validation_findings.duplicate_people = attachmentNormalization.duplicatePeople;
        request.validation_findings.invalid_people = attachmentNormalization.invalidPeople;
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

        for (const finding of attachmentNormalization.csv_row_findings || []) {
          if (finding.validation_status === 'blank') {
            continue;
          }
          if (finding.validation_status === 'duplicate') {
            warnings.push(
              `CSV row ${finding.row_number} duplicates username ${finding.username || 'unknown'} and was deduplicated.`
            );
            continue;
          }
          if (finding.validation_status === 'invalid') {
            errors.push(describeBulkCsvRowIssue(finding));
          }
        }
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

  if (request.intake_mode === 'manual' && request.requested_people.length === 0) {
    errors.push('At least one valid requested person is required.');
  }

  if (request.intake_mode === 'csv_attachment' && request.request_status !== 'waiting_for_attachment' && request.requested_people.length === 0) {
    errors.push('At least one valid requested person is required from the accepted CSV attachment.');
  }

  if (request.intake_mode !== 'csv_attachment' && request.invalid_people.length > 0) {
    errors.push(`Invalid GitHub usernames: ${request.invalid_people.join(', ')}`);
  }

  if (request.duplicate_people.length > 0) {
    warnings.push(`Duplicate usernames were deduplicated: ${request.duplicate_people.join(', ')}`);
  }

  let organizationVisible = false;
  if (request.organization && typeof options.getOrganization === 'function') {
    const organizationResult = await options.getOrganization({ organization: request.organization });
    organizationVisible = Boolean(organizationResult && organizationResult.exists);
    if (!organizationVisible) {
      errors.push('The target organization does not exist or is not visible to the workflow identity.');
    }
  }

  const registryResult = readTenantRegistryRecords({ registryDirectory: options.registryDirectory });
  if (registryResult.missing_directory) {
    errors.push('Tenant registry directory is missing in the workflow workspace.');
  }
  if (registryResult.malformed_files && registryResult.malformed_files.length > 0) {
    warnings.push('One or more tenant registry records were malformed and ignored.');
  }

  const orgViews = registryResult.records
    .map((record) => readTopologyView(record))
    .filter((view) => view.organization && view.organization === organization);
  const nameMatches = tenantNameNormalized
    ? orgViews.filter((view) => normalizeTenantName(view.tenant_display_name) === tenantNameNormalized)
    : orgViews;

  let tenantResolutionStatus = 'no_match';
  if (registryResult.malformed_files.length > 0 && orgViews.length === 0) {
    tenantResolutionStatus = 'registry_conflict';
  } else if (nameMatches.length === 1) {
    tenantResolutionStatus = 'resolved';
  } else if (nameMatches.length > 1) {
    tenantResolutionStatus = 'ambiguous';
  }

  const resolvedView = tenantResolutionStatus === 'resolved' ? nameMatches[0] : null;
  const availableTenantDisplayNames = [...new Set(orgViews
    .map((view) => String(view.tenant_display_name || '').split(/[\r\n]+/)[0].trim())
    .filter(Boolean))];

  if (!resolvedView) {
    if (tenantResolutionStatus === 'ambiguous') {
      errors.push(`Tenant name '${request.tenant_name_input}' matched multiple tenant records in organization '${request.organization}' and is ambiguous.`);
    } else if (tenantResolutionStatus === 'registry_conflict') {
      errors.push('Tenant registry data is malformed or conflicting for the target organization.');
    } else if (request.tenant_name_input) {
      errors.push(`No tenant record was found for tenant name '${request.tenant_name_input}' in organization '${request.organization}'.`);
      if (availableTenantDisplayNames.length > 0) {
        warnings.push(`Available tenant names in this organization: ${availableTenantDisplayNames.join(', ')}`);
      }
    } else {
      errors.push('Tenant context could not be resolved from the registry.');
    }
  }

  const tenantKey = resolvedView ? resolvedView.tenant_key : '';
  const tenantDisplayName = resolvedView ? resolvedView.tenant_display_name : '';
  const tenantTeamSlug = resolvedView ? resolvedView.tenant_root_team_slug : '';
  const repoAdminTeamSlug = resolvedView
    ? (resolvedView.repo_admin_team_slug || deriveRepoAdminTeamSlug(tenantKey))
    : '';

  // Authorization gate (per Uma + design doc §5.3): an active target org owner
  // OR an active maintainer of the tenant root team may call this operation.
  // Deliberately wider than the root-maintainer-only gate used by
  // add-cicd-admin-to-tenant (#26).
  let requesterMembershipState = 'unknown';
  let requesterOrgRole = 'unknown';
  let isTopTeamMaintainer = false;
  let isOrgAdmin = false;
  if (resolvedView && !tenantTeamSlug) {
    errors.push(`Tenant '${tenantDisplayName}' has no resolvable top team and cannot authorize repo admin membership management.`);
  } else if (resolvedView) {
    if (typeof options.getOrganizationMembership === 'function') {
      const requesterOrgMembership = await options.getOrganizationMembership({
        organization,
        username: requesterLogin,
      });
      const orgState = requesterOrgMembership && requesterOrgMembership.membership && requesterOrgMembership.membership.state
        ? String(requesterOrgMembership.membership.state).toLowerCase()
        : 'absent';
      requesterOrgRole = requesterOrgMembership && requesterOrgMembership.membership && requesterOrgMembership.membership.role
        ? String(requesterOrgMembership.membership.role).toLowerCase()
        : 'absent';
      isOrgAdmin = orgState === 'active' && requesterOrgRole === 'admin';
    }

    if (typeof options.getMembershipForUser === 'function') {
      const topMembership = await options.getMembershipForUser({
        organization,
        teamSlug: tenantTeamSlug,
        username: requesterLogin,
      });
      const topState = topMembership && topMembership.state ? String(topMembership.state).toLowerCase() : 'absent';
      const topRole = topMembership && topMembership.membership && topMembership.membership.role
        ? String(topMembership.membership.role).toLowerCase()
        : '';

      requesterMembershipState = topState === 'active' && topRole === 'maintainer'
        ? 'active_maintainer'
        : topState === 'active'
          ? 'active_member'
          : topState === 'absent'
            ? 'absent'
            : 'unknown';
      isTopTeamMaintainer = requesterMembershipState === 'active_maintainer';
    }

    if (!isOrgAdmin && !isTopTeamMaintainer) {
      errors.push(`Requester '${request.requester_login}' is not an active target organization owner and is not an active maintainer of the tenant top team '${tenantTeamSlug}' and cannot manage repo admin membership for tenant '${tenantDisplayName}'.`);
    }
  }

  let rootTeamExists = false;
  let rootTeamId = null;
  let repoAdminTeamExists = false;
  let repoAdminTeamSyncBlocked = false;
  if (resolvedView && tenantTeamSlug && typeof options.getTeamBySlug === 'function') {
    const rootTeamResult = await options.getTeamBySlug({
      organization,
      teamSlug: tenantTeamSlug,
    });
    rootTeamExists = Boolean(rootTeamResult && rootTeamResult.exists);
    rootTeamId = rootTeamResult && rootTeamResult.team ? rootTeamResult.team.id : null;
    if (!rootTeamExists) {
      errors.push(`The tenant root team '${tenantTeamSlug}' does not exist or is not visible to the workflow identity.`);
    }

    if (repoAdminTeamSlug) {
      const repoAdminTeamResult = await options.getTeamBySlug({
        organization,
        teamSlug: repoAdminTeamSlug,
      });
      repoAdminTeamExists = Boolean(repoAdminTeamResult && repoAdminTeamResult.exists);
      repoAdminTeamSyncBlocked = Boolean(repoAdminTeamResult && repoAdminTeamResult.team_sync_blocked);
      if (repoAdminTeamSyncBlocked) {
        errors.push(`The tenant repo admin team '${repoAdminTeamSlug}' is synchronized by IdP and cannot be mutated through the API.`);
      }
    }
  }

  let designatedApproverAuthorization = null;

  const requestedPeople = [];
  const requestedPeopleDetailMap = new Map(
    (request.requested_people_detail || [])
      .filter((detail) => detail && detail.username)
      .map((detail) => [detail.username, detail])
  );
  for (const username of request.requested_people) {
    let resolutionStatus = 'resolved';
    let failureReason = null;

    if (typeof options.resolveUser === 'function') {
      const resolved = await options.resolveUser({
        organization: request.organization,
        username,
      });

      if (!resolved || resolved.exists === false) {
        resolutionStatus = 'unresolved';
        failureReason = 'user_not_found';
        errors.push(`Requested user ${username} could not be resolved in the organization context.`);
      }
    }

    requestedPeople.push({
      username,
      source_row_number: requestedPeopleDetailMap.get(username)
        ? requestedPeopleDetailMap.get(username).source_row_number || null
        : null,
      source_comment_id: requestedPeopleDetailMap.get(username)
        ? requestedPeopleDetailMap.get(username).source_comment_id || null
        : null,
      resolution_status: resolutionStatus,
      current_membership_state: 'unknown',
      desired_action: resolutionStatus === 'resolved' ? 'add_member' : 'reject',
      execution_result: 'not_started',
      failure_reason: failureReason,
    });
  }

  if (request.dry_run) {
    warnings.push('Dry-run is enabled; reconciliation intent is reported without mutation.');
  }

  const requestStatus = request.request_status === 'waiting_for_attachment'
    ? 'waiting_for_attachment'
    : errors.length === 0
      ? 'awaiting_approval'
      : 'validation_failed';
  const contextMarker = resolvedView
    ? buildRepoAdminMembershipContextMarker({
        organization,
        tenant_key: tenantKey,
        tenant_team_slug: tenantTeamSlug,
        repo_admin_team_slug: repoAdminTeamSlug,
        requested_people: request.requested_people,
        registry_ref: registryRef,
      })
    : '';

  const canonicalTenantContext = resolvedView
    ? {
        tenant_key: tenantKey,
        tenant_display_name: tenantDisplayName,
        organization,
        registry_ref: registryRef,
        tenant_team_name: tenantTeamSlug,
        tenant_team_slug: tenantTeamSlug,
        repo_admin_team_slug: repoAdminTeamSlug,
        requester_membership_state: requesterMembershipState,
        requester_org_role: requesterOrgRole,
        tenant_resolution_status: tenantResolutionStatus,
        context_marker: contextMarker,
      }
    : null;

  const enrichedRequest = {
    ...request,
    tenant_key: tenantKey,
    tenant_display_name: tenantDisplayName,
    tenant_team_name: tenantTeamSlug,
    tenant_team_slug: tenantTeamSlug,
    repo_admin_team_slug: repoAdminTeamSlug,
    context_marker: contextMarker,
    request_status: requestStatus,
  };

  const plan = {
    organization,
    repo_admin_operation: request.repo_admin_operation,
    repo_admin_team_slug: repoAdminTeamSlug,
    tenant_root_team_slug: tenantTeamSlug,
    tenant_root_team_id: rootTeamId,
    team_action: repoAdminTeamExists ? 'noop' : 'create_team',
    dry_run: Boolean(request.dry_run),
  };

  return {
    is_valid: errors.length === 0 && requestStatus !== 'waiting_for_attachment',
    request_status: requestStatus,
    errors,
    warnings,
    organization_visible: organizationVisible,
    root_team_exists: rootTeamExists,
    root_team_id: rootTeamId,
    repo_admin_team_exists: repoAdminTeamExists,
    repo_admin_team_sync_blocked: repoAdminTeamSyncBlocked,
    designated_approver_authorization: designatedApproverAuthorization,
    canonical_tenant_context: canonicalTenantContext,
    tenant_resolution: {
      tenant_match_count: nameMatches.length,
      tenant_resolution_status: tenantResolutionStatus,
      registry_ref: registryRef,
      registry_directory: registryResult.registry_directory,
      registry_malformed_files: registryResult.malformed_files,
      registry_missing_directory: registryResult.missing_directory,
      requested_tenant_name: request.tenant_name_input,
      requested_tenant_name_normalized: tenantNameNormalized,
      candidate_registry_record_count: nameMatches.length,
      available_tenant_display_names: availableTenantDisplayNames,
    },
    attachment_rate_limit_snapshot: attachmentRateLimitSnapshot,
    attachment_validation_attempt: request.attachment_validation_attempt,
    accepted_attachment_submission: request.accepted_attachment_submission,
    bulk_csv_submission: request.bulk_csv_submission,
    csv_row_findings: request.csv_row_findings || [],
    csv_row_numbering_convention: request.csv_row_numbering_convention,
    requested_people: requestedPeople,
    plan,
    validation_findings: {
      tenant_resolution_status: tenantResolutionStatus,
      requester_membership_state: requesterMembershipState,
      requester_org_role: requesterOrgRole,
      repo_admin_team_slug: repoAdminTeamSlug,
      repo_admin_team_exists: repoAdminTeamExists,
      team_action: plan.team_action,
      context_marker: contextMarker,
      dry_run_no_mutation: Boolean(request.dry_run),
    },
    no_mutation_planned: true,
    request: enrichedRequest,
  };
}

module.exports = {
  REPO_ADMIN_TEAM_SUFFIX,
  buildRepoAdminMembershipContextMarker,
  deriveRepoAdminTeamSlug,
  validateRepoAdminMembershipRequest,
};
