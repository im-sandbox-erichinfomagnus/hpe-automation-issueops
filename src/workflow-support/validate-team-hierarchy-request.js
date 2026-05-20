'use strict';

const { parseTeamHierarchyRequest } = require('./parse-team-hierarchy-request');
const { unwrapCodeFence } = require('./normalize-requested-child-teams');

function hasPopulatedInput(value) {
  return unwrapCodeFence(value).trim() !== '';
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

function findAncestorSlugs(teamSlug, currentTeamMap) {
  const ancestors = [];
  const seen = new Set();
  let currentTeam = currentTeamMap.get(String(teamSlug || '').toLowerCase());

  while (currentTeam && currentTeam.parent && currentTeam.parent.slug) {
    const parentSlug = String(currentTeam.parent.slug || '').toLowerCase();
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
  const listTeams = options.listTeams;
  const resolveTeamMembership = options.resolveTeamMembership;

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

  if (manualPopulated === bulkCsvPopulated) {
    errors.push('Exactly one intake source must be populated: requested_child_teams or bulk_csv_requested_child_teams.');
  }

  if (request.intake_mode === 'bulk_csv') {
    const bulkCsvSubmission = request.bulk_csv_submission || {};
    for (const schemaError of bulkCsvSubmission.schema_errors || []) {
      errors.push(schemaError);
    }

    for (const finding of request.csv_row_findings || []) {
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

  if (request.requested_child_links.length === 0) {
    errors.push('At least one valid requested child team is required.');
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
      .map((team) => [String(team.slug).toLowerCase(), team])
  );

  const parentTeam = currentTeamMap.get(request.parent_team_slug);
  const parentTeamExists = Boolean(parentTeam);
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
    parentTeamExists &&
    typeof resolveTeamMembership === 'function'
  ) {
    const parentMembership = await resolveTeamMembership({
      organization: request.organization,
      teamSlug: request.parent_team_slug,
      username: request.designated_approver_login,
    });

    designatedApproverAuthorization.parent_team_role =
      parentMembership && parentMembership.membership
        ? parentMembership.membership.role || 'member'
        : 'absent';

    let allAuthorized = designatedApproverAuthorization.parent_team_role === 'maintainer';
    for (const childLink of request.requested_child_links) {
      const childTeam = currentTeamMap.get(childLink.child_team_slug);
      if (!childTeam) {
        designatedApproverAuthorization.child_team_roles.push({
          child_team_slug: childLink.child_team_slug,
          role: 'missing_team',
        });
        allAuthorized = false;
        continue;
      }

      const membership = await resolveTeamMembership({
        organization: request.organization,
        teamSlug: childLink.child_team_slug,
        username: request.designated_approver_login,
      });
      const role =
        membership && membership.membership ? membership.membership.role || 'member' : 'absent';
      designatedApproverAuthorization.child_team_roles.push({
        child_team_slug: childLink.child_team_slug,
        role,
      });
      if (role !== 'maintainer') {
        allAuthorized = false;
      }
    }

    designatedApproverAuthorization.state = allAuthorized ? 'authorized' : 'unauthorized';
    if (!allAuthorized) {
      errors.push('The designated hierarchy approver is not a current maintainer of the requested parent team and every requested child team.');
    }
  }

  const parentAncestors = parentTeamExists
    ? findAncestorSlugs(request.parent_team_slug, currentTeamMap)
    : [];

  const requestedChildLinks = request.requested_child_links.map((childLink) => {
    const currentChildTeam = currentTeamMap.get(childLink.child_team_slug);
    if (!currentChildTeam) {
      return {
        ...childLink,
        validation_status: 'missing_child',
        desired_action: 'reject',
        failure_reason: 'missing_child_team',
      };
    }

    const currentParentSlug =
      currentChildTeam.parent && currentChildTeam.parent.slug
        ? String(currentChildTeam.parent.slug).toLowerCase()
        : null;

    if (childLink.child_team_slug === request.parent_team_slug) {
      return {
        ...childLink,
        current_parent_slug: currentParentSlug,
        validation_status: 'cycle_blocked',
        desired_action: 'reject',
        failure_reason: 'self_parent_cycle',
      };
    }

    if (parentAncestors.includes(childLink.child_team_slug)) {
      return {
        ...childLink,
        current_parent_slug: currentParentSlug,
        validation_status: 'cycle_blocked',
        desired_action: 'reject',
        failure_reason: 'ancestor_cycle',
      };
    }

    if (currentParentSlug === request.parent_team_slug) {
      return {
        ...childLink,
        current_parent_slug: currentParentSlug,
        validation_status: 'already_linked',
        desired_action: 'noop',
        current_team_id: currentChildTeam.id || null,
      };
    }

    if (currentParentSlug && currentParentSlug !== request.parent_team_slug) {
      return {
        ...childLink,
        current_parent_slug: currentParentSlug,
        validation_status: 'reparent_blocked',
        desired_action: 'reject',
        current_team_id: currentChildTeam.id || null,
        failure_reason: 'reparenting_not_supported',
      };
    }

    return {
      ...childLink,
      current_parent_slug: currentParentSlug,
      validation_status: 'valid',
      desired_action: 'link_child',
      current_team_id: currentChildTeam.id || null,
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

  return {
    is_valid: errors.length === 0,
    request_status: errors.length === 0 ? 'awaiting_approval' : 'validation_failed',
    errors,
    warnings,
    organization_visible: organizationVisible,
    parent_team_exists: parentTeamExists,
    current_teams: currentTeams,
    bulk_csv_submission: request.bulk_csv_submission,
    csv_row_findings: request.csv_row_findings || [],
    csv_row_numbering_convention: request.csv_row_numbering_convention,
    designated_approver_authorization: designatedApproverAuthorization,
    requested_child_links: requestedChildLinks,
    existing_child_links: requestedChildLinks.filter((childLink) => childLink.desired_action === 'noop'),
    request: {
      ...request,
      requested_child_links: requestedChildLinks,
      request_status: errors.length === 0 ? 'awaiting_approval' : 'validation_failed',
    },
  };
}

module.exports = {
  findAncestorSlugs,
  validateTeamHierarchyRequest,
};