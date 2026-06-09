'use strict';

const fs = require('fs');
const path = require('path');

const { buildExecutionOutcome } = require('../workflow-support/build-execution-outcome');
const { buildAuditArtifact, toAuditArtifactJson } = require('../workflow-support/build-audit-artifact');
const { createGitHubTeamApi } = require('../workflow-support/github-team-api');
const { createGitHubTeamRepoApi } = require('../workflow-support/github-team-repo-api');
const { loadWorkflowToken } = require('../workflow-support/load-workflow-token');
const { parseTeamCreationRequest } = require('../workflow-support/parse-team-creation-request');
const { parseTenantRepoRequest } = require('../workflow-support/parse-tenant-repo-request');
const { parseTenantCreationRequest } = require('../workflow-support/parse-tenant-creation-request');
const { parseTeamHierarchyRequest } = require('../workflow-support/parse-team-hierarchy-request');
const { parseTeamMembershipRequest } = require('../workflow-support/parse-team-membership-request');
const { parseTeamRepoAccessRequest } = require('../workflow-support/parse-team-repo-access-request');
const { parseTeamRepoAccessRemovalRequest } = require('../workflow-support/parse-team-repo-access-removal-request');
const { reconcileTeamCreation } = require('../workflow-support/reconcile-team-creation');
const { reconcileTenantRepoCreation } = require('../workflow-support/reconcile-tenant-repo-creation');
const { reconcileTenantCreation } = require('../workflow-support/reconcile-tenant-creation');
const { reconcileTeamHierarchy } = require('../workflow-support/reconcile-team-hierarchy');
const { reconcileTeamRepoAccess } = require('../workflow-support/reconcile-team-repo-access');
const { reconcileTeamRepoAccessRemoval } = require('../workflow-support/reconcile-team-repo-access-removal');
const { validateTenantCreationRequest } = require('../workflow-support/validate-tenant-creation-request');
const { validateTenantRepoRequest } = require('../workflow-support/validate-tenant-repo-request');
const { validateTeamCreationRequest } = require('../workflow-support/validate-team-creation-request');
const { validateTeamHierarchyRequest } = require('../workflow-support/validate-team-hierarchy-request');
const { validateTeamMembershipRequest } = require('../workflow-support/validate-team-membership-request');
const { validateTeamRepoAccessRequest } = require('../workflow-support/validate-team-repo-access-request');
const { validateTeamRepoAccessRemovalRequest } = require('../workflow-support/validate-team-repo-access-removal-request');
const { emitAuditSummary } = require('./emit-audit-summary');
const { createGitHubTeamApi: createMembershipGitHubApi } = require('../workflow-support/github-team-api');
const { executeWithBoundedRetry } = require('../workflow-support/handle-rate-limit');
const { resolveTeamHierarchyAttachmentMaxBytes } = require('../actions/team-hierarchy-policy');
const { resolveTeamRepoAccessAttachmentMaxBytes } = require('../actions/team-repo-access-policy');

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

function parseJsonFromEnv(rawValue) {
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
    organization: env.PARSED_ORGANIZATION || '',
    team: env.PARSED_TEAM || '',
    parsed_tenant_name: env.PARSED_TENANT_NAME || '',
    repository_name: env.PARSED_REPOSITORY_NAME || '',
    parsed_repository_name: env.PARSED_REPOSITORY_NAME || '',
    tenant_name: env.PARSED_TENANT_NAME || '',
    tenant_display_name: env.PARSED_TENANT_NAME || '',
    tenant_type: env.PARSED_TENANT_TYPE || '',
    parsed_tenant_type: env.PARSED_TENANT_TYPE || '',
    target_team: env.PARSED_TARGET_TEAM || '',
    parent_team: env.PARSED_PARENT_TEAM || '',
    designated_hierarchy_approver: env.PARSED_DESIGNATED_HIERARCHY_APPROVER || '',
    designated_approver: env.PARSED_DESIGNATED_APPROVER || '',
    primary_contact: env.PARSED_PRIMARY_CONTACT || '',
    parsed_primary_contact: env.PARSED_PRIMARY_CONTACT || '',
    secondary_contact: env.PARSED_SECONDARY_CONTACT || '',
    parsed_secondary_contact: env.PARSED_SECONDARY_CONTACT || '',
    cmdb_id: env.PARSED_CMDB_ID || '',
    parsed_cmdb_id: env.PARSED_CMDB_ID || '',
    cost_center: env.PARSED_COST_CENTER || '',
    parsed_cost_center: env.PARSED_COST_CENTER || '',
    business_unit: env.PARSED_BUSINESS_UNIT || '',
    parsed_business_unit: env.PARSED_BUSINESS_UNIT || '',
    environment: env.PARSED_ENVIRONMENT || '',
    parsed_environment: env.PARSED_ENVIRONMENT || '',
    governance_code_scanning_enabled: env.PARSED_GOVERNANCE_CODE_SCANNING_ENABLED || '',
    parsed_governance_code_scanning_enabled: env.PARSED_GOVERNANCE_CODE_SCANNING_ENABLED || '',
    governance_secret_scanning_enabled: env.PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED || '',
    parsed_governance_secret_scanning_enabled: env.PARSED_GOVERNANCE_SECRET_SCANNING_ENABLED || '',
    governance_dependabot_enabled: env.PARSED_GOVERNANCE_DEPENDABOT_ENABLED || '',
    parsed_governance_dependabot_enabled: env.PARSED_GOVERNANCE_DEPENDABOT_ENABLED || '',
    requested_repositories: env.PARSED_REQUESTED_REPOSITORIES || '',
    bulk_csv_requested_repositories: env.PARSED_BULK_CSV_REQUESTED_REPOSITORIES || '',
    permission_level: env.PARSED_PERMISSION_LEVEL || '',
    repository_visibility: env.PARSED_REPOSITORY_VISIBILITY || '',
    parsed_repository_visibility: env.PARSED_REPOSITORY_VISIBILITY || '',
    requested_child_teams: env.PARSED_REQUESTED_CHILD_TEAMS || '',
    bulk_csv_requested_child_teams: env.PARSED_BULK_CSV_REQUESTED_CHILD_TEAMS || '',
    intended_owner: env.PARSED_INTENDED_OWNER || '',
    requested_team_names: env.PARSED_REQUESTED_TEAM_NAMES || '',
    bulk_csv_requested_team_names: env.PARSED_BULK_CSV_REQUESTED_TEAM_NAMES || '',
    team_slug: env.PARSED_TEAM_SLUG || '',
    requested_people: env.PARSED_REQUESTED_PEOPLE || '',
    intake_mode: env.PARSED_INTAKE_MODE || '',
    bulk_csv_requested_people: env.PARSED_BULK_CSV_REQUESTED_PEOPLE || '',
    business_justification: env.PARSED_BUSINESS_JUSTIFICATION || '',
    justification: env.PARSED_JUSTIFICATION || env.PARSED_BUSINESS_JUSTIFICATION || '',
    dry_run: env.PARSED_DRY_RUN || 'true',
  };
}

function isTeamRepoAccessParsedRequest(parsedRequest = {}) {
  const hasGrantSpecificSignals = Boolean(
    parsedRequest.target_team ||
    parsedRequest.parsed_target_team ||
    parsedRequest.bulk_csv_requested_repositories ||
    parsedRequest.parsed_bulk_csv_requested_repositories ||
    parsedRequest.permission_level ||
    parsedRequest.parsed_permission_level
  );

  const hasTenantSignals = Boolean(
    parsedRequest.tenant_name ||
    parsedRequest.parsed_tenant_name ||
    parsedRequest.tenant_display_name ||
    parsedRequest.repository_name ||
    parsedRequest.parsed_repository_name
  );

  return hasGrantSpecificSignals && !hasTenantSignals;
}

function isTeamRepoAccessRemovalParsedRequest(parsedRequest = {}) {
  const hasRemovalSignals = Boolean(
    parsedRequest.team ||
    parsedRequest.parsed_team ||
    parsedRequest.requested_repositories ||
    parsedRequest.parsed_requested_repositories ||
    parsedRequest.designated_approver ||
    parsedRequest.parsed_designated_approver
  );

  const hasAccessGrantSignals = Boolean(
    parsedRequest.permission_level ||
    parsedRequest.parsed_permission_level ||
    parsedRequest.target_team ||
    parsedRequest.parsed_target_team
  );

  const hasOtherOperationSignals = Boolean(
    parsedRequest.intended_owner ||
    parsedRequest.parsed_intended_owner ||
    parsedRequest.parent_team ||
    parsedRequest.parsed_parent_team ||
    parsedRequest.requested_people ||
    parsedRequest.parsed_requested_people
  );

  const hasTenantSignals = Boolean(
    parsedRequest.tenant_name ||
    parsedRequest.parsed_tenant_name ||
    parsedRequest.tenant_display_name ||
    parsedRequest.repository_name ||
    parsedRequest.parsed_repository_name
  );

  return hasRemovalSignals && !hasAccessGrantSignals && !hasOtherOperationSignals && !hasTenantSignals;
}

function isTenantRepoCreationParsedRequest(parsedRequest = {}) {
  const repositoryNameCandidate =
    parsedRequest.repository_name ||
    parsedRequest.parsed_repository_name ||
    '';

  const firstLineRepositoryName = String(repositoryNameCandidate)
    .replace(/\r\n/g, '\n')
    .split('\n')[0]
    .trim();

  const hasTenantModelSpecificSignals = Boolean(
    parsedRequest.tenant_type ||
    parsedRequest.parsed_tenant_type ||
    parsedRequest.governance_code_scanning_enabled ||
    parsedRequest.parsed_governance_code_scanning_enabled ||
    parsedRequest.governance_secret_scanning_enabled ||
    parsedRequest.parsed_governance_secret_scanning_enabled ||
    parsedRequest.governance_dependabot_enabled ||
    parsedRequest.parsed_governance_dependabot_enabled
  );

  const looksLikeRepositoryName = /^[a-zA-Z0-9._-]{1,100}$/.test(firstLineRepositoryName);

  return looksLikeRepositoryName && !hasTenantModelSpecificSignals;
}

function isTeamCreationParsedRequest(parsedRequest = {}) {
  return Boolean(
    parsedRequest.intended_owner ||
    parsedRequest.parsed_intended_owner ||
    parsedRequest.requested_team_names ||
    parsedRequest.parsed_requested_team_names ||
    parsedRequest.bulk_csv_requested_team_names ||
    parsedRequest.parsed_bulk_csv_requested_team_names
  );
}

function isTenantCreationParsedRequest(parsedRequest = {}) {
  return Boolean(
    parsedRequest.tenant_name ||
    parsedRequest.parsed_tenant_name ||
    parsedRequest.tenant_display_name
  );
}

function isTeamHierarchyParsedRequest(parsedRequest = {}) {
  return Boolean(
    parsedRequest.parent_team ||
    parsedRequest.parsed_parent_team ||
    parsedRequest.designated_hierarchy_approver ||
    parsedRequest.parsed_designated_hierarchy_approver ||
    parsedRequest.designated_approver ||
    parsedRequest.parsed_designated_approver ||
    parsedRequest.requested_child_teams ||
    parsedRequest.parsed_requested_child_teams
  );
}

function writeGitHubOutput(key, value, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) {
    return;
  }

  fs.appendFileSync(outputPath, `${key}=${value}\n`, 'utf8');
}

function buildCommentContextFromEnv(env = process.env) {
  return {
    id: env.COMMENT_ID || null,
    author_login: env.COMMENT_AUTHOR_LOGIN || '',
    body: env.COMMENT_BODY || '',
  };
}

function mapLegacyLifecycleStatus(value) {
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

function buildDefaultOrganizationRoleSpecifications(tenantKey) {
  const normalizedTenantKey = String(tenantKey || 'tenant').trim().toLowerCase();

  return [
    {
      role_key: 'tenant-admin',
      role_name: `${normalizedTenantKey}-tenant-admin`,
      permission_intent: 'create repos, create teams, manage repository access',
    },
    {
      role_key: 'repo-admin',
      role_name: `${normalizedTenantKey}-repo-admin`,
      permission_intent: 'create repos and manage repository access',
    },
    {
      role_key: 'developer',
      role_name: `${normalizedTenantKey}-developer`,
      permission_intent: 'contribute code to tenant repositories',
    },
    {
      role_key: 'viewer',
      role_name: `${normalizedTenantKey}-viewer`,
      permission_intent: 'read-only access to tenant repositories',
    },
  ];
}

function buildCanonicalTenantRecordFromRequest(request = {}) {
  const canonicalAccessModel = request.topology && request.topology.accessModel
    ? request.topology.accessModel
    : {
      enforcement: 'tenant-boundary',
      roles: ['tenant-admin', 'repo-admin', 'developer', 'viewer'],
      organizationRoleSpecifications: buildDefaultOrganizationRoleSpecifications(request.tenant_key),
    };

  if (!Array.isArray(canonicalAccessModel.organizationRoleSpecifications) || canonicalAccessModel.organizationRoleSpecifications.length === 0) {
    canonicalAccessModel.organizationRoleSpecifications = buildDefaultOrganizationRoleSpecifications(request.tenant_key);
  }

  return {
    tenantId: request.tenant_key,
    tenantName: request.tenant_display_name,
    tenantType: request.tenant_type,
    topology: request.topology
      ? {
        ...request.topology,
        accessModel: canonicalAccessModel,
      }
      : null,
    externalMappings: {
      cmdbId: request.external_mappings && request.external_mappings.cmdb_id || null,
      costCenter: request.external_mappings && request.external_mappings.cost_center || null,
      businessUnit: request.external_mappings && request.external_mappings.business_unit || null,
      environment: request.external_mappings && request.external_mappings.environment || 'nonprod',
    },
    metadata: {
      primaryContact: request.primary_contact || '',
      secondaryContact: request.secondary_contact || null,
      createdBy: request.requester_login || '',
      createdDate: request.submitted_at || new Date().toISOString(),
    },
    lifecycleStatus: mapLegacyLifecycleStatus(
      request.compatibility && request.compatibility.lifecycle_status_equivalent
        ? request.compatibility.lifecycle_status_equivalent
        : request.lifecycle_status || 'active'
    ),
    policy: {
      enforcement: canonicalAccessModel.enforcement,
      roles: canonicalAccessModel.roles,
      governanceMandatory: {
        codeScanning: Boolean(request.governance && request.governance.code_scanning && request.governance.code_scanning.mandatory),
        secretScanning: Boolean(request.governance && request.governance.secret_scanning && request.governance.secret_scanning.mandatory),
      },
    },
  };
}

function isTerminalRequestStatus(status) {
  return ['executed', 'partially_executed', 'failed', 'failed_after_approved_execution'].includes(status);
}

function terminalStateLabelPrefix(operation) {
  const operationPrefixes = {
    team_creation: 'issueops:create-org-teams:',
    team_hierarchy: 'issueops:add-child-teams:',
    team_repo_access: 'issueops:add-team-repo-access:',
    team_repo_access_removal: 'issueops:remove-team-repo-access:',
    tenant_repo_creation: 'issueops:create-tenant-repos:',
    tenant_creation: 'issueops:create-tenant:',
  };
  return operationPrefixes[operation] || 'issueops:add-team-members:';
}

function readIssueLabelsFromEnv(env = process.env) {
  if (!env.ISSUE_LABELS_JSON) {
    return [];
  }

  try {
    const labels = JSON.parse(env.ISSUE_LABELS_JSON);
    return Array.isArray(labels)
      ? labels.map((label) => String(label && label.name || label || '').toLowerCase()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function deriveTerminalStatusFromIssueLabels(labels = [], operation = null) {
  const prefixes = [terminalStateLabelPrefix(operation)];
  if (operation === 'tenant_creation') {
    // Backward compatibility for existing labels written before prefix normalization.
    prefixes.push('issueops:create-tenant-model:');
  }

  for (const status of ['executed', 'partially_executed', 'failed_after_approved_execution', 'failed']) {
    for (const prefix of prefixes) {
      if (labels.includes(`${prefix}${status}`)) {
        return status;
      }
    }
  }

  return null;
}

function readPriorAuditArtifact(artifactPath) {
  if (!artifactPath || !fs.existsSync(artifactPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  } catch {
    return null;
  }
}

function readPriorAttachmentRetryState(artifactPath) {
  const priorArtifact = readPriorAuditArtifact(artifactPath);
  if (!priorArtifact) {
    return {
      priorArtifact: null,
      latestFailedValidationAt: null,
      latestFailedValidationAttemptId: null,
    };
  }

  const priorAttempt = priorArtifact.validation && priorArtifact.validation.attachment_validation_attempt
    || priorArtifact.request && priorArtifact.request.attachment_validation_attempt
    || null;
  const priorRequest = priorArtifact.request || {};
  const priorAcceptedAttachment = priorArtifact.validation && priorArtifact.validation.accepted_attachment_submission
    || priorRequest.accepted_attachment_submission
    || null;

  if (!priorAttempt || priorRequest.intake_mode !== 'csv_attachment') {
    return {
      priorArtifact,
      latestFailedValidationAt: null,
      latestFailedValidationAttemptId: null,
    };
  }

  if (!['csv_invalid', 'attachment_rejected'].includes(priorAttempt.attempt_status)) {
    return {
      priorArtifact,
      latestFailedValidationAt: null,
      latestFailedValidationAttemptId: null,
    };
  }

  return {
    priorArtifact,
    latestFailedValidationAt: priorAcceptedAttachment && priorAcceptedAttachment.comment_created_at
      ? priorAcceptedAttachment.comment_created_at
      : priorAttempt.evaluated_at || null,
    latestFailedValidationAttemptId: priorAttempt.attempt_id || null,
  };
}

function buildTerminalStateValidation(priorArtifact, request) {
  const priorRequest = priorArtifact.request || {};
  const priorValidation = priorArtifact.validation || {};
  const warning = 'Later attachment comments are ignored after the request reaches a terminal execution state.';
  const attachmentValidationAttempt = {
    ...(priorRequest.attachment_validation_attempt || priorValidation.attachment_validation_attempt || {}),
    request_id: priorRequest.request_id || request.request_id,
    candidate_comment_id: request.comment_context.comment_id || null,
    attempt_status: 'ignored_terminal_state',
    evaluated_at: new Date().toISOString(),
  };
  const acceptedAttachmentSubmission = {
    ...(priorRequest.accepted_attachment_submission || priorValidation.accepted_attachment_submission || {}),
    acceptance_status: 'ignored_terminal_state',
    rejection_reason: 'terminal_state_ignored',
  };

  return {
    ...priorValidation,
    is_valid: priorValidation.is_valid !== false,
    request_status: priorRequest.request_status,
    attachment_validation_attempt: attachmentValidationAttempt,
    accepted_attachment_submission: acceptedAttachmentSubmission,
    warnings: [...new Set([...(priorValidation.warnings || []), warning])],
    request: {
      ...priorRequest,
      comment_context: request.comment_context,
      attachment_validation_attempt: attachmentValidationAttempt,
      accepted_attachment_submission: acceptedAttachmentSubmission,
      request_status: priorRequest.request_status,
    },
  };
}

async function executeGitHubReadWithRetry(operation, options = {}) {
  const result = await executeWithBoundedRetry(operation, {
    maxRetries: options.maxRetries || 2,
    sleep: options.sleep,
  });

  if (!result.ok) {
    throw Object.assign(result.error || new Error('GitHub read failed.'), {
      rate_limit_snapshot: result.retry_plan && result.retry_plan.rate_limit_snapshot || null,
    });
  }

  return result.value;
}

function buildMissingTokenHierarchyValidation(request) {
  return {
    is_valid: false,
    request_status: 'validation_failed',
    errors: ['Workflow token secret is missing. Configure ISSUEOPS_GITHUB_TOKEN or GITHUB_TOKEN for validation.'],
    warnings: [],
    organization_visible: false,
    parent_team_exists: false,
    designated_approver_authorization: null,
    requested_child_links: request.requested_child_links.map((childLink) => ({
      ...childLink,
      validation_status: 'rejected',
      desired_action: 'reject',
      execution_result: 'not_started',
      failure_reason: 'missing_token',
    })),
    existing_child_links: [],
    request: {
      ...request,
      request_status: 'validation_failed',
    },
  };
}

function buildMissingTokenRepoAccessValidation(request) {
  return {
    is_valid: false,
    request_status: 'validation_failed',
    errors: ['Workflow token secret is missing. Configure ISSUEOPS_GITHUB_TOKEN or GITHUB_TOKEN for validation.'],
    warnings: [],
    organization_visible: false,
    team_exists: false,
    bulk_csv_submission: request.bulk_csv_submission,
    csv_row_findings: request.csv_row_findings || [],
    csv_row_numbering_convention: request.csv_row_numbering_convention || null,
    designated_approver_authorization: null,
    requested_repository_grants: request.requested_repository_grants.map((grant) => ({
      ...grant,
      validation_status: 'rejected',
      desired_action: 'reject',
      execution_result: 'not_started',
      failure_reason: 'missing_token',
    })),
    already_satisfied_repository_grants: [],
    request: {
      ...request,
      request_status: 'validation_failed',
    },
  };
}

function buildMissingTokenRepoAccessRemovalValidation(request) {
  return {
    is_valid: false,
    request_status: 'validation_failed',
    errors: ['Workflow token secret is missing. Configure ISSUEOPS_GITHUB_TOKEN or GITHUB_TOKEN for validation.'],
    warnings: [],
    organization_visible: false,
    team_exists: false,
    designated_approver_authorization: null,
    requested_repository_removals: (request.requested_repository_removals || []).map((removal) => ({
      ...removal,
      validation_status: 'rejected',
      desired_action: 'reject',
      execution_result: 'not_started',
      failure_reason: 'missing_token',
    })),
    already_absent_repository_removals: [],
    request: {
      ...request,
      request_status: 'validation_failed',
    },
  };
}

async function runRequestValidation(options = {}) {
  const env = options.env || process.env;
  const shouldSetProcessExitCode = options.setProcessExitCode !== false && env === process.env;
  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join(
        'artifacts',
          `${isTeamRepoAccessParsedRequest(readParsedRequestFromEnv(env)) ? 'add-team-repo-access' : isTeamRepoAccessRemovalParsedRequest(readParsedRequestFromEnv(env)) ? 'remove-team-repo-access' : isTenantRepoCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-tenant-repos' : isTenantCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-tenant-model' : isTeamCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-org-teams' : isTeamHierarchyParsedRequest(readParsedRequestFromEnv(env)) ? 'add-child-teams' : 'add-team-members'}-validation-${env.ISSUE_NUMBER || 'manual'}.json`
      )
  );
  const parsedRequest = readParsedRequestFromEnv(env);
  const isTeamRepoAccess = isTeamRepoAccessParsedRequest(parsedRequest);
        const isTeamRepoAccessRemoval = isTeamRepoAccessRemovalParsedRequest(parsedRequest);
  const isTenantRepoCreation = isTenantRepoCreationParsedRequest(parsedRequest);
  const isTenantCreation = isTenantCreationParsedRequest(parsedRequest);
  const isTeamCreation = isTeamCreationParsedRequest(parsedRequest);
  const isTeamHierarchy = isTeamHierarchyParsedRequest(parsedRequest);
  const priorAttachmentRetryState = readPriorAttachmentRetryState(artifactPath);
  const priorArtifact = priorAttachmentRetryState.priorArtifact;
  const issueLabels = readIssueLabelsFromEnv(env);
  const teamHierarchyRepositoryPolicy = parseJsonFromEnv(env.TEAM_HIERARCHY_POLICY_JSON) || {};
  const teamRepoAccessRepositoryPolicy = parseJsonFromEnv(env.TEAM_REPO_ACCESS_POLICY_JSON) || {};
  const operation = isTeamRepoAccess
    ? 'team_repo_access'
    : isTeamRepoAccessRemoval
      ? 'team_repo_access_removal'
    : isTenantRepoCreation
      ? 'tenant_repo_creation'
      : isTenantCreation
        ? 'tenant_creation'
        : isTeamCreation
          ? 'team_creation'
          : isTeamHierarchy
            ? 'team_hierarchy'
            : 'team_membership';
  const terminalStatusFromIssueLabels = deriveTerminalStatusFromIssueLabels(issueLabels, operation);
  const request = (isTeamRepoAccess
    ? parseTeamRepoAccessRequest
    : isTeamRepoAccessRemoval
      ? parseTeamRepoAccessRemovalRequest
    : isTenantRepoCreation
      ? parseTenantRepoRequest
    : isTenantCreation
      ? parseTenantCreationRequest
    : isTeamCreation
      ? parseTeamCreationRequest
      : isTeamHierarchy
      ? parseTeamHierarchyRequest
      : parseTeamMembershipRequest)({
    parsedRequest,
    issue: {
      number: env.ISSUE_NUMBER,
      user: { login: env.REQUESTER_LOGIN || '' },
    },
    comment: buildCommentContextFromEnv(env),
    repository: env.GITHUB_REPOSITORY || '',
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
      issue_number: env.ISSUE_NUMBER,
    },
    legacyTenantRecord: parseJsonFromEnv(env.PARSED_LEGACY_TENANT_RECORD_JSON),
  });

  if (isTenantCreation) {
    request.lifecycle_status_equivalent = mapLegacyLifecycleStatus(
      request.compatibility && request.compatibility.lifecycle_status_equivalent
        ? request.compatibility.lifecycle_status_equivalent
        : request.lifecycle_status || 'active'
    );
    request.canonical_tenant_record = buildCanonicalTenantRecordFromRequest(request);
  }

  let validation;
  let reconciliationPlan = {};
  let approvalArtifact = null;
  let executionOutcome = null;
  try {
    if (
      request.intake_mode === 'csv_attachment' &&
      request.comment_context.comment_id &&
      terminalStatusFromIssueLabels
    ) {
      validation = buildTerminalStateValidation({
        request: {
          ...request,
          request_status: terminalStatusFromIssueLabels,
        },
        validation: {
          is_valid: true,
          warnings: [],
          errors: [],
        },
        approval: {
          approval_status: 'not_requested',
          approver_role: 'other',
        },
        execution: {
          mutation_count: 0,
          noop_count: 0,
          pending_count: 0,
          failure_count: 0,
          rollback_status: 'not_needed',
          summary: 'Later attachment comments are ignored after the request reaches a terminal execution state.',
        },
        reconciliation: {},
      }, request);
      approvalArtifact = {
        approval_status: 'not_requested',
        approver_login: '',
        approver_role: 'other',
        decision_source: 'validation',
        decision_note: 'Later attachment comments are ignored after the request reaches a terminal execution state.',
      };
      executionOutcome = {
        mutation_count: 0,
        noop_count: 0,
        pending_count: 0,
        failure_count: 0,
        rollback_status: 'not_needed',
        summary: 'Later attachment comments are ignored after the request reaches a terminal execution state.',
      };
    } else if (
      request.intake_mode === 'csv_attachment' &&
      request.comment_context.comment_id &&
      priorArtifact &&
      priorArtifact.request &&
      isTerminalRequestStatus(priorArtifact.request.request_status)
    ) {
      validation = buildTerminalStateValidation(priorArtifact, request);
      reconciliationPlan = priorArtifact.reconciliation || {};
      approvalArtifact = priorArtifact.approval || null;
      executionOutcome = priorArtifact.execution || null;
    } else {
    const tokenInfo = loadWorkflowToken({ env, required: false });
    if (!tokenInfo.token) {
      if (isTeamRepoAccess) {
        validation = buildMissingTokenRepoAccessValidation(request);
      } else if (isTeamRepoAccessRemoval) {
        validation = buildMissingTokenRepoAccessRemovalValidation(request);
      } else if (isTenantRepoCreation) {
        validation = {
          is_valid: false,
          request_status: 'validation_failed',
          errors: ['Workflow token secret is missing. Configure ISSUEOPS_GITHUB_TOKEN or GITHUB_TOKEN for validation.'],
          warnings: [],
          organization_visible: false,
          designated_approver_authorization: null,
          canonical_tenant_context: null,
          tenant_resolution: {
            tenant_match_count: 0,
            tenant_resolution_status: 'registry_conflict',
            candidates: [],
            registry_ref: env.TENANT_REGISTRY_REF || 'main',
            registry_directory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
            registry_malformed_files: [],
            registry_missing_directory: true,
          },
          request: {
            ...request,
            request_status: 'validation_failed',
          },
        };
      } else if (isTeamHierarchy) {
        validation = buildMissingTokenHierarchyValidation(request);
      } else if (isTenantCreation) {
        validation = {
          is_valid: false,
          request_status: 'validation_failed',
          errors: ['Workflow token secret is missing. Configure ISSUEOPS_GITHUB_TOKEN or GITHUB_TOKEN for validation.'],
          warnings: [],
          organization_visible: false,
          designated_approver_authorization: null,
          requester_eligibility: null,
          requested_teams: request.requested_teams.map((team) => ({
            ...team,
            validation_status: 'rejected',
            desired_action: 'reject',
            execution_result: 'not_started',
            failure_reason: 'missing_token',
          })),
          existing_teams: [],
          request: {
            ...request,
            request_status: 'validation_failed',
          },
        };
      } else if (isTeamCreation) {
        validation = {
          is_valid: false,
          request_status: 'validation_failed',
          errors: ['Workflow token secret is missing. Configure ISSUEOPS_GITHUB_TOKEN or GITHUB_TOKEN for validation.'],
          warnings: [],
          organization_visible: false,
          intended_owner_membership: null,
          bulk_csv_submission: request.bulk_csv_submission,
          csv_row_findings: request.csv_row_findings || [],
          csv_row_numbering_convention: request.csv_row_numbering_convention,
          requested_teams: request.requested_teams.map((team) => ({
            ...team,
            validation_status: 'rejected',
            desired_action: 'reject',
            execution_result: 'not_started',
            failure_reason: 'missing_token',
          })),
          existing_teams: [],
          request: {
            ...request,
            request_status: 'validation_failed',
          },
        };
      } else {
        validation = {
          is_valid: false,
          request_status: 'validation_failed',
          errors: ['Workflow token secret is missing. Configure ISSUEOPS_GITHUB_TOKEN or GITHUB_TOKEN for validation.'],
          warnings: [],
          team_exists: false,
          team_sync_blocked: false,
          bulk_csv_submission: request.bulk_csv_submission,
          csv_row_findings: request.csv_row_findings || [],
          csv_row_numbering_convention: request.csv_row_numbering_convention,
          requested_people: request.requested_people.map((username) => ({
            username,
            resolution_status: 'unresolved',
            current_membership_state: 'unknown',
            desired_action: 'reject',
            execution_result: 'not_started',
            failure_reason: 'missing_token',
          })),
          request: {
            ...request,
            request_status: 'validation_failed',
          },
        };
      }
    } else {
      const api = options.api || ((isTeamRepoAccess || isTeamRepoAccessRemoval)
        ? createGitHubTeamRepoApi({ token: tokenInfo.token })
        : createGitHubTeamApi({ token: tokenInfo.token }));
      const tenantRepoApi = isTenantRepoCreation
        ? (options.tenantRepoApi || createGitHubTeamRepoApi({ token: tokenInfo.token }))
        : null;
      if (isTeamRepoAccess) {
        const repoAccessAttachmentMaxBytes = resolveTeamRepoAccessAttachmentMaxBytes({
          attachment_max_bytes: options.maxAttachmentBytes,
          repository_policy: teamRepoAccessRepositoryPolicy,
        });
        const issueComments = env.ISSUE_NUMBER
          ? typeof api.listIssueComments === 'function'
            ? await executeGitHubReadWithRetry(
                () => api.listIssueComments({
                  repository: env.GITHUB_REPOSITORY || '',
                  issueNumber: env.ISSUE_NUMBER,
                }),
                { maxRetries: options.maxRetries || 2, sleep: options.sleep }
              )
            : []
          : [];
        validation = await validateTeamRepoAccessRequest(request, {
          getOrganization: ({ organization }) => executeGitHubReadWithRetry(
            () => api.getOrganization({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getTeamBySlug: ({ organization, teamSlug }) =>
            executeGitHubReadWithRetry(
              () => api.getTeamBySlug({ organization, teamSlug }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            ),
          getRepository: ({ owner, repo }) => executeGitHubReadWithRetry(
            () => api.getRepository({ owner, repo }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getTeamRepositoryPermission: ({ organization, teamSlug, owner, repo }) =>
            executeGitHubReadWithRetry(
              () => api.getTeamRepositoryPermission({ organization, teamSlug, owner, repo }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            ),
          getOrganizationMembership: ({ organization, username }) =>
            executeGitHubReadWithRetry(
              () => api.getOrganizationMembership({ organization, username }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            ),
          issueComments,
          latestFailedValidationAt: priorAttachmentRetryState.latestFailedValidationAt,
          latestFailedValidationAttemptId: priorAttachmentRetryState.latestFailedValidationAttemptId,
          repositoryPolicy: teamRepoAccessRepositoryPolicy,
          token: tokenInfo.token,
          fetchImpl: options.fetchImpl,
          maxAttachmentBytes: repoAccessAttachmentMaxBytes,
          maxRetries: options.maxRetries,
          sleep: options.sleep,
        });
        reconciliationPlan = reconcileTeamRepoAccess({
          request: validation.request,
          requested_repository_grants: validation.requested_repository_grants,
          organization_exists: validation.organization_visible,
          team_exists: validation.team_exists,
          intake_mode: validation.request.intake_mode,
          dry_run: validation.request.dry_run,
        });
      } else if (isTeamRepoAccessRemoval) {
        const repoAccessAttachmentMaxBytes = resolveTeamRepoAccessAttachmentMaxBytes({
          attachment_max_bytes: options.maxAttachmentBytes,
          repository_policy: teamRepoAccessRepositoryPolicy,
        });
        const issueComments = env.ISSUE_NUMBER
          ? typeof api.listIssueComments === 'function'
            ? await executeGitHubReadWithRetry(
                () => api.listIssueComments({
                  repository: env.GITHUB_REPOSITORY || '',
                  issueNumber: env.ISSUE_NUMBER,
                }),
                { maxRetries: options.maxRetries || 2, sleep: options.sleep }
              )
            : []
          : [];
        validation = await validateTeamRepoAccessRemovalRequest(request, {
          getOrganization: ({ organization }) => executeGitHubReadWithRetry(
            () => api.getOrganization({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getTeamBySlug: ({ organization, teamSlug }) =>
            executeGitHubReadWithRetry(
              () => api.getTeamBySlug({ organization, teamSlug }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            ),
          getRepository: ({ owner, repo }) => executeGitHubReadWithRetry(
            () => api.getRepository({ owner, repo }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getTeamRepositoryPermission: ({ organization, teamSlug, owner, repo }) =>
            executeGitHubReadWithRetry(
              () => api.getTeamRepositoryPermission({ organization, teamSlug, owner, repo }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            ),
          getOrganizationMembership: ({ organization, username }) =>
            executeGitHubReadWithRetry(
              () => api.getOrganizationMembership({ organization, username }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            ),
          issueComments,
          latestFailedValidationAt: priorAttachmentRetryState.latestFailedValidationAt,
          latestFailedValidationAttemptId: priorAttachmentRetryState.latestFailedValidationAttemptId,
          repositoryPolicy: teamRepoAccessRepositoryPolicy,
          token: tokenInfo.token,
          fetchImpl: options.fetchImpl,
          maxAttachmentBytes: repoAccessAttachmentMaxBytes,
          maxRetries: options.maxRetries,
          sleep: options.sleep,
        });
        reconciliationPlan = reconcileTeamRepoAccessRemoval({
          request: validation.request,
          requested_repository_removals: validation.requested_repository_removals,
          organization_exists: validation.organization_visible,
          team_exists: validation.team_exists,
          intake_mode: validation.request.intake_mode,
          dry_run: validation.request.dry_run,
        });
      } else if (isTenantRepoCreation) {
        validation = await validateTenantRepoRequest(request, {
          getOrganization: ({ organization }) => executeGitHubReadWithRetry(
            () => api.getOrganization({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          listTeams: ({ organization }) => executeGitHubReadWithRetry(
            () => api.listOrgTeams({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getMembershipForUser: ({ organization, teamSlug, username }) => executeGitHubReadWithRetry(
            () => api.getMembershipForUser({ organization, teamSlug, username }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getOrganizationMembership: ({ organization, username }) => executeGitHubReadWithRetry(
            () => api.getOrganizationMembership({ organization, username }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getRepository: ({ owner, repo }) => executeGitHubReadWithRetry(
            () => tenantRepoApi.getRepository({ owner, repo }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getTeamRepositoryPermission: ({ organization, teamSlug, owner, repo }) => executeGitHubReadWithRetry(
            () => tenantRepoApi.getTeamRepositoryPermission({ organization, teamSlug, owner, repo }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          registryRef: env.TENANT_REGISTRY_REF || 'main',
          registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
        });
        reconciliationPlan = reconcileTenantRepoCreation({
          request: validation.request,
          canonical_tenant_context: validation.canonical_tenant_context,
          organization_visible: validation.organization_visible,
          repository_state: validation.repository_state,
          current_repo_admin_permission: validation.current_repo_admin_permission,
          dry_run: validation.request.dry_run,
          boundary_revalidation_status: 'matched',
        });
      } else if (isTenantCreation) {
        validation = await validateTenantCreationRequest(request, {
          getOrganization: ({ organization }) => executeGitHubReadWithRetry(
            () => api.getOrganization({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getOrganizationMembership: ({ organization, username }) => executeGitHubReadWithRetry(
            () => api.getOrganizationMembership({ organization, username }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          listTeams: ({ organization }) => executeGitHubReadWithRetry(
            () => api.listOrgTeams({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
        });
        reconciliationPlan = reconcileTenantCreation({
          request: validation.request,
          requested_teams: validation.requested_teams,
          current_teams: validation.existing_teams,
          organization_exists: validation.organization_visible,
          dry_run: validation.request.dry_run,
        });
      } else if (isTeamCreation) {
        const issueComments = env.ISSUE_NUMBER
          ? typeof api.listIssueComments === 'function'
            ? await executeGitHubReadWithRetry(
                () => api.listIssueComments({
                  repository: env.GITHUB_REPOSITORY || '',
                  issueNumber: env.ISSUE_NUMBER,
                }),
                { maxRetries: options.maxRetries || 2, sleep: options.sleep }
              )
            : []
          : [];
        validation = await validateTeamCreationRequest(request, {
          getOrganization: ({ organization }) => executeGitHubReadWithRetry(
            () => api.getOrganization({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          resolveMembership: ({ organization, username }) =>
            executeGitHubReadWithRetry(
              () => api.getOrganizationMembership({ organization, username }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            ),
          listTeams: ({ organization }) => executeGitHubReadWithRetry(
            () => api.listOrgTeams({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          issueComments,
          latestFailedValidationAt: priorAttachmentRetryState.latestFailedValidationAt,
          latestFailedValidationAttemptId: priorAttachmentRetryState.latestFailedValidationAttemptId,
          token: tokenInfo.token,
          fetchImpl: options.fetchImpl,
          maxAttachmentBytes: options.maxAttachmentBytes,
          maxRetries: options.maxRetries,
          sleep: options.sleep,
        });
        reconciliationPlan = reconcileTeamCreation({
          request: validation.request,
          requested_teams: validation.requested_teams,
          current_teams: validation.requested_teams
            .filter((team) => team.desired_action === 'noop')
            .map((team) => ({
              id: team.current_team_id,
              slug: team.normalized_slug,
              name: team.requested_name,
            })),
          organization_exists: validation.organization_visible,
          dry_run: validation.request.dry_run,
        });
      } else if (isTeamHierarchy) {
        const hierarchyAttachmentMaxBytes = resolveTeamHierarchyAttachmentMaxBytes({
          attachment_max_bytes: options.maxAttachmentBytes,
          repository_policy: teamHierarchyRepositoryPolicy,
        });
        const issueComments = env.ISSUE_NUMBER
          ? typeof api.listIssueComments === 'function'
            ? await executeGitHubReadWithRetry(
                () => api.listIssueComments({
                  repository: env.GITHUB_REPOSITORY || '',
                  issueNumber: env.ISSUE_NUMBER,
                }),
                { maxRetries: options.maxRetries || 2, sleep: options.sleep }
              )
            : []
          : [];
        validation = await validateTeamHierarchyRequest(request, {
          getOrganization: ({ organization }) => executeGitHubReadWithRetry(
            () => api.getOrganization({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          listTeams: ({ organization }) => executeGitHubReadWithRetry(
            () => api.listOrgTeams({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          resolveTeamMembership: ({ organization, teamSlug, username }) =>
            executeGitHubReadWithRetry(
              () => api.getMembershipForUser({ organization, teamSlug, username }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            ),
          issueComments,
          latestFailedValidationAt: priorAttachmentRetryState.latestFailedValidationAt,
          latestFailedValidationAttemptId: priorAttachmentRetryState.latestFailedValidationAttemptId,
          repositoryPolicy: teamHierarchyRepositoryPolicy,
          token: tokenInfo.token,
          fetchImpl: options.fetchImpl,
          maxAttachmentBytes: hierarchyAttachmentMaxBytes,
          maxRetries: options.maxRetries,
          sleep: options.sleep,
        });
        reconciliationPlan = reconcileTeamHierarchy({
          request: validation.request,
          requested_child_links: validation.requested_child_links,
          current_teams: validation.current_teams,
          organization_exists: validation.organization_visible,
          parent_team_exists: validation.parent_team_exists,
          dry_run: validation.request.dry_run,
        });
      } else {
        const membershipApi = options.api || createMembershipGitHubApi({ token: tokenInfo.token });
        const issueComments = env.ISSUE_NUMBER
          ? typeof membershipApi.listIssueComments === 'function'
            ? await executeGitHubReadWithRetry(
                () => membershipApi.listIssueComments({
                  repository: env.GITHUB_REPOSITORY || '',
                  issueNumber: env.ISSUE_NUMBER,
                }),
                { maxRetries: options.maxRetries || 2, sleep: options.sleep }
              )
            : []
          : [];
        validation = await validateTeamMembershipRequest(request, {
          getTeam: ({ organization, teamSlug }) => executeGitHubReadWithRetry(
            () => membershipApi.getTeamBySlug({ organization, teamSlug }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          resolveUser: ({ organization, username }) =>
            executeGitHubReadWithRetry(
              () => membershipApi.getOrganizationMembership({ organization, username }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            ),
          issueComments,
          latestFailedValidationAt: priorAttachmentRetryState.latestFailedValidationAt,
          latestFailedValidationAttemptId: priorAttachmentRetryState.latestFailedValidationAttemptId,
          token: tokenInfo.token,
          fetchImpl: options.fetchImpl,
          maxAttachmentBytes: options.maxAttachmentBytes,
          maxRetries: options.maxRetries,
          sleep: options.sleep,
        });
      }
    }
    }
  } catch (error) {
    validation = {
      is_valid: false,
      request_status: 'validation_failed',
      errors: [error.message],
      warnings: [],
      team_exists: false,
      team_sync_blocked: false,
      bulk_csv_submission: request.bulk_csv_submission,
      csv_row_findings: request.csv_row_findings || [],
      csv_row_numbering_convention: request.csv_row_numbering_convention,
      requested_people: [],
      request: {
        ...request,
        request_status: 'validation_failed',
      },
    };
  }

  executionOutcome = executionOutcome || buildExecutionOutcome({
    executionResults: [],
    operationLabel: (isTeamRepoAccess || isTeamRepoAccessRemoval)
      ? 'repository'
      : isTenantRepoCreation
        ? 'tenant_repository'
        : isTenantCreation
          ? 'tenant_bootstrap'
          : isTeamCreation
            ? 'team'
            : isTeamHierarchy
              ? 'child_link'
              : 'membership',
    intake_mode: validation.request && validation.request.intake_mode,
    terminal_state: validation.request_status,
    duplicate_row_count: validation.request && validation.request.bulk_csv_submission
      ? validation.request.bulk_csv_submission.duplicate_row_count
      : 0,
    invalid_row_count: validation.request && validation.request.bulk_csv_submission
      ? validation.request.bulk_csv_submission.invalid_row_count
      : 0,
    attachment_rate_limit_snapshot: validation.attachment_rate_limit_snapshot || null,
  });

  if (!approvalArtifact) {
    executionOutcome.summary = validation.request_status === 'waiting_for_attachment'
      ? 'Request metadata is valid, but execution remains blocked until the requester posts a qualifying CSV attachment comment.'
      : validation.is_valid
      ? (isTeamRepoAccess || isTeamRepoAccessRemoval)
        ? 'Request is validated and ready for approval. No repository-access mutation was attempted.'
        : isTenantRepoCreation
        ? 'Request is validated and ready for approval. No tenant repository mutation was attempted.'
        : isTenantCreation
        ? 'Request is validated and ready for approval. No tenant bootstrap mutation was attempted.'
        : isTeamCreation
        ? 'Request is validated and ready for approval. No team creation was attempted.'
        : isTeamHierarchy
        ? 'Request is validated and ready for approval. No child-team mutation was attempted.'
        : 'Request is validated and ready for approval. No membership mutation was attempted.'
      : (isTeamRepoAccess || isTeamRepoAccessRemoval)
        ? 'Request validation failed. No repository-access mutation was attempted.'
        : isTenantRepoCreation
        ? 'Request validation failed. No tenant repository mutation was attempted.'
        : isTenantCreation
        ? 'Request validation failed. No tenant bootstrap mutation was attempted.'
        : isTeamCreation
        ? 'Request validation failed. No team creation was attempted.'
        : isTeamHierarchy
        ? 'Request validation failed. No child-team mutation was attempted.'
        : 'Request validation failed. No membership mutation was attempted.';
  }

  const auditArtifact = buildAuditArtifact({
    request: validation.request,
    validation,
    approval: approvalArtifact || {
      approval_status: validation.request_status === 'waiting_for_attachment'
        ? 'not_requested'
        : validation.is_valid
          ? 'pending'
          : 'not_requested',
      approver_role: 'other',
    },
    reconciliationPlan,
    executionOutcome,
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
      operation,
      artifact_name: path.basename(artifactPath),
      artifact_retention_days: env.AUDIT_ARTIFACT_RETENTION_DAYS || '',
    },
  });

  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, toAuditArtifactJson({
    request: validation.request,
    validation,
    approval: auditArtifact.approval,
    reconciliationPlan,
    executionOutcome,
    runContext: auditArtifact.metadata,
  }), 'utf8');

  emitAuditSummary(auditArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY });
  writeGitHubOutput('validation-status', validation.request_status, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-name', path.basename(artifactPath), env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-retention-days', env.AUDIT_ARTIFACT_RETENTION_DAYS || '', env.GITHUB_OUTPUT);

  if (!validation.is_valid && shouldSetProcessExitCode) {
    process.exitCode = 1;
  }

  return {
    validation,
    auditArtifact,
    artifactPath,
  };
}

if (require.main === module) {
  runRequestValidation().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildCanonicalTenantRecordFromRequest,
  mapLegacyLifecycleStatus,
  deriveTerminalStatusFromIssueLabels,
  isTenantRepoCreationParsedRequest,
  isTenantCreationParsedRequest,
  isTeamRepoAccessParsedRequest,
  isTeamRepoAccessRemovalParsedRequest,
  isTeamHierarchyParsedRequest,
  isTeamCreationParsedRequest,
  parseParsedRequestJson,
  parseJsonFromEnv,
  readIssueLabelsFromEnv,
  readParsedRequestFromEnv,
  buildCommentContextFromEnv,
  runRequestValidation,
};