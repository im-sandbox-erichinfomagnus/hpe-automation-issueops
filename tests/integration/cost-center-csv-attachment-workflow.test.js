'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runCostCenterValidation } = require('../../src/scripts/run-cost-center-validation');

const SAMPLE_CSV = [
  'cost_center,login,action',
  'Platform Engineering,octocat,add',
  'Platform Engineering,hubot,remove',
  'AI Enablement,hubot,add',
].join('\n');

function tempArtifactPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-cost-center-attach-'));
  return path.join(dir, 'artifact.json');
}

function buildEnv(overrides = {}) {
  return {
    ISSUE_NUMBER: '10',
    REQUESTER_LOGIN: 'requester',
    GITHUB_REPOSITORY: 'im-sandbox-erichinfomagnus/cost-center-demo',
    ...overrides,
  };
}

function parsedRequest(overrides = {}) {
  return JSON.stringify({
    enterprise: 'octo-ent',
    intended_approver: 'approver1',
    assignments_csv: SAMPLE_CSV,
    business_justification: 'Reallocating Copilot seats after the Q2 reorg.',
    dry_run: 'true',
    ...overrides,
  });
}

const throwingCostCenterApi = {
  async listCostCenters() {
    throw Object.assign(new Error('Not Found'), { status: 404 });
  },
};

test('an attached CSV routes through the existing parser to the same plan as the typed path', async () => {
  const attachmentUrl = 'https://github.com/user-attachments/files/777/cost-centers.csv';
  const downloads = [];

  const env = buildEnv({
    GITHUB_TOKEN: 'ghs_repo_token',
    PARSED_REQUEST_JSON: parsedRequest({ assignments_csv: '' }),
    COMMENT_BODY: `Assignments attached.\n[cost-centers.csv](${attachmentUrl})`,
    AUDIT_ARTIFACT_PATH: tempArtifactPath(),
  });

  const attachmentRun = await runCostCenterValidation({
    env,
    api: throwingCostCenterApi,
    setProcessExitCode: false,
    downloadCsvAttachment: async (options) => {
      downloads.push(options);
      return { text: SAMPLE_CSV };
    },
  });

  const typedEnv = buildEnv({
    GITHUB_TOKEN: 'ghs_repo_token',
    PARSED_REQUEST_JSON: parsedRequest(),
    AUDIT_ARTIFACT_PATH: tempArtifactPath(),
  });
  const typedRun = await runCostCenterValidation({
    env: typedEnv,
    api: throwingCostCenterApi,
    setProcessExitCode: false,
  });

  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].attachmentUrl, attachmentUrl);
  assert.equal(downloads[0].token, 'ghs_repo_token');

  assert.equal(attachmentRun.validation.is_valid, true);
  assert.deepEqual(
    attachmentRun.validation.requested_assignments,
    typedRun.validation.requested_assignments
  );
  assert.deepEqual(
    attachmentRun.reconciliationPlan.cost_centers_to_create.sort(),
    typedRun.reconciliationPlan.cost_centers_to_create.sort()
  );
  assert.equal(attachmentRun.reconciliationPlan.assignments_to_add.length, 2);
  assert.equal(attachmentRun.reconciliationPlan.assignments_to_remove.length, 1);
});

test('an attached CSV takes precedence over the typed textarea', async () => {
  const attachmentUrl = 'https://github.com/user-attachments/files/888/override.csv';
  const attachedCsv = ['cost_center,login,action', 'AI Enablement,monalisa,add'].join('\n');

  const env = buildEnv({
    GITHUB_TOKEN: 'ghs_repo_token',
    PARSED_REQUEST_JSON: parsedRequest(),
    COMMENT_BODY: `[override.csv](${attachmentUrl})`,
    AUDIT_ARTIFACT_PATH: tempArtifactPath(),
  });

  const run = await runCostCenterValidation({
    env,
    api: throwingCostCenterApi,
    setProcessExitCode: false,
    downloadCsvAttachment: async () => ({ text: attachedCsv }),
  });

  assert.equal(run.validation.requested_assignments.length, 1);
  assert.deepEqual(
    run.validation.requested_assignments.map((entry) => entry.login),
    ['monalisa']
  );
});

test('falls back to the typed textarea when no attachment is present', async () => {
  let downloadCalled = false;

  const env = buildEnv({
    GITHUB_TOKEN: 'ghs_repo_token',
    PARSED_REQUEST_JSON: parsedRequest(),
    COMMENT_BODY: 'No file here, see the form.',
    AUDIT_ARTIFACT_PATH: tempArtifactPath(),
  });

  const run = await runCostCenterValidation({
    env,
    api: throwingCostCenterApi,
    setProcessExitCode: false,
    downloadCsvAttachment: async () => {
      downloadCalled = true;
      return { text: '' };
    },
  });

  assert.equal(downloadCalled, false);
  assert.equal(run.validation.is_valid, true);
  assert.equal(run.validation.requested_assignments.length, 3);
});

test('a failed attachment download falls back to the typed CSV and warns instead of crashing', async () => {
  const attachmentUrl = 'https://github.com/user-attachments/files/999/blocked.csv';

  const env = buildEnv({
    GITHUB_TOKEN: 'ghs_repo_token',
    PARSED_REQUEST_JSON: parsedRequest(),
    COMMENT_BODY: `[blocked.csv](${attachmentUrl})`,
    AUDIT_ARTIFACT_PATH: tempArtifactPath(),
  });

  const run = await runCostCenterValidation({
    env,
    api: throwingCostCenterApi,
    setProcessExitCode: false,
    downloadCsvAttachment: async () => {
      throw Object.assign(new Error('Failed to download CSV attachment.'), { status: 404 });
    },
  });

  assert.equal(run.validation.is_valid, true);
  assert.equal(run.validation.requested_assignments.length, 3);
  assert.ok(run.validation.warnings.some((warning) => warning.includes('could not be downloaded')));
});

test('opening the issue with no .csv anywhere is not applicable and writes no validation_failed artifact', async () => {
  const artifactPath = tempArtifactPath();
  let downloadCalled = false;

  const env = buildEnv({
    GITHUB_TOKEN: 'ghs_repo_token',
    PARSED_REQUEST_JSON: parsedRequest({ assignments_csv: '' }),
    ISSUE_BODY: '### Enterprise slug\n\nocto-ent\n\nNo file attached yet.',
    COMMENT_BODY: '',
    AUDIT_ARTIFACT_PATH: artifactPath,
  });

  const run = await runCostCenterValidation({
    env,
    api: {
      async listIssueComments() {
        return [];
      },
      async listCostCenters() {
        throw Object.assign(new Error('Not Found'), { status: 404 });
      },
    },
    setProcessExitCode: false,
    downloadCsvAttachment: async () => {
      downloadCalled = true;
      return { text: '' };
    },
  });

  assert.equal(downloadCalled, false);
  assert.equal(run.applicable, false);
  assert.equal(run.validation, null);
  assert.equal(fs.existsSync(artifactPath), false);
});

test('an attached CSV in a comment produces the correct plan', async () => {
  const attachmentUrl = 'https://github.com/user-attachments/files/321/plan.csv';
  const env = buildEnv({
    GITHUB_TOKEN: 'ghs_repo_token',
    PARSED_REQUEST_JSON: parsedRequest({ assignments_csv: '' }),
    COMMENT_BODY: `Plan attached.\n[plan.csv](${attachmentUrl})`,
    AUDIT_ARTIFACT_PATH: tempArtifactPath(),
  });

  const run = await runCostCenterValidation({
    env,
    api: throwingCostCenterApi,
    setProcessExitCode: false,
    downloadCsvAttachment: async () => ({ text: SAMPLE_CSV }),
  });

  assert.equal(run.validation.is_valid, true);
  assert.deepEqual(run.reconciliationPlan.cost_centers_to_create.sort(), ['AI Enablement', 'Platform Engineering']);
  assert.equal(run.reconciliationPlan.assignments_to_add.length, 2);
  assert.equal(run.reconciliationPlan.assignments_to_remove.length, 1);
});

test('a failed attachment download with no typed CSV fails validation gracefully', async () => {
  const attachmentUrl = 'https://github.com/user-attachments/files/1000/blocked.csv';

  const env = buildEnv({
    GITHUB_TOKEN: 'ghs_repo_token',
    PARSED_REQUEST_JSON: parsedRequest({ assignments_csv: '' }),
    COMMENT_BODY: `[blocked.csv](${attachmentUrl})`,
    AUDIT_ARTIFACT_PATH: tempArtifactPath(),
  });

  const run = await runCostCenterValidation({
    env,
    api: throwingCostCenterApi,
    setProcessExitCode: false,
    downloadCsvAttachment: async () => {
      throw Object.assign(new Error('Failed to download CSV attachment.'), { status: 404 });
    },
  });

  assert.equal(run.validation.is_valid, false);
  assert.equal(run.validation.request_status, 'validation_failed');
  assert.ok(run.validation.warnings.some((warning) => warning.includes('could not be downloaded')));
});
