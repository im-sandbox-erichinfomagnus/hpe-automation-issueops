'use strict';

function normalizeCurrentTeam(team) {
  return {
    id: team.id || null,
    name: String(team.name || '').trim(),
    slug: String(team.slug || '').trim().toLowerCase(),
  };
}

function reconcileTeamCreation(input = {}) {
  const request = input.request || {};
  const validatedTeams = input.validatedTeams || input.requested_teams || [];
  const currentTeams = (input.currentTeams || input.current_teams || []).map(normalizeCurrentTeam);
  const currentTeamMap = new Map(
    currentTeams.filter((team) => team.slug).map((team) => [team.slug, team])
  );

  const teamsToCreate = [];
  const teamsAlreadyPresent = [];
  const teamsRejected = [];

  for (const team of validatedTeams) {
    if (team.validation_status !== 'valid' && team.validation_status !== 'existing') {
      teamsRejected.push({
        ...team,
        desired_action: 'reject',
      });
      continue;
    }

    const currentTeam = currentTeamMap.get(team.normalized_slug);
    if (currentTeam || team.desired_action === 'noop' || team.validation_status === 'existing') {
      teamsAlreadyPresent.push({
        ...team,
        desired_action: 'noop',
        current_team_id: currentTeam ? currentTeam.id : team.current_team_id || null,
      });
      continue;
    }

    teamsToCreate.push({
      ...team,
      desired_action: 'create_team',
      current_team_id: null,
    });
  }

  return {
    organization_exists: input.organization_exists !== false,
    teams_to_create: teamsToCreate,
    teams_already_present: teamsAlreadyPresent,
    teams_rejected: teamsRejected,
    dry_run: Boolean(input.dry_run ?? request.dry_run),
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    state:
      teamsToCreate.length === 0 && teamsRejected.length === 0
        ? 'validated'
        : input.dry_run || request.dry_run
          ? 'validated'
          : 'approved_for_execution',
  };
}

module.exports = {
  reconcileTeamCreation,
};