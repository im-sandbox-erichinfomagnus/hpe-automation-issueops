'use strict';

const crypto = require('crypto');

const { readTenantRegistryRecords } = require('./resolve-tenant-context-from-registry');

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTenantName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 100);
}

// Mirrors specs/022-enhance-tenant-topology team derivation: a tenant's teams are
// <tenant-slug>-root, <tenant-slug>-admin, <tenant-slug>-repo-admin. The admin team
// (type "admin", carrying the tenant-admin role) is the tenant CI/CD administration
// authority that runner operations authorize against.
function deriveCanonicalTenantTeams(tenantDisplayName) {
  const slug = normalizeSlug(tenantDisplayName);
  return {
    tenant_root_team_slug: slug ? `${slug}-root` : '',
    admin_team_slug: slug ? `${slug}-admin` : '',
    repo_admin_team_slug: slug ? `${slug}-repo-admin` : '',
  };
}

// Backwards-compatible alias: callers asking for the tenant CI/CD admin team get the
// topology admin team derived from the tenant name.
function deriveCicdAdminTeam(tenantDisplayName) {
  const teams = deriveCanonicalTenantTeams(tenantDisplayName);
  return {
    cicd_admin_team_name: teams.admin_team_slug,
    cicd_admin_team_slug: teams.admin_team_slug,
  };
}

// Normalizes a registry record (canonical topology, legacy flat, or the persisted
// superset that carries both) into one view. Canonical topology wins when present;
// legacy records are projected to the canonical team naming the same way
// create-tenant-model migrates them.
function readTopologyView(record = {}) {
  const topology = record.topology && typeof record.topology === 'object' ? record.topology : null;

  if (topology && topology.teams && Array.isArray(topology.teams.structure)) {
    const byType = {};
    for (const node of topology.teams.structure) {
      if (node && node.type && node.team) {
        byType[String(node.type).toLowerCase()] = normalizeLogin(node.team);
      }
    }
    const orgName = record.organization
      || (topology.organization && topology.organization.orgName)
      || '';
    return {
      schema: 'canonical',
      tenant_key: normalizeLogin(record.tenantId || record.tenant_key),
      tenant_display_name: String(record.tenantName || record.tenant_display_name || ''),
      organization: normalizeLogin(orgName),
      tenant_root_team_slug: byType.root || normalizeLogin(topology.teams.tenantRootTeam),
      admin_team_slug: byType.admin || '',
      repo_admin_team_slug: byType['repo-admin'] || '',
    };
  }

  // Legacy record: project to canonical team naming so authorization is consistent
  // with the migrated topology that create-tenant-model now produces.
  const displayName = String(record.tenant_display_name || record.tenantName || '');
  const derived = deriveCanonicalTenantTeams(displayName);
  return {
    schema: 'legacy_projection',
    tenant_key: normalizeLogin(record.tenant_key || record.tenantId),
    tenant_display_name: displayName,
    organization: normalizeLogin(record.organization),
    tenant_root_team_slug: derived.tenant_root_team_slug,
    admin_team_slug: derived.admin_team_slug,
    repo_admin_team_slug: derived.repo_admin_team_slug,
  };
}

function recordOrganization(record = {}) {
  if (record.organization) {
    return normalizeLogin(record.organization);
  }
  if (record.topology && record.topology.organization && record.topology.organization.orgName) {
    return normalizeLogin(record.topology.organization.orgName);
  }
  return '';
}

function recordDisplayName(record = {}) {
  return String(record.tenantName || record.tenant_display_name || '');
}

function buildTenantNamespacePrefix(tenantDisplayName) {
  const normalizedName = String(tenantDisplayName || '').trim().replace(/\s+/g, '_');
  return normalizedName ? `${normalizedName}_` : '';
}

function resolveNamespaceOwner(resourceName, tenantDisplayNames = []) {
  const lowerResourceName = String(resourceName || '').toLowerCase();
  let owner = null;
  let ownerPrefixLength = 0;

  for (const displayName of tenantDisplayNames) {
    const prefix = buildTenantNamespacePrefix(displayName).toLowerCase();
    if (prefix && lowerResourceName.startsWith(prefix) && prefix.length > ownerPrefixLength) {
      owner = String(displayName || '').trim();
      ownerPrefixLength = prefix.length;
    }
  }

  return owner;
}

function buildCicdContextMarker(input = {}) {
  const payload = JSON.stringify({
    operation: String(input.operation || 'hosted_runner_creation'),
    organization: normalizeLogin(input.organization),
    target_resource_name: normalizeLogin(input.target_resource_name),
    designated_approver_login: normalizeLogin(input.designated_approver_login),
    tenant_key: normalizeLogin(input.tenant_key),
    cicd_admin_team_slug: normalizeLogin(input.cicd_admin_team_slug),
    registry_ref: String(input.registry_ref || 'main'),
  });

  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  return `tenant-runner-context:${digest}`;
}

async function resolveTenantCicdContextFromRegistry(input = {}, options = {}) {
  const registryRef = String(options.registryRef || process.env.TENANT_REGISTRY_REF || 'main');
  const requesterLogin = normalizeLogin(input.requester_login);
  const organization = normalizeLogin(input.organization);
  const requestedTenantName = String(input.tenant_name_input || '').trim();
  const requestedTenantNameNormalized = normalizeTenantName(input.tenant_name_normalized || requestedTenantName);
  const listTeams = options.listTeams;
  const getMembershipForUser = options.getMembershipForUser;

  const registryResult = readTenantRegistryRecords({ registryDirectory: options.registryDirectory });
  const recordsForOrganization = registryResult.records.filter(
    (record) => recordOrganization(record) === organization
  );
  const recordsForTenantName = requestedTenantNameNormalized
    ? recordsForOrganization.filter((record) => normalizeTenantName(recordDisplayName(record)) === requestedTenantNameNormalized)
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
  for (const record of recordsForTenantName) {
    const view = readTopologyView(record);
    const tenantRootTeamSlug = view.tenant_root_team_slug;
    const adminTeamSlug = view.admin_team_slug;
    const tenantRootTeam = tenantRootTeamSlug ? teamBySlug.get(tenantRootTeamSlug) || null : null;
    const adminTeam = adminTeamSlug ? teamBySlug.get(adminTeamSlug) || null : null;

    let governanceRelationStatus = 'valid';
    if (!tenantRootTeam || !tenantRootTeamSlug) {
      governanceRelationStatus = 'missing_tenant_team';
    } else if (!adminTeam || !adminTeamSlug) {
      governanceRelationStatus = 'missing_cicd_admin_team';
    }

    let requesterCicdMembershipState = 'unknown';
    let authorizationStatus = 'blocked';
    if (
      typeof getMembershipForUser === 'function' &&
      adminTeamSlug &&
      governanceRelationStatus === 'valid'
    ) {
      const cicdMembership = await getMembershipForUser({
        organization,
        teamSlug: adminTeamSlug,
        username: requesterLogin,
      });

      const membershipState = cicdMembership && cicdMembership.state
        ? String(cicdMembership.state).toLowerCase()
        : 'absent';
      const membershipRole = cicdMembership && cicdMembership.membership && cicdMembership.membership.role
        ? String(cicdMembership.membership.role).toLowerCase()
        : '';

      requesterCicdMembershipState = membershipState === 'active' && membershipRole === 'maintainer'
        ? 'active_maintainer'
        : membershipState === 'active'
          ? 'active_member'
          : membershipState === 'pending'
            ? 'pending'
            : membershipState === 'absent'
              ? 'absent'
              : 'unknown';

      authorizationStatus =
        requesterCicdMembershipState === 'active_member' || requesterCicdMembershipState === 'active_maintainer'
          ? 'authorized'
          : requesterCicdMembershipState === 'unknown'
            ? 'ambiguous'
            : 'unauthorized';
    }

    candidates.push({
      tenant_key: view.tenant_key,
      tenant_display_name: view.tenant_display_name,
      organization,
      registry_ref: registryRef,
      topology_schema: view.schema,
      tenant_team_name: tenantRootTeamSlug,
      tenant_team_slug: tenantRootTeamSlug,
      repo_admin_team_slug: view.repo_admin_team_slug,
      cicd_admin_team_name: adminTeamSlug,
      cicd_admin_team_slug: adminTeamSlug,
      cicd_admin_team_exists: Boolean(adminTeam),
      governance_relation_status: governanceRelationStatus,
      requester_cicd_membership_state: requesterCicdMembershipState,
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
    ? buildCicdContextMarker({
        operation: input.operation,
        organization,
        target_resource_name: input.target_resource_name,
        designated_approver_login: input.designated_approver_login,
        tenant_key: resolvedCandidate.tenant_key,
        cicd_admin_team_slug: resolvedCandidate.cicd_admin_team_slug,
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
      .map((record) => recordDisplayName(record).split(/[\r\n]+/)[0].trim())
      .filter(Boolean))],
    tenant_match_count: authorizedCandidates.length,
    tenant_resolution_status: tenantResolutionStatus,
    candidates,
    resolved_context: resolvedCandidate
      ? {
          ...resolvedCandidate,
          context_marker: contextMarker,
        }
      : null,
  };
}

module.exports = {
  buildCicdContextMarker,
  buildTenantNamespacePrefix,
  deriveCanonicalTenantTeams,
  deriveCicdAdminTeam,
  readTopologyView,
  resolveNamespaceOwner,
  resolveTenantCicdContextFromRegistry,
};
