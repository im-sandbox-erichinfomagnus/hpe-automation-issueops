'use strict';

const fs = require('fs');
const path = require('path');

function ensureJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeForComparison(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForComparison(entry));
  }

  if (value && typeof value === 'object') {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeForComparison(value[key]);
    }
    return normalized;
  }

  return value;
}

function stripVolatileRegistryFields(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  const { updated_at, source_run_id, ...stable } = record;
  return stable;
}

function isLegacyTenantRecord(record) {
  return Boolean(record && typeof record === 'object' && record.tenant_key && !record.tenantId);
}

function normalizeLifecycleStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'active') {
    return 'active';
  }
  if (['blocked', 'inactive', 'suspended'].includes(normalized)) {
    return 'blocked';
  }
  if (['partial_failure', 'partial-failure', 'failed_after_approved_execution', 'partially_executed'].includes(normalized)) {
    return 'partial_failure';
  }
  if (['decommissioned', 'retired'].includes(normalized)) {
    return 'decommissioned';
  }
  return 'active';
}

function mapCicdRegistryExtension(input = {}) {
  const request = input.request || {};
  const reconciliation = input.reconciliation || {};
  const decision = reconciliation.cicd_capability_decision || request.cicd_capability_intent || {};

  return {
    cicd_admin_team_name: request.cicd_admin_team_name || null,
    cicd_admin_team_slug: request.cicd_admin_team_slug || null,
    cicd_capability_status: decision.status || request.cicd_capability_status || 'requested',
    cicd_capability_reason_code: decision.reason_code || request.cicd_capability_reason_code || null,
    cicd_capability_evidence_ref: request.cicd_capability_evidence_ref || null,
  };
}

function mapCicdTopologyRelation(input = {}) {
  const request = input.request || {};
  const reconciliation = input.reconciliation || {};
  const relationOutcome = reconciliation.cicd_topology_update_result && reconciliation.cicd_topology_update_result.status
    ? reconciliation.cicd_topology_update_result.status
    : reconciliation.cicd_topology_update_action === 'not_applicable'
      ? 'noop'
      : 'applied';

  if (!request.cicd_admin_team_slug) {
    return null;
  }

  return {
    parent_team_name: request.tenant_team_name || null,
    parent_team_slug: request.tenant_team_slug || null,
    child_team_name: request.cicd_admin_team_name || null,
    child_team_slug: request.cicd_admin_team_slug,
    relation_status: relationOutcome,
    conflict_reason: reconciliation.cicd_topology_update_result && reconciliation.cicd_topology_update_result.conflict_reason || null,
  };
}

function ensureTopologyStructureRelation(topology = {}, relation = null) {
  if (!relation || !relation.child_team_slug || !relation.parent_team_slug) {
    return topology;
  }

  // Only persist a structure edge when the reconciliation actually applied it.
  if (String(relation.relation_status || '').toLowerCase() !== 'applied') {
    return topology;
  }

  const nextTopology = topology && typeof topology === 'object' ? { ...topology } : {};
  const teams = nextTopology.teams && typeof nextTopology.teams === 'object' ? { ...nextTopology.teams } : {};
  const structure = Array.isArray(teams.structure) ? [...teams.structure] : [];
  const alreadyPresent = structure.some((entry) =>
    entry &&
    String(entry.team || '').toLowerCase() === String(relation.child_team_slug).toLowerCase() &&
    String(entry.parent || '').toLowerCase() === String(relation.parent_team_slug).toLowerCase()
  );

  const childAlreadyMapped = structure.some((entry) =>
    entry && String(entry.team || '').toLowerCase() === String(relation.child_team_slug).toLowerCase()
  );

  if (!alreadyPresent && !childAlreadyMapped) {
    structure.push({
      team: relation.child_team_slug,
      parent: relation.parent_team_slug,
      type: 'cicd-admin',
    });
  }

  teams.structure = structure;
  nextTopology.teams = teams;
  return nextTopology;
}

function buildTenantRegistryRecord(input = {}) {
  const request = input.request || {};
  const reconciliation = input.reconciliation || {};
  const nowIso = new Date().toISOString();
  const cicdExtension = mapCicdRegistryExtension({ request, reconciliation });
  const cicdTopologyRelation = mapCicdTopologyRelation({ request, reconciliation });
  const topologyWithCicdRelation = ensureTopologyStructureRelation(request.topology || null, cicdTopologyRelation);

  return {
    tenantId: request.tenant_key,
    tenantName: request.tenant_display_name,
    tenantType: request.tenant_type || 'application',
    topology: topologyWithCicdRelation,
    externalMappings: {
      cmdbId: request.external_mappings && request.external_mappings.cmdb_id || null,
      costCenter: request.external_mappings && request.external_mappings.cost_center || null,
      businessUnit: request.external_mappings && request.external_mappings.business_unit || null,
      environment: request.external_mappings && request.external_mappings.environment || 'nonprod',
    },
    metadata: {
      primaryContact: request.primary_contact || '',
      secondaryContact: request.secondary_contact || null,
      createdBy: request.requester_login,
      createdDate: request.submitted_at || nowIso,
    },
    lifecycleStatus: request.canonical_tenant_record && request.canonical_tenant_record.lifecycleStatus
      ? request.canonical_tenant_record.lifecycleStatus
      : normalizeLifecycleStatus(input.lifecycle_status || request.lifecycle_status),
    tenant_key: request.tenant_key,
    tenant_display_name: request.tenant_display_name,
    organization: request.organization,
    tenant_team_name: request.tenant_team_name,
    tenant_team_slug: request.tenant_team_slug,
    repo_admin_team_name: request.repo_admin_team_name,
    repo_admin_team_slug: request.repo_admin_team_slug,
    cicd_admin_team_name: cicdExtension.cicd_admin_team_name,
    cicd_admin_team_slug: cicdExtension.cicd_admin_team_slug,
    cicd_topology_relation: cicdTopologyRelation,
    cicd_capability_status: cicdExtension.cicd_capability_status,
    cicd_capability_reason_code: cicdExtension.cicd_capability_reason_code,
    cicd_capability_evidence_ref: cicdExtension.cicd_capability_evidence_ref,
    bootstrap_tenant_admin_login: request.tenant_admin_login || null,
    requester_login: request.requester_login,
    approver_login: input.approver_login || '',
    lifecycle_status: input.lifecycle_status || 'active',
    created_at: input.created_at || nowIso,
    updated_at: nowIso,
    source_issue_number: request.issue_number,
    source_run_id: input.run_id || process.env.GITHUB_RUN_ID || null,
  };
}

function persistTenantRegistryRecord(input = {}) {
  const request = input.request || {};
  const mode = String(input.mode || process.env.TENANT_REGISTRY_PERSISTENCE_MODE || 'artifact').toLowerCase();
  const requireDirectory = input.requireDirectory != null
    ? Boolean(input.requireDirectory)
    : String(process.env.TENANT_REGISTRY_REQUIRE_DIRECTORY || 'true').toLowerCase() !== 'false';
  const registryDirectory = path.resolve(input.registryDirectory || process.env.TENANT_REGISTRY_DIR || 'tenant-registry');
  const artifactDirectory = path.resolve(input.artifactDirectory || 'artifacts');

  const record = buildTenantRegistryRecord({
    request,
    reconciliation: input.reconciliation || null,
    approver_login: input.approver_login,
    lifecycle_status: input.lifecycle_status,
    run_id: input.run_id,
  });

  const fileName = `${request.tenant_key || 'unknown-tenant'}.json`;
  const registryFilePath = path.join(registryDirectory, fileName);

  if (requireDirectory && !fs.existsSync(registryDirectory)) {
    fs.mkdirSync(artifactDirectory, { recursive: true });
    const fallbackPath = path.join(artifactDirectory, `tenant-registry-fallback-${request.issue_number || 'manual'}.json`);
    fs.writeFileSync(fallbackPath, ensureJson({
      status: 'missing_registry_directory',
      registry_directory: registryDirectory,
      intended_registry_path: registryFilePath,
      mode,
      record,
      generated_at: new Date().toISOString(),
    }), 'utf8');

    return {
      status: 'blocked_missing_directory',
      mode,
      registry_directory: registryDirectory,
      registry_path: registryFilePath,
      fallback_artifact_path: fallbackPath,
      error: 'tenant-registry directory is missing',
    };
  }

  if (mode === 'artifact') {
    fs.mkdirSync(artifactDirectory, { recursive: true });
    const artifactPath = path.join(artifactDirectory, `tenant-registry-record-${request.issue_number || 'manual'}.json`);
    fs.writeFileSync(artifactPath, ensureJson(record), 'utf8');

    return {
      status: 'artifact_written',
      mode,
      registry_path: registryFilePath,
      fallback_artifact_path: artifactPath,
      record,
    };
  }

  try {
    let existingRecord = null;
    try {
      existingRecord = JSON.parse(fs.readFileSync(registryFilePath, 'utf8'));
    } catch (readError) {
      if (!readError || readError.code !== 'ENOENT') {
        throw readError;
      }
    }
    const legacyMigrationDetected = isLegacyTenantRecord(existingRecord);
    const createdAt = existingRecord && existingRecord.created_at
      ? existingRecord.created_at
      : record.created_at;
    const persistedRecord = {
      ...record,
      created_at: createdAt,
    };

    if (existingRecord) {
      const existingComparable = normalizeForComparison(stripVolatileRegistryFields(existingRecord));
      const persistedComparable = normalizeForComparison(stripVolatileRegistryFields(persistedRecord));

      if (JSON.stringify(existingComparable) === JSON.stringify(persistedComparable)) {
        return {
          status: 'unchanged',
          mode,
          registry_path: registryFilePath,
          record: existingRecord,
        };
      }
    }

    fs.writeFileSync(registryFilePath, ensureJson(persistedRecord), 'utf8');

    return {
      status: existingRecord ? 'updated' : 'created',
      mode,
      registry_path: registryFilePath,
      record: persistedRecord,
      migration: legacyMigrationDetected
        ? {
            status: 'legacy_to_canonical_migrated',
            from_schema: 'legacy',
            to_schema: 'canonical',
          }
        : {
            status: 'none',
            from_schema: existingRecord ? 'canonical' : 'new',
            to_schema: 'canonical',
          },
    };
  } catch (error) {
    fs.mkdirSync(artifactDirectory, { recursive: true });
    const fallbackPath = path.join(artifactDirectory, `tenant-registry-fallback-${request.issue_number || 'manual'}.json`);
    fs.writeFileSync(fallbackPath, ensureJson({
      status: 'durable_write_failed',
      mode,
      registry_directory: registryDirectory,
      intended_registry_path: registryFilePath,
      error: error.message,
      record,
      generated_at: new Date().toISOString(),
    }), 'utf8');

    return {
      status: 'partial_failure_durable_write',
      mode,
      registry_path: registryFilePath,
      fallback_artifact_path: fallbackPath,
      error: error.message,
    };
  }
}

module.exports = {
  buildTenantRegistryRecord,
  mapCicdRegistryExtension,
  mapCicdTopologyRelation,
  persistTenantRegistryRecord,
};
