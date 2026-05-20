'use strict';

function buildTeamMap(currentTeams = []) {
  return new Map(
    currentTeams
      .filter((team) => team && team.slug)
      .map((team) => [String(team.slug || '').toLowerCase(), team])
  );
}

function findAncestorSlugs(teamMap, teamSlug) {
  const ancestors = new Set();
  let currentTeam = teamMap.get(String(teamSlug || '').toLowerCase()) || null;

  while (currentTeam && currentTeam.parent && currentTeam.parent.slug) {
    const parentSlug = String(currentTeam.parent.slug || '').toLowerCase();
    if (!parentSlug || ancestors.has(parentSlug)) {
      break;
    }
    ancestors.add(parentSlug);
    currentTeam = teamMap.get(parentSlug) || null;
  }

  return ancestors;
}

function reconcileTeamHierarchy(input = {}) {
  const request = input.request || {};
  const validatedChildLinks = input.validatedChildLinks || input.requested_child_links || [];
  const currentTeams = input.currentTeams || input.current_teams || [];
  const teamMap = buildTeamMap(currentTeams);
  const parentTeamSlug = String(request.parent_team_slug || input.parent_team_slug || '').toLowerCase();
  const parentAncestors = findAncestorSlugs(teamMap, parentTeamSlug);

  const childLinksToApply = [];
  const childLinksAlreadyPresent = [];
  const childLinksRejected = [];

  for (const childLink of validatedChildLinks) {
    const childTeamSlug = String(childLink.child_team_slug || '').toLowerCase();
    const currentChildTeam = teamMap.get(childTeamSlug) || null;
    const currentParentSlug = currentChildTeam && currentChildTeam.parent && currentChildTeam.parent.slug
      ? String(currentChildTeam.parent.slug || '').toLowerCase()
      : null;

    if (childLink.desired_action === 'link_child' && childLink.validation_status === 'valid') {
      if (!currentChildTeam) {
        childLinksRejected.push({
          ...childLink,
          desired_action: 'reject',
          failure_reason: childLink.failure_reason || 'missing_child',
        });
        continue;
      }

      if (currentParentSlug === parentTeamSlug) {
        childLinksAlreadyPresent.push({
          ...childLink,
          current_parent_slug: currentParentSlug,
          desired_action: 'noop',
        });
        continue;
      }

      if (currentParentSlug && currentParentSlug !== parentTeamSlug) {
        childLinksRejected.push({
          ...childLink,
          current_parent_slug: currentParentSlug,
          desired_action: 'reject',
          failure_reason: childLink.failure_reason || 'reparent_blocked',
        });
        continue;
      }

      if (parentAncestors.has(childTeamSlug) || childTeamSlug === parentTeamSlug) {
        childLinksRejected.push({
          ...childLink,
          current_parent_slug: currentParentSlug,
          desired_action: 'reject',
          failure_reason: childLink.failure_reason || 'cycle_blocked',
        });
        continue;
      }

      childLinksToApply.push({
        ...childLink,
        current_parent_slug: currentParentSlug,
        desired_action: 'link_child',
      });
      continue;
    }

    if (childLink.desired_action === 'noop' || childLink.validation_status === 'already_linked') {
      childLinksAlreadyPresent.push({
        ...childLink,
        current_parent_slug: currentParentSlug,
        desired_action: 'noop',
      });
      continue;
    }

    childLinksRejected.push({
      ...childLink,
      current_parent_slug: currentParentSlug,
      desired_action: 'reject',
    });
  }

  const dryRun = Boolean(input.dry_run ?? request.dry_run);

  return {
    organization_exists: input.organization_exists !== false,
    parent_team_exists: input.parent_team_exists !== false,
    intake_mode: request.intake_mode || input.intake_mode || null,
    child_links_to_apply: childLinksToApply,
    child_links_already_present: childLinksAlreadyPresent,
    child_links_rejected: childLinksRejected,
    dry_run: dryRun,
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    state:
      childLinksToApply.length === 0 && childLinksRejected.length === 0
        ? 'validated'
        : dryRun
          ? 'validated'
          : 'approved_for_execution',
  };
}

module.exports = {
  findAncestorSlugs,
  reconcileTeamHierarchy,
};