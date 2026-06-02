'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { toAuditArtifactJson } = require('../workflow-support/build-audit-artifact');

function writeGitHubOutput(key, value, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) {
    return;
  }

  fs.appendFileSync(outputPath, `${key}=${value}\n`, 'utf8');
}

function buildArtifactsUrl(repository, artifactName) {
  return `https://api.github.com/repos/${repository}/actions/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`;
}

async function listArtifacts({ repository, artifactName, token, fetchImpl = global.fetch }) {
  const response = await fetchImpl(buildArtifactsUrl(repository, artifactName), {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to list workflow artifacts (${response.status}).`);
  }

  const payload = await response.json();
  return payload && Array.isArray(payload.artifacts) ? payload.artifacts : [];
}

function pickLatestArtifact(artifacts = [], currentRunId = null) {
  const normalizedCurrentRunId = currentRunId == null ? null : String(currentRunId);

  return [...artifacts]
    .filter((artifact) => artifact && artifact.expired !== true)
    .filter((artifact) => {
      const artifactRunId = artifact.workflow_run && artifact.workflow_run.id != null
        ? String(artifact.workflow_run.id)
        : null;
      return !normalizedCurrentRunId || artifactRunId !== normalizedCurrentRunId;
    })
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))[0] || null;
}

function listCandidateArtifacts(artifacts = [], currentRunId = null) {
  const normalizedCurrentRunId = currentRunId == null ? null : String(currentRunId);

  return [...artifacts]
    .filter((artifact) => artifact && artifact.expired !== true)
    .filter((artifact) => {
      const artifactRunId = artifact.workflow_run && artifact.workflow_run.id != null
        ? String(artifact.workflow_run.id)
        : null;
      return !normalizedCurrentRunId || artifactRunId !== normalizedCurrentRunId;
    })
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
}

function isTerminalRequestStatus(status) {
  return ['executed', 'partially_executed', 'failed', 'failed_after_approved_execution'].includes(String(status || ''));
}

async function downloadArtifactArchive({ artifact, token, fetchImpl = global.fetch }) {
  const response = await fetchImpl(artifact.archive_download_url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to download workflow artifact archive (${response.status}).`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function extractZipArchive(archivePath, outputDirectory) {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'powershell' : 'unzip';
  const args = isWindows
    ? ['-NoProfile', '-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${outputDirectory}' -Force`]
    : ['-o', archivePath, '-d', outputDirectory];
  const result = spawnSync(command, args, { stdio: 'pipe' });

  if (result.status !== 0) {
    throw new Error(`Failed to extract workflow artifact archive using ${command}.`);
  }
}

function findFirstJsonFile(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findFirstJsonFile(fullPath);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') {
      return fullPath;
    }
  }

  return null;
}

function readArtifactRequestStatus(filePath) {
  try {
    const artifact = readRestorableArtifact(filePath);
    return artifact.request.request_status || null;
  } catch {
    return null;
  }
}

function readRestorableArtifact(filePath) {
  const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new Error('Workflow artifact archive did not contain a valid audit artifact object.');
  }

  if (!artifact.request || typeof artifact.request !== 'object' || Array.isArray(artifact.request)) {
    throw new Error('Workflow artifact archive did not contain a valid audit artifact request payload.');
  }

  return artifact;
}

function serializeRestorableArtifact(artifact = {}) {
  return toAuditArtifactJson({
    request: artifact.request || {},
    validation: artifact.validation || {},
    assignment: artifact.assignment || {},
    approval: artifact.approval || {},
    reconciliationPlan: artifact.reconciliation || artifact.reconciliationPlan || artifact.reconciliation_plan || {},
    executionOutcome: artifact.execution || artifact.executionOutcome || artifact.execution_outcome || {},
    runContext: {
      run_id: artifact.metadata && artifact.metadata.run_id || null,
      run_attempt: artifact.metadata && artifact.metadata.run_attempt || null,
      operation: artifact.metadata && artifact.metadata.operation || null,
    },
  });
}

async function materializeArtifactArchive(options = {}) {
  const archiveBuffer = await (options.downloadArtifactArchive || downloadArtifactArchive)({
    artifact: options.artifact,
    token: options.token,
    fetchImpl: options.fetchImpl,
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-artifact-restore-'));
  const archivePath = path.join(tempDir, 'artifact.zip');
  const extractDir = path.join(tempDir, 'extracted');

  fs.mkdirSync(extractDir, { recursive: true });
  fs.writeFileSync(archivePath, archiveBuffer);
  (options.extractZipArchive || extractZipArchive)(archivePath, extractDir);

  const extractedArtifactPath = findFirstJsonFile(extractDir);
  if (!extractedArtifactPath) {
    throw new Error('Workflow artifact archive did not contain a JSON audit artifact.');
  }

  return extractedArtifactPath;
}

async function selectArtifactForRestore(options = {}) {
  const candidates = listCandidateArtifacts(options.artifacts || [], options.currentRunId);
  let fallbackSelection = null;

  for (const artifact of candidates) {
    const extractedArtifactPath = await materializeArtifactArchive({
      artifact,
      token: options.token,
      fetchImpl: options.fetchImpl,
      downloadArtifactArchive: options.downloadArtifactArchive,
      extractZipArchive: options.extractZipArchive,
    });
    const restoredArtifact = (() => {
      try {
        return readRestorableArtifact(extractedArtifactPath);
      } catch {
        return null;
      }
    })();

    if (!restoredArtifact) {
      continue;
    }

    const requestStatus = restoredArtifact.request.request_status || null;

    if (!fallbackSelection) {
      fallbackSelection = { artifact, extractedArtifactPath, requestStatus, restoredArtifact };
    }

    if (isTerminalRequestStatus(requestStatus)) {
      return { artifact, extractedArtifactPath, requestStatus, restoredArtifact };
    }
  }

  return fallbackSelection;
}

async function restoreRequestAuditArtifact(options = {}) {
  const env = options.env || process.env;
  const repository = options.repository || env.GITHUB_REPOSITORY || '';
  const issueNumber = options.issueNumber || env.ISSUE_NUMBER || '';
  const token = options.token || env.GITHUB_TOKEN || env.ISSUEOPS_GITHUB_TOKEN || '';
  const operation = options.operation || env.OPERATION || '';
  const artifactPath = path.resolve(
    options.artifactPath || env.AUDIT_ARTIFACT_PATH || path.join('artifacts', `add-team-members-validation-${issueNumber || 'manual'}.json`)
  );
  const currentRunId = options.currentRunId || env.GITHUB_RUN_ID || null;
  const fetchImpl = options.fetchImpl || global.fetch;
  const defaultArtifactName = operation === 'team_repo_access_removal'
    ? `remove-team-repo-access-validation-${issueNumber}`
    : `add-team-members-validation-${issueNumber}`;
  const artifactName = options.artifactName
    || env.ARTIFACT_NAME
    || (artifactPath ? path.basename(artifactPath, '.json') : defaultArtifactName);

  if (!repository || !issueNumber || !token) {
    writeGitHubOutput('audit-artifact-restored', 'false', env.GITHUB_OUTPUT);
    return { restored: false, artifactPath, reason: 'missing_context' };
  }

  const artifacts = await listArtifacts({ repository, artifactName, token, fetchImpl });
  const selection = await selectArtifactForRestore({
    artifacts,
    currentRunId,
    token,
    fetchImpl,
    downloadArtifactArchive: options.downloadArtifactArchive,
    extractZipArchive: options.extractZipArchive,
  });
  const artifact = selection && selection.artifact || null;

  if (!artifact) {
    writeGitHubOutput('audit-artifact-restored', 'false', env.GITHUB_OUTPUT);
    return { restored: false, artifactPath, reason: 'not_found' };
  }
  const extractedArtifactPath = selection.extractedArtifactPath;
  const restoredArtifact = selection.restoredArtifact || readRestorableArtifact(extractedArtifactPath);

  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, serializeRestorableArtifact(restoredArtifact), 'utf8');
  writeGitHubOutput('audit-artifact-restored', 'true', env.GITHUB_OUTPUT);

  return {
    restored: true,
    artifactId: artifact.id,
    artifactName: artifact.name,
    artifactPath,
  };
}

if (require.main === module) {
  restoreRequestAuditArtifact().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  buildArtifactsUrl,
  downloadArtifactArchive,
  extractZipArchive,
  findFirstJsonFile,
  isTerminalRequestStatus,
  listArtifacts,
  listCandidateArtifacts,
  pickLatestArtifact,
  readArtifactRequestStatus,
  readRestorableArtifact,
  serializeRestorableArtifact,
  restoreRequestAuditArtifact,
  selectArtifactForRestore,
};