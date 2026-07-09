'use strict';

const ALLOWED_RULESET_OPERATIONS = ['create', 'delete'];
const ALLOWED_RULESET_TARGETS = ['branch', 'tag'];
const ALLOWED_RULESET_ENFORCEMENTS = ['active', 'evaluate', 'disabled'];
const DEFAULT_REF_NAME_PATTERN = '~DEFAULT_BRANCH';

// Fields that only appear on a create request. Their presence in the raw parsed
// payload is how the create operation is distinguished from a delete, which
// carries only the repository and ruleset name.
const CREATE_ONLY_FIELDS = [
  ['target', 'parsed_target'],
  ['ref_name_pattern', 'parsed_ref_name_pattern'],
  ['enforcement', 'parsed_enforcement'],
  ['require_pull_request', 'parsed_require_pull_request'],
  ['block_force_pushes', 'parsed_block_force_pushes'],
  ['require_linear_history', 'parsed_require_linear_history'],
  ['restrict_deletions', 'parsed_restrict_deletions'],
];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLogin(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeBoolean(value, defaultValue) {
  if (value == null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function normalizeTenantName(value) {
  return normalizeText(value).replace(/\s+/g, ' ').toLowerCase();
}

function normalizeDropdownValue(value) {
  return normalizeText(value).replace(/^\[|\]$/g, '').trim().toLowerCase();
}

function normalizeRepositoryName(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 100);
}

function normalizeRulesetName(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function readField(source, keys) {
  for (const key of keys) {
    if (source && source[key] != null && source[key] !== '') {
      return source[key];
    }
  }

  return '';
}

function hasAnyField(source, fieldPairs) {
  for (const keys of fieldPairs) {
    if (readField(source, keys) !== '') {
      return true;
    }
  }
  return false;
}

function buildRequestId(repository, issueNumber, runId, runAttempt) {
  const issuePart = issueNumber != null ? String(issueNumber) : 'manual';
  const runPart = runId != null ? String(runId) : 'local';
  const attemptPart = runAttempt != null ? String(runAttempt) : '1';
  return `${repository || 'unknown-repo'}#${issuePart}/${runPart}.${attemptPart}`;
}

function parseRepositoryRulesetRequest(input = {}) {
  const parsed = input.parsedRequest || input.parsed_request || {};
  const issue = input.issue || {};
  const runContext = input.runContext || input.run_context || {};

  const explicitOperation = normalizeDropdownValue(input.rulesetOperation || input.ruleset_operation);
  const rulesetOperation = ALLOWED_RULESET_OPERATIONS.includes(explicitOperation)
    ? explicitOperation
    : hasAnyField(parsed, CREATE_ONLY_FIELDS)
      ? 'create'
      : 'delete';

  const repository = input.repository || runContext.repository || process.env.GITHUB_REPOSITORY || '';
  const issueNumber = input.issueNumber || issue.number || runContext.issue_number || process.env.ISSUE_NUMBER;
  const requesterLogin = normalizeLogin(input.requesterLogin || issue.user && issue.user.login || '');
  const organization = normalizeLogin(readField(parsed, ['organization', 'parsed_organization']) || input.organization);
  const tenantNameInput = normalizeText(
    readField(parsed, ['tenant_name', 'parsed_tenant_name', 'tenant_display_name']) || input.tenantName
  );
  const tenantNameNormalized = normalizeTenantName(tenantNameInput);
  const repositoryTargetInput = normalizeText(
    readField(parsed, ['repository', 'parsed_repository']) || input.repositoryTarget
  );
  const repositoryTargetNormalized = normalizeRepositoryName(repositoryTargetInput);
  const rulesetNameInput = normalizeRulesetName(
    readField(parsed, ['ruleset_name', 'parsed_ruleset_name']) || input.rulesetName
  );

  const targetInput = normalizeDropdownValue(
    readField(parsed, ['target', 'parsed_target']) || input.target
  );
  const rulesetTarget = rulesetOperation === 'create'
    ? (targetInput || 'branch')
    : '';
  const enforcementInput = normalizeDropdownValue(
    readField(parsed, ['enforcement', 'parsed_enforcement']) || input.enforcement
  );
  const enforcement = rulesetOperation === 'create'
    ? (enforcementInput || 'active')
    : '';
  const refNamePatternInput = normalizeText(
    readField(parsed, ['ref_name_pattern', 'parsed_ref_name_pattern']) || input.refNamePattern
  );
  const refNamePattern = rulesetOperation === 'create'
    ? (refNamePatternInput || DEFAULT_REF_NAME_PATTERN)
    : '';

  const requirePullRequest = rulesetOperation === 'create'
    ? normalizeBoolean(readField(parsed, ['require_pull_request', 'parsed_require_pull_request']) || input.requirePullRequest, false)
    : false;
  const blockForcePushes = rulesetOperation === 'create'
    ? normalizeBoolean(readField(parsed, ['block_force_pushes', 'parsed_block_force_pushes']) || input.blockForcePushes, false)
    : false;
  const requireLinearHistory = rulesetOperation === 'create'
    ? normalizeBoolean(readField(parsed, ['require_linear_history', 'parsed_require_linear_history']) || input.requireLinearHistory, false)
    : false;
  const restrictDeletions = rulesetOperation === 'create'
    ? normalizeBoolean(readField(parsed, ['restrict_deletions', 'parsed_restrict_deletions']) || input.restrictDeletions, false)
    : false;

  const designatedApproverLogin = normalizeLogin(
    readField(parsed, ['designated_approver', 'parsed_designated_approver']) || input.designatedApprover
  );
  const dryRun = normalizeBoolean(
    readField(parsed, ['dry_run', 'parsed_dry_run']) || input.dry_run,
    true
  );
  const justification = normalizeText(
    readField(parsed, ['justification', 'parsed_justification', 'business_justification']) || input.justification
  );
  const submittedAt = input.submittedAt || new Date().toISOString();
  const requestId = buildRequestId(
    repository,
    issueNumber,
    runContext.run_id || process.env.GITHUB_RUN_ID,
    runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT
  );

  return {
    request_id: requestId,
    issue_number: issueNumber == null ? null : Number(issueNumber),
    repository,
    requester_login: requesterLogin,
    organization,
    tenant_name_input: tenantNameInput,
    tenant_name_normalized: tenantNameNormalized,
    ruleset_operation: rulesetOperation,
    repository_target_input: repositoryTargetInput,
    repository_target_normalized: repositoryTargetNormalized,
    ruleset_name_input: rulesetNameInput,
    ruleset_name_normalized: rulesetNameInput,
    ruleset_target: rulesetTarget,
    ref_name_pattern: refNamePattern,
    enforcement,
    require_pull_request: requirePullRequest,
    block_force_pushes: blockForcePushes,
    require_linear_history: requireLinearHistory,
    restrict_deletions: restrictDeletions,
    designated_approver_login: designatedApproverLogin,
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: 'manual',
    request_status: 'submitted',
  };
}

function buildRepositoryRulesetPayload(request = {}) {
  const rules = [];

  if (request.require_pull_request) {
    rules.push({
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    });
  }

  if (request.block_force_pushes) {
    rules.push({ type: 'non_fast_forward' });
  }

  if (request.require_linear_history) {
    rules.push({ type: 'required_linear_history' });
  }

  if (request.restrict_deletions) {
    rules.push({ type: 'deletion' });
  }

  return {
    name: request.ruleset_name_input || request.ruleset_name_normalized || '',
    target: request.ruleset_target || 'branch',
    enforcement: request.enforcement || 'active',
    conditions: {
      ref_name: {
        include: [request.ref_name_pattern || DEFAULT_REF_NAME_PATTERN],
        exclude: [],
      },
    },
    rules,
  };
}

module.exports = {
  ALLOWED_RULESET_OPERATIONS,
  ALLOWED_RULESET_TARGETS,
  ALLOWED_RULESET_ENFORCEMENTS,
  DEFAULT_REF_NAME_PATTERN,
  buildRepositoryRulesetPayload,
  normalizeRepositoryName,
  normalizeRulesetName,
  parseRepositoryRulesetRequest,
};
