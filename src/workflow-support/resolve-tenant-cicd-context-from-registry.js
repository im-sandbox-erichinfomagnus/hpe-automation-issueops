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
// <tenant-slug>-root, <tenant-slug>-admin, <tenant-slug>-repo-admin and
// <tenant-slug>-cicd-admin. Per the HPE release sheet the CICDAdmins team is the
// primary CI/CD role for runner and variable operations; the tenant admin team is
// accepted as a fallback so tenants provisioned before the dedicated team existed
// keep working.
function deriveCanonicalTenantTeams(tenantDisplayName) {
  const slug = normalizeSlug(tenantDisplayName);
  return {
    tenant_root_team_slug: slug ? `${slug}-root` : '',
    admin_team_slug: slug ? `${slug}-admin` : '',
    repo_admin_team_slug: slug ? `${slug}-repo-admin` : '',
    cicd_admin_team_slug: slug ? `${slug}-cicd-admin` : '',
  };
}

// Callers asking for the tenant CI/CD admin team get the dedicated cicd-admin team,
// the same team add-cicd-admin-to-tenant writes members into.
function deriveCicdAdminTeam(tenantDisplayName) {
  const teams = deriveCanonicalTenantTeams(tenantDisplayName);
  return {
    cicd_admin_team_name: teams.cicd_admin_team_slug,
    cicd_admin_team_slug: teams.cicd_admin_team_slug,
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
    // A structure array can omit node types (acme.json carries only cicd-admin), so
    // each slug falls back to the record's flat field before giving up.
    return {
      schema: 'canonical',
      tenant_key: normalizeLogin(record.tenantId || record.tenant_key),
      tenant_display_name: String(record.tenantName || record.tenant_display_name || ''),
      organization: normalizeLogin(orgName),
      tenant_root_team_slug: byType.root
        || normalizeLogin(topology.teams.tenantRootTeam)
        || normalizeLogin(record.tenant_team_slug),
      admin_team_slug: byType.admin || normalizeLogin(record.admin_team_slug),
      repo_admin_team_slug: byType['repo-admin'] || normalizeLogin(record.repo_admin_team_slug),
      cicd_admin_team_slug: byType['cicd-admin'] || normalizeLogin(record.cicd_admin_team_slug),
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
    cicd_admin_team_slug: derived.cicd_admin_team_slug,
  };
}

// Release sheet order: CICDAdmins is the primary CI/CD role, the tenant admin team is
// the accepted fallback. teamExists, when supplied, drops teams absent from the org so
// a tenant without a dedicated cicd-admin team still authorizes against admin.
function orderedCicdTeamCandidates(input = {}) {
  const seen = new Set();
  return [
    { slug: normalizeLogin(input.cicdAdminTeamSlug), matched_on: 'cicd-admin' },
    { slug: normalizeLogin(input.adminTeamSlug), matched_on: 'admin' },
  ].filter((candidate) => {
    if (!candidate.slug || seen.has(candidate.slug)) {
      return false;
    }
    seen.add(candidate.slug);
    return typeof input.teamExists === 'function' ? Boolean(input.teamExists(candidate.slug)) : true;
  });
}

function normalizeMembershipState(membership) {
  const state = membership && membership.state ? String(membership.state).toLowerCase() : 'absent';
  const role = membership && membership.membership && membership.membership.role
    ? String(membership.membership.role).toLowerCase()
    : '';

  if (state === 'active') {
    return role === 'maintainer' ? 'active_maintainer' : 'active_member';
  }
  return state === 'pending' ? 'pending' : state === 'absent' ? 'absent' : 'unknown';
}

function isActiveCicdMembershipState(state) {
  return state === 'active_member' || state === 'active_maintainer';
}

// Shared by the runner resolver and the tenant-variables validator so the two CI/CD
// gates cannot drift. Stops at the first team the requester is active in.
async function probeCicdTeamMembership(input = {}) {
  const candidates = orderedCicdTeamCandidates(input);
  const base = {
    cicd_admin_team_slug: candidates.length ? candidates[0].slug : '',
    cicd_admin_team_matched_on: null,
    candidate_team_slugs: candidates.map((candidate) => candidate.slug),
    membership_state: 'unknown',
    authorized: false,
  };

  if (typeof input.getMembershipForUser !== 'function' || candidates.length === 0) {
    return base;
  }

  const observedStates = [];
  for (const candidate of candidates) {
    const membership = await input.getMembershipForUser({
      organization: input.organization,
      teamSlug: candidate.slug,
      username: input.username,
    });
    const membershipState = normalizeMembershipState(membership);
    observedStates.push(membershipState);

    if (isActiveCicdMembershipState(membershipState)) {
      return {
        ...base,
        cicd_admin_team_slug: candidate.slug,
        cicd_admin_team_matched_on: candidate.matched_on,
        membership_state: membershipState,
        authorized: true,
      };
    }
  }

  return {
    ...base,
    membership_state: observedStates.includes('unknown') ? 'unknown' : observedStates[0],
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
    const cicdAdminTeamSlug = view.cicd_admin_team_slug;
    const tenantRootTeam = tenantRootTeamSlug ? teamBySlug.get(tenantRootTeamSlug) || null : null;
    const teamExists = (slug) => teamBySlug.has(slug);
    const eligibleCicdTeams = orderedCicdTeamCandidates({ cicdAdminTeamSlug, adminTeamSlug, teamExists });

    let governanceRelationStatus = 'valid';
    if (!tenantRootTeam || !tenantRootTeamSlug) {
      governanceRelationStatus = 'missing_tenant_team';
    } else if (eligibleCicdTeams.length === 0) {
      governanceRelationStatus = 'missing_cicd_admin_team';
    }

    let cicdProbe = {
      // Fall back to the declared slug so remediation messages still name a team
      // when neither CI/CD team exists in the organization.
      cicd_admin_team_slug: eligibleCicdTeams.length
        ? eligibleCicdTeams[0].slug
        : (cicdAdminTeamSlug || adminTeamSlug),
      cicd_admin_team_matched_on: null,
      membership_state: 'unknown',
      authorized: false,
    };
    if (governanceRelationStatus === 'valid') {
      cicdProbe = await probeCicdTeamMembership({
        organization,
        username: requesterLogin,
        getMembershipForUser,
        cicdAdminTeamSlug,
        adminTeamSlug,
        teamExists,
      });
    }

    const requesterCicdMembershipState = cicdProbe.membership_state;
    const resolvedCicdTeamSlug = cicdProbe.cicd_admin_team_slug;
    let authorizationStatus = 'blocked';
    if (governanceRelationStatus === 'valid') {
      authorizationStatus = cicdProbe.authorized
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
      cicd_admin_team_name: resolvedCicdTeamSlug,
      cicd_admin_team_slug: resolvedCicdTeamSlug,
      cicd_admin_team_matched_on: cicdProbe.cicd_admin_team_matched_on,
      cicd_admin_team_candidate_slugs: eligibleCicdTeams.map((candidate) => candidate.slug),
      cicd_admin_team_exists: eligibleCicdTeams.length > 0,
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
  orderedCicdTeamCandidates,
  probeCicdTeamMembership,
  readTopologyView,
  resolveNamespaceOwner,
  resolveTenantCicdContextFromRegistry,
};
