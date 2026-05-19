'use strict';

const { parseTeamMembershipRequest } = require('./parse-team-membership-request');
const { unwrapCodeFence } = require('./normalize-requested-people');

function hasPopulatedInput(value) {
  return unwrapCodeFence(value).trim() !== '';
}

function describeCsvRowIssue(finding) {
  switch (finding.failure_reason) {
    case 'missing_username':
      return `CSV row ${finding.row_number} is missing the required username value.`;
    case 'invalid_username':
      return `CSV row ${finding.row_number} contains an invalid GitHub username${finding.username ? `: ${finding.username}` : ''}.`;
    case 'inconsistent_shape':
      return `CSV row ${finding.row_number} does not match the header column count.`;
    default:
      return `CSV row ${finding.row_number} is invalid.`;
  }
}

async function validateTeamMembershipRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseTeamMembershipRequest(input);
  const errors = [];
  const warnings = [];
  const resolver = options.resolveUser;
  const teamLookup = options.getTeam;
  const requestedPeopleDetailMap = new Map(
    (request.requested_people_detail || [])
      .filter((detail) => detail && detail.username)
      .map((detail) => [detail.username, detail])
  );

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.team_slug) {
    errors.push('Target team slug is required.');
  }

  const manualPopulated = hasPopulatedInput(request.requested_people_input);
  const bulkCsvPopulated = hasPopulatedInput(request.bulk_csv_input);

  if (manualPopulated === bulkCsvPopulated) {
    errors.push('Exactly one intake source must be populated: requested_people or bulk_csv_requested_people.');
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
        warnings.push(
          `CSV row ${finding.row_number} duplicates username ${finding.username || 'unknown'} and was deduplicated.`
        );
        continue;
      }

      if (finding.validation_status === 'invalid' || finding.validation_status === 'blank') {
        errors.push(describeCsvRowIssue(finding));
      }
    }
  }

  if (request.requested_people.length === 0) {
    errors.push('At least one valid requested person is required.');
  }

  if (request.intake_mode !== 'bulk_csv' && request.invalid_people.length > 0) {
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
      source_row_number: requestedPeopleDetailMap.get(username)
        ? requestedPeopleDetailMap.get(username).source_row_number || null
        : null,
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
    bulk_csv_submission: request.bulk_csv_submission,
    csv_row_findings: request.csv_row_findings || [],
    csv_row_numbering_convention: request.csv_row_numbering_convention,
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