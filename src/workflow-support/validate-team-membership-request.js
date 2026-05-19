'use strict';

const { parseTeamMembershipRequest } = require('./parse-team-membership-request');

async function validateTeamMembershipRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseTeamMembershipRequest(input);
  const errors = [];
  const warnings = [];
  const resolver = options.resolveUser;
  const teamLookup = options.getTeam;

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.team_slug) {
    errors.push('Target team slug is required.');
  }

  if (request.requested_people.length === 0) {
    errors.push('At least one valid requested person is required.');
  }

  if (request.invalid_people.length > 0) {
    errors.push(`Invalid GitHub usernames: ${request.invalid_people.join(', ')}`);
  }

  if (request.duplicate_people.length > 0) {
    warnings.push(`Duplicate usernames were deduplicated: ${request.duplicate_people.join(', ')}`);
  }

  let teamExists = false;
  let teamSyncBlocked = false;

  if (request.organization && request.team_slug && typeof teamLookup === 'function') {
    const teamResult = await teamLookup({
      organization: request.organization,
      teamSlug: request.team_slug,
    });
    teamExists = Boolean(teamResult && teamResult.exists);
    teamSyncBlocked = Boolean(teamResult && teamResult.team_sync_blocked);
    if (!teamExists) {
      errors.push('The target team does not exist or is not visible to the workflow identity.');
    }
    if (teamSyncBlocked) {
      errors.push('The target team is synchronized by IdP and cannot be mutated through the API.');
    }
  }

  const requestedPeople = [];
  for (const username of request.requested_people) {
    let resolutionStatus = 'resolved';
    let failureReason = null;

    if (typeof resolver === 'function') {
      const resolved = await resolver({
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
      resolution_status: resolutionStatus,
      current_membership_state: 'unknown',
      desired_action: resolutionStatus === 'resolved' ? 'add_member' : 'reject',
      execution_result: 'not_started',
      failure_reason: failureReason,
    });
  }

  return {
    is_valid: errors.length === 0,
    request_status: errors.length === 0 ? 'awaiting_approval' : 'validation_failed',
    errors,
    warnings,
    team_exists: teamExists,
    team_sync_blocked: teamSyncBlocked,
    requested_people: requestedPeople,
    request: {
      ...request,
      request_status: errors.length === 0 ? 'awaiting_approval' : 'validation_failed',
    },
  };
}

module.exports = {
  validateTeamMembershipRequest,
};