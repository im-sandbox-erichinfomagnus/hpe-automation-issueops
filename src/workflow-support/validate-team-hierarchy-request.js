'use strict';

const { parseTeamHierarchyRequest } = require('./parse-team-hierarchy-request');
const { downloadCsvAttachment } = require('./download-csv-attachment');
const { hashAttachmentContent } = require('./hash-attachment-content');
const { normalizeBulkCsvRequestedChildTeams } = require('./normalize-bulk-csv-requested-child-teams');
const { resolveCsvAttachmentComment } = require('./resolve-csv-attachment-comment');
const { unwrapCodeFence } = require('./normalize-requested-child-teams');
const { resolveTeamHierarchyAttachmentMaxBytes } = require('../actions/team-hierarchy-policy');

function hasPopulatedInput(value) {
  return unwrapCodeFence(value).trim() !== '';
}

function normalizeTeamSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function canonicalizeTeamSlug(value) {
  return normalizeTeamSlug(value).replace(/[-_]+/g, '-');
}

function buildTeamLookupMaps(currentTeams = []) {
  const exactMap = new Map();
  const canonicalMap = new Map();
  const canonicalVariantsMap = new Map();

  for (const team of currentTeams) {
    if (!team || !team.slug) {
      continue;
    }

    const exactSlug = normalizeTeamSlug(team.slug);
    const canonicalSlug = canonicalizeTeamSlug(team.slug);

    exactMap.set(exactSlug, team);

    if (!canonicalMap.has(canonicalSlug)) {
      canonicalMap.set(canonicalSlug, team);
      canonicalVariantsMap.set(canonicalSlug, [team]);
    } else {
      const existing = canonicalMap.get(canonicalSlug);
      if (existing && normalizeTeamSlug(existing.slug) !== exactSlug) {
        // Ambiguous canonical key: keep exact matching only.
        canonicalMap.set(canonicalSlug, null);
      }

      const variants = canonicalVariantsMap.get(canonicalSlug) || [];
      variants.push(team);
      canonicalVariantsMap.set(canonicalSlug, variants);
    }
  }

  return {
    exactMap,
    canonicalMap,
    canonicalVariantsMap,
  };
}

function resolveTeamFromLookup(teamSlug, lookupMaps) {
  const exactSlug = normalizeTeamSlug(teamSlug);
  if (!exactSlug) {
    return null;
  }

  if (lookupMaps.exactMap.has(exactSlug)) {
    return lookupMaps.exactMap.get(exactSlug);
  }

  return lookupMaps.canonicalMap.get(canonicalizeTeamSlug(exactSlug)) || null;
}

function resolveTeamVariantsFromLookup(teamSlug, lookupMaps) {
  const exactSlug = normalizeTeamSlug(teamSlug);
  if (!exactSlug) {
    return [];
  }

  const canonicalSlug = canonicalizeTeamSlug(exactSlug);
  const exactTeam = lookupMaps.exactMap.get(exactSlug) || null;
  const canonicalVariants = lookupMaps.canonicalVariantsMap.get(canonicalSlug) || [];

  if (!exactTeam) {
    return canonicalVariants;
  }

  const deduped = [exactTeam];
  for (const team of canonicalVariants) {
    if (!team || normalizeTeamSlug(team.slug) === normalizeTeamSlug(exactTeam.slug)) {
      continue;
    }

    deduped.push(team);
  }

  return deduped;
}

function resolveChildTeamFromLookup(teamSlug, requestedParentCanonicalSlug, lookupMaps) {
  const exactSlug = normalizeTeamSlug(teamSlug);
  if (!exactSlug) {
    return null;
  }

  const canonicalSlug = canonicalizeTeamSlug(exactSlug);
  const exactTeam = lookupMaps.exactMap.get(exactSlug) || null;
  const canonicalVariants = lookupMaps.canonicalVariantsMap.get(canonicalSlug) || [];

  const hasParentMatch = (team) => {
    const parentSlug = team && team.parent && team.parent.slug ? team.parent.slug : null;
    return canonicalizeTeamSlug(parentSlug) === requestedParentCanonicalSlug;
  };

  if (exactTeam && hasParentMatch(exactTeam)) {
    return exactTeam;
  }

  const parentMatchedVariants = canonicalVariants.filter((team) => hasParentMatch(team));
  if (parentMatchedVariants.length === 1) {
    return parentMatchedVariants[0];
  }

  if (exactTeam) {
    return exactTeam;
  }

  if (canonicalVariants.length === 1) {
    return canonicalVariants[0];
  }

  return lookupMaps.canonicalMap.get(canonicalSlug) || null;
}

function describeCsvRowIssue(finding) {
  switch (finding.failure_reason) {
    case 'missing_child_team':
      return `CSV row ${finding.row_number} is missing the required child_team value.`;
    case 'invalid_child_team':
      return `CSV row ${finding.row_number} contains an invalid child_team${finding.child_team_name ? `: ${finding.child_team_name}` : ''}.`;
    case 'conflicting_slug':
      return `CSV row ${finding.row_number} conflicts with another row after slug normalization${finding.normalized_slug ? `: ${finding.normalized_slug}` : ''}.`;
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
        `CSV row ${finding.row_number} duplicates child team ${finding.child_team_name || 'unknown'}.`
      );
      continue;
    }

    if (finding.validation_status === 'invalid') {
      errors.push(describeCsvRowIssue(finding));
    }
  }
}

function findAncestorSlugs(teamSlug, currentTeamMap) {
  const ancestors = [];
  const seen = new Set();
  let currentTeam = currentTeamMap.get(normalizeTeamSlug(teamSlug));

  while (currentTeam && currentTeam.parent && currentTeam.parent.slug) {
    const parentSlug = normalizeTeamSlug(currentTeam.parent.slug);
    if (!parentSlug || seen.has(parentSlug)) {
      break;
    }

    ancestors.push(parentSlug);
    seen.add(parentSlug);
    currentTeam = currentTeamMap.get(parentSlug);
  }

  return ancestors;
}

async function validateTeamHierarchyRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseTeamHierarchyRequest(input);
  const errors = [];
  const warnings = [];
  const getOrganization = options.getOrganization;
  const getOrganizationMembership = options.getOrganizationMembership;
  const listTeams = options.listTeams;
  const resolveTeamMembership = options.resolveTeamMembership;
  const issueComments = options.issueComments || input.issueComments || input.issue_comments || [];
  const latestFailedValidationAt = options.latestFailedValidationAt || input.latestFailedValidationAt || null;
  const latestFailedValidationAttemptId = options.latestFailedValidationAttemptId || input.latestFailedValidationAttemptId || null;
  const terminalStateReached = ['executed', 'partially_executed', 'failed', 'failed_after_approved_execution'].includes(request.request_status);
  const attachmentMaxBytes = resolveTeamHierarchyAttachmentMaxBytes({
    attachment_max_bytes: options.maxAttachmentBytes,
    repository_policy: options.repositoryPolicy,
  });
  let attachmentRateLimitSnapshot = null;

  request.validation_findings.attachment_max_bytes = attachmentMaxBytes;

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.parent_team_slug) {
    errors.push('An existing parent team is required.');
  }

  if (!request.designated_approver_login) {
    errors.push('A single designated hierarchy approver is required.');
  }

  const manualPopulated = hasPopulatedInput(request.requested_child_teams_input);
  const bulkCsvPopulated = hasPopulatedInput(request.bulk_csv_input);

  if (!request.intake_mode) {
    errors.push('Exactly one supported intake mode must be selected: manual or csv_attachment.');
  }

  if (request.intake_mode === 'csv_attachment' && manualPopulated) {
    errors.push('requested_child_teams must be empty when intake_mode is csv_attachment.');
  }

  if (request.intake_mode === 'csv_attachment' && bulkCsvPopulated) {
    errors.push('bulk_csv_requested_child_teams must be empty when intake_mode is csv_attachment.');
  }

  if (request.intake_mode === 'bulk_csv') {
    errors.push('The bulk CSV textarea intake is no longer supported. Select csv_attachment and upload the CSV as a requester-authored issue comment attachment.');
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
      // Once an eligible requester attachment is selected, leave the waiting state.
      // Final status is derived below from accumulated validation errors.
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
        const attachmentNormalization = normalizeBulkCsvRequestedChildTeams(downloadedAttachment.text);

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
        request.requested_child_links = attachmentNormalization.normalizedChildTeams.map((childTeam) => ({
          ...childTeam,
          current_parent_slug: null,
          validation_status: 'valid',
          desired_action: 'link_child',
          execution_result: 'not_started',
          failure_reason: null,
          source_comment_id: candidate.comment_id || null,
        }));
        request.requested_child_link_detail = attachmentNormalization.requestedChildTeamDetail.map((detail) => ({
          ...detail,
          source_comment_id: candidate.comment_id || null,
        }));
        request.duplicate_child_teams = attachmentNormalization.duplicateChildTeams;
        request.conflicting_child_slugs = attachmentNormalization.conflictingChildSlugs;
        request.invalid_child_teams = attachmentNormalization.invalidChildTeams;
        request.csv_row_findings = attachmentNormalization.csv_row_findings;
        request.validation_findings.duplicate_child_teams = attachmentNormalization.duplicateChildTeams;
        request.validation_findings.conflicting_child_slugs = attachmentNormalization.conflictingChildSlugs;
        request.validation_findings.invalid_child_teams = attachmentNormalization.invalidChildTeams;
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

  if (request.intake_mode === 'bulk_csv') {
    const bulkCsvSubmission = request.bulk_csv_submission || {};
    appendCsvValidationErrors(errors, bulkCsvSubmission.schema_errors, request.csv_row_findings);
  }

  if (request.intake_mode === 'manual' && request.requested_child_links.length === 0) {
    errors.push('At least one valid requested child team is required.');
  }

  if (request.intake_mode === 'csv_attachment' && request.request_status !== 'waiting_for_attachment' && request.requested_child_links.length === 0) {
    errors.push('At least one valid requested child team is required from the accepted CSV attachment.');
  }

  if (request.invalid_child_teams.length > 0) {
    errors.push(`Invalid child teams: ${request.invalid_child_teams.join(', ')}`);
  }

  if (request.duplicate_child_teams.length > 0) {
    errors.push(`Duplicate child teams were detected: ${request.duplicate_child_teams.join(', ')}`);
  }

  if (request.conflicting_child_slugs.length > 0) {
    const conflicting = request.conflicting_child_slugs.map((entry) => entry.slug).join(', ');
    errors.push(`Conflicting normalized child-team slugs were detected: ${conflicting}`);
  }

  if (request.unsupported_inputs && request.unsupported_inputs.requested_team_names) {
    errors.push('Team-creation input is out of scope for this workflow version and must be removed.');
  }

  if (request.unsupported_inputs && request.unsupported_inputs.requested_people) {
    errors.push('Member-management input is out of scope for this workflow version and must be removed.');
  }

  let organizationVisible = false;
  if (request.organization && typeof getOrganization === 'function') {
    const organizationResult = await getOrganization({ organization: request.organization });
    organizationVisible = Boolean(organizationResult && organizationResult.exists);
    if (!organizationVisible) {
      errors.push('The target organization does not exist or is not visible to the workflow identity.');
    }
  }

  let currentTeams = [];
  if (request.organization && typeof listTeams === 'function') {
    currentTeams = await listTeams({ organization: request.organization });
  }

  const currentTeamMap = new Map(
    currentTeams
      .filter((team) => team && team.slug)
      .map((team) => [normalizeTeamSlug(team.slug), team])
  );
  const teamLookupMaps = buildTeamLookupMaps(currentTeams);

  const parentTeam = resolveTeamFromLookup(request.parent_team_slug, teamLookupMaps);
  const parentTeamExists = Boolean(parentTeam);
  const requestParentCanonicalSlug = canonicalizeTeamSlug(parentTeamExists ? parentTeam.slug : request.parent_team_slug);
  if (request.parent_team_slug && !parentTeamExists) {
    errors.push('The requested parent team does not exist in the target organization.');
  }

  let designatedApproverAuthorization = {
    login: request.designated_approver_login,
    state: request.designated_approver_login ? 'unknown' : 'missing',
    parent_team_role: 'unknown',
    child_team_roles: [],
  };

  if (
    request.organization &&
    request.designated_approver_login &&
    typeof getOrganizationMembership === 'function'
  ) {
    const orgMembership = await getOrganizationMembership({
      organization: request.organization,
      username: request.designated_approver_login,
    });

    const orgMembershipState = orgMembership && orgMembership.membership
      ? String(orgMembership.membership.state || 'active').toLowerCase()
      : 'absent';

    designatedApproverAuthorization.state = orgMembership && orgMembership.exists && orgMembershipState === 'active'
      ? 'authorized'
      : 'unauthorized';

    if (typeof resolveTeamMembership === 'function' && request.parent_team_slug) {
      try {
        const parentMembership = await resolveTeamMembership({
          organization: request.organization,
          teamSlug: request.parent_team_slug,
          username: request.designated_approver_login,
        });
        designatedApproverAuthorization.parent_team_role = parentMembership && parentMembership.membership
          ? parentMembership.membership.role || 'member'
          : 'absent';
      } catch (error) {
        designatedApproverAuthorization.parent_team_role = 'unknown';
      }
    }

    if (designatedApproverAuthorization.state !== 'authorized') {
      errors.push('The designated hierarchy approver must be an active member of the target organization.');
    }
  }

  const parentAncestors = parentTeamExists
    ? findAncestorSlugs(parentTeam.slug, currentTeamMap)
    : [];
  const parentAncestorSet = new Set(parentAncestors.map((slug) => canonicalizeTeamSlug(slug)));

  const requestedChildLinks = request.requested_child_links.map((childLink) => {
    const candidateChildTeams = resolveTeamVariantsFromLookup(childLink.child_team_slug, teamLookupMaps);
    const candidateTeamSlugs = candidateChildTeams.map((team) => normalizeTeamSlug(team.slug));
    if (candidateChildTeams.length === 0) {
      return {
        ...childLink,
        validation_status: 'missing_child',
        desired_action: 'reject',
        failure_reason: 'missing_child_team',
        resolved_child_team_slug: null,
        candidate_child_team_slugs: [],
      };
    }

    const candidateByParentMatch = candidateChildTeams.find((team) =>
      canonicalizeTeamSlug(team && team.parent && team.parent.slug) === requestParentCanonicalSlug
    ) || null;
    const candidateByNoParent = candidateChildTeams.find((team) => !team || !team.parent || !team.parent.slug) || null;
    const currentChildTeam = candidateByParentMatch || candidateByNoParent || candidateChildTeams[0];

    const currentParentSlug = currentChildTeam && currentChildTeam.parent && currentChildTeam.parent.slug
      ? normalizeTeamSlug(currentChildTeam.parent.slug)
      : null;
    const candidateCanonicalSlugs = new Set(candidateChildTeams.map((team) => canonicalizeTeamSlug(team.slug)));

    if (candidateCanonicalSlugs.has(requestParentCanonicalSlug)) {
      return {
        ...childLink,
        current_parent_slug: currentParentSlug,
        validation_status: 'cycle_blocked',
        desired_action: 'reject',
        failure_reason: 'self_parent_cycle',
        resolved_child_team_slug: normalizeTeamSlug(currentChildTeam.slug),
        candidate_child_team_slugs: candidateTeamSlugs,
      };
    }

    const isAncestorCycle = [...candidateCanonicalSlugs].some((slug) => parentAncestorSet.has(slug));
    if (isAncestorCycle) {
      return {
        ...childLink,
        current_parent_slug: currentParentSlug,
        validation_status: 'cycle_blocked',
        desired_action: 'reject',
        failure_reason: 'ancestor_cycle',
        resolved_child_team_slug: normalizeTeamSlug(currentChildTeam.slug),
        candidate_child_team_slugs: candidateTeamSlugs,
      };
    }

    if (candidateByParentMatch) {
      return {
        ...childLink,
        current_parent_slug: normalizeTeamSlug(candidateByParentMatch.parent && candidateByParentMatch.parent.slug),
        validation_status: 'already_linked',
        desired_action: 'noop',
        current_team_id: candidateByParentMatch.id || null,
        resolved_child_team_slug: normalizeTeamSlug(candidateByParentMatch.slug),
        candidate_child_team_slugs: candidateTeamSlugs,
      };
    }

    if (!candidateByNoParent && currentParentSlug && canonicalizeTeamSlug(currentParentSlug) !== requestParentCanonicalSlug) {
      return {
        ...childLink,
        current_parent_slug: currentParentSlug,
        validation_status: 'reparent_blocked',
        desired_action: 'reject',
        current_team_id: currentChildTeam.id || null,
        failure_reason: 'reparenting_not_supported',
        resolved_child_team_slug: normalizeTeamSlug(currentChildTeam.slug),
        candidate_child_team_slugs: candidateTeamSlugs,
      };
    }

    return {
      ...childLink,
      current_parent_slug: currentParentSlug,
      validation_status: 'valid',
      desired_action: 'link_child',
      current_team_id: currentChildTeam.id || null,
      resolved_child_team_slug: normalizeTeamSlug(currentChildTeam.slug),
      candidate_child_team_slugs: candidateTeamSlugs,
    };
  });

  const missingChildren = requestedChildLinks
    .filter((childLink) => childLink.validation_status === 'missing_child')
    .map((childLink) => childLink.requested_name);
  if (missingChildren.length > 0) {
    errors.push(`The following child teams do not exist in the target organization: ${missingChildren.join(', ')}`);
  }

  const reparentBlocked = requestedChildLinks
    .filter((childLink) => childLink.validation_status === 'reparent_blocked')
    .map((childLink) => childLink.requested_name);
  if (reparentBlocked.length > 0) {
    errors.push(`Re-parenting is out of scope for this workflow version: ${reparentBlocked.join(', ')}`);
  }

  const cycleBlocked = requestedChildLinks
    .filter((childLink) => childLink.validation_status === 'cycle_blocked')
    .map((childLink) => childLink.requested_name);
  if (cycleBlocked.length > 0) {
    errors.push(`The request would create a team hierarchy cycle: ${cycleBlocked.join(', ')}`);
  }

  if (
    !skipDesignatedApproverValidation &&
    request.organization &&
    request.designated_approver_login &&
    typeof resolveTeamMembership === 'function'
  ) {
    const childRoleSlugs = [...new Set(
      requestedChildLinks
        .map((childLink) => normalizeTeamSlug(childLink.resolved_child_team_slug || childLink.child_team_slug))
        .filter(Boolean)
    )];

    for (const childTeamSlug of childRoleSlugs) {
      try {
        const membership = await resolveTeamMembership({
          organization: request.organization,
          teamSlug: childTeamSlug,
          username: request.designated_approver_login,
        });
        const role = membership && membership.membership
          ? membership.membership.role || 'member'
          : 'absent';
        designatedApproverAuthorization.child_team_roles.push({
          child_team_slug: childTeamSlug,
          role,
        });
      } catch (error) {
        designatedApproverAuthorization.child_team_roles.push({
          child_team_slug: childTeamSlug,
          role: 'unknown',
        });
      }
    }
  }

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
    parent_team_exists: parentTeamExists,
    current_teams: currentTeams,
    attachment_rate_limit_snapshot: attachmentRateLimitSnapshot,
    attachment_max_bytes: attachmentMaxBytes,
    attachment_validation_attempt: request.attachment_validation_attempt,
    accepted_attachment_submission: request.accepted_attachment_submission,
    bulk_csv_submission: request.bulk_csv_submission,
    csv_row_findings: request.csv_row_findings || [],
    csv_row_numbering_convention: request.csv_row_numbering_convention,
    designated_approver_authorization: designatedApproverAuthorization,
    requested_child_links: requestedChildLinks,
    existing_child_links: requestedChildLinks.filter((childLink) => childLink.desired_action === 'noop'),
    request: {
      ...request,
      requested_child_links: requestedChildLinks,
      request_status: request.request_status === 'waiting_for_attachment'
        ? 'waiting_for_attachment'
        : errors.length === 0
          ? 'awaiting_approval'
          : 'validation_failed',
    },
  };
}

module.exports = {
  appendCsvValidationErrors,
  findAncestorSlugs,
  validateTeamHierarchyRequest,
};