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

async function resolveTenantContextFromRegistry(input = {}, options = {}) {
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
    const repoAdminTeamSlug = normalizeLogin(record.repo_admin_team_slug);
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

      authorizationStatus =
        tenantRoleState === 'active_maintainer' &&
        repoAdminMembershipState === 'active_member' &&
        governanceRelationStatus === 'valid'
          ? 'authorized'
          : tenantRoleState === 'active_member'
            ? 'unauthorized'
            : tenantRoleState === 'unknown' || repoAdminMembershipState === 'unknown'
              ? 'ambiguous'
              : 'blocked';
    }

    candidates.push({
      tenant_key: normalizeLogin(record.tenant_key),
      tenant_display_name: String(record.tenant_display_name || ''),
      organization,
      registry_ref: registryRef,
      tenant_team_name: String(record.tenant_team_name || ''),
      tenant_team_slug: tenantTeamSlug,
      repo_admin_team_name: String(record.repo_admin_team_name || ''),
      repo_admin_team_slug: repoAdminTeamSlug,
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
  buildContextMarker,
  readTenantRegistryRecords,
  resolveTenantContextFromRegistry,
};