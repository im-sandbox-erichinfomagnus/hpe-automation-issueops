'use strict';

const crypto = require('crypto');

const {
  ALLOWED_SUBTEAM_OPERATIONS,
  parseTenantSubteamRequest,
} = require('./parse-tenant-subteam-request');
const { unwrapCodeFence } = require('./normalize-requested-teams');
const { normalizeBulkCsvRequestedSubteams } = require('./normalize-bulk-csv-requested-subteams');
const { downloadCsvAttachment } = require('./download-csv-attachment');
const { hashAttachmentContent } = require('./hash-attachment-content');
const { resolveCsvAttachmentComment } = require('./resolve-csv-attachment-comment');
const { readTenantRegistryRecords } = require('./resolve-tenant-context-from-registry');
const { readTopologyView } = require('./resolve-tenant-cicd-context-from-registry');

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTenantName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hasPopulatedInput(value) {
  return unwrapCodeFence(value).trim() !== '';
}

// Subteams follow the tenant naming convention: <tenantKey>-<subteam-slug>.
// Requested names that already carry the tenant prefix are not double-prefixed.
function deriveTenantSubteamSlug(tenantKey, subteamSlug) {
  const normalizedKey = normalizeLogin(tenantKey);
  const normalizedSubteam = normalizeLogin(subteamSlug);
  if (!normalizedKey || !normalizedSubteam) {
    return '';
  }
  if (normalizedSubteam.startsWith(`${normalizedKey}-`)) {
    return normalizedSubteam;
  }
  return `${normalizedKey}-${normalizedSubteam}`;
}

function buildTenantSubteamContextMarker(input = {}) {
  const payload = JSON.stringify({
    operation: 'tenant_subteam_creation',
    organization: normalizeLogin(input.organization),
    tenant_key: normalizeLogin(input.tenant_key),
    tenant_team_slug: normalizeLogin(input.tenant_team_slug),
    parent_team_slug: normalizeLogin(input.parent_team_slug),
    designated_approver_login: normalizeLogin(input.designated_approver_login),
    requested_subteam_slugs: [...(input.requested_subteam_slugs || [])].sort(),
    registry_ref: String(input.registry_ref || 'main'),
  });

  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  return `tenant-subteam-context:${digest}`;
}

async function validateTenantSubteamRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseTenantSubteamRequest(input);
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

  if (!ALLOWED_SUBTEAM_OPERATIONS.includes(request.subteam_operation)) {
    errors.push(`Subteam operation '${request.subteam_operation || ''}' is invalid. Allowed values are: ${ALLOWED_SUBTEAM_OPERATIONS.join(', ')}.`);
  }

  if (!request.designated_approver_login) {
    errors.push('A designated approver is required.');
  }

  const manualPopulated = hasPopulatedInput(request.requested_team_names_input);

  if (!request.intake_mode) {
    errors.push('Exactly one supported intake mode must be selected: manual or csv_attachment.');
  }

  if (request.intake_mode === 'csv_attachment' && manualPopulated) {
    errors.push('requested_subteams must be empty when intake_mode is csv_attachment.');
  }

  // Approved-execution revalidation reuses the enriched request whose attachment
  // was already accepted; skip attachment re-resolution in that case.
  const attachmentAlreadyAccepted =
    request.intake_mode === 'csv_attachment' &&
    request.accepted_attachment_submission &&
    request.accepted_attachment_submission.acceptance_status === 'accepted' &&
    Array.isArray(request.requested_teams) &&
    request.requested_teams.length > 0;

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
        const attachmentNormalization = normalizeBulkCsvRequestedSubteams(downloadedAttachment.text);

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
        request.requested_teams = attachmentNormalization.normalizedTeams;
        request.requested_team_detail = attachmentNormalization.requestedTeamDetail;
        request.duplicate_team_names = attachmentNormalization.duplicateTeamNames;
        request.conflicting_slugs = attachmentNormalization.conflictingSlugs;
        request.invalid_team_names = attachmentNormalization.invalidTeamNames;
        request.csv_row_findings = attachmentNormalization.csv_row_findings;
        request.validation_findings.duplicate_team_names = attachmentNormalization.duplicateTeamNames;
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

        for (const finding of attachmentNormalization.csv_row_findings || []) {
          if (finding.validation_status === 'blank') {
            continue;
          }
          if (finding.validation_status === 'duplicate') {
            warnings.push(
              `CSV row ${finding.row_number} duplicates subteam ${finding.team_name || 'unknown'} and was deduplicated.`
            );
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

  if (request.intake_mode === 'manual' && request.requested_teams.length === 0) {
    errors.push('At least one valid requested subteam name is required.');
  }

  if (request.intake_mode === 'csv_attachment' && request.request_status !== 'waiting_for_attachment' && request.requested_teams.length === 0) {
    errors.push('At least one valid requested subteam name is required from the accepted CSV attachment.');
  }

  if (request.invalid_team_names.length > 0) {
    errors.push(`Invalid subteam names: ${request.invalid_team_names.join(', ')}`);
  }

  if (request.duplicate_team_names.length > 0) {
    warnings.push(`Duplicate subteam names were deduplicated: ${request.duplicate_team_names.join(', ')}`);
  }

  if (request.conflicting_slugs.length > 0) {
    errors.push(`Conflicting subteam slugs: ${request.conflicting_slugs.map((entry) => entry.slug).join(', ')}`);
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

  // Authorization gate (per Uma + design doc §5.3, same as add-repo-admin-to-tenant):
  // an active target org owner OR an active maintainer of the tenant root team.
  let requesterMembershipState = 'unknown';
  let requesterOrgRole = 'unknown';
  let isTopTeamMaintainer = false;
  let isOrgAdmin = false;
  if (resolvedView && !tenantTeamSlug) {
    errors.push(`Tenant '${tenantDisplayName}' has no resolvable top team and cannot authorize subteam creation.`);
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
      errors.push(`Requester '${request.requester_login}' is not an active target organization owner and is not an active maintainer of the tenant top team '${tenantTeamSlug}' and cannot create subteams for tenant '${tenantDisplayName}'.`);
    }
  }

  let rootTeamExists = false;
  let rootTeamId = null;
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
  }

  // Parent resolution: default is the tenant root team; an explicit parent must
  // belong to the tenant (root or a <tenantKey>- prefixed child) and exist.
  // Re-parenting subteams under other subteams post-creation is a v2 follow-up.
  let parentTeamSlug = tenantTeamSlug;
  let parentTeamId = rootTeamId;
  let parentTeamExists = rootTeamExists;
  const requestedParentSlug = normalizeLogin(request.parent_team_slug);
  if (resolvedView && requestedParentSlug && requestedParentSlug !== tenantTeamSlug) {
    const belongsToTenant = requestedParentSlug.startsWith(`${tenantKey}-`);
    if (!belongsToTenant) {
      errors.push(`Parent team '${requestedParentSlug}' does not belong to tenant '${tenantDisplayName}' (expected the tenant root team or a '${tenantKey}-' prefixed team).`);
      parentTeamExists = false;
      parentTeamSlug = requestedParentSlug;
      parentTeamId = null;
    } else if (typeof options.getTeamBySlug === 'function') {
      const parentResult = await options.getTeamBySlug({
        organization,
        teamSlug: requestedParentSlug,
      });
      parentTeamExists = Boolean(parentResult && parentResult.exists);
      parentTeamId = parentResult && parentResult.team ? parentResult.team.id : null;
      parentTeamSlug = requestedParentSlug;
      if (!parentTeamExists) {
        errors.push(`Parent team '${requestedParentSlug}' does not exist or is not visible to the workflow identity.`);
      }
    }
  }

  let designatedApproverAuthorization = {
    state: 'unknown',
    role: 'other',
  };
  if (request.organization && request.designated_approver_login && typeof options.getOrganizationMembership === 'function') {
    const approverMembership = await options.getOrganizationMembership({
      organization: request.organization,
      username: request.designated_approver_login,
    });

    const approverState = approverMembership && approverMembership.membership && approverMembership.membership.state
      ? String(approverMembership.membership.state).toLowerCase()
      : 'absent';
    const approverRole = approverMembership && approverMembership.membership && approverMembership.membership.role
      ? String(approverMembership.membership.role).toLowerCase()
      : 'other';

    designatedApproverAuthorization = {
      state: approverState === 'active' && approverRole === 'admin' ? 'authorized' : 'unauthorized',
      role: approverRole,
    };

    if (designatedApproverAuthorization.state !== 'authorized') {
      errors.push('Designated approver must be an active target organization owner.');
    }
  }

  const requestedTeams = [];
  for (const team of request.requested_teams) {
    const fullSlug = deriveTenantSubteamSlug(tenantKey, team.normalized_slug);
    let currentState = 'unknown';

    if (resolvedView && fullSlug && typeof options.getTeamBySlug === 'function') {
      const teamResult = await options.getTeamBySlug({
        organization,
        teamSlug: fullSlug,
      });
      currentState = teamResult && teamResult.exists ? 'present' : 'absent';
    }

    requestedTeams.push({
      requested_name: team.requested_name,
      base_slug: team.normalized_slug,
      normalized_slug: fullSlug,
      source_row_number: team.source_row_number || null,
      validation_status: 'valid',
      current_state: currentState,
      desired_action: currentState === 'present' ? 'noop' : 'create_team',
      execution_result: 'not_started',
      failure_reason: null,
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
    ? buildTenantSubteamContextMarker({
        organization,
        tenant_key: tenantKey,
        tenant_team_slug: tenantTeamSlug,
        parent_team_slug: parentTeamSlug,
        designated_approver_login: request.designated_approver_login,
        requested_subteam_slugs: requestedTeams.map((team) => team.normalized_slug),
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
        parent_team_slug: parentTeamSlug,
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
    parent_team_slug: parentTeamSlug,
    requested_teams: requestedTeams,
    context_marker: contextMarker,
    request_status: requestStatus,
  };

  const plan = {
    organization,
    subteam_operation: request.subteam_operation,
    parent_team_slug: parentTeamSlug,
    parent_team_id: parentTeamId,
    tenant_root_team_slug: tenantTeamSlug,
    tenant_root_team_id: rootTeamId,
    subteams_to_create: requestedTeams.filter((team) => team.desired_action === 'create_team').length,
    subteams_already_present: requestedTeams.filter((team) => team.desired_action === 'noop').length,
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
    parent_team_exists: parentTeamExists,
    parent_team_id: parentTeamId,
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
    requested_teams: requestedTeams,
    plan,
    validation_findings: {
      tenant_resolution_status: tenantResolutionStatus,
      requester_membership_state: requesterMembershipState,
      requester_org_role: requesterOrgRole,
      parent_team_slug: parentTeamSlug,
      subteams_to_create: plan.subteams_to_create,
      subteams_already_present: plan.subteams_already_present,
      context_marker: contextMarker,
      dry_run_no_mutation: Boolean(request.dry_run),
    },
    no_mutation_planned: true,
    request: enrichedRequest,
  };
}

module.exports = {
  buildTenantSubteamContextMarker,
  deriveTenantSubteamSlug,
  validateTenantSubteamRequest,
};
