'use strict';

function reconcileTenantCreation(input = {}) {
  const request = input.request || {};
  const validatedTeams = input.validatedTeams || input.requested_teams || [];
  const currentTeams = input.currentTeams || input.current_teams || [];
  const currentMap = new Map(
    currentTeams
      .filter((team) => team && team.slug)
      .map((team) => [String(team.slug).toLowerCase(), team])
  );

  const teamsToCreate = [];
  const teamsAlreadyPresent = [];
  const teamsRejected = [];

  for (const team of validatedTeams) {
    if (team.validation_status !== 'valid' && team.validation_status !== 'existing') {
      teamsRejected.push({ ...team, desired_action: 'reject' });
      continue;
    }

    const existing = currentMap.get(String(team.normalized_slug || '').toLowerCase());
    if (existing || team.desired_action === 'noop' || team.validation_status === 'existing') {
      teamsAlreadyPresent.push({
        ...team,
        desired_action: 'noop',
        current_team_id: existing ? existing.id || null : team.current_team_id || null,
      });
      continue;
    }

    teamsToCreate.push({
      ...team,
      desired_action: 'create_team',
      current_team_id: null,
    });
  }

  const tenantParentSlug = String(request.tenant_team_slug || request.parent_team_slug || '').toLowerCase();
  const repoAdminSlug = String(request.repo_admin_team_slug || '').toLowerCase();

  const parentTeam = currentMap.get(tenantParentSlug) || null;
  const childTeam = currentMap.get(repoAdminSlug) || null;
  const childParentSlug = childTeam && childTeam.parent && childTeam.parent.slug
    ? String(childTeam.parent.slug).toLowerCase()
    : null;

  const hierarchyAction = !childTeam || !parentTeam
    ? 'pending_teams'
    : childParentSlug === tenantParentSlug
      ? 'noop'
      : childParentSlug && childParentSlug !== tenantParentSlug
        ? 'reparent_blocked'
        : 'link_child';

  const requesterMembership = input.requesterMembership || null;
  const requesterBootstrapAction = requesterMembership && requesterMembership.membership && requesterMembership.membership.role === 'maintainer'
    ? 'noop'
    : 'ensure_maintainer';

  return {
    organization_exists: input.organization_exists !== false,
    teams_to_create: teamsToCreate,
    teams_already_present: teamsAlreadyPresent,
    teams_rejected: teamsRejected,
    child_links_to_apply: hierarchyAction === 'link_child'
      ? [{ child_team_slug: repoAdminSlug, parent_team_slug: tenantParentSlug }]
      : [],
    child_links_already_present: hierarchyAction === 'noop'
      ? [{ child_team_slug: repoAdminSlug, parent_team_slug: tenantParentSlug }]
      : [],
    child_links_rejected: hierarchyAction === 'reparent_blocked'
      ? [{ child_team_slug: repoAdminSlug, parent_team_slug: childParentSlug, failure_reason: 'reparent_blocked' }]
      : [],
    requester_bootstrap_action: requesterBootstrapAction,
    registry_persistence_action: 'write',
    intake_mode: request.intake_mode || 'manual',
    dry_run: Boolean(input.dry_run ?? request.dry_run),
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    state: teamsRejected.length > 0 || hierarchyAction === 'reparent_blocked'
      ? 'blocked'
      : 'approved_for_execution',
  };
}

module.exports = {
  reconcileTenantCreation,
};
