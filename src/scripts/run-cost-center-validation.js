'use strict';

const fs = require('fs');
const path = require('path');

const { buildCostCenterArtifact, toCostCenterArtifactJson } = require('../workflow-support/cost-center-artifact');
const { createGitHubCostCenterApi } = require('../workflow-support/github-cost-center-api');
const { formatCostCenterSummary } = require('../workflow-support/format-cost-center-summary');
const { loadWorkflowToken } = require('../workflow-support/load-workflow-token');
const { parseCostCenterRequest } = require('../workflow-support/parse-cost-center-request');
const { reconcileCostCenter } = require('../workflow-support/reconcile-cost-center');
const {
  downloadCostCenterCsvAttachment,
  findLatestCsvAttachmentInComments,
  resolveCostCenterCsvAttachment,
} = require('../workflow-support/resolve-cost-center-csv-attachment');
const { validateCostCenterRequest } = require('../workflow-support/validate-cost-center-request');

function parseParsedRequestJson(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function readParsedRequestFromEnv(env = process.env) {
  const parsedRequestJson = parseParsedRequestJson(env.PARSED_REQUEST_JSON);
  if (parsedRequestJson) {
    return parsedRequestJson;
  }

  return {
    enterprise: env.PARSED_ENTERPRISE || '',
    intended_approver: env.PARSED_INTENDED_APPROVER || '',
    assignments_csv: env.PARSED_ASSIGNMENTS_CSV || '',
    business_justification: env.PARSED_BUSINESS_JUSTIFICATION || '',
    dry_run: env.PARSED_DRY_RUN || 'true',
  };
}

function writeGitHubOutput(key, value, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) {
    return;
  }

  fs.appendFileSync(outputPath, `${key}=${value}\n`, 'utf8');
}

function writeStepSummary(summary, summaryPath = process.env.GITHUB_STEP_SUMMARY) {
  if (summaryPath) {
    fs.writeFileSync(summaryPath, `${summary}\n`, 'utf8');
  }
}

async function resolveCommentsAttachment(options, env, tokenInfo, costCenterApi) {
  if (!tokenInfo.token || !costCenterApi || typeof costCenterApi.listIssueComments !== 'function') {
    return null;
  }

  const repository = env.GITHUB_REPOSITORY || '';
  const issueNumber = env.ISSUE_NUMBER;
  if (!repository || issueNumber == null || issueNumber === '') {
    return null;
  }

  let comments;
  try {
    comments = await costCenterApi.listIssueComments({ repository, issueNumber });
  } catch {
    return null;
  }

  return findLatestCsvAttachmentInComments(comments || []);
}

async function resolveAttachmentCsv(options, env, tokenInfo, costCenterApi) {
  let attachment = resolveCostCenterCsvAttachment({
    commentBody: env.COMMENT_BODY || '',
    issueBody: env.ISSUE_BODY || '',
  });

  if (!attachment) {
    attachment = await resolveCommentsAttachment(options, env, tokenInfo, costCenterApi);
  }

  if (!attachment) {
    return { text: null, warning: null, attachment: null };
  }

  try {
    const downloaded = await downloadCostCenterCsvAttachment({
      attachmentUrl: attachment.attachment_url,
      token: tokenInfo.token,
      downloadImpl: options.downloadCsvAttachment,
      fetchImpl: options.fetchImpl,
      maxBytes: options.maxAttachmentBytes,
      maxRetries: options.maxRetries,
      sleep: options.sleep,
    });

    const text = downloaded && typeof downloaded.text === 'string' ? downloaded.text : null;
    return { text, warning: null, attachment };
  } catch (error) {
    return {
      text: null,
      warning: `The attached file ${attachment.filename || attachment.attachment_url} could not be downloaded (${error.message}).`,
      attachment,
    };
  }
}

async function runCostCenterValidation(options = {}) {
  const env = options.env || process.env;
  const parsedRequest = readParsedRequestFromEnv(env);
  const tokenInfo = loadWorkflowToken({ env, required: false });

  const api = tokenInfo.token
    ? (options.api || createGitHubCostCenterApi({ token: tokenInfo.token }))
    : (options.api || null);

  const attachmentResult = await resolveAttachmentCsv(options, env, tokenInfo, api);
  const effectiveParsedRequest = attachmentResult.text != null
    ? { ...parsedRequest, assignments_csv: attachmentResult.text }
    : parsedRequest;

  const request = parseCostCenterRequest({
    parsedRequest: effectiveParsedRequest,
    issue: {
      number: env.ISSUE_NUMBER,
      user: { login: env.REQUESTER_LOGIN || '' },
    },
    repository: env.GITHUB_REPOSITORY || '',
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
      issue_number: env.ISSUE_NUMBER,
    },
  });

  if (!request.intake_mode && !attachmentResult.warning) {
    return {
      request,
      validation: null,
      reconciliationPlan: null,
      artifactPath: null,
      summary: null,
      applicable: false,
    };
  }

  const hooks = {};
  if (api && typeof api.listCostCenters === 'function') {
    hooks.listCostCenters = ({ enterprise }) => api.listCostCenters({ enterprise });
  }

  const validation = await validateCostCenterRequest(request, hooks);

  if (attachmentResult.warning) {
    validation.warnings = [attachmentResult.warning, ...(validation.warnings || [])];
  }

  const reconciliationPlan = reconcileCostCenter({
    request: validation.request,
    validatedAssignments: validation.requested_assignments,
    currentCostCenters: validation.existing_cost_centers,
    enterprise_exists: validation.enterprise_visible !== false,
    live_state_verified: validation.live_state_verified,
    dry_run: validation.request.dry_run,
  });

  const summaryInput = {
    request: validation.request,
    validation,
    approval: {
      approval_status: validation.is_valid ? 'pending' : 'not_requested',
    },
    reconciliationPlan,
    executionOutcome: {},
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
    },
  };
  const summary = formatCostCenterSummary(buildCostCenterArtifact(summaryInput));

  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join('artifacts', `cost-center-reallocation-validation-${env.ISSUE_NUMBER || 'manual'}.json`)
  );
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(
    artifactPath,
    toCostCenterArtifactJson({ ...summaryInput, audit_summary_markdown: summary }),
    'utf8'
  );

  writeStepSummary(summary, env.GITHUB_STEP_SUMMARY);
  writeGitHubOutput('validation-status', validation.request_status, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);

  return { request, validation, reconciliationPlan, artifactPath, summary, applicable: true };
}

if (require.main === module) {
  runCostCenterValidation().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  parseParsedRequestJson,
  readParsedRequestFromEnv,
  runCostCenterValidation,
};
