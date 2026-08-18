'use strict';

const fs = require('fs');
const path = require('path');

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

// Pure plan builder mirroring reconcile-repo-admin-membership (#27), applied to
// a batch of subteams: existing subteams converge as noop, missing ones are
// created under the resolved parent with every active root-team maintainer
// assigned as Team Maintainer.
function reconcileTenantSubteamCreation(input = {}) {
  const request = input.request || {};
  const validatedTeams = input.validatedTeams || input.requested_teams || [];
  const rootTeamMaintainers = [...new Set(
    (input.rootTeamMaintainers || input.root_team_maintainers || [])
      .map((maintainer) => normalizeLogin(typeof maintainer === 'string' ? maintainer : maintainer.username))
      .filter(Boolean)
  )];

  const teamsToCreate = [];
  const teamsAlreadyPresent = [];
  const teamsRejected = [];

  for (const team of validatedTeams) {
    if (team.validation_status !== 'valid') {
      teamsRejected.push({
        ...team,
        desired_action: 'reject',
      });
      continue;
    }

    if (team.current_state === 'present') {
      teamsAlreadyPresent.push({
        ...team,
        desired_action: 'noop',
      });
      continue;
    }

    teamsToCreate.push({
      ...team,
      desired_action: 'create_team',
    });
  }

  const dryRun = Boolean(input.dry_run ?? request.dry_run);

  return {
    intake_mode: request.intake_mode || null,
    parent_team_slug: normalizeLogin(input.parent_team_slug || request.parent_team_slug),
    parent_team_id: input.parent_team_id ?? null,
    tenant_root_team_slug: normalizeLogin(input.tenant_root_team_slug || request.tenant_team_slug),
    tenant_root_team_id: input.tenant_root_team_id ?? null,
    maintainers_to_assign: teamsToCreate.length > 0 ? rootTeamMaintainers : [],
    teams_to_create: teamsToCreate,
    teams_already_present: teamsAlreadyPresent,
    teams_rejected: teamsRejected,
    dry_run: dryRun,
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    state:
      teamsToCreate.length === 0 && teamsRejected.length === 0
        ? 'validated'
        : dryRun
          ? 'validated'
          : 'approved_for_execution',
  };
}

// Appends subteam nodes to the canonical tenant registry record for the teams
// this operation created. Nodes already present are skipped.
function persistTenantSubteamTopology(input = {}) {
  const registryDirectory = path.resolve(
    input.registryDirectory || input.registry_directory || process.env.TENANT_REGISTRY_DIR || 'tenant-registry'
  );
  const tenantKey = normalizeLogin(input.tenantKey || input.tenant_key);
  const parentTeamSlug = normalizeLogin(input.parentTeamSlug || input.parent_team_slug);
  const subteamSlugs = [...new Set(
    (input.subteamSlugs || input.subteam_slugs || []).map(normalizeLogin).filter(Boolean)
  )];

  if (!tenantKey || !parentTeamSlug || subteamSlugs.length === 0) {
    return { status: 'failed', failure_reason: 'missing_topology_input', registry_path: null, appended_count: 0 };
  }

  if (!fs.existsSync(registryDirectory)) {
    return { status: 'failed', failure_reason: 'registry_directory_missing', registry_path: null, appended_count: 0 };
  }

  const entries = fs.readdirSync(registryDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') {
      continue;
    }

    const filePath = path.join(registryDirectory, entry.name);
    let record;
    try {
      record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }

    const recordKey = normalizeLogin(record && (record.tenantId || record.tenant_key));
    if (recordKey !== tenantKey) {
      continue;
    }

    if (!record.topology || !record.topology.teams || !Array.isArray(record.topology.teams.structure)) {
      return { status: 'skipped_legacy_record', failure_reason: null, registry_path: filePath, appended_count: 0 };
    }

    const structure = record.topology.teams.structure;
    const existingSlugs = new Set(
      structure.filter((node) => node && node.team).map((node) => normalizeLogin(node.team))
    );

    let appendedCount = 0;
    for (const slug of subteamSlugs) {
      if (existingSlugs.has(slug)) {
        continue;
      }
      structure.push({
        team: slug,
        parent: parentTeamSlug,
        type: 'subteam',
      });
      existingSlugs.add(slug);
      appendedCount += 1;
    }

    if (appendedCount === 0) {
      return { status: 'noop', failure_reason: null, registry_path: filePath, appended_count: 0 };
    }

    try {
      fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    } catch (error) {
      return { status: 'failed', failure_reason: error.message, registry_path: filePath, appended_count: 0 };
    }

    return { status: 'appended', failure_reason: null, registry_path: filePath, appended_count: appendedCount };
  }

  return { status: 'failed', failure_reason: 'tenant_record_not_found', registry_path: null, appended_count: 0 };
}

module.exports = {
  persistTenantSubteamTopology,
  reconcileTenantSubteamCreation,
};
