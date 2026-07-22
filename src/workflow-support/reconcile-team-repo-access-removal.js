'use strict';

function reconcileTeamRepoAccessRemoval(input = {}) {
  const request = input.request || {};
  const validatedRepositoryRemovals =
    input.validatedRepositoryRemovals ||
    input.requested_repository_removals ||
    [];

  const removalsToApply = [];
  const alreadyAbsentNoops = [];
  const rejectedItems = [];

  for (const removal of validatedRepositoryRemovals) {
    if (removal.desired_action === 'remove_access' && removal.validation_status === 'valid') {
      removalsToApply.push({
        ...removal,
        desired_action: 'remove_access',
      });
      continue;
    }

    if (removal.desired_action === 'noop_already_absent') {
      alreadyAbsentNoops.push({
        ...removal,
        desired_action: 'noop_already_absent',
      });
      continue;
    }

    rejectedItems.push({
      ...removal,
      desired_action: 'reject',
    });
  }

  const dryRun = Boolean(input.dry_run ?? request.dry_run);
  const state = removalsToApply.length === 0 && rejectedItems.length === 0
    ? 'validated'
    : dryRun
      ? 'validated'
      : 'approved_for_execution';

  return {
    organization_exists: input.organization_exists !== false,
    team_exists: input.team_exists !== false,
    intake_mode: input.intake_mode || request.intake_mode || null,
    removals_to_apply: removalsToApply,
    already_absent_noops: alreadyAbsentNoops,
    rejected_items: rejectedItems,
    dry_run: dryRun,
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    state,
  };
}

module.exports = {
  reconcileTeamRepoAccessRemoval,
};
