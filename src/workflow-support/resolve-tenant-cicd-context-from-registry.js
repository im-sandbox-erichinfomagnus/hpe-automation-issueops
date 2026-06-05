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

function deriveCicdAdminTeam(tenantDisplayName) {
  const normalizedName = String(tenantDisplayName || '').trim().replace(/\s+/g, '_');
  const cicdAdminTeamName = `${normalizedName}_CICDAdmins`;

  return {
    cicd_admin_team_name: cicdAdminTeamName,
    cicd_admin_team_slug: normalizeSlug(cicdAdminTeamName),
  };
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
    (record) => normalizeLogin(record.organization) === organization
  );
  const recordsForTenantName = requestedTenantNameNormalized
    ? recordsForOrganization.filter((record) => normalizeTenantName(record.tenant_display_name) === requestedTenantNameNormalized)
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
    const tenantTeamSlug = normalizeLogin(record.tenant_team_slug);
    const derivedCicdTeam = deriveCicdAdminTeam(record.tenant_display_name);
    const cicdAdminTeamSlug = derivedCicdTeam.cicd_admin_team_slug;
    const tenantTeam = tenantTeamSlug ? teamBySlug.get(tenantTeamSlug) || null : null;
    const cicdAdminTeam = cicdAdminTeamSlug ? teamBySlug.get(cicdAdminTeamSlug) || null : null;

    let governanceRelationStatus = 'valid';
    if (!tenantTeam || !tenantTeamSlug) {
      governanceRelationStatus = 'missing_tenant_team';
    } else if (!cicdAdminTeam || !cicdAdminTeamSlug) {
      governanceRelationStatus = 'missing_cicd_admin_team';
    }

    let requesterCicdMembershipState = 'unknown';
    let authorizationStatus = 'blocked';
    if (
      typeof getMembershipForUser === 'function' &&
      cicdAdminTeamSlug &&
      governanceRelationStatus === 'valid'
    ) {
      const cicdMembership = await getMembershipForUser({
        organization,
        teamSlug: cicdAdminTeamSlug,
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
      tenant_key: normalizeLogin(record.tenant_key),
      tenant_display_name: String(record.tenant_display_name || ''),
      organization,
      registry_ref: registryRef,
      tenant_team_name: String(record.tenant_team_name || ''),
      tenant_team_slug: tenantTeamSlug,
      cicd_admin_team_name: derivedCicdTeam.cicd_admin_team_name,
      cicd_admin_team_slug: cicdAdminTeamSlug,
      cicd_admin_team_exists: Boolean(cicdAdminTeam),
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
      .map((record) => String(record.tenant_display_name || '').split(/[\r\n]+/)[0].trim())
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
  deriveCicdAdminTeam,
  resolveNamespaceOwner,
  resolveTenantCicdContextFromRegistry,
};
