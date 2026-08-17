'use strict';

const fs = require('fs');
const path = require('path');

const { parseCostCenterRequest } = require('../workflow-support/parse-manage-cost-centers-request');
const { validateCostCenterRequest } = require('../workflow-support/validate-manage-cost-centers-request');
const { reconcileCostCenterChanges } = require('../workflow-support/reconcile-manage-cost-centers-changes');
const { createGitHubCostCenterApi } = require('../workflow-support/github-cost-center-billing-api');
const { createGitHubTeamApi } = require('../workflow-support/github-team-api');
const { resolveCsvAttachmentComment } = require('../workflow-support/resolve-csv-attachment-comment');
const { downloadCsvAttachment } = require('../workflow-support/download-csv-attachment');
const { loadWorkflowToken } = require('../workflow-support/load-workflow-token');
const { executeWithBoundedRetry } = require('../workflow-support/handle-rate-limit');
const { buildCostCenterArtifact, toCostCenterArtifactJson } = require('../workflow-support/build-manage-cost-centers-artifact');
const { emitCostCenterSummary } = require('./emit-manage-cost-centers-summary');

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

  const parsedEnv = readParsedRequestFromEnv(env);
  let request = parseCostCenterRequest({
    parsedRequest: parsedEnv,
    issue: { number: env.ISSUE_NUMBER, user: { login: env.REQUESTER_LOGIN || '' } },
    repository: env.GITHUB_REPOSITORY || '',
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
      issue_number: env.ISSUE_NUMBER,
    },
  });

  const tokenInfo = loadWorkflowToken({ env, required: false });

  // When the inline spreadsheet field is left blank (shadow text only), fall back to
  // a CSV file attached by the issue author in a comment, the same intake mode the
  // team operations use.
  let attachmentProvenance = null;
  let waitingForAttachment = false;
  let attachmentRejection = null;
  if (request.csv_schema_status === 'empty') {
    if (request.issue_number != null && tokenInfo.token) {
      const commentsApi = options.commentsApi || createGitHubTeamApi({ token: tokenInfo.token });
      let comments = [];
      try {
        comments = await commentsApi.listIssueComments({
          repository: request.repository,
          issueNumber: request.issue_number,
        });
      } catch (error) {
        comments = [];
      }
      const resolution = resolveCsvAttachmentComment({
        issueComments: comments,
        requesterLogin: request.requester_login,
      });
      if (resolution.resolution_status === 'attachment_candidate_selected') {
        const candidate = resolution.candidate;
        try {
          const download = options.downloadAttachment
            ? await options.downloadAttachment({ attachmentUrl: candidate.attachment_url, token: tokenInfo.token })
            : await downloadCsvAttachment({ attachmentUrl: candidate.attachment_url, token: tokenInfo.token, fetchImpl: options.fetchImpl, sleep: options.sleep });
          request = parseCostCenterRequest({
            parsedRequest: { ...parsedEnv, cost_centers: download.text },
            issue: { number: env.ISSUE_NUMBER, user: { login: env.REQUESTER_LOGIN || '' } },
            repository: env.GITHUB_REPOSITORY || '',
            runContext: { run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT, issue_number: env.ISSUE_NUMBER },
          });
          request.intake_mode = 'csv_attachment';
          attachmentProvenance = {
            comment_id: candidate.comment_id,
            attachment_url: candidate.attachment_url,
            filename: candidate.filename,
            byte_size: download.byte_size,
          };
        } catch (error) {
          waitingForAttachment = true;
          attachmentRejection = { reason: 'download_failed', detail: error.message };
        }
      } else if (resolution.resolution_status === 'attachment_rejected') {
        waitingForAttachment = true;
        attachmentRejection = {
          reason: (resolution.candidate && resolution.candidate.rejection_reason) || 'attachment_rejected',
          detail: 'The attached file was not accepted (must be a single .csv file uploaded by the issue author).',
        };
      } else {
        waitingForAttachment = true; // waiting_for_attachment
      }
    } else {
      waitingForAttachment = true;
    }
  }
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
  if (waitingForAttachment) {
    const note = attachmentRejection
      ? `Attached file was not accepted (${attachmentRejection.reason}). Attach a single .csv file in a new comment, as the issue author.`
      : 'No spreadsheet was provided inline. Attach a .csv file in a comment on this issue (as the issue author) and the plan will be generated.';
    request.intake_mode = 'csv_attachment';
    request.request_status = 'waiting_for_attachment';
    validation = {
      is_valid: false,
      request_status: 'waiting_for_attachment',
      errors: [],
      warnings: [note],
      live_access: null,
      requested_changes: [],
      counts: { create: 0, rename: 0, delete: 0, noop: 0, rejected: 0 },
      request: { ...request, request_status: 'waiting_for_attachment' },
    };
  } else {
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
    if (attachmentProvenance) {
      validation.request = { ...(validation.request || request), intake_mode: 'csv_attachment', attachment_provenance: attachmentProvenance };
      validation.warnings = [...(validation.warnings || []), `Spreadsheet read from attached file ${attachmentProvenance.filename || 'comment.csv'} (${attachmentProvenance.byte_size} bytes).`];
    }
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
