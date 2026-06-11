'use strict';

const fs = require('fs');
const path = require('path');

const { parseCostCenterRequest } = require('../workflow-support/parse-cost-center-request');
const { validateCostCenterRequest } = require('../workflow-support/validate-cost-center-request');
const { reconcileCostCenterChanges } = require('../workflow-support/reconcile-cost-center-changes');
const { createGitHubCostCenterApi } = require('../workflow-support/github-cost-center-api');
const { loadWorkflowToken } = require('../workflow-support/load-workflow-token');
const { executeWithBoundedRetry } = require('../workflow-support/handle-rate-limit');
const { buildCostCenterArtifact, toCostCenterArtifactJson } = require('../workflow-support/build-cost-center-artifact');
const { emitCostCenterSummary } = require('./emit-cost-center-summary');

function writeGitHubOutput(key, value, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) {
    return;
  }
  fs.appendFileSync(outputPath, `${key}=${value}\n`, 'utf8');
}

function readParsedRequestFromEnv(env = process.env) {
  return {
    enterprise: env.PARSED_ENTERPRISE || '',
    designated_approver: env.PARSED_DESIGNATED_APPROVER || '',
    dry_run: env.PARSED_DRY_RUN || 'true',
    justification: env.PARSED_JUSTIFICATION || '',
    cost_centers: env.PARSED_COST_CENTERS || '',
  };
}

async function runCostCenterValidation(options = {}) {
  const env = options.env || process.env;
  const shouldSetExitCode = options.setProcessExitCode !== false && env === process.env;
  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join('artifacts', `manage-cost-centers-validation-${env.ISSUE_NUMBER || 'manual'}.json`)
  );

  const request = parseCostCenterRequest({
    parsedRequest: readParsedRequestFromEnv(env),
    issue: { number: env.ISSUE_NUMBER, user: { login: env.REQUESTER_LOGIN || '' } },
    repository: env.GITHUB_REPOSITORY || '',
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
      issue_number: env.ISSUE_NUMBER,
    },
  });

  const tokenInfo = loadWorkflowToken({ env, required: false });
  let validationOptions = {};
  if (tokenInfo.token) {
    const api = options.costCenterApi || createGitHubCostCenterApi({ token: tokenInfo.token });
    validationOptions = {
      listCostCenters: ({ enterprise, state }) =>
        executeWithBoundedRetry(() => api.listCostCenters({ enterprise, state }), { maxRetries: options.maxRetries || 2, sleep: options.sleep })
          .then((result) => {
            if (!result.ok) {
              throw result.error || new Error('Failed to list cost centers');
            }
            return result.value;
          }),
      getCostCenter: ({ enterprise, costCenterId }) =>
        executeWithBoundedRetry(() => api.getCostCenter({ enterprise, costCenterId }), { maxRetries: options.maxRetries || 2, sleep: options.sleep })
          .then((result) => {
            if (!result.ok) {
              throw result.error || new Error('Failed to load cost center');
            }
            return result.value;
          }),
    };
  } else if (options.costCenterApi) {
    const api = options.costCenterApi;
    validationOptions = {
      listCostCenters: (args) => api.listCostCenters(args),
      getCostCenter: (args) => api.getCostCenter(args),
    };
  }

  let validation;
  try {
    validation = await validateCostCenterRequest(request, validationOptions);
  } catch (error) {
    validation = {
      is_valid: false,
      request_status: 'validation_failed',
      errors: [`Validation could not complete: ${error.message}`],
      warnings: [],
      live_access: false,
      requested_changes: request.requested_changes || [],
      counts: { create: 0, rename: 0, delete: 0, noop: 0, rejected: 0 },
      request: { ...request, request_status: 'validation_failed' },
    };
  }

  const reconciliation = reconcileCostCenterChanges({
    requested_changes: validation.requested_changes,
    dry_run: request.dry_run,
  });

  const artifact = buildCostCenterArtifact({
    request: validation.request || request,
    validation,
    reconciliation,
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
      artifact_name: path.basename(artifactPath),
      artifact_retention_days: env.AUDIT_ARTIFACT_RETENTION_DAYS || '',
    },
  });

  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, toCostCenterArtifactJson({
    request: validation.request || request,
    validation,
    reconciliation,
    runContext: artifact.metadata,
  }), 'utf8');

  emitCostCenterSummary(artifact, { summaryPath: env.GITHUB_STEP_SUMMARY });
  writeGitHubOutput('validation-status', validation.request_status, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-name', path.basename(artifactPath), env.GITHUB_OUTPUT);

  if (!validation.is_valid && shouldSetExitCode) {
    process.exitCode = 1;
  }

  return { validation, reconciliation, artifact, artifactPath };
}

if (require.main === module) {
  runCostCenterValidation().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  readParsedRequestFromEnv,
  runCostCenterValidation,
};
