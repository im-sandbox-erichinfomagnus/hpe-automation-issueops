'use strict';

const { parseTeamRepoAccessRequest } = require('./parse-team-repo-access-request');
const { getPermissionRank } = require('./normalize-requested-permission');
const { normalizeRequestedPermission } = require('./normalize-requested-permission');
const { unwrapCodeFence } = require('./normalize-requested-repositories');

function hasPopulatedInput(value) {
  return unwrapCodeFence(value).trim() !== '';
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

function classifyRepositoryGrant(grant, request, repositoryState, currentPermissionApiValue) {
  const currentPermissionRank = getPermissionRank(currentPermissionApiValue || 'none');
  const requestedPermissionRank = request.requested_permission_rank;

  if (!repositoryState || repositoryState.exists === false) {
    return {
      ...grant,
      validation_status: 'missing_repository',
      desired_action: 'reject',
      current_permission_api_value: 'none',
      current_permission_rank: 0,
      failure_reason: 'missing_repository',
    };
  }

  if (repositoryState.repository.owner !== request.organization) {
    return {
      ...grant,
      repository_archived: repositoryState.repository.archived,
      validation_status: 'conflicting',
      desired_action: 'reject',
      current_permission_api_value: 'none',
      current_permission_rank: 0,
      failure_reason: 'repository_outside_target_organization',
    };
  }

  if (repositoryState.repository.archived) {
    return {
      ...grant,
      repository_archived: true,
      validation_status: 'archived_blocked',
      desired_action: 'reject',
      current_permission_api_value: currentPermissionApiValue || 'none',
      current_permission_rank: currentPermissionRank,
      failure_reason: 'archived_repository',
    };
  }

  if (currentPermissionRank === requestedPermissionRank) {
    return {
      ...grant,
      repository_archived: false,
      validation_status: 'exact_match',
      desired_action: 'noop',
      current_permission_api_value: currentPermissionApiValue,
      current_permission_rank: currentPermissionRank,
      execution_result: 'noop',
      failure_reason: null,
    };
  }

  if (currentPermissionRank > requestedPermissionRank) {
    return {
      ...grant,
      repository_archived: false,
      validation_status: 'stronger_existing_access',
      desired_action: 'noop',
      current_permission_api_value: currentPermissionApiValue,
      current_permission_rank: currentPermissionRank,
      execution_result: 'noop',
      failure_reason: null,
    };
  }

  if (currentPermissionRank > 0 && currentPermissionRank < requestedPermissionRank) {
    return {
      ...grant,
      repository_archived: false,
      validation_status: 'weaker_existing_access',
      desired_action: 'reject',
      current_permission_api_value: currentPermissionApiValue,
      current_permission_rank: currentPermissionRank,
      failure_reason: 'weaker_existing_access',
    };
  }

  return {
    ...grant,
    repository_archived: false,
    validation_status: 'valid',
    desired_action: 'grant_access',
    current_permission_api_value: currentPermissionApiValue || 'none',
    current_permission_rank: currentPermissionRank,
    failure_reason: null,
  };
}

async function validateTeamRepoAccessRequest(input = {}, options = {}) {
  const rawRequest = input.request_id ? input : parseTeamRepoAccessRequest(input);
  const permissionNormalization = normalizeRequestedPermission(
    rawRequest.requested_permission_label || rawRequest.requested_permission_api_value
  );
  const request = {
    invalid_repositories: [],
    duplicate_repositories: [],
    conflicting_repositories: [],
    requested_repository_grants: [],
    unsupported_inputs: {},
    requested_permission_label: permissionNormalization.requested_permission_label,
    requested_permission_api_value: permissionNormalization.requested_permission_api_value,
    requested_permission_rank: permissionNormalization.requested_permission_rank,
    ...rawRequest,
  };
  const errors = [];
  const warnings = [];
  const getOrganization = options.getOrganization;
  const getTeamBySlug = options.getTeamBySlug;
  const getRepository = options.getRepository;
  const getTeamRepositoryPermission = options.getTeamRepositoryPermission;
  const getOrganizationMembership = options.getOrganizationMembership;

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.team_slug) {
    errors.push('An existing target team is required.');
  }

  if (!request.designated_approver_login) {
    errors.push('A single designated repository-access approver is required.');
  }

  if (!request.requested_permission_api_value) {
    errors.push('A supported built-in repository role is required.');
  }

  const manualPopulated = hasPopulatedInput(request.requested_repositories_input);
  const bulkCsvPopulated = hasPopulatedInput(request.bulk_csv_input);

  if (manualPopulated === bulkCsvPopulated) {
    errors.push('Exactly one intake source must be populated: requested_repositories or bulk_csv_requested_repositories.');
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
          `CSV row ${finding.row_number} duplicates repository ${finding.repository_value || 'unknown'}.`
        );
        continue;
      }

      if (finding.validation_status === 'invalid') {
        errors.push(describeCsvRowIssue(finding));
      }
    }
  }

  if (request.requested_repository_grants.length === 0) {
    errors.push('At least one valid requested repository is required.');
  }

  if (request.invalid_repositories.length > 0) {
    errors.push(`Invalid requested repositories: ${request.invalid_repositories.join(', ')}`);
  }

  if (request.duplicate_repositories.length > 0) {
    errors.push(`Duplicate requested repositories were detected: ${request.duplicate_repositories.join(', ')}`);
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

  let designatedApproverAuthorization = {
    login: request.designated_approver_login,
    state: request.designated_approver_login ? 'unknown' : 'missing',
    membership_state: 'unknown',
    role: 'other',
  };

  if (request.organization && request.designated_approver_login && typeof getOrganizationMembership === 'function') {
    const membership = await getOrganizationMembership({
      organization: request.organization,
      username: request.designated_approver_login,
    });

    if (!membership || membership.exists === false) {
      designatedApproverAuthorization = {
        login: request.designated_approver_login,
        state: 'unauthorized',
        membership_state: 'absent',
        role: 'other',
      };
      errors.push('The designated repository-access approver is not an active owner in the target organization.');
    } else {
      const membershipRole = membership.membership && membership.membership.role
        ? membership.membership.role
        : 'other';
      const membershipState = membership.membership && membership.membership.state
        ? membership.membership.state
        : 'active';
      const authorized = membershipRole === 'admin' && membershipState === 'active';
      designatedApproverAuthorization = {
        login: request.designated_approver_login,
        state: authorized ? 'authorized' : 'unauthorized',
        membership_state: membershipState,
        role: authorized ? 'target_org_owner' : 'other',
      };
      if (!authorized) {
        errors.push('The designated repository-access approver is not an active owner in the target organization.');
      }
    }
  }

  const requestedRepositoryGrants = [];
  for (const grant of request.requested_repository_grants) {
    let repositoryState = null;
    let permissionState = null;

    if (typeof getRepository === 'function') {
      repositoryState = await getRepository({
        owner: grant.repository_owner,
        repo: grant.repository_name,
      });
    }

    if (
      repositoryState &&
      repositoryState.exists &&
      !repositoryState.repository.archived &&
      repositoryState.repository.owner === request.organization &&
      teamExists &&
      typeof getTeamRepositoryPermission === 'function'
    ) {
      permissionState = await getTeamRepositoryPermission({
        organization: request.organization,
        teamSlug: request.team_slug,
        owner: grant.repository_owner,
        repo: grant.repository_name,
      });
    }

    const classifiedGrant = classifyRepositoryGrant(
      grant,
      request,
      repositoryState,
      permissionState ? permissionState.current_permission_api_value : 'none'
    );
    requestedRepositoryGrants.push(classifiedGrant);
  }

  const missingRepositories = requestedRepositoryGrants
    .filter((grant) => grant.validation_status === 'missing_repository')
    .map((grant) => grant.repository_full_name || grant.requested_repository_name);
  if (missingRepositories.length > 0) {
    errors.push(`The following repositories do not exist in the target organization: ${missingRepositories.join(', ')}`);
  }

  const archivedRepositories = requestedRepositoryGrants
    .filter((grant) => grant.validation_status === 'archived_blocked')
    .map((grant) => grant.repository_full_name);
  if (archivedRepositories.length > 0) {
    errors.push(`Archived repositories are blocked in this workflow version: ${archivedRepositories.join(', ')}`);
  }

  const weakerPermissionRepositories = requestedRepositoryGrants
    .filter((grant) => grant.validation_status === 'weaker_existing_access')
    .map((grant) => grant.repository_full_name);
  if (weakerPermissionRepositories.length > 0) {
    errors.push(`Repositories requiring in-place permission upgrades are out of scope: ${weakerPermissionRepositories.join(', ')}`);
  }

  return {
    is_valid: errors.length === 0,
    request_status: errors.length === 0 ? 'awaiting_approval' : 'validation_failed',
    errors,
    warnings,
    organization_visible: organizationVisible,
    team_exists: teamExists,
    bulk_csv_submission: request.bulk_csv_submission,
    csv_row_findings: request.csv_row_findings || [],
    csv_row_numbering_convention: request.csv_row_numbering_convention || null,
    designated_approver_authorization: designatedApproverAuthorization,
    requested_repository_grants: requestedRepositoryGrants,
    already_satisfied_repository_grants: requestedRepositoryGrants.filter(
      (grant) => grant.desired_action === 'noop'
    ),
    request: {
      ...request,
      requested_repository_grants: requestedRepositoryGrants,
      request_status: errors.length === 0 ? 'awaiting_approval' : 'validation_failed',
    },
  };
}

module.exports = {
  classifyRepositoryGrant,
  validateTeamRepoAccessRequest,
};