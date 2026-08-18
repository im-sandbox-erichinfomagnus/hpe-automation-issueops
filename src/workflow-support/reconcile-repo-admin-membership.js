'use strict';

const fs = require('fs');
const path = require('path');

function normalizeCurrentMember(member) {
  if (typeof member === 'string') {
    return {
      username: member.toLowerCase(),
      state: 'active',
    };
  }

  return {
    username: String(member.username || member.login || '').toLowerCase(),
    state: member.state || 'active',
  };
}

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

// Pure plan builder mirroring reconcile-cicd-admin-membership (#26). The
// repo-admin team normally already exists from tenant bootstrap, but the
// ensure-team step is kept for safety: when missing it is created as a child
// of the tenant root team and every active root-team maintainer is assigned
// as its Team Maintainer.
function reconcileRepoAdminMembership(input = {}) {
  const request = input.request || {};
  const validatedPeople = input.validatedPeople || input.requested_people || [];
  const repoAdminTeamExists = input.repo_admin_team_exists === true;
  const currentMembers = (input.currentMembers || input.current_members || []).map(normalizeCurrentMember);
  const currentMemberMap = new Map(
    currentMembers.filter((member) => member.username).map((member) => [member.username, member])
  );
  const rootTeamMaintainers = [...new Set(
    (input.rootTeamMaintainers || input.root_team_maintainers || [])
      .map((maintainer) => normalizeLogin(typeof maintainer === 'string' ? maintainer : maintainer.username))
      .filter(Boolean)
  )];

  const peopleToAdd = [];
  const peopleAlreadyPresent = [];
  const peopleRejected = [];

  for (const person of validatedPeople) {
    const currentMember = repoAdminTeamExists ? currentMemberMap.get(person.username) : null;
    if (person.resolution_status !== 'resolved') {
      peopleRejected.push({
        ...person,
        desired_action: 'reject',
      });
      continue;
    }

    if (currentMember) {
      peopleAlreadyPresent.push({
        ...person,
        current_membership_state: currentMember.state,
        desired_action: 'noop',
      });
      continue;
    }

    peopleToAdd.push({
      ...person,
      current_membership_state: 'absent',
      desired_action: 'add_member',
    });
  }

  const teamAction = repoAdminTeamExists ? 'noop' : 'create_team';
  const maintainersToAssign = repoAdminTeamExists ? [] : rootTeamMaintainers;
  const dryRun = Boolean(input.dry_run ?? request.dry_run);

  return {
    intake_mode: request.intake_mode || null,
    team_action: teamAction,
    repo_admin_team_slug: normalizeLogin(input.repo_admin_team_slug || request.repo_admin_team_slug),
    tenant_root_team_slug: normalizeLogin(input.tenant_root_team_slug || request.tenant_team_slug),
    tenant_root_team_id: input.tenant_root_team_id ?? null,
    maintainers_to_assign: maintainersToAssign,
    current_members: currentMembers,
    people_to_add: peopleToAdd,
    people_already_present: peopleAlreadyPresent,
    people_rejected: peopleRejected,
    dry_run: dryRun,
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    state:
      teamAction === 'noop' && peopleToAdd.length === 0 && peopleRejected.length === 0
        ? 'validated'
        : dryRun
          ? 'validated'
          : 'approved_for_execution',
  };
}

// Appends the repo-admin team node to the canonical tenant registry record when
// this operation had to create the team. Normally a noop: tenant bootstrap
// already records the repo-admin node.
function persistRepoAdminTeamTopology(input = {}) {
  const registryDirectory = path.resolve(
    input.registryDirectory || input.registry_directory || process.env.TENANT_REGISTRY_DIR || 'tenant-registry'
  );
  const tenantKey = normalizeLogin(input.tenantKey || input.tenant_key);
  const teamSlug = normalizeLogin(input.teamSlug || input.team_slug);
  const parentTeamSlug = normalizeLogin(input.parentTeamSlug || input.parent_team_slug);

  if (!tenantKey || !teamSlug || !parentTeamSlug) {
    return { status: 'failed', failure_reason: 'missing_topology_input', registry_path: null };
  }

  if (!fs.existsSync(registryDirectory)) {
    return { status: 'failed', failure_reason: 'registry_directory_missing', registry_path: null };
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
      return { status: 'skipped_legacy_record', failure_reason: null, registry_path: filePath };
    }

    const structure = record.topology.teams.structure;
    const alreadyPresent = structure.some(
      (node) => node && normalizeLogin(node.team) === teamSlug
    );
    if (alreadyPresent) {
      return { status: 'noop', failure_reason: null, registry_path: filePath };
    }

    structure.push({
      team: teamSlug,
      parent: parentTeamSlug,
      type: 'repo-admin',
    });

    try {
      fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    } catch (error) {
      return { status: 'failed', failure_reason: error.message, registry_path: filePath };
    }

    return { status: 'appended', failure_reason: null, registry_path: filePath };
  }

  return { status: 'failed', failure_reason: 'tenant_record_not_found', registry_path: null };
}

module.exports = {
  persistRepoAdminTeamTopology,
  reconcileRepoAdminMembership,
};
