'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTenantName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeRepositoryNameForComparison(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function safeReadJson(filePath) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(filePath, 'utf8')),
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}

function readTenantRegistryRecords(options = {}) {
  const registryDirectory = path.resolve(options.registryDirectory || process.env.TENANT_REGISTRY_DIR || 'tenant-registry');
  if (!fs.existsSync(registryDirectory)) {
    return {
      registry_directory: registryDirectory,
      records: [],
      malformed_files: [],
      missing_directory: true,
    };
  }

  const records = [];
  const malformedFiles = [];
  const entries = fs.readdirSync(registryDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') {
      continue;
    }

    const filePath = path.join(registryDirectory, entry.name);
    const readResult = safeReadJson(filePath);
    if (!readResult.ok) {
      malformedFiles.push({
        file: entry.name,
        error: readResult.error && readResult.error.message ? readResult.error.message : 'invalid_json',
      });
      continue;
    }

    const record = readResult.value;
    if (!record || typeof record !== 'object') {
      malformedFiles.push({ file: entry.name, error: 'invalid_record_shape' });
      continue;
    }

    records.push({ ...record, _source_file: entry.name });
  }

  return {
    registry_directory: registryDirectory,
    records,
    malformed_files: malformedFiles,
    missing_directory: false,
  };
}

function buildContextMarker(input = {}) {
  const payload = JSON.stringify({
    operation: 'tenant_repo_creation',
    organization: normalizeLogin(input.organization),
    repository_name_normalized: normalizeLogin(input.repository_name_normalized),
    designated_approver_login: normalizeLogin(input.designated_approver_login),
    tenant_key: normalizeLogin(input.tenant_key),
    tenant_team_slug: normalizeLogin(input.tenant_team_slug),
    repo_admin_team_slug: normalizeLogin(input.repo_admin_team_slug),
    registry_ref: String(input.registry_ref || 'main'),
  });

  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  return `tenant-repo-context:${digest}`;
}

function isCanonicalTopologyRecord(record) {
  return Boolean(
    record &&
    typeof record === 'object' &&
    record.tenantId &&
    record.topology &&
    typeof record.topology === 'object'
  );
}

function projectCanonicalRecord(record = {}) {
  const topology = record.topology && typeof record.topology === 'object' ? record.topology : {};
  const organization = topology.organization && topology.organization.orgName
    ? normalizeLogin(topology.organization.orgName)
    : '';
  const teams = topology.teams && typeof topology.teams === 'object' ? topology.teams : {};
  const structure = Array.isArray(teams.structure) ? teams.structure : [];
  const tenantRootTeamSlug = normalizeLogin(teams.tenantRootTeam || '');
  const repoAdminCandidates = structure
    .filter((node) => node && typeof node === 'object' && normalizeLogin(node.type) === 'repo-admin')
    .map((node) => ({
      team_slug: normalizeLogin(node.team || ''),
      parent_slug: normalizeLogin(node.parent || ''),
      team_name: String(node.name || node.team || ''),
    }))
    .filter((node) => node.team_slug);

  let selectedRepoAdmin = repoAdminCandidates[0] || null;
  let selectedRepoAdminParentMatchesRoot = false;
  if (tenantRootTeamSlug) {
    const sameParent = repoAdminCandidates.find((candidate) => candidate.parent_slug === tenantRootTeamSlug) || null;
    if (sameParent) {
      selectedRepoAdmin = sameParent;
      selectedRepoAdminParentMatchesRoot = true;
    }
  }
  if (!selectedRepoAdminParentMatchesRoot && selectedRepoAdmin && tenantRootTeamSlug) {
    selectedRepoAdminParentMatchesRoot = selectedRepoAdmin.parent_slug === tenantRootTeamSlug;
  }

  const accessModel = topology.accessModel && typeof topology.accessModel === 'object'
    ? topology.accessModel
    : {};
  const accessModelEnforcement = String(accessModel.enforcement || '').trim().toLowerCase();
  const accessModelRoles = Array.isArray(accessModel.roles)
    ? accessModel.roles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean)
    : [];

  const ownedRaw = topology.repositories && typeof topology.repositories === 'object'
    ? topology.repositories.owned
    : undefined;
  const ownedRepositoriesStatus = Array.isArray(ownedRaw)
    ? 'array'
    : ownedRaw == null
      ? 'absent'
      : 'invalid';
  const ownedRepositories = Array.isArray(ownedRaw)
    ? ownedRaw
    : [];

  return {
    topology_mode: 'canonical',
    tenant_id: normalizeLogin(record.tenantId || ''),
    tenant_key: normalizeLogin(record.tenantId || ''),
    tenant_display_name: String(record.tenantName || ''),
    organization,
    tenant_team_name: String(teams.tenantRootTeamName || teams.tenantRootTeam || ''),
    tenant_team_slug: tenantRootTeamSlug,
    repo_admin_team_name: selectedRepoAdmin ? selectedRepoAdmin.team_name : '',
    repo_admin_team_slug: selectedRepoAdmin ? selectedRepoAdmin.team_slug : '',
    repo_admin_parent_matches_root: selectedRepoAdminParentMatchesRoot,
    access_model_enforcement: accessModelEnforcement,
    access_model_roles: accessModelRoles,
    canonical_fields_consulted: [
      'tenantId',
      'topology.organization.orgName',
      'topology.teams.tenantRootTeam',
      'topology.teams.structure',
      'topology.accessModel.enforcement',
      'topology.accessModel.roles',
      'topology.repositories.owned',
    ],
    owned_repositories: ownedRepositories,
    owned_repositories_status: ownedRepositoriesStatus,
  };
}

function projectLegacyRecord(record = {}) {
  return {
    topology_mode: 'legacy_projection',
    tenant_id: normalizeLogin(record.tenant_key || ''),
    tenant_key: normalizeLogin(record.tenant_key || ''),
    tenant_display_name: String(record.tenant_display_name || ''),
    organization: normalizeLogin(record.organization || ''),
    tenant_team_name: String(record.tenant_team_name || ''),
    tenant_team_slug: normalizeLogin(record.tenant_team_slug || ''),
    repo_admin_team_name: String(record.repo_admin_team_name || ''),
    repo_admin_team_slug: normalizeLogin(record.repo_admin_team_slug || ''),
    repo_admin_parent_matches_root: true,
    access_model_enforcement: '',
    access_model_roles: [],
    canonical_fields_consulted: [],
    owned_repositories: [],
    owned_repositories_status: 'absent',
  };
}

function projectTenantRecord(record = {}) {
  if (isCanonicalTopologyRecord(record)) {
    return projectCanonicalRecord(record);
  }

  return projectLegacyRecord(record);
}

async function resolveTenantContextFromRegistry(input = {}, options = {}) {
  const registryRef = String(options.registryRef || process.env.TENANT_REGISTRY_REF || 'main');
  const requesterLogin = normalizeLogin(input.requester_login);
  const organization = normalizeLogin(input.organization);
  const requestedTenantName = String(input.tenant_name_input || '').trim();
  const requestedTenantNameNormalized = normalizeTenantName(input.tenant_name_normalized || requestedTenantName);
  const listTeams = options.listTeams;
  const getMembershipForUser = options.getMembershipForUser;

  const registryResult = readTenantRegistryRecords({ registryDirectory: options.registryDirectory });
  const projectedRecords = registryResult.records
    .map((record) => ({
      source_record: record,
      projection: projectTenantRecord(record),
    }))
    .filter((entry) => entry.projection.organization);

  const recordsForOrganization = projectedRecords.filter(
    (entry) => entry.projection.organization === organization
  );
  const recordsForTenantName = requestedTenantNameNormalized
    ? recordsForOrganization.filter((entry) => normalizeTenantName(entry.projection.tenant_display_name) === requestedTenantNameNormalized)
    : recordsForOrganization;

  const teams = typeof listTeams === 'function'
    ? await listTeams({ organization })
    : [];
  const teamBySlug = new Map(
    (teams || [])
      .filter((team) => team && team.slug)
      .map((team) => [normalizeLogin(team.slug), team])
  );

  const candidates = [];
  for (const entry of recordsForTenantName) {
    const record = entry.source_record;
    const projection = entry.projection;
    const tenantTeamSlug = normalizeLogin(projection.tenant_team_slug);
    const repoAdminTeamSlug = normalizeLogin(projection.repo_admin_team_slug);
    const tenantTeam = tenantTeamSlug ? teamBySlug.get(tenantTeamSlug) || null : null;
    const repoAdminTeam = repoAdminTeamSlug ? teamBySlug.get(repoAdminTeamSlug) || null : null;

    let governanceRelationStatus = 'valid';
    if (!tenantTeam || !tenantTeamSlug) {
      governanceRelationStatus = 'conflicting';
    } else if (!repoAdminTeam || !repoAdminTeamSlug) {
      governanceRelationStatus = 'missing_repo_admin';
    } else {
      const parentSlug = repoAdminTeam.parent && repoAdminTeam.parent.slug
        ? normalizeLogin(repoAdminTeam.parent.slug)
        : '';
      if (!parentSlug) {
        governanceRelationStatus = 'wrong_parent';
      } else if (parentSlug !== tenantTeamSlug) {
        governanceRelationStatus = 'wrong_parent';
      }
    }

    let tenantRoleState = 'unknown';
    let repoAdminMembershipState = 'unknown';
    let authorizationStatus = 'blocked';
    if (typeof getMembershipForUser === 'function' && tenantTeamSlug && repoAdminTeamSlug) {
      const tenantMembership = await getMembershipForUser({
        organization,
        teamSlug: tenantTeamSlug,
        username: requesterLogin,
      });
      const repoAdminMembership = await getMembershipForUser({
        organization,
        teamSlug: repoAdminTeamSlug,
        username: requesterLogin,
      });

      const tenantMembershipState = tenantMembership && tenantMembership.state
        ? String(tenantMembership.state).toLowerCase()
        : 'absent';
      const tenantRole = tenantMembership && tenantMembership.membership && tenantMembership.membership.role
        ? String(tenantMembership.membership.role).toLowerCase()
        : '';
      const repoAdminState = repoAdminMembership && repoAdminMembership.state
        ? String(repoAdminMembership.state).toLowerCase()
        : 'absent';

      tenantRoleState = tenantMembershipState === 'active' && tenantRole === 'maintainer'
        ? 'active_maintainer'
        : tenantMembershipState === 'active'
          ? 'active_member'
          : tenantMembershipState === 'absent'
            ? 'absent'
            : 'unknown';
      repoAdminMembershipState = repoAdminState === 'active' ? 'active_member' : repoAdminState === 'absent' ? 'absent' : 'unknown';

      // V2.2.1 create-repo authorization: a requester may act on the tenant when
      // they are an active maintainer of the tenant top team OR an active
      // member/maintainer of the repo-admin team (an active repo-admin membership
      // maps to 'active_member' above). This is an OR, not an AND: a plain
      // repo-admin member who is not the tenant admin is authorized.
      const requesterIsTopMaintainer = tenantRoleState === 'active_maintainer';
      const requesterIsRepoAdminMember = repoAdminMembershipState === 'active_member';
      const membershipUnknown = tenantRoleState === 'unknown' || repoAdminMembershipState === 'unknown';

      authorizationStatus =
        governanceRelationStatus === 'valid' && (requesterIsTopMaintainer || requesterIsRepoAdminMember)
          ? 'authorized'
          : membershipUnknown
            ? 'ambiguous'
            : governanceRelationStatus === 'valid' && tenantRoleState === 'active_member'
              ? 'unauthorized'
              : 'blocked';
    }

    candidates.push({
      topology_mode: projection.topology_mode,
      tenant_id: projection.tenant_id,
      tenant_key: projection.tenant_key,
      tenant_display_name: projection.tenant_display_name,
      organization,
      registry_ref: registryRef,
      tenant_team_name: projection.tenant_team_name,
      tenant_team_slug: tenantTeamSlug,
      repo_admin_team_name: projection.repo_admin_team_name,
      repo_admin_team_slug: repoAdminTeamSlug,
      owned_repositories: projection.owned_repositories,
      owned_repositories_status: projection.owned_repositories_status,
      repo_admin_parent_matches_root: projection.repo_admin_parent_matches_root,
      access_model_enforcement: projection.access_model_enforcement,
      access_model_roles: projection.access_model_roles,
      canonical_fields_consulted: projection.canonical_fields_consulted,
      governance_relation_status: governanceRelationStatus,
      tenant_role_state: tenantRoleState,
      repo_admin_membership_state: repoAdminMembershipState,
      authorization_status: authorizationStatus,
      source_file: record._source_file,
    });
  }

  const authorizedCandidates = candidates.filter((candidate) => candidate.authorization_status === 'authorized');
  let tenantResolutionStatus = 'no_match';
  if (registryResult.malformed_files.length > 0 && recordsForOrganization.length === 0) {
    tenantResolutionStatus = 'registry_conflict';
  } else if (authorizedCandidates.length === 1) {
    tenantResolutionStatus = 'resolved';
  } else if (authorizedCandidates.length > 1) {
    tenantResolutionStatus = 'ambiguous';
  }

  const resolvedCandidate = tenantResolutionStatus === 'resolved' ? authorizedCandidates[0] : null;
  const contextMarker = resolvedCandidate
    ? buildContextMarker({
        organization,
        repository_name_normalized: input.repository_name_normalized,
        designated_approver_login: input.designated_approver_login,
        tenant_key: resolvedCandidate.tenant_key,
        tenant_team_slug: resolvedCandidate.tenant_team_slug,
        repo_admin_team_slug: resolvedCandidate.repo_admin_team_slug,
        registry_ref: registryRef,
      })
    : '';

  return {
    registry_ref: registryRef,
    registry_directory: registryResult.registry_directory,
    registry_missing_directory: registryResult.missing_directory,
    registry_malformed_files: registryResult.malformed_files,
    requested_tenant_name: requestedTenantName,
    requested_tenant_name_normalized: requestedTenantNameNormalized,
    candidate_registry_record_count: recordsForTenantName.length,
    available_tenant_display_names: [...new Set(recordsForOrganization
      .map((entry) => String(entry.projection.tenant_display_name || '').split(/[\r\n]+/)[0].trim())
      .filter(Boolean))],
    tenant_match_count: authorizedCandidates.length,
    tenant_resolution_status: tenantResolutionStatus,
    candidates,
    resolved_context: resolvedCandidate
      ? {
          ...resolvedCandidate,
          repository_name_normalized_for_context: normalizeRepositoryNameForComparison(input.repository_name_normalized),
          context_marker: contextMarker,
        }
      : null,
  };
}

module.exports = {
  buildContextMarker,
  readTenantRegistryRecords,
  resolveTenantContextFromRegistry,
};