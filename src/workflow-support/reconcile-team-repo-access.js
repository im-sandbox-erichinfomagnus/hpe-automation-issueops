'use strict';

const { API_PERMISSION_RANK } = require('./normalize-requested-permission');

function reconcileTeamRepoAccess(input = {}) {
  const request = input.request || {};
  const validatedRepositoryGrants =
    input.validatedRepositoryGrants ||
    input.requested_repository_grants ||
    [];

  const repositoriesToGrant = [];
  const repositoriesAlreadySatisfied = [];
  const repositoriesRejected = [];

  for (const grant of validatedRepositoryGrants) {
    if (grant.desired_action === 'grant_access' && grant.validation_status === 'valid') {
      repositoriesToGrant.push({
        ...grant,
        desired_action: 'grant_access',
      });
      continue;
    }

    if (grant.desired_action === 'noop') {
      repositoriesAlreadySatisfied.push({
        ...grant,
        desired_action: 'noop',
      });
      continue;
    }

    repositoriesRejected.push({
      ...grant,
      desired_action: 'reject',
    });
  }

  const dryRun = Boolean(input.dry_run ?? request.dry_run);
  const state = repositoriesToGrant.length === 0 && repositoriesRejected.length === 0
    ? 'validated'
    : dryRun
      ? 'validated'
      : 'approved_for_execution';

  return {
    organization_exists: input.organization_exists !== false,
    team_exists: input.team_exists !== false,
    intake_mode: input.intake_mode || request.intake_mode || null,
    repositories_to_grant: repositoriesToGrant,
    repositories_already_satisfied: repositoriesAlreadySatisfied,
    repositories_rejected: repositoriesRejected,
    permission_strength_ladder: Object.keys(API_PERMISSION_RANK)
      .filter((permission) => permission !== 'none')
      .sort((left, right) => API_PERMISSION_RANK[left] - API_PERMISSION_RANK[right]),
    dry_run: dryRun,
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    state,
  };
}

module.exports = {
  reconcileTeamRepoAccess,
};