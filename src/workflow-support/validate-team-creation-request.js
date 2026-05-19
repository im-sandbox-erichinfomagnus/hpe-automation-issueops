'use strict';

const { parseTeamCreationRequest } = require('./parse-team-creation-request');

async function validateTeamCreationRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseTeamCreationRequest(input);
  const errors = [];
  const warnings = [];
  const getOrganization = options.getOrganization;
  const listTeams = options.listTeams;
  const resolveMembership = options.resolveMembership;

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.intended_owner_login) {
    errors.push('A single intended owner is required.');
  }

  if (request.requested_teams.length === 0) {
    errors.push('At least one valid requested team name is required.');
  }

  if (request.invalid_team_names.length > 0) {
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
    is_valid: errors.length === 0,
    request_status: errors.length === 0 ? 'awaiting_approval' : 'validation_failed',
    errors,
    warnings,
    organization_visible: organizationVisible,
    intended_owner_membership: intendedOwnerMembership,
    requested_teams: requestedTeams,
    existing_teams: requestedTeams.filter((team) => team.desired_action === 'noop'),
    request: {
      ...request,
      requested_teams: requestedTeams,
      request_status: errors.length === 0 ? 'awaiting_approval' : 'validation_failed',
    },
  };
}

module.exports = {
  validateTeamCreationRequest,
};