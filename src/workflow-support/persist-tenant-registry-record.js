'use strict';

const fs = require('fs');
const path = require('path');

function ensureJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildTenantRegistryRecord(input = {}) {
  const request = input.request || {};
  const nowIso = new Date().toISOString();

  return {
    tenant_key: request.tenant_key,
    tenant_display_name: request.tenant_display_name,
    organization: request.organization,
    tenant_team_name: request.tenant_team_name,
    tenant_team_slug: request.tenant_team_slug,
    repo_admin_team_name: request.repo_admin_team_name,
    repo_admin_team_slug: request.repo_admin_team_slug,
    bootstrap_tenant_admin_login: request.requester_login,
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
    const existedBeforeWrite = fs.existsSync(registryFilePath);
    const createdAt = existedBeforeWrite
      ? JSON.parse(fs.readFileSync(registryFilePath, 'utf8')).created_at || record.created_at
      : record.created_at;
    const persistedRecord = {
      ...record,
      created_at: createdAt,
    };

    fs.writeFileSync(registryFilePath, ensureJson(persistedRecord), 'utf8');

    return {
      status: existedBeforeWrite ? 'updated' : 'created',
      mode,
      registry_path: registryFilePath,
      record: persistedRecord,
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
  persistTenantRegistryRecord,
};
