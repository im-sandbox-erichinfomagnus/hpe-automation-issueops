'use strict';

const fs = require('fs');
const path = require('path');

const { assertTeamHierarchyAllowed } = require('../actions/team-hierarchy-policy');
const { assertTeamCreationAllowed } = require('../actions/team-creation-policy');
const { assertMutationAllowed } = require('../actions/team-membership-policy');
const { assertTenantBootstrapHierarchyAllowed } = require('../actions/team-hierarchy-policy');
const { assertTenantBootstrapMembershipAllowed } = require('../actions/team-membership-policy');
const { assertRepositoryAccessAllowed } = require('../actions/team-repo-access-policy');
const { assertRepositoryCreationAllowed } = require('../actions/repo-creation-policy');
const { assertRepoAdminTeamPermissionAllowed } = require('../actions/repo-permission-policy');
const { assertHostedRunnerMutationAllowed } = require('../actions/hosted-runner-policy');
const { assertRunnerGroupCreationAllowed } = require('../actions/runner-group-policy');
const { buildAuditArtifact, toAuditArtifactJson } = require('../workflow-support/build-audit-artifact');
const { buildExecutionOutcome } = require('../workflow-support/build-execution-outcome');
const { createGitHubTeamApi } = require('../workflow-support/github-team-api');
const { createGitHubTeamRepoApi } = require('../workflow-support/github-team-repo-api');
const { createGitHubRunnerApi } = require('../workflow-support/github-runner-api');
const { executeWithBoundedRetry } = require('../workflow-support/handle-rate-limit');
const { executeCapabilityOperationWithRetry } = require('../workflow-support/handle-rate-limit');
const { buildTenantBootstrapRateLimitContext } = require('../workflow-support/handle-rate-limit');
const { buildTopologyRegistryReadRateLimitContext } = require('../workflow-support/handle-rate-limit');
const { buildOwnedTopologyPersistenceRateLimitContext } = require('../workflow-support/handle-rate-limit');
const { persistTenantRegistryRecord } = require('../workflow-support/persist-tenant-registry-record');
const { commitRegistryRecord } = require('../workflow-support/commit-registry-record');
const { reconcileTenantCreation } = require('../workflow-support/reconcile-tenant-creation');
const { reconcileTenantRepoCreation } = require('../workflow-support/reconcile-tenant-repo-creation');
const { reconcileTenantRepoCreationBatch } = require('../workflow-support/reconcile-tenant-repo-creation');
const { persistOwnedRepositoryEntry } = require('../workflow-support/reconcile-tenant-repo-creation');
const { reconcileHostedRunnerCreation } = require('../workflow-support/reconcile-hosted-runner-creation');
const { reconcileHostedRunnerDeletion } = require('../workflow-support/reconcile-hosted-runner-deletion');
const { reconcileHostedRunnerMove } = require('../workflow-support/reconcile-hosted-runner-move');
const { reconcileRunnerGroupCreation } = require('../workflow-support/reconcile-runner-group-creation');
const { reconcileTenantVariables } = require('../workflow-support/reconcile-tenant-variables');
const { reconcileRepositoryRuleset } = require('../workflow-support/reconcile-repository-ruleset');
const { reconcileTeamHierarchy } = require('../workflow-support/reconcile-team-hierarchy');
const { reconcileTeamCreation } = require('../workflow-support/reconcile-team-creation');
const { reconcileTeamMembers } = require('../workflow-support/reconcile-team-members');
const { reconcileTeamRepoAccess } = require('../workflow-support/reconcile-team-repo-access');
const { reconcileTeamRepoAccessRemoval } = require('../workflow-support/reconcile-team-repo-access-removal');
const { validateTeamRepoAccessRequest } = require('../workflow-support/validate-team-repo-access-request');
const { validateTeamRepoAccessRemovalRequest } = require('../workflow-support/validate-team-repo-access-removal-request');
const { validateTenantRepoRequest } = require('../workflow-support/validate-tenant-repo-request');
const { validateHostedRunnerRequest } = require('../workflow-support/validate-hosted-runner-request');
const { validateHostedRunnerDeletionRequest } = require('../workflow-support/validate-hosted-runner-deletion-request');
const { validateHostedRunnerMoveRequest } = require('../workflow-support/validate-hosted-runner-move-request');
const { validateRunnerGroupRequest } = require('../workflow-support/validate-runner-group-request');
const { validateTenantVariablesRequest } = require('../workflow-support/validate-tenant-variables-request');
const { createGitHubOrgVariablesApi } = require('../workflow-support/github-org-variables-api');
const { validateRepositoryRulesetRequest } = require('../workflow-support/validate-repository-ruleset-request');
const { createGitHubRepoRulesetsApi } = require('../workflow-support/github-repo-rulesets-api');
const { assertRunnerGroupCreationAllowed: assertTenantVariablesMutationAllowed } = require('../actions/runner-group-policy');
const { assertRunnerGroupCreationAllowed: assertRepositoryRulesetMutationAllowed } = require('../actions/runner-group-policy');
const { emitAuditSummary } = require('./emit-audit-summary');

function terminalStateLabelPrefix(operation) {
  const operationPrefixes = {
    team_creation: 'issueops:create-org-teams:',
    team_hierarchy: 'issueops:add-child-teams:',
    team_repo_access: 'issueops:add-team-repo-access:',
    team_repo_access_removal: 'issueops:remove-team-repo-access:',
    tenant_repo_creation: 'issueops:create-tenant-repos:',
    tenant_creation: 'issueops:create-tenant:',
    hosted_runner_creation: 'issueops:create-tenant-hosted-runner:',
    hosted_runner_deletion: 'issueops:delete-tenant-hosted-runner:',
    hosted_runner_move: 'issueops:move-tenant-hosted-runner:',
    runner_group_creation: 'issueops:create-tenant-runner-groups:',
    tenant_variable_management: 'issueops:manage-tenant-variables:',
    repository_ruleset_creation: 'issueops:create-repository-ruleset:',
    repository_ruleset_deletion: 'issueops:delete-repository-ruleset:',
  };
  return operationPrefixes[operation] || 'issueops:add-team-members:';
}

function buildTerminalLabelPrefixes(operation) {
  const prefixes = [terminalStateLabelPrefix(operation)];

  if (operation === 'tenant_creation') {
    // Backward compatibility for labels written before prefix normalization.
    prefixes.push('issueops:create-tenant-model:');
  }

  if (operation === 'tenant_repo_creation') {
    // Tenant-repo requests should not keep stale tenant-bootstrap terminal labels.
    prefixes.push('issueops:create-tenant:');
    prefixes.push('issueops:create-tenant-model:');
  }

  return [...new Set(prefixes)];
}

function buildTerminalStateLabels(prefixes = []) {
  const statuses = ['executed', 'partially_executed', 'failed_after_approved_execution', 'failed'];
  return prefixes.flatMap((prefix) => statuses.map((status) => `${prefix}${status}`));
}

function readAuditArtifact(filePath) {
  const resolvedPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

function writeGitHubOutput(key, value, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) {
    return;
  }

  fs.appendFileSync(outputPath, `${key}=${value}\n`, 'utf8');
}

function hasAutomaticRequesterAuthorization(approval = {}) {
  const requesterAuthorization = approval.requester_authorization || {};
  return (
    approval.decision_source === 'automatic_demo' &&
    approval.approval_status === 'approved' &&
    requesterAuthorization.authorized === true
  );
}

function isAutomaticExecutionArtifact(auditArtifact = {}) {
  const metadata = auditArtifact.metadata || {};
  const approval = auditArtifact.approval || {};
  return (
    String(metadata.approval_mode || '').toLowerCase() === 'automatic' ||
    approval.decision_source === 'automatic_demo'
  );
}

function formatExecutionSummaryLead(options = {}) {
  const auditArtifact = options.auditArtifact || {};
  const status = String(options.status || 'failed');
  const executionLabel = String(options.executionLabel || 'execution');
  const mutationLabel = String(options.mutationLabel || executionLabel);
  const automatic = isAutomaticExecutionArtifact(auditArtifact);

  if (status === 'dry_run') {
    return automatic
      ? 'Automatic authorization passed, but execution remains blocked because the request is dry-run only.'
      : 'Approved execution remains blocked because the request is dry-run only.';
  }
  if (status === 'noop') {
    return automatic
      ? `Request is already satisfied. Re-running the automatically authorized request does not trigger a new ${mutationLabel} mutation run.`
      : `Request is already satisfied. Additional approval comments do not trigger a new ${mutationLabel} mutation run.`;
  }
  if (status === 'executed') {
    return automatic
      ? `${executionLabel} completed after automatic authorization.`
      : `Approved ${executionLabel} completed.`;
  }
  if (status === 'partially_executed') {
    return automatic
      ? `${executionLabel} completed with partial failure after automatic authorization.`
      : `Approved ${executionLabel} completed with partial failure.`;
  }

  return automatic
    ? `${executionLabel} failed after automatic authorization.`
    : `Approved ${executionLabel} failed.`;
}

function normalizeRequesterMaintainerPolicy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'keep' || normalized === 'keep_maintainer') {
    return 'keep_maintainer';
  }
  if (['member', 'downgrade_to_member', 'downgrade'].includes(normalized)) {
    return 'downgrade_to_member';
  }
  if (['remove', 'remove_membership', 'remove_requester'].includes(normalized)) {
    return 'remove';
  }
  return 'keep_maintainer';
}

function summarizeMaintainerNormalizationActions(actions = [], policy = 'keep_maintainer') {
  const requesterActions = actions.filter((entry) => String(entry.action || '').startsWith('normalize_requester'));
  const mutated = requesterActions.filter((entry) => ['added', 'mutated', 'removed'].includes(entry.execution_result)).length;
  const failed = requesterActions.filter((entry) => entry.execution_result === 'failed').length;
  const noop = requesterActions.filter((entry) => entry.execution_result === 'noop').length;

  if (policy === 'keep_maintainer') {
    return 'Requester maintainership retained by policy (keep_maintainer).';
  }

  if (requesterActions.length === 0) {
    return `No requester maintainership normalization was required (policy=${policy}).`;
  }

  if (failed > 0) {
    return `Requester maintainership normalization attempted with policy ${policy}: changed=${mutated}, noop=${noop}, failed=${failed}.`;
  }

  return `Requester maintainership normalization applied with policy ${policy}: changed=${mutated}, noop=${noop}, failed=0.`;
}

function buildContextBindingEvidence(auditArtifact = {}, executionContextMarker = null) {
  const approval = auditArtifact.approval || {};
  const approvedContextMarker = approval.approved_context_marker || null;
  const latestContextMarker = approval.latest_context_marker || null;
  const normalizedExecutionContextMarker = executionContextMarker || null;
  const contextBindingStatus = (
    approvedContextMarker &&
    latestContextMarker &&
    normalizedExecutionContextMarker &&
    String(approvedContextMarker) === String(latestContextMarker) &&
    String(latestContextMarker) === String(normalizedExecutionContextMarker)
  )
    ? 'matched'
    : 'mismatched';

  return {
    approved_context_marker: approvedContextMarker,
    latest_context_marker: latestContextMarker,
    execution_context_marker: normalizedExecutionContextMarker,
    context_binding_status: contextBindingStatus,
  };
}

// Finds an organization membership reader for the pre-mutation caller recheck.
// Injected adapters win so tests and workflows share one path; a real token is the
// last resort. Returning null is a deliberate fail-closed signal, not a skip.
function resolveCallerMembershipLookup(context = {}) {
  const options = context.options || {};
  const mutationDecision = context.mutationDecision || {};
  const auditArtifact = context.auditArtifact || null;

  if (typeof options.getOrganizationMembership === 'function') {
    return ({ organization, username }) => options.getOrganizationMembership({ organization, username });
  }

  const adapters = [];
  if (options.teamApi) {
    adapters.push(options.teamApi);
  }
  if (typeof options.createApi === 'function') {
    adapters.push(options.createApi({
      token: mutationDecision.tokenInfo && mutationDecision.tokenInfo.token,
      auditArtifact,
    }));
  }
  if (options.api) {
    adapters.push(options.api);
  }

  const adapter = adapters.find(
    (candidate) => candidate && typeof candidate.getOrganizationMembership === 'function'
  );
  if (adapter) {
    return ({ organization, username }) => adapter.getOrganizationMembership({ organization, username });
  }

  const token = mutationDecision.tokenInfo && mutationDecision.tokenInfo.token;
  if (!token || adapters.length > 0) {
    return null;
  }

  const liveApi = createGitHubTeamApi({ token });
  return ({ organization, username }) => liveApi.getOrganizationMembership({ organization, username });
}

function buildExecutionApprovalContext(auditArtifact = {}) {
  const approval = auditArtifact.approval || {};
  if (!hasAutomaticRequesterAuthorization(approval)) {
    return approval;
  }

  const request = auditArtifact.request || {};
  const requesterAuthorization = approval.requester_authorization || {};
  const requesterLogin =
    requesterAuthorization.requester_login ||
    request.requester_login ||
    '';
  const operation = auditArtifact.metadata && auditArtifact.metadata.operation || 'team_membership';
  if (operation === 'team_membership') {
    return {
      ...approval,
      approver_login: requesterLogin,
      approver_role: 'org_owner',
      approver_authorization_state: 'authorized',
    };
  }

  if (operation === 'team_creation') {
    return {
      ...approval,
      approver_login: request.intended_owner_login || '',
      approver_role: 'intended_owner',
      approver_authorization_state: 'authorized',
    };
  }

  if (operation === 'team_hierarchy') {
    return {
      ...approval,
      approver_login: requesterLogin,
      designated_approver_login: requesterLogin,
      approver_role: 'designated_hierarchy_approver',
      approver_authorization_state: 'authorized',
    };
  }

  return {
    ...approval,
    approver_login: requesterLogin,
    designated_approver_login: requesterLogin,
    approver_role: 'target_org_owner',
    approver_authorization_state: 'authorized',
  };
}

function buildValidatedPeople(auditArtifact = {}) {
  const validationPeople = auditArtifact.validation && auditArtifact.validation.requested_people;
  const request = auditArtifact.request || {};
  const requestedPeopleDetailMap = new Map(
    (request.requested_people_detail || [])
      .filter((detail) => detail && detail.username)
      .map((detail) => [detail.username, detail])
  );
  const acceptedAttachmentCommentId = request.accepted_attachment_submission
    ? request.accepted_attachment_submission.comment_id || null
    : null;

  if (Array.isArray(validationPeople) && validationPeople.length > 0) {
    return validationPeople.map((person) => {
      const personDetail = requestedPeopleDetailMap.get(person.username) || {};
      return {
        ...person,
        source_row_number: person.source_row_number ?? personDetail.source_row_number ?? null,
        source_comment_id: person.source_comment_id ?? personDetail.source_comment_id ?? acceptedAttachmentCommentId,
      };
    });
  }

  return (request.requested_people || []).map((username) => ({
    username,
    source_row_number: requestedPeopleDetailMap.get(username)
      ? requestedPeopleDetailMap.get(username).source_row_number || null
      : null,
    source_comment_id: requestedPeopleDetailMap.get(username)
      ? requestedPeopleDetailMap.get(username).source_comment_id || acceptedAttachmentCommentId
      : acceptedAttachmentCommentId,
    resolution_status: 'resolved',
    current_membership_state: 'unknown',
    desired_action: 'add_member',
    execution_result: 'not_started',
    failure_reason: null,
  }));
}

function buildValidatedTeams(auditArtifact = {}) {
  const validationTeams = auditArtifact.validation && auditArtifact.validation.requested_teams;
  if (Array.isArray(validationTeams) && validationTeams.length > 0) {
    return validationTeams;
  }

  return (auditArtifact.request && auditArtifact.request.requested_teams || []).map((team) => ({
    ...team,
    validation_status: team.validation_status || 'valid',
    desired_action: team.desired_action || 'create_team',
    execution_result: team.execution_result || 'not_started',
    failure_reason: team.failure_reason || null,
  }));
}

function buildValidatedChildLinks(auditArtifact = {}) {
  const validationChildLinks = auditArtifact.validation && auditArtifact.validation.requested_child_links;
  if (Array.isArray(validationChildLinks) && validationChildLinks.length > 0) {
    return validationChildLinks;
  }

  return (auditArtifact.request && auditArtifact.request.requested_child_links || []).map((childLink) => ({
    ...childLink,
    validation_status: childLink.validation_status || 'valid',
    desired_action: childLink.desired_action || 'link_child',
    execution_result: childLink.execution_result || 'not_started',
    failure_reason: childLink.failure_reason || null,
  }));
}

function buildValidatedRepositoryGrants(auditArtifact = {}) {
  const validationRepositoryGrants = auditArtifact.validation && auditArtifact.validation.requested_repository_grants;
  if (Array.isArray(validationRepositoryGrants) && validationRepositoryGrants.length > 0) {
    return validationRepositoryGrants;
  }

  return (auditArtifact.request && auditArtifact.request.requested_repository_grants || []).map((grant) => ({
    ...grant,
    validation_status: grant.validation_status || 'valid',
    desired_action: grant.desired_action || 'grant_access',
    execution_result: grant.execution_result || 'not_started',
    failure_reason: grant.failure_reason || null,
  }));
}

function buildValidatedRepositoryRemovals(auditArtifact = {}) {
  const validationRepositoryRemovals = auditArtifact.validation && auditArtifact.validation.requested_repository_removals;
  if (Array.isArray(validationRepositoryRemovals) && validationRepositoryRemovals.length > 0) {
    return validationRepositoryRemovals;
  }

  return (auditArtifact.request && auditArtifact.request.requested_repository_removals || []).map((removal) => ({
    ...removal,
    validation_status: removal.validation_status || 'valid',
    desired_action: removal.desired_action || 'remove_access',
    execution_result: removal.execution_result || 'not_started',
    failure_reason: removal.failure_reason || null,
  }));
}

function classifyFailureReason(error = {}) {
  if (error.team_sync_blocked) {
    return 'team_sync_blocked';
  }

  if (error.status === 429) {
    return 'rate_limited';
  }

  const message = String(error.payload && error.payload.message ? error.payload.message : error.message || '').toLowerCase();
  if (message.includes('secondary rate limit')) {
    return 'rate_limited';
  }

  if (error.status) {
    return `http_${error.status}`;
  }

  return 'unknown_error';
}

async function ensureTenantRepoCustomPropertyDefinitions(options = {}) {
  const api = options.api;
  const organization = options.organization;
  const properties = Array.isArray(options.properties) ? options.properties : [];
  const executeWithRetry = options.executeWithRetry;
  const maxRetries = options.maxRetries || 2;
  const sleep = options.sleep;

  if (!organization || properties.length === 0) {
    return {
      ok: true,
      created: [],
      failed: [],
      rate_limit_snapshot: null,
    };
  }

  if (
    !api ||
    typeof api.getOrganizationCustomPropertiesSchema !== 'function' ||
    typeof api.createOrUpdateOrganizationCustomProperty !== 'function'
  ) {
    return {
      ok: true,
      created: [],
      failed: [],
      skipped: true,
      rate_limit_snapshot: null,
    };
  }

  const schemaResult = await executeWithRetry(
    () => api.getOrganizationCustomPropertiesSchema({ organization }),
    {
      maxRetries,
      sleep,
    }
  );

  let latestRateLimitSnapshot = schemaResult.retry_plan.rate_limit_snapshot || null;

  if (!schemaResult.ok) {
    return {
      ok: false,
      created: [],
      failed: [
        {
          property_name: null,
          failure_reason: classifyFailureReason(schemaResult.error),
          status_code: schemaResult.error && schemaResult.error.status ? schemaResult.error.status : null,
          detail: schemaResult.error && schemaResult.error.payload && schemaResult.error.payload.message
            ? schemaResult.error.payload.message
            : schemaResult.error && schemaResult.error.message
              ? schemaResult.error.message
              : null,
        },
      ],
      rate_limit_snapshot: latestRateLimitSnapshot,
    };
  }

  const existingPropertyNames = new Set(
    (schemaResult.value || [])
      .map((entry) => String(entry && entry.property_name || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const missingPropertyNames = [...new Set(
    properties
      .map((entry) => String(entry && entry.property_name || '').trim())
      .filter(Boolean)
  )].filter((propertyName) => !existingPropertyNames.has(propertyName.toLowerCase()));

  const created = [];
  const failed = [];

  for (const propertyName of missingPropertyNames) {
    const upsertResult = await executeWithRetry(
      () => api.createOrUpdateOrganizationCustomProperty({
        organization,
        property_name: propertyName,
        value_type: 'string',
        description: `Managed by IssueOps for tenant repository contact metadata: ${propertyName}`,
        values_editable_by: 'org_actors',
      }),
      {
        maxRetries,
        sleep,
      }
    );

    latestRateLimitSnapshot = upsertResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

    if (upsertResult.ok) {
      created.push(propertyName);
      continue;
    }

    failed.push({
      property_name: propertyName,
      failure_reason: classifyFailureReason(upsertResult.error),
      status_code: upsertResult.error && upsertResult.error.status ? upsertResult.error.status : null,
      detail: upsertResult.error && upsertResult.error.payload && upsertResult.error.payload.message
        ? upsertResult.error.payload.message
        : upsertResult.error && upsertResult.error.message
          ? upsertResult.error.message
          : null,
    });
  }

  return {
    ok: failed.length === 0,
    created,
    failed,
    rate_limit_snapshot: latestRateLimitSnapshot,
  };
}
function deriveRequestStatus(executionOutcome) {
  if (executionOutcome.failure_count === 0) {
    return 'executed';
  }

  if (
    executionOutcome.mutation_count > 0 ||
    executionOutcome.noop_count > 0 ||
    executionOutcome.pending_count > 0
  ) {
    return 'partially_executed';
  }

  return 'failed';
}

function deriveApprovedExecutionTerminalState(executionOutcome, options = {}) {
  const baseStatus = deriveRequestStatus(executionOutcome);
  const operation = options.operation || '';
  const intakeMode = options.intakeMode || '';
  const approvalStatus = options.approvalStatus || '';

  if (
    baseStatus === 'failed' &&
    approvalStatus === 'approved' &&
    operation === 'team_hierarchy' &&
    intakeMode === 'csv_attachment'
  ) {
    return 'failed_after_approved_execution';
  }

  return baseStatus;
}

function validateTenantBoundaryGuardrails(request = {}) {
  const accessModel = request.topology && request.topology.accessModel || {};
  const expectedRoles = ['tenant-admin', 'repo-admin', 'developer', 'viewer'];
  const roles = Array.isArray(accessModel.roles) ? accessModel.roles : [];

  const enforcementValid = accessModel.enforcement === 'tenant-boundary';
  const rolesValid = roles.length === expectedRoles.length &&
    expectedRoles.every((role, index) => roles[index] === role);

  if (!enforcementValid || !rolesValid) {
    return {
      valid: false,
      reason: 'tenant_boundary_policy_violation',
      detail: 'Tenant-boundary pre-mutation guardrail failed: accessModel.enforcement and canonical role ordering must match policy.',
    };
  }

  return {
    valid: true,
    reason: 'tenant_boundary_policy_passed',
  };
}

function buildTenantOrganizationRolePlan(request = {}) {
  const accessModel = request.topology && request.topology.accessModel || {};
  const roleOrder = Array.isArray(accessModel.roles)
    ? accessModel.roles
    : ['tenant-admin', 'repo-admin', 'developer', 'viewer'];
  const roleSpecifications = Array.isArray(accessModel.organizationRoleSpecifications)
    ? accessModel.organizationRoleSpecifications
    : [];

  return roleOrder.map((roleKey) => {
    const specification = roleSpecifications.find((entry) => entry && entry.role_key === roleKey) || {};
    const fallbackRoleName = `${String(request.tenant_key || 'tenant').toLowerCase()}-${roleKey}`;
    const fallbackBaseRole = roleKey === 'viewer'
      ? 'read'
      : roleKey === 'developer'
        ? 'write'
        : 'maintain';

    return {
      role_key: roleKey,
      role_name: String(specification.role_name || fallbackRoleName).trim(),
      permission_intent: specification.permission_intent || null,
      repository_base_role: fallbackBaseRole,
      repository_permissions: [],
    };
  });
}

function normalizeRoleMapKey(value) {
  return String(value || '').trim().toLowerCase();
}

function buildPreMutationFailureArtifact(options = {}) {
  const auditArtifact = options.auditArtifact;
  const artifactPath = options.artifactPath;
  const env = options.env || process.env;
  const operationLabel = options.operationLabel;
  const rateLimitSnapshot = options.rateLimitSnapshot || null;
  const failureMessage = options.failureMessage;
  const isTenantRepoCreation = options.isTenantRepoCreation === true;

  auditArtifact.request.request_status = 'failed';
  auditArtifact.reconciliation = {
    ...(auditArtifact.reconciliation || {}),
    rate_limit_snapshot: rateLimitSnapshot,
  };
  auditArtifact.execution = buildExecutionOutcome({
    executionResults: [],
    operationLabel,
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
    },
    intake_mode: auditArtifact.request && auditArtifact.request.intake_mode,
    duplicate_row_count: auditArtifact.request && auditArtifact.request.bulk_csv_submission
      ? auditArtifact.request.bulk_csv_submission.duplicate_row_count
      : 0,
    invalid_row_count: auditArtifact.request && auditArtifact.request.bulk_csv_submission
      ? auditArtifact.request.bulk_csv_submission.invalid_row_count
      : 0,
    artifact_path: artifactPath,
    rate_limit_snapshot: rateLimitSnapshot,
  });
  auditArtifact.execution.failure_count = 1;
  auditArtifact.execution.rollback_status = 'not_needed';
  auditArtifact.execution.summary = failureMessage;

  const updatedArtifact = buildAuditArtifact({
    request: auditArtifact.request,
    validation: auditArtifact.validation,
    assignment: auditArtifact.assignment,
    approval: auditArtifact.approval,
    reconciliationPlan: auditArtifact.reconciliation,
    executionOutcome: auditArtifact.execution,
    runContext: {
      run_id: env.GITHUB_RUN_ID || auditArtifact.metadata && auditArtifact.metadata.run_id,
      run_attempt: env.GITHUB_RUN_ATTEMPT || auditArtifact.metadata && auditArtifact.metadata.run_attempt,
      operation: auditArtifact.metadata && auditArtifact.metadata.operation,
    },
  });

  let auditPersistenceResult = 'persisted';
  try {
    fs.writeFileSync(artifactPath, toAuditArtifactJson({
      request: updatedArtifact.request,
      validation: updatedArtifact.validation,
      assignment: updatedArtifact.assignment,
      approval: updatedArtifact.approval,
      reconciliationPlan: updatedArtifact.reconciliation,
      executionOutcome: updatedArtifact.execution,
      runContext: updatedArtifact.metadata,
    }), 'utf8');
  } catch (error) {
    auditPersistenceResult = 'failed';
    updatedArtifact.execution.failure_count = (updatedArtifact.execution.failure_count || 0) + 1;
    updatedArtifact.execution.rollback_status = 'manual_remediation_required';
    if (updatedArtifact.request.request_status === 'executed') {
      updatedArtifact.request.request_status = 'partially_executed';
    }
    updatedArtifact.execution.summary = `${updatedArtifact.execution.summary} Audit artifact persistence failed: ${error.message}.`;
  }

  if (isTenantRepoCreation) {
    updatedArtifact.execution.audit_persistence_result = auditPersistenceResult;
  }

  writeGitHubOutput('execution-status', updatedArtifact.request.request_status, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-name', path.basename(artifactPath), env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-retention-days', env.AUDIT_ARTIFACT_RETENTION_DAYS || '', env.GITHUB_OUTPUT);
  emitAuditSummary(updatedArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });
  return updatedArtifact;
}

async function executeTenantVariableManagement(context = {}) {
  const auditArtifact = context.auditArtifact;
  const artifactPath = context.artifactPath;
  const env = context.env || process.env;
  const mutationDecision = context.mutationDecision;
  const options = context.options || {};
  const operation = context.operation || 'tenant_variable_management';
  const shouldSetExitCode = context.shouldSetExitCode === true;

  const teamApi = options.teamApi || createGitHubTeamApi({ token: mutationDecision.tokenInfo.token });
  const orgVariablesApi = options.orgVariablesApi || createGitHubOrgVariablesApi({ token: mutationDecision.tokenInfo.token });

  // Re-validate against live state so a requester who lost tenant top-team
  // maintainership (or a context change) fails closed before any mutation.
  const revalidation = await validateTenantVariablesRequest(auditArtifact.request, {
    getOrganization: ({ organization }) => teamApi.getOrganization({ organization }),
    listTeams: ({ organization }) => teamApi.listOrgTeams({ organization }),
    getMembershipForUser: ({ organization, teamSlug, username }) =>
      teamApi.getMembershipForUser({ organization, teamSlug, username }),
    getOrganizationMembership: ({ organization, username }) =>
      teamApi.getOrganizationMembership({ organization, username }),
    getOrganizationVariable: ({ organization, name }) =>
      orgVariablesApi.getOrganizationVariable({ organization, name }),
    registryRef: env.TENANT_REGISTRY_REF || 'main',
    registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
  });

  auditArtifact.validation = {
    ...auditArtifact.validation,
    ...revalidation,
  };

  const boundaryStatus = revalidation.is_valid ? 'matched' : 'mismatched';
  const planEntries = revalidation.plan && Array.isArray(revalidation.plan.entries)
    ? revalidation.plan.entries
    : [];

  const reconcileOutcome = await reconcileTenantVariables({
    api: orgVariablesApi,
    organization: auditArtifact.request.organization,
    variable_operation: auditArtifact.request.variable_operation,
    entries: planEntries,
    dry_run: false,
    boundary_revalidation_status: boundaryStatus,
  });

  const executionResults = [];
  for (const applied of reconcileOutcome.applied) {
    executionResults.push({
      requested_name: applied.name,
      result_kind: 'organization_variable',
      execution_result: applied.action === 'created'
        ? 'created'
        : applied.action === 'deleted'
          ? 'deleted'
          : 'mutated',
      failure_reason: null,
    });
  }
  for (const entry of reconcileOutcome.skipped) {
    executionResults.push({
      requested_name: entry.name,
      result_kind: 'organization_variable',
      execution_result: 'noop',
      failure_reason: null,
    });
  }
  for (const failure of reconcileOutcome.failed) {
    executionResults.push({
      requested_name: failure.name,
      result_kind: 'organization_variable',
      execution_result: 'failed',
      failure_reason: failure.failure_reason || 'unknown_error',
    });
  }

  const executionOutcome = buildExecutionOutcome({
    executionResults,
    operationLabel: 'variable',
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
    },
    intake_mode: auditArtifact.request && auditArtifact.request.intake_mode,
    approved_context_marker: auditArtifact.approval && auditArtifact.approval.approved_context_marker || null,
    latest_context_marker: auditArtifact.approval && auditArtifact.approval.latest_context_marker || null,
    execution_context_marker: auditArtifact.request && auditArtifact.request.context_marker || null,
    audit_persistence_result: 'pending',
    mutation_token_source: mutationDecision.tokenInfo && mutationDecision.tokenInfo.source || null,
    mutation_token_kind: mutationDecision.tokenInfo && mutationDecision.tokenInfo.token_kind || null,
    mutation_token_is_pat_backed: Boolean(mutationDecision.tokenInfo && mutationDecision.tokenInfo.is_pat_backed),
    artifact_path: artifactPath,
  });

  const requestStatus = deriveApprovedExecutionTerminalState(executionOutcome, {
    operation,
    intakeMode: auditArtifact.request && auditArtifact.request.intake_mode,
    approvalStatus: auditArtifact.approval && auditArtifact.approval.approval_status,
  });
  const isExecutedNoMutationOutcome =
    requestStatus === 'executed' &&
    executionOutcome.mutation_count === 0 &&
    executionOutcome.pending_count === 0 &&
    executionOutcome.failure_count === 0;
  const summaryPrefix = isExecutedNoMutationOutcome
    ? 'Request is already satisfied. Additional approval comments do not trigger a new tenant variable mutation run.'
    : requestStatus === 'executed'
      ? 'Approved tenant variable execution completed.'
      : requestStatus === 'partially_executed'
        ? 'Approved tenant variable execution completed with partial failure.'
        : 'Approved tenant variable execution failed.';

  auditArtifact.request.request_status = requestStatus;
  auditArtifact.reconciliation = {
    ...(auditArtifact.reconciliation || {}),
    state: reconcileOutcome.status,
    dry_run: false,
    boundary_revalidation_status: boundaryStatus,
    variable_operation: auditArtifact.request.variable_operation,
    variable_entries_applied: reconcileOutcome.applied,
    variable_entries_skipped: reconcileOutcome.skipped,
    variable_entries_failed: reconcileOutcome.failed,
  };
  auditArtifact.execution = {
    ...executionOutcome,
    summary: `${summaryPrefix} ${executionOutcome.summary}`,
  };

  const updatedArtifact = buildAuditArtifact({
    request: auditArtifact.request,
    validation: auditArtifact.validation,
    assignment: auditArtifact.assignment,
    approval: auditArtifact.approval,
    reconciliationPlan: auditArtifact.reconciliation,
    executionOutcome: auditArtifact.execution,
    runContext: {
      run_id: env.GITHUB_RUN_ID || auditArtifact.metadata && auditArtifact.metadata.run_id,
      run_attempt: env.GITHUB_RUN_ATTEMPT || auditArtifact.metadata && auditArtifact.metadata.run_attempt,
      operation,
      artifact_name: path.basename(artifactPath),
      artifact_retention_days: env.AUDIT_ARTIFACT_RETENTION_DAYS || '',
    },
  });

  let auditPersistenceResult = 'persisted';
  try {
    fs.writeFileSync(artifactPath, toAuditArtifactJson({
      request: updatedArtifact.request,
      validation: updatedArtifact.validation,
      assignment: updatedArtifact.assignment,
      approval: updatedArtifact.approval,
      reconciliationPlan: updatedArtifact.reconciliation,
      executionOutcome: updatedArtifact.execution,
      runContext: updatedArtifact.metadata,
    }), 'utf8');
  } catch (error) {
    auditPersistenceResult = 'failed';
    updatedArtifact.execution.failure_count = (updatedArtifact.execution.failure_count || 0) + 1;
    updatedArtifact.execution.rollback_status = 'manual_remediation_required';
    updatedArtifact.request.request_status = updatedArtifact.request.request_status === 'executed'
      ? 'partially_executed'
      : 'failed';
    updatedArtifact.execution.summary = `${updatedArtifact.execution.summary} Audit artifact persistence failed: ${error.message}.`;
  }
  updatedArtifact.execution.audit_persistence_result = auditPersistenceResult;

  if (
    updatedArtifact.request &&
    updatedArtifact.request.issue_number != null &&
    typeof teamApi.addIssueLabels === 'function'
  ) {
    const labelPrefix = terminalStateLabelPrefix(operation);
    const targetLabel = `${labelPrefix}${updatedArtifact.request.request_status}`;
    try {
      if (typeof teamApi.listIssueLabels === 'function' && typeof teamApi.removeIssueLabel === 'function') {
        const existingLabels = await teamApi.listIssueLabels({
          repository: updatedArtifact.request.repository,
          issueNumber: updatedArtifact.request.issue_number,
        });
        const managedTerminalLabels = new Set(buildTerminalStateLabels(buildTerminalLabelPrefixes(operation)));
        const staleTerminalLabels = existingLabels
          .filter((label) => managedTerminalLabels.has(label) && label !== targetLabel);
        for (const staleLabel of staleTerminalLabels) {
          await teamApi.removeIssueLabel({
            repository: updatedArtifact.request.repository,
            issueNumber: updatedArtifact.request.issue_number,
            label: staleLabel,
          });
        }
      }
      await teamApi.addIssueLabels({
        repository: updatedArtifact.request.repository,
        issueNumber: updatedArtifact.request.issue_number,
        labels: [targetLabel],
      });
    } catch (labelError) {
      console.warn(`[warn] Failed to add terminal state label: ${labelError.message}`);
    }
  }

  writeGitHubOutput('execution-status', updatedArtifact.request.request_status, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
  emitAuditSummary(updatedArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });

  if (shouldSetExitCode && updatedArtifact.request.request_status !== 'executed') {
    process.exitCode = 1;
  }

  return updatedArtifact;
}

async function executeRepositoryRulesetManagement(context = {}) {
  const auditArtifact = context.auditArtifact;
  const artifactPath = context.artifactPath;
  const env = context.env || process.env;
  const mutationDecision = context.mutationDecision;
  const options = context.options || {};
  const operation = context.operation
    || (auditArtifact.request && auditArtifact.request.ruleset_operation === 'delete'
      ? 'repository_ruleset_deletion'
      : 'repository_ruleset_creation');
  const shouldSetExitCode = context.shouldSetExitCode === true;

  const teamApi = options.teamApi || createGitHubTeamApi({ token: mutationDecision.tokenInfo.token });
  const rulesetsApi = options.rulesetsApi || createGitHubRepoRulesetsApi({ token: mutationDecision.tokenInfo.token });

  // Re-validate against live state so a requester who lost repository-admin
  // credentials (or a row that became unauthorized) fails closed per row before
  // any ruleset mutation.
  const revalidation = await validateRepositoryRulesetRequest(auditArtifact.request, {
    getOrganization: ({ organization }) => teamApi.getOrganization({ organization }),
    getMembershipForUser: ({ organization, teamSlug, username }) =>
      teamApi.getMembershipForUser({ organization, teamSlug, username }),
    getOrganizationMembership: ({ organization, username }) =>
      teamApi.getOrganizationMembership({ organization, username }),
    getRepositoryCollaboratorPermission: ({ owner, repo, username }) =>
      rulesetsApi.getRepositoryCollaboratorPermission({ owner, repo, username }),
    getRepository: ({ owner, repo }) => rulesetsApi.getRepository({ owner, repo }),
    listRepositoryRulesets: ({ owner, repo }) => rulesetsApi.listRepositoryRulesets({ owner, repo }),
    registryRef: env.TENANT_REGISTRY_REF || 'main',
    registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
  });

  auditArtifact.validation = {
    ...auditArtifact.validation,
    ...revalidation,
  };

  const boundaryStatus = revalidation.is_valid ? 'matched' : 'mismatched';
  const plan = revalidation.plan || {};
  const reconcileEntries = Array.isArray(plan.entries) ? plan.entries : [];

  const reconcileOutcome = await reconcileRepositoryRuleset({
    api: rulesetsApi,
    organization: auditArtifact.request.organization,
    ruleset_operation: auditArtifact.request.ruleset_operation,
    entries: reconcileEntries,
    dry_run: false,
    boundary_revalidation_status: boundaryStatus,
  });

  const rowName = (row) => `${row.repository || ''}/${row.ruleset_name || ''}`;
  const executionResults = [];
  for (const applied of reconcileOutcome.applied) {
    executionResults.push({
      requested_name: rowName(applied),
      result_kind: 'repository_ruleset',
      execution_result: applied.action === 'created'
        ? 'created'
        : applied.action === 'deleted'
          ? 'deleted'
          : 'mutated',
      failure_reason: null,
    });
  }
  for (const entry of reconcileOutcome.skipped) {
    executionResults.push({
      requested_name: rowName(entry),
      result_kind: 'repository_ruleset',
      execution_result: 'noop',
      failure_reason: null,
    });
  }
  for (const failure of reconcileOutcome.failed) {
    executionResults.push({
      requested_name: rowName(failure),
      result_kind: 'repository_ruleset',
      execution_result: 'failed',
      failure_reason: failure.failure_reason || 'unknown_error',
    });
  }

  const executionOutcome = buildExecutionOutcome({
    executionResults,
    operationLabel: 'repository_ruleset',
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
    },
    intake_mode: auditArtifact.request && auditArtifact.request.intake_mode,
    approved_context_marker: auditArtifact.approval && auditArtifact.approval.approved_context_marker || null,
    latest_context_marker: auditArtifact.approval && auditArtifact.approval.latest_context_marker || null,
    execution_context_marker: auditArtifact.request && auditArtifact.request.context_marker || null,
    audit_persistence_result: 'pending',
    mutation_token_source: mutationDecision.tokenInfo && mutationDecision.tokenInfo.source || null,
    mutation_token_kind: mutationDecision.tokenInfo && mutationDecision.tokenInfo.token_kind || null,
    mutation_token_is_pat_backed: Boolean(mutationDecision.tokenInfo && mutationDecision.tokenInfo.is_pat_backed),
    artifact_path: artifactPath,
  });

  const requestStatus = deriveApprovedExecutionTerminalState(executionOutcome, {
    operation,
    intakeMode: auditArtifact.request && auditArtifact.request.intake_mode,
    approvalStatus: auditArtifact.approval && auditArtifact.approval.approval_status,
  });
  const isExecutedNoMutationOutcome =
    requestStatus === 'executed' &&
    executionOutcome.mutation_count === 0 &&
    executionOutcome.pending_count === 0 &&
    executionOutcome.failure_count === 0;
  const summaryPrefix = isExecutedNoMutationOutcome
    ? 'Request is already satisfied. Additional approval comments do not trigger a new repository ruleset mutation run.'
    : requestStatus === 'executed'
      ? 'Approved repository ruleset execution completed.'
      : requestStatus === 'partially_executed'
        ? 'Approved repository ruleset execution completed with partial failure.'
        : 'Approved repository ruleset execution failed.';

  auditArtifact.request.request_status = requestStatus;
  auditArtifact.reconciliation = {
    ...(auditArtifact.reconciliation || {}),
    state: reconcileOutcome.status,
    dry_run: false,
    boundary_revalidation_status: boundaryStatus,
    ruleset_operation: auditArtifact.request.ruleset_operation,
    ruleset_entries_applied: reconcileOutcome.applied,
    ruleset_entries_skipped: reconcileOutcome.skipped,
    ruleset_entries_failed: reconcileOutcome.failed,
  };
  auditArtifact.execution = {
    ...executionOutcome,
    summary: `${summaryPrefix} ${executionOutcome.summary}`,
  };

  const updatedArtifact = buildAuditArtifact({
    request: auditArtifact.request,
    validation: auditArtifact.validation,
    assignment: auditArtifact.assignment,
    approval: auditArtifact.approval,
    reconciliationPlan: auditArtifact.reconciliation,
    executionOutcome: auditArtifact.execution,
    runContext: {
      run_id: env.GITHUB_RUN_ID || auditArtifact.metadata && auditArtifact.metadata.run_id,
      run_attempt: env.GITHUB_RUN_ATTEMPT || auditArtifact.metadata && auditArtifact.metadata.run_attempt,
      operation,
      artifact_name: path.basename(artifactPath),
      artifact_retention_days: env.AUDIT_ARTIFACT_RETENTION_DAYS || '',
    },
  });

  let auditPersistenceResult = 'persisted';
  try {
    fs.writeFileSync(artifactPath, toAuditArtifactJson({
      request: updatedArtifact.request,
      validation: updatedArtifact.validation,
      assignment: updatedArtifact.assignment,
      approval: updatedArtifact.approval,
      reconciliationPlan: updatedArtifact.reconciliation,
      executionOutcome: updatedArtifact.execution,
      runContext: updatedArtifact.metadata,
    }), 'utf8');
  } catch (error) {
    auditPersistenceResult = 'failed';
    updatedArtifact.execution.failure_count = (updatedArtifact.execution.failure_count || 0) + 1;
    updatedArtifact.execution.rollback_status = 'manual_remediation_required';
    updatedArtifact.request.request_status = updatedArtifact.request.request_status === 'executed'
      ? 'partially_executed'
      : 'failed';
    updatedArtifact.execution.summary = `${updatedArtifact.execution.summary} Audit artifact persistence failed: ${error.message}.`;
  }
  updatedArtifact.execution.audit_persistence_result = auditPersistenceResult;

  if (
    updatedArtifact.request &&
    updatedArtifact.request.issue_number != null &&
    typeof teamApi.addIssueLabels === 'function'
  ) {
    const labelPrefix = terminalStateLabelPrefix(operation);
    const targetLabel = `${labelPrefix}${updatedArtifact.request.request_status}`;
    try {
      if (typeof teamApi.listIssueLabels === 'function' && typeof teamApi.removeIssueLabel === 'function') {
        const existingLabels = await teamApi.listIssueLabels({
          repository: updatedArtifact.request.repository,
          issueNumber: updatedArtifact.request.issue_number,
        });
        const managedTerminalLabels = new Set(buildTerminalStateLabels(buildTerminalLabelPrefixes(operation)));
        const staleTerminalLabels = existingLabels
          .filter((label) => managedTerminalLabels.has(label) && label !== targetLabel);
        for (const staleLabel of staleTerminalLabels) {
          await teamApi.removeIssueLabel({
            repository: updatedArtifact.request.repository,
            issueNumber: updatedArtifact.request.issue_number,
            label: staleLabel,
          });
        }
      }
      await teamApi.addIssueLabels({
        repository: updatedArtifact.request.repository,
        issueNumber: updatedArtifact.request.issue_number,
        labels: [targetLabel],
      });
    } catch (labelError) {
      console.warn(`[warn] Failed to add terminal state label: ${labelError.message}`);
    }
  }

  writeGitHubOutput('execution-status', updatedArtifact.request.request_status, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
  emitAuditSummary(updatedArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });

  if (shouldSetExitCode && updatedArtifact.request.request_status !== 'executed') {
    process.exitCode = 1;
  }

  return updatedArtifact;
}

// Dedicated batch execution for create-tenant-repos when one issue carries more
// than one repository. Mirrors executeRepositoryRulesetManagement: re-validate
// against live state (per-row fail-closed), reconcile each row idempotently, then
// persist the audit and terminal labels. Single-repository requests continue to
// flow through the legacy generic execution path unchanged.
async function executeTenantRepoCreationBatch(context = {}) {
  const auditArtifact = context.auditArtifact;
  const artifactPath = context.artifactPath;
  const env = context.env || process.env;
  const mutationDecision = context.mutationDecision;
  const options = context.options || {};
  const operation = context.operation || 'tenant_repo_creation';
  const shouldSetExitCode = context.shouldSetExitCode === true;

  const teamApi = options.teamApi || createGitHubTeamApi({ token: mutationDecision.tokenInfo.token });
  const tenantRepoApi = options.createApi
    ? options.createApi({ token: mutationDecision.tokenInfo.token, auditArtifact })
    : (options.tenantRepoApi || createGitHubTeamRepoApi({ token: mutationDecision.tokenInfo.token }));

  // Re-validate the whole batch against live state so a requester who lost the
  // tenant authorization gate (or a row that became invalid) fails closed per row
  // before any repository mutation.
  const revalidation = await validateTenantRepoRequest(auditArtifact.request, {
    getOrganization: ({ organization }) => teamApi.getOrganization({ organization }),
    listTeams: ({ organization }) => teamApi.listOrgTeams({ organization }),
    getMembershipForUser: ({ organization, teamSlug, username }) =>
      teamApi.getMembershipForUser({ organization, teamSlug, username }),
    getOrganizationMembership: ({ organization, username }) =>
      teamApi.getOrganizationMembership({ organization, username }),
    getRepository: ({ owner, repo }) => tenantRepoApi.getRepository({ owner, repo }),
    getTeamRepositoryPermission: ({ organization, teamSlug, owner, repo }) =>
      tenantRepoApi.getTeamRepositoryPermission({ organization, teamSlug, owner, repo }),
    registryRef: env.TENANT_REGISTRY_REF || 'main',
    registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
  });

  auditArtifact.validation = {
    ...auditArtifact.validation,
    ...revalidation,
  };

  const boundaryStatus = revalidation.is_valid ? 'matched' : 'mismatched';
  const reconcileEntries = Array.isArray(revalidation.entries) ? revalidation.entries : [];

  const reconcileOutcome = await reconcileTenantRepoCreationBatch({
    api: tenantRepoApi,
    organization: auditArtifact.request.organization,
    tenantContext: revalidation.canonical_tenant_context || {},
    requester_login: auditArtifact.request.requester_login,
    entries: reconcileEntries,
    dry_run: false,
    boundary_revalidation_status: boundaryStatus,
    registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
  });

  const executionResults = [];
  for (const appliedRow of reconcileOutcome.applied) {
    executionResults.push({
      repository_full_name: `${auditArtifact.request.organization}/${appliedRow.repository}`,
      result_kind: 'repository_creation',
      execution_result: 'created',
      failure_reason: null,
    });
  }
  for (const skippedRow of reconcileOutcome.skipped) {
    executionResults.push({
      repository_full_name: `${auditArtifact.request.organization}/${skippedRow.repository}`,
      result_kind: 'repository_creation',
      execution_result: 'noop',
      failure_reason: null,
    });
  }
  for (const failure of reconcileOutcome.failed) {
    executionResults.push({
      repository_full_name: `${auditArtifact.request.organization}/${failure.repository}`,
      result_kind: 'repository_creation',
      execution_result: 'failed',
      failure_reason: failure.failure_reason || 'unknown_error',
    });
  }

  const executionOutcome = buildExecutionOutcome({
    executionResults,
    operationLabel: 'repository',
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
    },
    intake_mode: auditArtifact.request && auditArtifact.request.intake_mode,
    approved_context_marker: auditArtifact.approval && auditArtifact.approval.approved_context_marker || null,
    latest_context_marker: auditArtifact.approval && auditArtifact.approval.latest_context_marker || null,
    execution_context_marker: auditArtifact.request && auditArtifact.request.context_marker || null,
    audit_persistence_result: 'pending',
    mutation_token_source: mutationDecision.tokenInfo && mutationDecision.tokenInfo.source || null,
    mutation_token_kind: mutationDecision.tokenInfo && mutationDecision.tokenInfo.token_kind || null,
    mutation_token_is_pat_backed: Boolean(mutationDecision.tokenInfo && mutationDecision.tokenInfo.is_pat_backed),
    artifact_path: artifactPath,
  });

  const requestStatus = deriveApprovedExecutionTerminalState(executionOutcome, {
    operation,
    intakeMode: auditArtifact.request && auditArtifact.request.intake_mode,
    approvalStatus: auditArtifact.approval && auditArtifact.approval.approval_status,
  });
  const summaryPrefix = requestStatus === 'executed'
    ? 'Approved tenant repository batch execution completed.'
    : requestStatus === 'partially_executed'
      ? 'Approved tenant repository batch execution completed with partial failure.'
      : 'Approved tenant repository batch execution failed.';

  auditArtifact.request.request_status = requestStatus;
  auditArtifact.reconciliation = {
    ...(auditArtifact.reconciliation || {}),
    state: reconcileOutcome.status,
    dry_run: false,
    boundary_revalidation_status: boundaryStatus,
    repository_entries_applied: reconcileOutcome.applied,
    repository_entries_skipped: reconcileOutcome.skipped,
    repository_entries_failed: reconcileOutcome.failed,
  };
  auditArtifact.execution = {
    ...executionOutcome,
    summary: `${summaryPrefix} ${executionOutcome.summary}`,
  };

  const updatedArtifact = buildAuditArtifact({
    request: auditArtifact.request,
    validation: auditArtifact.validation,
    assignment: auditArtifact.assignment,
    approval: auditArtifact.approval,
    reconciliationPlan: auditArtifact.reconciliation,
    executionOutcome: auditArtifact.execution,
    runContext: {
      run_id: env.GITHUB_RUN_ID || auditArtifact.metadata && auditArtifact.metadata.run_id,
      run_attempt: env.GITHUB_RUN_ATTEMPT || auditArtifact.metadata && auditArtifact.metadata.run_attempt,
      operation,
      artifact_name: path.basename(artifactPath),
      artifact_retention_days: env.AUDIT_ARTIFACT_RETENTION_DAYS || '',
    },
  });

  let auditPersistenceResult = 'persisted';
  try {
    fs.writeFileSync(artifactPath, toAuditArtifactJson({
      request: updatedArtifact.request,
      validation: updatedArtifact.validation,
      assignment: updatedArtifact.assignment,
      approval: updatedArtifact.approval,
      reconciliationPlan: updatedArtifact.reconciliation,
      executionOutcome: updatedArtifact.execution,
      runContext: updatedArtifact.metadata,
    }), 'utf8');
  } catch (error) {
    auditPersistenceResult = 'failed';
    updatedArtifact.execution.failure_count = (updatedArtifact.execution.failure_count || 0) + 1;
    updatedArtifact.execution.rollback_status = 'manual_remediation_required';
    updatedArtifact.request.request_status = updatedArtifact.request.request_status === 'executed'
      ? 'partially_executed'
      : 'failed';
    updatedArtifact.execution.summary = `${updatedArtifact.execution.summary} Audit artifact persistence failed: ${error.message}.`;
  }
  updatedArtifact.execution.audit_persistence_result = auditPersistenceResult;

  if (
    updatedArtifact.request &&
    updatedArtifact.request.issue_number != null &&
    typeof teamApi.addIssueLabels === 'function'
  ) {
    const labelPrefix = terminalStateLabelPrefix(operation);
    const targetLabel = `${labelPrefix}${updatedArtifact.request.request_status}`;
    try {
      if (typeof teamApi.listIssueLabels === 'function' && typeof teamApi.removeIssueLabel === 'function') {
        const existingLabels = await teamApi.listIssueLabels({
          repository: updatedArtifact.request.repository,
          issueNumber: updatedArtifact.request.issue_number,
        });
        const managedTerminalLabels = new Set(buildTerminalStateLabels(buildTerminalLabelPrefixes(operation)));
        const staleTerminalLabels = existingLabels
          .filter((label) => managedTerminalLabels.has(label) && label !== targetLabel);
        for (const staleLabel of staleTerminalLabels) {
          await teamApi.removeIssueLabel({
            repository: updatedArtifact.request.repository,
            issueNumber: updatedArtifact.request.issue_number,
            label: staleLabel,
          });
        }
      }
      await teamApi.addIssueLabels({
        repository: updatedArtifact.request.repository,
        issueNumber: updatedArtifact.request.issue_number,
        labels: [targetLabel],
      });
    } catch (labelError) {
      console.warn(`[warn] Failed to add terminal state label: ${labelError.message}`);
    }
  }

  writeGitHubOutput('execution-status', updatedArtifact.request.request_status, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
  emitAuditSummary(updatedArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });

  if (shouldSetExitCode && updatedArtifact.request.request_status !== 'executed') {
    process.exitCode = 1;
  }

  return updatedArtifact;
}

async function runApprovedExecution(options = {}) {
  const env = options.env || process.env;
  const shouldSetExitCode = options.setProcessExitCode === true;
  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join('artifacts', `add-team-members-validation-${env.ISSUE_NUMBER || 'manual'}.json`)
  );
  const auditArtifact = readAuditArtifact(artifactPath);
  const isTeamRepoAccess = auditArtifact.metadata && auditArtifact.metadata.operation === 'team_repo_access';
  const isTeamRepoAccessRemoval = auditArtifact.metadata && auditArtifact.metadata.operation === 'team_repo_access_removal';
  const isTenantRepoCreation = auditArtifact.metadata && auditArtifact.metadata.operation === 'tenant_repo_creation';
  const isTenantCreation = auditArtifact.metadata && auditArtifact.metadata.operation === 'tenant_creation';
  const isTeamHierarchy = auditArtifact.metadata && auditArtifact.metadata.operation === 'team_hierarchy';
  const isTeamCreation = auditArtifact.metadata && auditArtifact.metadata.operation === 'team_creation';
  const isHostedRunnerCreation = auditArtifact.metadata && auditArtifact.metadata.operation === 'hosted_runner_creation';
  const isHostedRunnerDeletion = auditArtifact.metadata && auditArtifact.metadata.operation === 'hosted_runner_deletion';
  const isHostedRunnerMove = auditArtifact.metadata && auditArtifact.metadata.operation === 'hosted_runner_move';
  const isRunnerGroupCreation = auditArtifact.metadata && auditArtifact.metadata.operation === 'runner_group_creation';
  const isTenantVariableManagement = auditArtifact.metadata && auditArtifact.metadata.operation === 'tenant_variable_management';
  const isRepositoryRulesetCreation = auditArtifact.metadata && auditArtifact.metadata.operation === 'repository_ruleset_creation';
  const isRepositoryRulesetDeletion = auditArtifact.metadata && auditArtifact.metadata.operation === 'repository_ruleset_deletion';
  const isRepositoryRulesetOperation = isRepositoryRulesetCreation || isRepositoryRulesetDeletion;
  const isTenantRunnerOperation = isHostedRunnerCreation || isHostedRunnerDeletion || isHostedRunnerMove || isRunnerGroupCreation;
  const operation = auditArtifact.metadata && auditArtifact.metadata.operation || 'team_membership';

  if (!auditArtifact.validation || auditArtifact.validation.is_valid !== true) {
    writeGitHubOutput('execution-status', 'not_requested', env.GITHUB_OUTPUT);
    emitAuditSummary(auditArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });
    return auditArtifact;
  }

  if (!auditArtifact.approval || auditArtifact.approval.approval_status !== 'approved') {
    writeGitHubOutput('execution-status', auditArtifact.approval && auditArtifact.approval.approval_status || 'pending', env.GITHUB_OUTPUT);
    emitAuditSummary(auditArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });
    return auditArtifact;
  }

  let mutationDecision;
  try {
    mutationDecision = isTenantCreation
      ? (() => {
          const decision = assertTenantBootstrapMembershipAllowed({
            approval_status: auditArtifact.approval.approval_status,
            approver_role: auditArtifact.approval.approver_role,
            requester_login: auditArtifact.request.requester_login,
            dry_run: auditArtifact.request.dry_run,
            tokenInfo: options.tokenInfo,
          });

          if (!decision.tokenInfo || !decision.tokenInfo.is_pat_backed) {
            throw new Error('Tenant bootstrap mutation blocked because the workflow token is not PAT-backed for org mutation');
          }

          return decision;
        })()
      : isTeamCreation
      ? assertTeamCreationAllowed({
          approval_status: auditArtifact.approval.approval_status,
          approver_login: auditArtifact.approval.approver_login,
          intended_owner_login: auditArtifact.request.intended_owner_login,
          dry_run: auditArtifact.request.dry_run,
          tokenInfo: options.tokenInfo,
        })
      : isTeamHierarchy
        ? assertTeamHierarchyAllowed({
            approval_status: auditArtifact.approval.approval_status,
            approver_login: auditArtifact.approval.approver_login,
            designated_approver_login: auditArtifact.request.designated_approver_login,
            approver_authorization_state: auditArtifact.approval.approver_authorization_state,
            dry_run: auditArtifact.request.dry_run,
            tokenInfo: options.tokenInfo,
          })
      : isTeamRepoAccess
        ? assertRepositoryAccessAllowed({
            approval_status: auditArtifact.approval.approval_status,
            approver_login: auditArtifact.approval.approver_login,
            designated_approver_login: auditArtifact.request.designated_approver_login,
            approver_role: auditArtifact.approval.approver_role,
            approver_authorization_state: auditArtifact.approval.approver_authorization_state,
            dry_run: auditArtifact.request.dry_run,
            tokenInfo: options.tokenInfo,
          })
      : isTeamRepoAccessRemoval
        ? assertRepositoryAccessAllowed({
            approval_status: auditArtifact.approval.approval_status,
            approver_login: auditArtifact.approval.approver_login,
            designated_approver_login: auditArtifact.request.designated_approver_login,
            approver_role: auditArtifact.approval.approver_role,
            approver_authorization_state: auditArtifact.approval.approver_authorization_state,
            dry_run: auditArtifact.request.dry_run,
            tokenInfo: options.tokenInfo,
          })
      : isTenantRepoCreation
        ? assertRepositoryCreationAllowed({
            approval_status: auditArtifact.approval.approval_status,
            approver_login: auditArtifact.approval.approver_login,
            designated_approver_login: auditArtifact.request.designated_approver_login,
            approver_role: auditArtifact.approval.approver_role,
            approver_authorization_state: auditArtifact.approval.approver_authorization_state,
            dry_run: auditArtifact.request.dry_run,
            tokenInfo: options.tokenInfo,
          })
      : (isHostedRunnerCreation || isHostedRunnerDeletion || isHostedRunnerMove)
        ? assertHostedRunnerMutationAllowed({
            approval_status: auditArtifact.approval.approval_status,
            approver_login: auditArtifact.approval.approver_login,
            designated_approver_login: auditArtifact.request.designated_approver_login,
            approver_role: auditArtifact.approval.approver_role,
            approver_authorization_state: auditArtifact.approval.approver_authorization_state,
            dry_run: auditArtifact.request.dry_run,
            tokenInfo: options.tokenInfo,
          })
      : isRunnerGroupCreation
        ? assertRunnerGroupCreationAllowed({
            approval_status: auditArtifact.approval.approval_status,
            approver_login: auditArtifact.approval.approver_login,
            designated_approver_login: auditArtifact.request.designated_approver_login,
            approver_role: auditArtifact.approval.approver_role,
            approver_authorization_state: auditArtifact.approval.approver_authorization_state,
            dry_run: auditArtifact.request.dry_run,
            tokenInfo: options.tokenInfo,
          })
      : isTenantVariableManagement
        ? assertTenantVariablesMutationAllowed({
            approval_status: auditArtifact.approval.approval_status,
            approver_login: auditArtifact.approval.approver_login,
            designated_approver_login: auditArtifact.request.designated_approver_login,
            approver_role: auditArtifact.approval.approver_role,
            approver_authorization_state: auditArtifact.approval.approver_authorization_state,
            dry_run: auditArtifact.request.dry_run,
            tokenInfo: options.tokenInfo,
          })
      : isRepositoryRulesetOperation
        ? assertRepositoryRulesetMutationAllowed({
            approval_status: auditArtifact.approval.approval_status,
            approver_login: auditArtifact.approval.approver_login,
            designated_approver_login: auditArtifact.request.designated_approver_login,
            approver_role: auditArtifact.approval.approver_role,
            approver_authorization_state: auditArtifact.approval.approver_authorization_state,
            dry_run: auditArtifact.request.dry_run,
            tokenInfo: options.tokenInfo,
          })
      : assertMutationAllowed({
          approval_status: auditArtifact.approval.approval_status,
          approver_role: auditArtifact.approval.approver_role,
          dry_run: auditArtifact.request.dry_run,
          tokenInfo: options.tokenInfo,
        });
  } catch (error) {
    auditArtifact.request.request_status = 'failed';
    auditArtifact.execution = buildExecutionOutcome({
      executionResults: [],
      operationLabel: isTeamCreation ? 'team' : isTeamHierarchy ? 'child link' : (isTeamRepoAccess || isTeamRepoAccessRemoval || isTenantRepoCreation) ? 'repository' : (isHostedRunnerCreation || isHostedRunnerDeletion || isHostedRunnerMove) ? 'hosted_runner' : isRunnerGroupCreation ? 'runner_group' : isRepositoryRulesetOperation ? 'repository_ruleset' : 'membership',
      runContext: {
        run_id: env.GITHUB_RUN_ID,
        run_attempt: env.GITHUB_RUN_ATTEMPT,
      },
      intake_mode: auditArtifact.request && auditArtifact.request.intake_mode,
      duplicate_row_count: auditArtifact.request && auditArtifact.request.bulk_csv_submission
        ? auditArtifact.request.bulk_csv_submission.duplicate_row_count
        : 0,
      invalid_row_count: auditArtifact.request && auditArtifact.request.bulk_csv_submission
        ? auditArtifact.request.bulk_csv_submission.invalid_row_count
        : 0,
      artifact_path: artifactPath,
    });
    auditArtifact.execution.failure_count = 1;
    auditArtifact.execution.rollback_status = 'manual_follow_up_required';
    auditArtifact.execution.summary = `${error.message}. No ${isTenantCreation ? 'tenant bootstrap mutation' : isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team mutation' : isTenantRepoCreation ? 'tenant repository mutation' : isHostedRunnerCreation ? 'tenant hosted-runner mutation' : isHostedRunnerMove ? 'tenant hosted-runner move' : isHostedRunnerDeletion ? 'tenant hosted-runner deletion' : isRunnerGroupCreation ? 'tenant runner-group mutation' : isTenantVariableManagement ? 'tenant variable mutation' : isRepositoryRulesetOperation ? 'repository ruleset mutation' : (isTeamRepoAccess || isTeamRepoAccessRemoval) ? 'repository-access mutation' : 'membership mutation'} was attempted.`;
    fs.writeFileSync(artifactPath, toAuditArtifactJson({
      request: auditArtifact.request,
      validation: auditArtifact.validation,
      assignment: auditArtifact.assignment,
      approval: auditArtifact.approval,
      reconciliationPlan: auditArtifact.reconciliation,
      executionOutcome: auditArtifact.execution,
      runContext: auditArtifact.metadata,
    }), 'utf8');
    writeGitHubOutput('execution-status', 'failed', env.GITHUB_OUTPUT);
    emitAuditSummary(auditArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });
    if (shouldSetExitCode) {
      process.exitCode = 1;
    }
    return auditArtifact;
  }

  if (!mutationDecision.allowed) {
    auditArtifact.execution.summary = `Approved execution remains blocked because the request is dry-run only. No ${isTenantCreation ? 'tenant bootstrap mutation' : isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team mutation' : isTenantRepoCreation ? 'tenant repository mutation' : isHostedRunnerCreation ? 'tenant hosted-runner mutation' : isHostedRunnerMove ? 'tenant hosted-runner move' : isHostedRunnerDeletion ? 'tenant hosted-runner deletion' : isRunnerGroupCreation ? 'tenant runner-group mutation' : isTenantVariableManagement ? 'tenant variable mutation' : isRepositoryRulesetOperation ? 'repository ruleset mutation' : (isTeamRepoAccess || isTeamRepoAccessRemoval) ? 'repository-access mutation' : 'membership mutation'} was attempted.`;
    auditArtifact.execution.rollback_status = auditArtifact.execution.rollback_status || 'not_needed';
    writeGitHubOutput('execution-status', mutationDecision.reason, env.GITHUB_OUTPUT);
    emitAuditSummary(auditArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });
    return auditArtifact;
  }

  if (isTenantCreation) {
    const tenantBoundaryGuard = validateTenantBoundaryGuardrails(auditArtifact.request || {});
    if (!tenantBoundaryGuard.valid) {
      auditArtifact.request.request_status = 'failed';
      auditArtifact.execution = buildExecutionOutcome({
        executionResults: [],
        operationLabel: 'tenant_bootstrap',
        runContext: {
          run_id: env.GITHUB_RUN_ID,
          run_attempt: env.GITHUB_RUN_ATTEMPT,
        },
        intake_mode: auditArtifact.request && auditArtifact.request.intake_mode,
        duplicate_row_count: 0,
        invalid_row_count: 0,
      });
      auditArtifact.execution.failure_count = 1;
      auditArtifact.execution.rollback_status = 'manual_follow_up_required';
      auditArtifact.execution.summary = `${tenantBoundaryGuard.detail} No tenant bootstrap mutation was attempted.`;

      fs.writeFileSync(artifactPath, toAuditArtifactJson({
        request: auditArtifact.request,
        validation: auditArtifact.validation,
        assignment: auditArtifact.assignment,
        approval: auditArtifact.approval,
        reconciliationPlan: auditArtifact.reconciliation,
        executionOutcome: auditArtifact.execution,
        runContext: auditArtifact.metadata,
      }), 'utf8');
      writeGitHubOutput('execution-status', 'failed', env.GITHUB_OUTPUT);
      emitAuditSummary(auditArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });
      if (shouldSetExitCode) {
        process.exitCode = 1;
      }
      return auditArtifact;
    }
  }

  if (isTenantVariableManagement) {
    return await executeTenantVariableManagement({
      auditArtifact,
      artifactPath,
      env,
      mutationDecision,
      options,
      operation,
      shouldSetExitCode,
    });
  }

  if (isRepositoryRulesetOperation) {
    return await executeRepositoryRulesetManagement({
      auditArtifact,
      artifactPath,
      env,
      mutationDecision,
      options,
      operation,
      shouldSetExitCode,
    });
  }

  // A tenant-repo request that carries more than one repository row runs through
  // the dedicated per-row batch executor. Single-repository requests fall through
  // to the legacy generic execution path below to preserve its exact behavior.
  if (
    isTenantRepoCreation &&
    Array.isArray(auditArtifact.request.repository_entries) &&
    auditArtifact.request.repository_entries.length > 1
  ) {
    return await executeTenantRepoCreationBatch({
      auditArtifact,
      artifactPath,
      env,
      mutationDecision,
      options,
      operation,
      shouldSetExitCode,
    });
  }

  const api = options.createApi
    ? options.createApi({ token: mutationDecision.tokenInfo.token, auditArtifact })
    : (isTeamRepoAccess || isTeamRepoAccessRemoval || isTenantRepoCreation)
      ? createGitHubTeamRepoApi({ token: mutationDecision.tokenInfo.token })
      : createGitHubTeamApi({ token: mutationDecision.tokenInfo.token });
  const teamApi = options.teamApi || createGitHubTeamApi({ token: mutationDecision.tokenInfo.token });
  const runnerApi = isTenantRunnerOperation
    ? (options.runnerApi || createGitHubRunnerApi({ token: mutationDecision.tokenInfo.token }))
    : null;
  let repoAccessValidation = auditArtifact.validation;
  let tenantRepoValidation = auditArtifact.validation;
  let tenantRunnerValidation = auditArtifact.validation;
  let tenantValidationRateLimitSnapshot = null;
  if (
    isTeamRepoAccess &&
    typeof api.getOrganization === 'function' &&
    typeof api.getTeamBySlug === 'function' &&
    typeof api.getRepository === 'function' &&
    typeof api.getTeamRepositoryPermission === 'function' &&
    typeof api.getOrganizationMembership === 'function'
  ) {
    repoAccessValidation = await validateTeamRepoAccessRequest(auditArtifact.request, {
      getOrganization: ({ organization }) => api.getOrganization({ organization }),
      getTeamBySlug: ({ organization, teamSlug }) => api.getTeamBySlug({ organization, teamSlug }),
      getRepository: ({ owner, repo }) => api.getRepository({ owner, repo }),
      getTeamRepositoryPermission: ({ organization, teamSlug, owner, repo }) =>
        api.getTeamRepositoryPermission({ organization, teamSlug, owner, repo }),
      getOrganizationMembership: ({ organization, username }) =>
        api.getOrganizationMembership({ organization, username }),
    });
    auditArtifact.validation = {
      ...auditArtifact.validation,
      ...repoAccessValidation,
    };
  } else if (
    isTeamRepoAccessRemoval &&
    typeof api.getOrganization === 'function' &&
    typeof api.getTeamBySlug === 'function' &&
    typeof api.getRepository === 'function' &&
    typeof api.getTeamRepositoryPermission === 'function' &&
    typeof api.getOrganizationMembership === 'function'
  ) {
    repoAccessValidation = await validateTeamRepoAccessRemovalRequest(auditArtifact.request, {
      getOrganization: ({ organization }) => api.getOrganization({ organization }),
      getTeamBySlug: ({ organization, teamSlug }) => api.getTeamBySlug({ organization, teamSlug }),
      getRepository: ({ owner, repo }) => api.getRepository({ owner, repo }),
      getTeamRepositoryPermission: ({ organization, teamSlug, owner, repo }) =>
        api.getTeamRepositoryPermission({ organization, teamSlug, owner, repo }),
      getOrganizationMembership: ({ organization, username }) =>
        api.getOrganizationMembership({ organization, username }),
    });
    auditArtifact.validation = {
      ...auditArtifact.validation,
      ...repoAccessValidation,
    };
  } else if (
    isTenantRepoCreation &&
    typeof teamApi.getOrganization === 'function' &&
    typeof teamApi.listOrgTeams === 'function' &&
    typeof teamApi.getMembershipForUser === 'function' &&
    typeof teamApi.getOrganizationMembership === 'function' &&
    typeof api.getRepository === 'function' &&
    typeof api.getTeamRepositoryPermission === 'function'
  ) {
    const executeTenantReadWithRetry = async (operation, operationName) => {
      const result = await executeWithBoundedRetry(operation, {
        maxRetries: options.maxRetries || 2,
        sleep: options.sleep,
      });

      tenantValidationRateLimitSnapshot = result.retry_plan && result.retry_plan.rate_limit_snapshot
        ? result.retry_plan.rate_limit_snapshot
        : tenantValidationRateLimitSnapshot;

      if (!result.ok) {
        const rateContext = buildTopologyRegistryReadRateLimitContext(result.error || {}, {
          operation: operationName,
          maxRetries: options.maxRetries || 2,
        });
        tenantValidationRateLimitSnapshot = rateContext.rate_limit_snapshot || tenantValidationRateLimitSnapshot;
        throw Object.assign(result.error || new Error('Tenant topology read failed.'), {
          rate_limit_snapshot: tenantValidationRateLimitSnapshot,
        });
      }

      return result.value;
    };

    tenantRepoValidation = await validateTenantRepoRequest(auditArtifact.request, {
      getOrganization: ({ organization }) => executeTenantReadWithRetry(
        () => teamApi.getOrganization({ organization }),
        'tenant_topology_get_organization'
      ),
      listTeams: ({ organization }) => executeTenantReadWithRetry(
        () => teamApi.listOrgTeams({ organization }),
        'tenant_topology_list_teams'
      ),
      getMembershipForUser: ({ organization, teamSlug, username }) =>
        executeTenantReadWithRetry(
          () => teamApi.getMembershipForUser({ organization, teamSlug, username }),
          'tenant_topology_membership_lookup'
        ),
      getOrganizationMembership: ({ organization, username }) =>
        executeTenantReadWithRetry(
          () => teamApi.getOrganizationMembership({ organization, username }),
          'tenant_topology_org_membership_lookup'
        ),
      getRepository: ({ owner, repo }) => executeTenantReadWithRetry(
        () => api.getRepository({ owner, repo }),
        'tenant_topology_repository_lookup'
      ),
      getTeamRepositoryPermission: ({ organization, teamSlug, owner, repo }) =>
        executeTenantReadWithRetry(
          () => api.getTeamRepositoryPermission({ organization, teamSlug, owner, repo }),
          'tenant_topology_permission_lookup'
        ),
      allowOwnedDuplicateWhenRepositoryExists: true,
      registryRef: env.TENANT_REGISTRY_REF || 'main',
      registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
    });
    auditArtifact.validation = {
      ...auditArtifact.validation,
      ...tenantRepoValidation,
    };
  } else if (
    isTenantRunnerOperation &&
    typeof teamApi.getOrganization === 'function' &&
    typeof teamApi.listOrgTeams === 'function' &&
    typeof teamApi.getMembershipForUser === 'function' &&
    typeof teamApi.getOrganizationMembership === 'function' &&
    runnerApi
  ) {
    const runnerValidationOptions = {
      getOrganization: ({ organization }) => teamApi.getOrganization({ organization }),
      listTeams: ({ organization }) => teamApi.listOrgTeams({ organization }),
      getMembershipForUser: ({ organization, teamSlug, username }) =>
        teamApi.getMembershipForUser({ organization, teamSlug, username }),
      getOrganizationMembership: ({ organization, username }) =>
        teamApi.getOrganizationMembership({ organization, username }),
      registryRef: env.TENANT_REGISTRY_REF || 'main',
      registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
    };

    if (isHostedRunnerCreation) {
      tenantRunnerValidation = await validateHostedRunnerRequest(auditArtifact.request, {
        ...runnerValidationOptions,
        listHostedRunners: ({ organization }) => runnerApi.listHostedRunners({ organization }),
        listRunnerGroups: ({ organization }) => runnerApi.listRunnerGroups({ organization }),
      });
    } else if (isHostedRunnerDeletion) {
      tenantRunnerValidation = await validateHostedRunnerDeletionRequest(auditArtifact.request, {
        ...runnerValidationOptions,
        listHostedRunners: ({ organization }) => runnerApi.listHostedRunners({ organization }),
      });
    } else if (isHostedRunnerMove) {
      tenantRunnerValidation = await validateHostedRunnerMoveRequest(auditArtifact.request, {
        ...runnerValidationOptions,
        listHostedRunners: ({ organization }) => runnerApi.listHostedRunners({ organization }),
        listRunnerGroups: ({ organization }) => runnerApi.listRunnerGroups({ organization }),
      });
    } else {
      tenantRunnerValidation = await validateRunnerGroupRequest(auditArtifact.request, {
        ...runnerValidationOptions,
        listRunnerGroups: ({ organization }) => runnerApi.listRunnerGroups({ organization }),
      });
    }

    auditArtifact.validation = {
      ...auditArtifact.validation,
      ...tenantRunnerValidation,
    };
  }
  const teamReadApi = isTenantRepoCreation ? teamApi : api;
  const currentTeams = (isTenantCreation || isTeamCreation || isTeamHierarchy || isTenantRepoCreation)
    ? await teamReadApi.listOrgTeams({
        organization: auditArtifact.request.organization,
      })
    : null;
  let tenantAdminMembership = null;
  if (
    isTenantCreation &&
    typeof api.getMembershipForUser === 'function' &&
    auditArtifact.request &&
    auditArtifact.request.tenant_team_slug &&
    auditArtifact.request.tenant_admin_login
  ) {
    try {
      assertLiveRevalidationReaders([
        {
          adapter: api,
          adapterLabel: 'teamApi',
          methods: ['getMembershipForUser'],
        },
      ]);
      tenantAdminMembership = await api.getMembershipForUser({
        organization: auditArtifact.request.organization,
        teamSlug: auditArtifact.request.tenant_team_slug,
        username: auditArtifact.request.tenant_admin_login,
      });
    } catch (error) {
      return failPreMutationExecution({
        auditArtifact,
        artifactPath,
        env,
        error,
        operationLabel: 'tenant_bootstrap',
        rateLimitSnapshot:
          tenantValidationRateLimitSnapshot ||
          auditArtifact.reconciliation && auditArtifact.reconciliation.rate_limit_snapshot,
        rateLimitOperation: 'tenant_admin_membership_read',
        maxRetries: options.maxRetries || 2,
        shouldSetExitCode,
        failureMessage: ({ failureReason }) =>
          `Execution stopped before tenant bootstrap mutation because tenant admin membership could not be read safely (${failureReason}). No tenant bootstrap mutation was attempted.`,
      });
    }
  }
  let latestRateLimitSnapshot = tenantValidationRateLimitSnapshot || auditArtifact.reconciliation && auditArtifact.reconciliation.rate_limit_snapshot || null;
  let currentMembers = [];
  if (!isTenantCreation && !isTeamCreation && !isTeamHierarchy && !isTeamRepoAccess && !isTeamRepoAccessRemoval && !isTenantRepoCreation && !isTenantRunnerOperation) {
    const currentMembersResult = await executeWithBoundedRetry(
      () => api.listTeamMembers({
        organization: auditArtifact.request.organization,
        teamSlug: auditArtifact.request.team_slug,
      }),
      {
        maxRetries: options.maxRetries || 2,
        sleep: options.sleep,
      }
    );

    latestRateLimitSnapshot = currentMembersResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

    if (!currentMembersResult.ok) {
      const failureReason = classifyFailureReason(currentMembersResult.error);
      return buildPreMutationFailureArtifact({
        auditArtifact,
        artifactPath,
        env,
        isTenantRepoCreation,
        operationLabel: 'membership',
        rateLimitSnapshot: latestRateLimitSnapshot,
        failureMessage: `Approved execution stopped before membership mutation because the current team state could not be read safely (${failureReason}). Retry the request later or investigate the GitHub API response before resuming.`,
      });
    }

    currentMembers = currentMembersResult.value;
  }
  const reconciliationPlan = isTenantCreation
    ? reconcileTenantCreation({
        request: auditArtifact.request,
        validatedTeams: buildValidatedTeams(auditArtifact),
        currentTeams,
        tenantAdminMembership,
        requesterMembership: tenantAdminMembership,
        organization_exists: auditArtifact.validation.organization_visible,
        dry_run: auditArtifact.request.dry_run,
      })
    : isTenantRepoCreation
    ? reconcileTenantRepoCreation({
        request: tenantRepoValidation.request || auditArtifact.request,
        canonical_tenant_context: tenantRepoValidation.canonical_tenant_context,
        organization_visible: tenantRepoValidation.organization_visible,
        repository_state: tenantRepoValidation.repository_state,
        current_repo_admin_permission: tenantRepoValidation.current_repo_admin_permission,
        duplicate_owned_repository_conflict: tenantRepoValidation.validation_findings && tenantRepoValidation.validation_findings.duplicate_owned_repository_conflict,
        dry_run: auditArtifact.request.dry_run,
        boundary_revalidation_status: tenantRepoValidation && tenantRepoValidation.is_valid ? 'matched' : 'mismatched',
      })
    : isHostedRunnerCreation
    ? reconcileHostedRunnerCreation({
        request: tenantRunnerValidation.request || auditArtifact.request,
        canonical_tenant_context: tenantRunnerValidation.canonical_tenant_context,
        organization_visible: tenantRunnerValidation.organization_visible,
        runner_exists: tenantRunnerValidation.runner_exists,
        existing_runner_id: tenantRunnerValidation.existing_runner_id,
        runner_group_resolution: tenantRunnerValidation.runner_group_resolution,
        dry_run: auditArtifact.request.dry_run,
        boundary_revalidation_status: tenantRunnerValidation && tenantRunnerValidation.is_valid ? 'matched' : 'mismatched',
      })
    : isHostedRunnerDeletion
    ? reconcileHostedRunnerDeletion({
        request: tenantRunnerValidation.request || auditArtifact.request,
        canonical_tenant_context: tenantRunnerValidation.canonical_tenant_context,
        organization_visible: tenantRunnerValidation.organization_visible,
        runner_exists: tenantRunnerValidation.runner_exists,
        existing_runner_id: tenantRunnerValidation.existing_runner_id,
        dry_run: auditArtifact.request.dry_run,
        boundary_revalidation_status: tenantRunnerValidation && tenantRunnerValidation.is_valid ? 'matched' : 'mismatched',
      })
    : isHostedRunnerMove
    ? reconcileHostedRunnerMove({
        request: tenantRunnerValidation.request || auditArtifact.request,
        canonical_tenant_context: tenantRunnerValidation.canonical_tenant_context,
        organization_visible: tenantRunnerValidation.organization_visible,
        runner_exists: tenantRunnerValidation.runner_exists,
        existing_runner_id: tenantRunnerValidation.existing_runner_id,
        current_runner_group_id: tenantRunnerValidation.current_runner_group_id,
        target_runner_group_resolution: tenantRunnerValidation.target_runner_group_resolution,
        runner_already_in_target_group: tenantRunnerValidation.runner_already_in_target_group,
        dry_run: auditArtifact.request.dry_run,
        boundary_revalidation_status: tenantRunnerValidation && tenantRunnerValidation.is_valid ? 'matched' : 'mismatched',
      })
    : isRunnerGroupCreation
    ? reconcileRunnerGroupCreation({
        request: tenantRunnerValidation.request || auditArtifact.request,
        canonical_tenant_context: tenantRunnerValidation.canonical_tenant_context,
        organization_visible: tenantRunnerValidation.organization_visible,
        runner_group_exists: tenantRunnerValidation.runner_group_exists,
        existing_runner_group_id: tenantRunnerValidation.existing_runner_group_id,
        dry_run: auditArtifact.request.dry_run,
        boundary_revalidation_status: tenantRunnerValidation && tenantRunnerValidation.is_valid ? 'matched' : 'mismatched',
      })
    : isTeamCreation
    ? reconcileTeamCreation({
        request: auditArtifact.request,
        validatedTeams: buildValidatedTeams(auditArtifact),
        currentTeams,
        organization_exists: auditArtifact.validation.organization_visible,
        dry_run: auditArtifact.request.dry_run,
      })
    : isTeamHierarchy
      ? reconcileTeamHierarchy({
          request: auditArtifact.request,
          validatedChildLinks: buildValidatedChildLinks(auditArtifact),
          currentTeams,
          organization_exists: auditArtifact.validation.organization_visible,
          parent_team_exists: auditArtifact.validation.parent_team_exists,
          dry_run: auditArtifact.request.dry_run,
        })
    : isTeamRepoAccess
      ? reconcileTeamRepoAccess({
          request: repoAccessValidation.request || auditArtifact.request,
          validatedRepositoryGrants: repoAccessValidation.requested_repository_grants || buildValidatedRepositoryGrants(auditArtifact),
          organization_exists: repoAccessValidation.organization_visible,
          team_exists: repoAccessValidation.team_exists,
          dry_run: auditArtifact.request.dry_run,
        })
      : isTeamRepoAccessRemoval
        ? reconcileTeamRepoAccessRemoval({
            request: repoAccessValidation.request || auditArtifact.request,
            validatedRepositoryRemovals: repoAccessValidation.requested_repository_removals || buildValidatedRepositoryRemovals(auditArtifact),
            organization_exists: repoAccessValidation.organization_visible,
            team_exists: repoAccessValidation.team_exists,
            dry_run: auditArtifact.request.dry_run,
          })
    : reconcileTeamMembers({
        request: auditArtifact.request,
        validatedPeople: buildValidatedPeople(auditArtifact),
        currentMembers,
        team_exists: auditArtifact.validation.team_exists,
        team_sync_blocked: auditArtifact.validation.team_sync_blocked,
        dry_run: auditArtifact.request.dry_run,
      });
  const parentTeam = isTeamHierarchy
    ? currentTeams.find((team) => String(team.slug || '').toLowerCase() === String(auditArtifact.request.parent_team_slug || '').toLowerCase())
    : null;

  const executionResults = [];
  latestRateLimitSnapshot = reconciliationPlan.rate_limit_snapshot || latestRateLimitSnapshot;

  if (isTenantRepoCreation) {
    reconciliationPlan.actual_visibility = reconciliationPlan.actual_visibility || reconciliationPlan.existing_visibility || null;

    if (reconciliationPlan.creation_action === 'noop') {
      reconciliationPlan.actual_visibility = reconciliationPlan.existing_visibility || reconciliationPlan.requested_visibility || reconciliationPlan.actual_visibility;
      executionResults.push({
        repository_full_name: reconciliationPlan.repository_full_name,
        result_kind: 'repository_creation',
        execution_result: 'noop',
        failure_reason: null,
      });
    } else if (reconciliationPlan.creation_action === 'reject') {
      executionResults.push({
        repository_full_name: reconciliationPlan.repository_full_name,
        result_kind: 'repository_creation',
        execution_result: 'failed',
        failure_reason: reconciliationPlan.blocked_reason || 'boundary_revalidation_mismatch',
      });
    }

    if (reconciliationPlan.custom_properties_action === 'noop') {
      executionResults.push({
        repository_full_name: reconciliationPlan.repository_full_name,
        result_kind: 'custom_properties',
        execution_result: 'noop',
        failure_reason: null,
      });
    }

    if (reconciliationPlan.permission_action === 'noop') {
      executionResults.push({
        repository_full_name: reconciliationPlan.repository_full_name,
        result_kind: 'repo_admin_grant',
        execution_result: 'noop',
        failure_reason: null,
      });
    }
  } else if (isHostedRunnerCreation || isHostedRunnerDeletion || isHostedRunnerMove) {
    const plannedAction = isHostedRunnerCreation
      ? reconciliationPlan.creation_action
      : isHostedRunnerMove
        ? reconciliationPlan.move_action
        : reconciliationPlan.deletion_action;
    if (plannedAction === 'noop') {
      executionResults.push({
        runner_name: reconciliationPlan.runner_name_derived,
        execution_result: 'noop',
        failure_reason: null,
      });
    } else if (plannedAction === 'reject') {
      executionResults.push({
        runner_name: reconciliationPlan.runner_name_derived,
        execution_result: 'failed',
        failure_reason: reconciliationPlan.blocked_reason || 'boundary_revalidation_mismatch',
      });
    }
  } else if (isRunnerGroupCreation) {
    if (reconciliationPlan.creation_action === 'noop') {
      executionResults.push({
        runner_group_name: reconciliationPlan.runner_group_name_derived,
        execution_result: 'noop',
        failure_reason: null,
      });
    } else if (reconciliationPlan.creation_action === 'reject') {
      executionResults.push({
        runner_group_name: reconciliationPlan.runner_group_name_derived,
        execution_result: 'failed',
        failure_reason: reconciliationPlan.blocked_reason || 'boundary_revalidation_mismatch',
      });
    }
  } else if (isTenantCreation || isTeamCreation) {
    for (const team of reconciliationPlan.teams_already_present) {
      executionResults.push({
        normalized_slug: team.normalized_slug,
        requested_name: team.requested_name,
        source_row_number: team.source_row_number || null,
        source_comment_id: team.source_comment_id || null,
        current_team_id: team.current_team_id || null,
        execution_result: 'noop',
        failure_reason: null,
      });
    }

    for (const team of reconciliationPlan.teams_rejected) {
      executionResults.push({
        normalized_slug: team.normalized_slug,
        requested_name: team.requested_name,
        source_row_number: team.source_row_number || null,
        source_comment_id: team.source_comment_id || null,
        execution_result: 'failed',
        failure_reason: team.failure_reason || 'rejected',
      });
    }
  } else if (isTeamHierarchy) {
    for (const childLink of reconciliationPlan.child_links_already_present) {
      executionResults.push({
        team_slug: childLink.child_team_slug,
        requested_name: childLink.requested_name || childLink.requested_child_name,
        source_row_number: childLink.source_row_number || null,
        source_comment_id: childLink.source_comment_id || null,
        execution_result: 'noop',
        failure_reason: null,
      });
    }

    for (const childLink of reconciliationPlan.child_links_rejected) {
      executionResults.push({
        team_slug: childLink.child_team_slug,
        requested_name: childLink.requested_name || childLink.requested_child_name,
        source_row_number: childLink.source_row_number || null,
        source_comment_id: childLink.source_comment_id || null,
        execution_result: 'failed',
        failure_reason: childLink.failure_reason || 'rejected',
      });
    }
  } else if (isTeamRepoAccess) {
    for (const repository of reconciliationPlan.repositories_already_satisfied) {
      executionResults.push({
        repository_full_name: repository.repository_full_name,
        source_row_number: repository.source_row_number || null,
        execution_result: 'noop',
        failure_reason: null,
      });
    }

    for (const repository of reconciliationPlan.repositories_rejected) {
      executionResults.push({
        repository_full_name: repository.repository_full_name,
        source_row_number: repository.source_row_number || null,
        execution_result: 'rejected',
        failure_reason: repository.failure_reason || 'rejected',
      });
    }
  } else if (isTeamRepoAccessRemoval) {
    for (const repository of reconciliationPlan.already_absent_noops) {
      executionResults.push({
        repository_full_name: repository.repository_full_name,
        source_row_number: repository.source_row_number || null,
        execution_result: 'noop',
        failure_reason: null,
      });
    }

    for (const repository of reconciliationPlan.rejected_items) {
      executionResults.push({
        repository_full_name: repository.repository_full_name,
        source_row_number: repository.source_row_number || null,
        execution_result: 'rejected',
        failure_reason: repository.failure_reason || 'rejected',
      });
    }
  } else {
    for (const person of reconciliationPlan.people_already_present) {
      executionResults.push({
        username: person.username,
        source_row_number: person.source_row_number || null,
        source_comment_id: person.source_comment_id || null,
        execution_result: 'noop',
        failure_reason: null,
      });
    }

    for (const person of reconciliationPlan.people_rejected) {
      executionResults.push({
        username: person.username,
        source_row_number: person.source_row_number || null,
        source_comment_id: person.source_comment_id || null,
        execution_result: 'failed',
        failure_reason: person.failure_reason || 'rejected',
      });
    }
  }

  if (!auditArtifact.request.dry_run) {
    if (isTenantRepoCreation) {
      if (reconciliationPlan.boundary_revalidation_status !== 'matched') {
        executionResults.push({
          repository_full_name: reconciliationPlan.repository_full_name,
          execution_result: 'failed',
          failure_reason: 'boundary_mismatch',
        });
      } else {
        const repoOwner = auditArtifact.request.organization;
        const repoName = auditArtifact.request.repository_name_normalized;

        if (reconciliationPlan.creation_action === 'create_repository') {
          const attemptResult = await executeWithBoundedRetry(
            () => api.createOrganizationRepository({
              organization: repoOwner,
              name: repoName,
              visibility: reconciliationPlan.desired_repository_visibility || auditArtifact.request.repository_visibility || 'private',
              description: `Tenant-scoped repository for ${auditArtifact.request.tenant_display_name || auditArtifact.request.tenant_name_input || auditArtifact.request.tenant_key || 'tenant'}`,
            }),
            {
              maxRetries: options.maxRetries || 2,
              sleep: options.sleep,
            }
          );

          latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

          if (attemptResult.ok) {
            reconciliationPlan.actual_visibility = attemptResult.value && attemptResult.value.repository && attemptResult.value.repository.visibility
              ? String(attemptResult.value.repository.visibility).toLowerCase()
              : reconciliationPlan.desired_repository_visibility || auditArtifact.request.repository_visibility || 'private';
          }

          executionResults.push({
            repository_full_name: reconciliationPlan.repository_full_name,
            result_kind: 'repository_creation',
            execution_result: attemptResult.ok ? 'created' : 'failed',
            failure_reason: attemptResult.ok ? null : classifyFailureReason(attemptResult.error),
          });
        } else if (reconciliationPlan.creation_action === 'noop') {
          reconciliationPlan.actual_visibility = reconciliationPlan.existing_visibility || reconciliationPlan.requested_visibility || reconciliationPlan.actual_visibility;
          executionResults.push({
            repository_full_name: reconciliationPlan.repository_full_name,
            result_kind: 'repository_creation',
            execution_result: 'noop',
            failure_reason: null,
          });
        } else if (reconciliationPlan.creation_action === 'reject') {
          reconciliationPlan.actual_visibility = reconciliationPlan.existing_visibility || reconciliationPlan.actual_visibility;
          executionResults.push({
            repository_full_name: reconciliationPlan.repository_full_name,
            result_kind: 'repository_creation',
            execution_result: 'failed',
            failure_reason: reconciliationPlan.blocked_reason || 'creation_rejected',
          });
        }

        const creationFailed = executionResults.some((result) =>
          result.repository_full_name === reconciliationPlan.repository_full_name &&
          result.result_kind === 'repository_creation' &&
          result.execution_result === 'failed' &&
          result.failure_reason !== 'permission_rejected'
        );

        if (reconciliationPlan.custom_properties_action === 'set') {
          if (creationFailed) {
            console.log(`[tenant_repo_creation] Skipping repository custom properties because repository creation failed for ${reconciliationPlan.repository_full_name}.`);
            executionResults.push({
              repository_full_name: reconciliationPlan.repository_full_name,
              result_kind: 'custom_properties',
              execution_result: 'failed',
              failure_reason: 'repository_creation_failed',
            });
          } else if (typeof api.setRepositoryCustomProperties !== 'function') {
            console.log(`[tenant_repo_creation] Repository API adapter does not expose setRepositoryCustomProperties; recording noop for ${reconciliationPlan.repository_full_name}.`);
            executionResults.push({
              repository_full_name: reconciliationPlan.repository_full_name,
              result_kind: 'custom_properties',
              execution_result: 'noop',
              failure_reason: null,
            });
          } else {
            const schemaEnsureResult = await ensureTenantRepoCustomPropertyDefinitions({
              api,
              organization: repoOwner,
              properties: reconciliationPlan.desired_repository_custom_properties || [],
              executeWithRetry: executeWithBoundedRetry,
              maxRetries: options.maxRetries || 2,
              sleep: options.sleep,
            });
            latestRateLimitSnapshot = schemaEnsureResult.rate_limit_snapshot || latestRateLimitSnapshot;

            if (!schemaEnsureResult.ok) {
              const firstFailure = schemaEnsureResult.failed && schemaEnsureResult.failed.length > 0
                ? schemaEnsureResult.failed[0]
                : null;
              executionResults.push({
                repository_full_name: reconciliationPlan.repository_full_name,
                result_kind: 'custom_properties',
                execution_result: 'failed',
                failure_reason: firstFailure && firstFailure.failure_reason ? firstFailure.failure_reason : 'custom_property_schema_failed',
                status_code: firstFailure && firstFailure.status_code != null ? firstFailure.status_code : null,
                detail: firstFailure && firstFailure.detail ? firstFailure.detail : 'Failed to ensure required organization custom property definitions.',
              });
            } else {
              const desiredPropertyCount = Array.isArray(reconciliationPlan.desired_repository_custom_properties)
                ? reconciliationPlan.desired_repository_custom_properties.length
                : 0;
              console.log(`[tenant_repo_creation] Applying ${desiredPropertyCount} repository custom properties to ${repoOwner}/${repoName}.`);
              const attemptResult = await executeWithBoundedRetry(
                () => api.setRepositoryCustomProperties({
                  owner: repoOwner,
                  repo: repoName,
                  properties: reconciliationPlan.desired_repository_custom_properties || [],
                }),
                {
                  maxRetries: options.maxRetries || 2,
                  sleep: options.sleep,
                }
              );

              latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

              if (attemptResult.ok) {
                console.log(`[tenant_repo_creation] Repository custom properties updated for ${repoOwner}/${repoName}.`);
              } else {
                const statusCode = attemptResult.error && attemptResult.error.status ? attemptResult.error.status : 'unknown';
                const message = attemptResult.error && attemptResult.error.payload && attemptResult.error.payload.message
                  ? attemptResult.error.payload.message
                  : attemptResult.error && attemptResult.error.message
                    ? attemptResult.error.message
                    : 'unknown error';
                console.log(`[tenant_repo_creation] Repository custom properties update failed for ${repoOwner}/${repoName} (status=${statusCode}): ${message}`);
              }

              executionResults.push({
                repository_full_name: reconciliationPlan.repository_full_name,
                result_kind: 'custom_properties',
                execution_result: attemptResult.ok ? 'mutated' : 'failed',
                failure_reason: attemptResult.ok ? null : classifyFailureReason(attemptResult.error),
                status_code: attemptResult.ok ? null : (attemptResult.error && attemptResult.error.status ? attemptResult.error.status : null),
                detail: attemptResult.ok
                  ? null
                  : (
                    attemptResult.error && attemptResult.error.payload && attemptResult.error.payload.message
                      ? attemptResult.error.payload.message
                      : attemptResult.error && attemptResult.error.message
                        ? attemptResult.error.message
                        : null
                  ),
              });
            }
          }
        } else if (reconciliationPlan.custom_properties_action === 'reject') {
          executionResults.push({
            repository_full_name: reconciliationPlan.repository_full_name,
            result_kind: 'custom_properties',
            execution_result: 'failed',
            failure_reason: reconciliationPlan.blocked_reason || 'custom_properties_rejected',
          });
        }

        if (!creationFailed && reconciliationPlan.permission_action === 'grant_admin') {
          let permissionPolicyAllowed = true;
          try {
            assertRepoAdminTeamPermissionAllowed({
              approval_status: auditArtifact.approval.approval_status,
              approver_role: auditArtifact.approval.approver_role,
              approver_authorization_state: auditArtifact.approval.approver_authorization_state,
              dry_run: auditArtifact.request.dry_run,
              repo_admin_team_slug: auditArtifact.request.repo_admin_team_slug,
              tokenInfo: mutationDecision.tokenInfo,
            });
          } catch (error) {
            permissionPolicyAllowed = false;
            executionResults.push({
              repository_full_name: reconciliationPlan.repository_full_name,
              result_kind: 'repo_admin_grant',
              execution_result: 'failed',
              failure_reason: 'permission_policy_blocked',
              detail: error.message,
            });
          }

          if (permissionPolicyAllowed) {
            const attemptResult = await executeWithBoundedRetry(
              () => api.addOrUpdateTeamRepositoryPermission({
                organization: repoOwner,
                teamSlug: auditArtifact.request.repo_admin_team_slug,
                owner: repoOwner,
                repo: repoName,
                permission: 'admin',
              }),
              {
                maxRetries: options.maxRetries || 2,
                sleep: options.sleep,
              }
            );

            latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

            executionResults.push({
              repository_full_name: reconciliationPlan.repository_full_name,
              result_kind: 'repo_admin_grant',
              execution_result: attemptResult.ok ? 'granted' : 'failed',
              failure_reason: attemptResult.ok ? null : classifyFailureReason(attemptResult.error),
            });
          }
        } else if (reconciliationPlan.permission_action === 'noop') {
          executionResults.push({
            repository_full_name: reconciliationPlan.repository_full_name,
            result_kind: 'repo_admin_grant',
            execution_result: 'noop',
            failure_reason: null,
          });
        } else if (reconciliationPlan.permission_action === 'reject') {
          executionResults.push({
            repository_full_name: reconciliationPlan.repository_full_name,
            result_kind: 'repo_admin_grant',
            execution_result: 'failed',
            failure_reason: reconciliationPlan.blocked_reason || 'permission_rejected',
          });
        }

        const mutationFailed = executionResults.some((result) =>
          result.repository_full_name === reconciliationPlan.repository_full_name &&
          result.execution_result === 'failed'
        );

        if (!mutationFailed && reconciliationPlan.owned_topology_action === 'append_owned_entry') {
          const persistOwnedTopology = typeof options.persistOwnedTopology === 'function'
            ? options.persistOwnedTopology
            : (persistenceInput) => persistOwnedRepositoryEntry({
              request: persistenceInput.request,
              tenantContext: persistenceInput.tenant_context,
              ownedEntry: persistenceInput.owned_entry_candidate,
              registryDirectory: persistenceInput.registry_directory,
            });

          if (typeof persistOwnedTopology === 'function') {
            const persistenceResult = await executeWithBoundedRetry(
              () => persistOwnedTopology({
                request: tenantRepoValidation.request || auditArtifact.request,
                tenant_context: tenantRepoValidation.canonical_tenant_context,
                owned_entry_candidate: reconciliationPlan.owned_entry_candidate,
                topology_mode: reconciliationPlan.topology_mode,
                registry_directory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
                registry_ref: env.TENANT_REGISTRY_REF || 'main',
              }),
              {
                maxRetries: options.maxRetries || 2,
                sleep: options.sleep,
              }
            );

            latestRateLimitSnapshot = persistenceResult.retry_plan && persistenceResult.retry_plan.rate_limit_snapshot
              ? persistenceResult.retry_plan.rate_limit_snapshot
              : latestRateLimitSnapshot;

            if (persistenceResult.ok) {
              reconciliationPlan.topology_persistence_result = persistenceResult.value || { status: 'appended' };

              const appendedRegistryPath = reconciliationPlan.topology_persistence_result && reconciliationPlan.topology_persistence_result.registry_path
                ? reconciliationPlan.topology_persistence_result.registry_path
                : null;
              const shouldCommitOwnedTopology =
                options.commitOwnedTopology === true ||
                (options.commitOwnedTopology !== false && String(env.GITHUB_ACTIONS || '').toLowerCase() === 'true');

              if (
                shouldCommitOwnedTopology &&
                appendedRegistryPath &&
                reconciliationPlan.topology_persistence_result.status === 'appended'
              ) {
                const commitResult = commitRegistryRecord({
                  registryFilePath: appendedRegistryPath,
                  tenantKey:
                    auditArtifact.request.tenant_key ||
                    tenantRepoValidation && tenantRepoValidation.canonical_tenant_context && (tenantRepoValidation.canonical_tenant_context.tenant_key || tenantRepoValidation.canonical_tenant_context.tenant_id) ||
                    'tenant',
                  issueNumber: auditArtifact.request.issue_number,
                  repoRoot: process.cwd(),
                }, {
                  env,
                });

                reconciliationPlan.topology_persistence_result.commit_result = commitResult;

                if (commitResult.status === 'failed') {
                  reconciliationPlan.topology_persistence_result = {
                    ...reconciliationPlan.topology_persistence_result,
                    status: 'failed',
                    failure_reason: 'owned_topology_commit_failed',
                    detail: commitResult.message || 'Failed to commit owned topology changes to repository.',
                  };

                  executionResults.push({
                    repository_full_name: reconciliationPlan.repository_full_name,
                    execution_result: 'failed',
                    failure_reason: 'owned_topology_commit_failed',
                    execution_stage: 'topology_persistence',
                  });
                }
              }
            } else {
              const persistenceRateContext = buildOwnedTopologyPersistenceRateLimitContext(
                persistenceResult.error || {},
                {
                  operation: 'tenant_owned_topology_persistence',
                  maxRetries: options.maxRetries || 2,
                }
              );
              latestRateLimitSnapshot = persistenceRateContext.rate_limit_snapshot || latestRateLimitSnapshot;
              reconciliationPlan.topology_persistence_result = {
                status: 'failed',
                failure_reason: classifyFailureReason(persistenceResult.error),
                detail: persistenceResult.error && persistenceResult.error.message
                  ? persistenceResult.error.message
                  : 'owned_topology_persistence_failed',
              };
              executionResults.push({
                repository_full_name: reconciliationPlan.repository_full_name,
                execution_result: 'failed',
                failure_reason: 'owned_topology_persistence_failed',
                execution_stage: 'topology_persistence',
              });
            }
          } else {
            reconciliationPlan.topology_persistence_result = {
              status: 'pending_implementation',
              detail: 'owned topology persistence hook is not configured',
            };
          }
        } else if (reconciliationPlan.owned_topology_action === 'noop_already_owned') {
          reconciliationPlan.topology_persistence_result = { status: 'noop' };
        } else if (reconciliationPlan.owned_topology_action === 'blocked_duplicate') {
          reconciliationPlan.topology_persistence_result = { status: 'duplicate_blocked' };
        }
      }
    } else if (isHostedRunnerCreation) {
      // Boundary mismatch and other blockers surface as creation_action 'reject',
      // which the pre-mutation block has already recorded as a failed result.
      if (reconciliationPlan.creation_action === 'create_hosted_runner') {
        const runnerGroupResolution = reconciliationPlan.runner_group_resolution || {};
        const attemptResult = await executeWithBoundedRetry(
          () => runnerApi.createHostedRunner({
            organization: auditArtifact.request.organization,
            name: reconciliationPlan.runner_name_derived,
            imageId: auditArtifact.request.runner_image_id,
            imageSource: auditArtifact.request.runner_image_source || 'github',
            size: auditArtifact.request.runner_size,
            runnerGroupId: runnerGroupResolution.resolved_group_id,
            maximumRunners: auditArtifact.request.maximum_runners,
          }),
          {
            maxRetries: options.maxRetries || 2,
            sleep: options.sleep,
          }
        );

        latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

        if (attemptResult.ok) {
          reconciliationPlan.created_runner_id = attemptResult.value && attemptResult.value.id || null;
          reconciliationPlan.created_runner_status = attemptResult.value && attemptResult.value.status || '';
        }

        executionResults.push({
          runner_name: reconciliationPlan.runner_name_derived,
          created_runner_id: attemptResult.ok ? attemptResult.value && attemptResult.value.id || null : null,
          execution_result: attemptResult.ok ? 'created' : 'failed',
          failure_reason: attemptResult.ok ? null : classifyFailureReason(attemptResult.error),
        });
      }
    } else if (isHostedRunnerDeletion) {
      // Boundary mismatch and other blockers surface as deletion_action 'reject',
      // which the pre-mutation block has already recorded as a failed result.
      if (reconciliationPlan.deletion_action === 'delete_hosted_runner') {
        const attemptResult = await executeWithBoundedRetry(
          () => runnerApi.deleteHostedRunner({
            organization: auditArtifact.request.organization,
            hostedRunnerId: reconciliationPlan.existing_runner_id,
          }),
          {
            maxRetries: options.maxRetries || 2,
            sleep: options.sleep,
          }
        );

        latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

        const deletedAsNoop = attemptResult.ok && attemptResult.value && attemptResult.value.not_found;
        executionResults.push({
          runner_name: reconciliationPlan.runner_name_derived,
          execution_result: attemptResult.ok ? (deletedAsNoop ? 'noop' : 'deleted') : 'failed',
          failure_reason: attemptResult.ok ? null : classifyFailureReason(attemptResult.error),
        });
      }
    } else if (isHostedRunnerMove) {
      if (reconciliationPlan.move_action === 'move_hosted_runner') {
        const attemptResult = await executeWithBoundedRetry(
          () => runnerApi.updateHostedRunner({
            organization: auditArtifact.request.organization,
            hostedRunnerId: reconciliationPlan.existing_runner_id,
            runnerGroupId: reconciliationPlan.target_runner_group_id,
          }),
          {
            maxRetries: options.maxRetries || 2,
            sleep: options.sleep,
          }
        );

        latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

        executionResults.push({
          runner_name: reconciliationPlan.runner_name_derived,
          hosted_runner_id: reconciliationPlan.existing_runner_id,
          runner_group_id: reconciliationPlan.target_runner_group_id,
          execution_result: attemptResult.ok ? 'moved' : 'failed',
          failure_reason: attemptResult.ok ? null : classifyFailureReason(attemptResult.error),
        });
      }
    } else if (isRunnerGroupCreation) {
      // Boundary mismatch and other blockers surface as creation_action 'reject',
      // which the pre-mutation block has already recorded as a failed result.
      if (reconciliationPlan.creation_action === 'create_runner_group') {
        const attemptResult = await executeWithBoundedRetry(
          () => runnerApi.createRunnerGroup({
            organization: auditArtifact.request.organization,
            name: reconciliationPlan.runner_group_name_derived,
            visibility: auditArtifact.request.runner_group_visibility || 'selected',
            allowsPublicRepositories: auditArtifact.request.allows_public_repositories,
          }),
          {
            maxRetries: options.maxRetries || 2,
            sleep: options.sleep,
          }
        );

        latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

        if (attemptResult.ok) {
          reconciliationPlan.created_runner_group_id = attemptResult.value && attemptResult.value.id || null;
        }

        executionResults.push({
          runner_group_name: reconciliationPlan.runner_group_name_derived,
          created_runner_group_id: attemptResult.ok ? attemptResult.value && attemptResult.value.id || null : null,
          execution_result: attemptResult.ok ? 'created' : 'failed',
          failure_reason: attemptResult.ok ? null : classifyFailureReason(attemptResult.error),
        });
      }
    } else if (isTenantCreation || isTeamCreation) {
      for (const team of reconciliationPlan.teams_to_create) {
        const attemptResult = await executeWithBoundedRetry(
          () => api.createTeam({
            organization: auditArtifact.request.organization,
            name: team.requested_name,
          }),
          {
            maxRetries: options.maxRetries || 2,
            sleep: options.sleep,
          }
        );

        latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

        if (attemptResult.ok) {
          executionResults.push({
            normalized_slug: team.normalized_slug,
            requested_name: team.requested_name,
            source_row_number: team.source_row_number || null,
            source_comment_id: team.source_comment_id || null,
            created_team_id: attemptResult.value && attemptResult.value.id || null,
            execution_result: 'created',
            failure_reason: null,
          });
          continue;
        }

        executionResults.push({
          normalized_slug: team.normalized_slug,
          requested_name: team.requested_name,
          source_row_number: team.source_row_number || null,
          source_comment_id: team.source_comment_id || null,
          execution_result: 'failed',
          failure_reason: classifyFailureReason(attemptResult.error),
        });
      }

      if (isTenantCreation) {
        const refreshedTeamsResult = await executeWithBoundedRetry(
          () => api.listOrgTeams({ organization: auditArtifact.request.organization }),
          {
            maxRetries: options.maxRetries || 2,
            sleep: options.sleep,
          }
        );

        latestRateLimitSnapshot = refreshedTeamsResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;
        const refreshedTeams = refreshedTeamsResult.ok ? refreshedTeamsResult.value : currentTeams;
        const parentTeam = (refreshedTeams || []).find((team) => String(team.slug || '').toLowerCase() === String(auditArtifact.request.tenant_team_slug || '').toLowerCase());
        const requestedChildLinks = Array.isArray(auditArtifact.request.requested_child_links)
          ? auditArtifact.request.requested_child_links
          : [];
        const desiredOrganizationRoles = buildTenantOrganizationRolePlan(auditArtifact.request || {});

        reconciliationPlan.organization_roles_to_create = [];
        reconciliationPlan.organization_roles_already_present = [];
        reconciliationPlan.organization_roles_failed = [];
        reconciliationPlan.organization_roles_skipped = [];

        if (desiredOrganizationRoles.length > 0) {
          const cicdDecision = reconciliationPlan.cicd_capability_decision || {};
          const cicdIntent = auditArtifact.request && auditArtifact.request.cicd_capability_intent
            ? auditArtifact.request.cicd_capability_intent
            : {};
          const fallbackAllowed = Boolean(
            (cicdIntent.fallback_path_available || cicdIntent.fallbackPathAvailable) &&
            (cicdIntent.fallback_policy_approved || cicdIntent.fallbackPolicyApproved) &&
            (cicdIntent.tenant_scope_resolvable || cicdIntent.tenantScopeResolvable)
          );

          if (cicdDecision.status === 'blocked' || cicdDecision.status === 'unavailable' || cicdDecision.status === 'skipped') {
            const reasonCode = cicdDecision.reason_code || 'capability_unavailable';
            const skipReason = `cicd_capability_${cicdDecision.status}_${reasonCode}`;
            for (const rolePlan of desiredOrganizationRoles) {
              executionResults.push({
                role_name: rolePlan.role_name,
                requested_name: rolePlan.role_name,
                execution_result: 'noop',
                failure_reason: null,
              });
              reconciliationPlan.organization_roles_skipped.push({
                ...rolePlan,
                skip_reason: skipReason,
              });
            }
          } else {
            const roleApiProviders = [];
            const selectedPath = String(cicdDecision.selected_path || 'primary').toLowerCase();
            const includePrimary = selectedPath === 'primary' || selectedPath === 'none';
            const includeFallback = selectedPath === 'fallback';

            if (includePrimary && typeof api.listOrganizationRoles === 'function') {
              roleApiProviders.push({
                kind: 'organization_role',
                list: () => api.listOrganizationRoles({ organization: auditArtifact.request.organization }),
                create: typeof api.createOrganizationRole === 'function'
                  ? (rolePlan) => api.createOrganizationRole({
                    organization: auditArtifact.request.organization,
                    name: rolePlan.role_name,
                    description: rolePlan.permission_intent || undefined,
                  })
                  : null,
              });
            }

            if (includeFallback && typeof api.listCustomRepositoryRoles === 'function') {
              roleApiProviders.push({
                kind: 'custom_repository_role',
                list: () => api.listCustomRepositoryRoles({ organization: auditArtifact.request.organization }),
                create: typeof api.createCustomRepositoryRole === 'function'
                  ? (rolePlan) => api.createCustomRepositoryRole({
                    organization: auditArtifact.request.organization,
                    name: rolePlan.role_name,
                    description: rolePlan.permission_intent || undefined,
                    base_role: rolePlan.repository_base_role,
                    permissions: rolePlan.repository_permissions,
                  })
                  : null,
              });
            }

            if (selectedPath === 'primary' && fallbackAllowed && typeof api.listCustomRepositoryRoles === 'function') {
              roleApiProviders.push({
                kind: 'custom_repository_role',
                list: () => api.listCustomRepositoryRoles({ organization: auditArtifact.request.organization }),
                create: typeof api.createCustomRepositoryRole === 'function'
                  ? (rolePlan) => api.createCustomRepositoryRole({
                    organization: auditArtifact.request.organization,
                    name: rolePlan.role_name,
                    description: rolePlan.permission_intent || undefined,
                    base_role: rolePlan.repository_base_role,
                    permissions: rolePlan.repository_permissions,
                  })
                  : null,
              });
            }

            let selectedProvider = null;
            let existingRoleByName = null;
            let lastRoleApiError = null;
            for (const provider of roleApiProviders) {
              const existingRolesResult = await executeCapabilityOperationWithRetry(provider.list, {
                maxRetries: options.maxRetries || 2,
                sleep: options.sleep,
              });

              latestRateLimitSnapshot = existingRolesResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

              if (existingRolesResult.ok) {
                selectedProvider = provider;
                existingRoleByName = new Map(
                  (existingRolesResult.value || [])
                    .filter((entry) => entry && entry.name)
                    .map((entry) => [normalizeRoleMapKey(entry.name), entry])
                );
                break;
              }

              lastRoleApiError = existingRolesResult.error;
            }

            if (!selectedProvider) {
              const failureReason = lastRoleApiError
                ? classifyFailureReason(lastRoleApiError)
                : 'api_unsupported';
              const skipReason = lastRoleApiError
                ? `organization_role_provisioning_skipped_${failureReason}`
                : 'organization_role_api_unsupported';
              reconciliationPlan.cicd_capability_decision = {
                ...cicdDecision,
                selected_path: 'none',
                status: 'unavailable',
                reason_code: 'capability_unavailable',
                reason_message: 'No safe CI/CD capability provider was available at execution time.',
              };
              reconciliationPlan.cicd_capability_action = 'unavailable';
              for (const rolePlan of desiredOrganizationRoles) {
                executionResults.push({
                  role_name: rolePlan.role_name,
                  requested_name: rolePlan.role_name,
                  execution_result: 'noop',
                  failure_reason: null,
                });
                reconciliationPlan.organization_roles_skipped.push({
                  ...rolePlan,
                  skip_reason: skipReason,
                });
              }
            } else {
              if (selectedProvider.kind === 'custom_repository_role' && selectedPath !== 'fallback') {
                reconciliationPlan.cicd_capability_decision = {
                  ...cicdDecision,
                  selected_path: 'fallback',
                  status: 'applied',
                  reason_code: null,
                  reason_message: 'Primary capability path unavailable; fallback repository-scoped path selected.',
                };
                reconciliationPlan.cicd_capability_action = 'apply_fallback';
              }

              for (const rolePlan of desiredOrganizationRoles) {
                const existingRole = existingRoleByName.get(normalizeRoleMapKey(rolePlan.role_name));
                if (existingRole) {
                  executionResults.push({
                    role_name: rolePlan.role_name,
                    requested_name: rolePlan.role_name,
                    execution_result: 'noop',
                    failure_reason: null,
                  });
                  reconciliationPlan.organization_roles_already_present.push({
                    ...rolePlan,
                    role_id: existingRole.id || null,
                    role_api_provider: selectedProvider.kind,
                  });
                  continue;
                }

                if (typeof selectedProvider.create !== 'function') {
                  reconciliationPlan.organization_roles_skipped.push({
                    ...rolePlan,
                    role_api_provider: selectedProvider.kind,
                    skip_reason: 'organization_role_api_unsupported',
                  });
                  executionResults.push({
                    role_name: rolePlan.role_name,
                    requested_name: rolePlan.role_name,
                    execution_result: 'noop',
                    failure_reason: null,
                  });
                  continue;
                }

                const createRoleResult = await executeCapabilityOperationWithRetry(
                  () => selectedProvider.create(rolePlan),
                  {
                    maxRetries: options.maxRetries || 2,
                    sleep: options.sleep,
                  }
                );

                latestRateLimitSnapshot = createRoleResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

                if (createRoleResult.ok) {
                  executionResults.push({
                    role_name: rolePlan.role_name,
                    requested_name: rolePlan.role_name,
                    execution_result: 'created',
                    failure_reason: null,
                  });
                  reconciliationPlan.organization_roles_to_create.push({
                    ...rolePlan,
                    role_id: createRoleResult.value && createRoleResult.value.id || null,
                    role_api_provider: selectedProvider.kind,
                  });
                  continue;
                }

                reconciliationPlan.organization_roles_skipped.push({
                  ...rolePlan,
                  role_api_provider: selectedProvider.kind,
                  skip_reason: `organization_role_provisioning_skipped_${classifyFailureReason(createRoleResult.error)}`,
                });
                executionResults.push({
                  role_name: rolePlan.role_name,
                  requested_name: rolePlan.role_name,
                  execution_result: 'noop',
                  failure_reason: null,
                });
              }
            }
          }
        }

        try {
          if (parentTeam && requestedChildLinks.length > 0) {
            assertTenantBootstrapHierarchyAllowed({
              approval_status: auditArtifact.approval.approval_status,
              approver_login: auditArtifact.approval.approver_login,
              designated_approver_login: auditArtifact.request.designated_approver_login,
              approver_authorization_state: auditArtifact.approval.approver_authorization_state,
              parent_team_slug: auditArtifact.request.tenant_team_slug,
              dry_run: auditArtifact.request.dry_run,
              tokenInfo: mutationDecision.tokenInfo,
            });

            for (const childLink of requestedChildLinks) {
              const childTeam = (refreshedTeams || []).find((team) =>
                String(team.slug || '').toLowerCase() === String(childLink.child_team_slug || '').toLowerCase()
              );
              if (!childTeam) {
                continue;
              }

              const childParentSlug = childTeam.parent && childTeam.parent.slug
                ? String(childTeam.parent.slug).toLowerCase()
                : null;

              if (!childParentSlug) {
                const linkResult = await executeWithBoundedRetry(
                  () => api.updateTeamParent({
                    organization: auditArtifact.request.organization,
                    teamSlug: childTeam.slug,
                    parentTeamId: parentTeam.id,
                  }),
                  {
                    maxRetries: options.maxRetries || 2,
                    sleep: options.sleep,
                  }
                );

                latestRateLimitSnapshot = linkResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;
                executionResults.push({
                  team_slug: childTeam.slug,
                  requested_name: childTeam.name,
                  execution_result: linkResult.ok ? 'linked' : 'failed',
                  failure_reason: linkResult.ok ? null : classifyFailureReason(linkResult.error),
                });
              } else if (childParentSlug === String(parentTeam.slug || '').toLowerCase()) {
                executionResults.push({
                  team_slug: childTeam.slug,
                  requested_name: childTeam.name,
                  execution_result: 'noop',
                  failure_reason: null,
                });
              } else {
                executionResults.push({
                  team_slug: childTeam.slug,
                  requested_name: childTeam.name,
                  execution_result: 'failed',
                  failure_reason: 'reparent_blocked',
                });
              }
            }

            assertTenantBootstrapMembershipAllowed({
              approval_status: auditArtifact.approval.approval_status,
              approver_role: auditArtifact.approval.approver_role,
              requester_login: auditArtifact.request.requester_login,
              dry_run: auditArtifact.request.dry_run,
              tokenInfo: mutationDecision.tokenInfo,
            });

            const tenantAdminLogin = auditArtifact.request.tenant_admin_login || '';
            const requesterLogin = auditArtifact.request.requester_login || '';
            const requesterMaintainerPolicy = normalizeRequesterMaintainerPolicy(env.TENANT_BOOTSTRAP_REQUESTER_POLICY);
            const tenantTeamSlugs = [...new Set((auditArtifact.request.requested_teams || [])
              .map((team) => String(team && team.normalized_slug || '').toLowerCase())
              .filter(Boolean))];
            const tenantBootstrapMaintainerActions = [];

            reconciliationPlan.tenant_admin_bootstrap_action = reconciliationPlan.tenant_admin_bootstrap_action || reconciliationPlan.requester_bootstrap_action || 'ensure_maintainer';
            reconciliationPlan.tenant_admin_intended_login = tenantAdminLogin;
            reconciliationPlan.requester_maintainer_normalization_policy = requesterMaintainerPolicy;
            reconciliationPlan.creator_maintainer_behavior = 'github_auto_adds_creator_as_maintainer';

            if (!tenantAdminLogin) {
              throw new Error('Tenant bootstrap policy blocked because tenant_admin_login is missing; requester fallback is disabled.');
            }

            for (const teamSlug of tenantTeamSlugs) {
              const currentMembership = typeof api.getMembershipForUser === 'function'
                ? await api.getMembershipForUser({
                    organization: auditArtifact.request.organization,
                    teamSlug,
                    username: tenantAdminLogin,
                  })
                : teamSlug === parentTeam.slug
                  ? tenantAdminMembership
                  : null;

              const currentRole = currentMembership && currentMembership.membership
                ? String(currentMembership.membership.role || '').toLowerCase()
                : '';

              if (currentMembership && currentMembership.state === 'active' && currentRole === 'maintainer') {
                executionResults.push({
                  team_slug: teamSlug,
                  username: tenantAdminLogin,
                  execution_result: 'noop',
                  failure_reason: null,
                });
                tenantBootstrapMaintainerActions.push({
                  team_slug: teamSlug,
                  username: tenantAdminLogin,
                  action: 'ensure_intended_admin_maintainer',
                  execution_result: 'noop',
                  failure_reason: null,
                });
                continue;
              }

              const membershipResult = await executeWithBoundedRetry(
                () => api.addOrUpdateTeamMembership({
                  organization: auditArtifact.request.organization,
                  teamSlug,
                  username: tenantAdminLogin,
                  role: 'maintainer',
                }),
                {
                  maxRetries: options.maxRetries || 2,
                  sleep: options.sleep,
                }
              );

              latestRateLimitSnapshot = membershipResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;
              executionResults.push({
                team_slug: teamSlug,
                username: tenantAdminLogin,
                execution_result: membershipResult.ok ? 'added' : 'failed',
                failure_reason: membershipResult.ok ? null : classifyFailureReason(membershipResult.error),
              });
              tenantBootstrapMaintainerActions.push({
                team_slug: teamSlug,
                username: tenantAdminLogin,
                action: 'ensure_intended_admin_maintainer',
                execution_result: membershipResult.ok ? 'added' : 'failed',
                failure_reason: membershipResult.ok ? null : classifyFailureReason(membershipResult.error),
              });
            }

            if (
              requesterLogin &&
              tenantAdminLogin &&
              requesterLogin !== tenantAdminLogin &&
              requesterMaintainerPolicy !== 'keep_maintainer'
            ) {
              for (const teamSlug of tenantTeamSlugs) {
                const requesterMembership = typeof api.getMembershipForUser === 'function'
                  ? await api.getMembershipForUser({
                      organization: auditArtifact.request.organization,
                      teamSlug,
                      username: requesterLogin,
                    })
                  : null;
                const requesterState = requesterMembership && requesterMembership.state
                  ? String(requesterMembership.state || '').toLowerCase()
                  : 'absent';
                const requesterRole = requesterMembership && requesterMembership.membership
                  ? String(requesterMembership.membership.role || '').toLowerCase()
                  : '';

                if (requesterMaintainerPolicy === 'downgrade_to_member') {
                  if (requesterState !== 'active') {
                    tenantBootstrapMaintainerActions.push({
                      team_slug: teamSlug,
                      username: requesterLogin,
                      action: 'normalize_requester_to_member',
                      execution_result: 'noop',
                      failure_reason: null,
                      detail: 'requester_membership_absent',
                    });
                    continue;
                  }

                  if (requesterRole === 'member') {
                    tenantBootstrapMaintainerActions.push({
                      team_slug: teamSlug,
                      username: requesterLogin,
                      action: 'normalize_requester_to_member',
                      execution_result: 'noop',
                      failure_reason: null,
                    });
                    continue;
                  }

                  const downgradeResult = await executeWithBoundedRetry(
                    () => api.addOrUpdateTeamMembership({
                      organization: auditArtifact.request.organization,
                      teamSlug,
                      username: requesterLogin,
                      role: 'member',
                    }),
                    {
                      maxRetries: options.maxRetries || 2,
                      sleep: options.sleep,
                    }
                  );

                  latestRateLimitSnapshot = downgradeResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;
                  executionResults.push({
                    team_slug: teamSlug,
                    username: requesterLogin,
                    execution_result: downgradeResult.ok ? 'mutated' : 'failed',
                    failure_reason: downgradeResult.ok ? null : classifyFailureReason(downgradeResult.error),
                  });
                  tenantBootstrapMaintainerActions.push({
                    team_slug: teamSlug,
                    username: requesterLogin,
                    action: 'normalize_requester_to_member',
                    execution_result: downgradeResult.ok ? 'mutated' : 'failed',
                    failure_reason: downgradeResult.ok ? null : classifyFailureReason(downgradeResult.error),
                  });
                  continue;
                }

                if (requesterState !== 'active') {
                  tenantBootstrapMaintainerActions.push({
                    team_slug: teamSlug,
                    username: requesterLogin,
                    action: 'normalize_requester_remove_membership',
                    execution_result: 'noop',
                    failure_reason: null,
                    detail: 'requester_membership_absent',
                  });
                  continue;
                }

                if (typeof api.removeTeamMembership === 'function') {
                  const removalResult = await executeWithBoundedRetry(
                    () => api.removeTeamMembership({
                      organization: auditArtifact.request.organization,
                      teamSlug,
                      username: requesterLogin,
                    }),
                    {
                      maxRetries: options.maxRetries || 2,
                      sleep: options.sleep,
                    }
                  );

                  latestRateLimitSnapshot = removalResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;
                  executionResults.push({
                    team_slug: teamSlug,
                    username: requesterLogin,
                    execution_result: removalResult.ok ? 'removed' : 'failed',
                    failure_reason: removalResult.ok ? null : classifyFailureReason(removalResult.error),
                  });
                  tenantBootstrapMaintainerActions.push({
                    team_slug: teamSlug,
                    username: requesterLogin,
                    action: 'normalize_requester_remove_membership',
                    execution_result: removalResult.ok ? 'removed' : 'failed',
                    failure_reason: removalResult.ok ? null : classifyFailureReason(removalResult.error),
                  });
                  continue;
                }

                // Fallback when explicit remove is unavailable: downgrade to member.
                const fallbackResult = await executeWithBoundedRetry(
                  () => api.addOrUpdateTeamMembership({
                    organization: auditArtifact.request.organization,
                    teamSlug,
                    username: requesterLogin,
                    role: 'member',
                  }),
                  {
                    maxRetries: options.maxRetries || 2,
                    sleep: options.sleep,
                  }
                );

                latestRateLimitSnapshot = fallbackResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;
                executionResults.push({
                  team_slug: teamSlug,
                  username: requesterLogin,
                  execution_result: fallbackResult.ok ? 'mutated' : 'failed',
                  failure_reason: fallbackResult.ok ? null : classifyFailureReason(fallbackResult.error),
                });
                tenantBootstrapMaintainerActions.push({
                  team_slug: teamSlug,
                  username: requesterLogin,
                  action: 'normalize_requester_remove_membership_fallback_to_member',
                  execution_result: fallbackResult.ok ? 'mutated' : 'failed',
                  failure_reason: fallbackResult.ok ? null : classifyFailureReason(fallbackResult.error),
                  detail: 'remove_team_membership_unavailable',
                });
              }
            }

            reconciliationPlan.tenant_bootstrap_maintainer_actions = tenantBootstrapMaintainerActions;
            reconciliationPlan.tenant_bootstrap_final_maintainer_action = summarizeMaintainerNormalizationActions(
              tenantBootstrapMaintainerActions,
              requesterMaintainerPolicy
            );
          }
        } catch (error) {
          const rateContext = buildTenantBootstrapRateLimitContext(error, {
            operation: 'tenant_bootstrap_guard',
            maxRetries: options.maxRetries || 2,
          });
          latestRateLimitSnapshot = rateContext.rate_limit_snapshot || latestRateLimitSnapshot;
          executionResults.push({
            execution_result: 'failed',
            failure_reason: 'tenant_policy_blocked',
            detail: error.message,
          });
        }

        const registryResult = persistTenantRegistryRecord({
          request: auditArtifact.request,
          reconciliation: reconciliationPlan,
          approver_login: auditArtifact.approval.approver_login,
          lifecycle_status: 'active',
          mode: env.TENANT_REGISTRY_PERSISTENCE_MODE,
          requireDirectory: String(env.TENANT_REGISTRY_REQUIRE_DIRECTORY || 'true').toLowerCase() !== 'false',
          registryDirectory: env.TENANT_REGISTRY_DIR,
          artifactDirectory: path.dirname(artifactPath),
        });

        reconciliationPlan.registry_persistence_result = registryResult;
        reconciliationPlan.cicd_topology_update_result = registryResult && registryResult.record && registryResult.record.cicd_topology_relation
          ? { status: registryResult.record.cicd_topology_relation.relation_status || 'noop' }
          : { status: 'noop' };
        reconciliationPlan.compatibility_mode = reconciliationPlan.compatibility_mode || auditArtifact.request && auditArtifact.request.compatibility && auditArtifact.request.compatibility.mode || 'canonical';
        reconciliationPlan.registry_migration_status = registryResult && registryResult.migration
          ? registryResult.migration.status
          : 'none';
        if (registryResult.status === 'blocked_missing_directory') {
          executionResults.push({
            execution_result: 'failed',
            failure_reason: 'registry_directory_missing',
          });
        } else if (registryResult.status === 'partial_failure_durable_write') {
          executionResults.push({
            execution_result: 'failed',
            failure_reason: 'registry_durable_write_failed',
          });
        } else if (registryResult.status === 'created' || registryResult.status === 'updated') {
          // Attempt to commit and push the registry record to the repository
          const commitResult = commitRegistryRecord({
            registryFilePath: registryResult.registry_path,
            tenantKey: auditArtifact.request.tenant_key,
            issueNumber: auditArtifact.request.issue_number,
            repoRoot: process.cwd(),
          }, {
            env,
          });
          reconciliationPlan.registry_commit_result = commitResult;
          
          // Log commit result to workflow summary
          if (env.GITHUB_STEP_SUMMARY) {
            const summaryMsg = commitResult.status === 'committed'
              ? `✅ **Registry Persistence**: Tenant registry committed to repository (${commitResult.commit_message})`
              : commitResult.status === 'noop'
                ? `ℹ️ **Registry Persistence**: No registry changes to commit (file unchanged)`
                : `⚠️ **Registry Persistence**: Failed to commit registry record (${commitResult.message})`;
            
            fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `\n${summaryMsg}\n`, 'utf8');
          }
          
          if (commitResult.status === 'failed' && commitResult.error) {
            // Log the commit failure but don't block execution
            // (registry file was written to runner workspace, which is acceptable fallback)
            console.warn(`Registry commit failed: ${commitResult.message}`);
          }
        } else if (registryResult.status === 'unchanged') {
          const commitResult = {
            status: 'noop',
            message: 'No registry changes to commit (file unchanged)',
            committed: false,
            pushed: false,
          };
          reconciliationPlan.registry_commit_result = commitResult;

          if (env.GITHUB_STEP_SUMMARY) {
            fs.appendFileSync(
              env.GITHUB_STEP_SUMMARY,
              '\nℹ️ **Registry Persistence**: No registry changes to commit (file unchanged)\n',
              'utf8'
            );
          }
        }
      }
    } else if (isTeamHierarchy) {
      for (const childLink of reconciliationPlan.child_links_to_apply) {
        const attemptResult = await executeWithBoundedRetry(
          () => api.updateTeamParent({
            organization: auditArtifact.request.organization,
            teamSlug: childLink.child_team_slug,
            parentTeamId: parentTeam && parentTeam.id,
          }),
          {
            maxRetries: options.maxRetries || 2,
            sleep: options.sleep,
          }
        );

        latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

        if (attemptResult.ok) {
          executionResults.push({
            team_slug: childLink.child_team_slug,
            requested_name: childLink.requested_name || childLink.requested_child_name,
            source_row_number: childLink.source_row_number || null,
            source_comment_id: childLink.source_comment_id || null,
            execution_result: 'linked',
            failure_reason: null,
          });
          continue;
        }

        executionResults.push({
          team_slug: childLink.child_team_slug,
          requested_name: childLink.requested_name || childLink.requested_child_name,
          source_row_number: childLink.source_row_number || null,
          source_comment_id: childLink.source_comment_id || null,
          execution_result: 'failed',
          failure_reason: classifyFailureReason(attemptResult.error),
        });
      }
    } else if (isTeamRepoAccess) {
      for (const repository of reconciliationPlan.repositories_to_grant) {
        const attemptResult = await executeWithBoundedRetry(
          () => api.addOrUpdateTeamRepositoryPermission({
            organization: auditArtifact.request.organization,
            teamSlug: auditArtifact.request.team_slug,
            owner: repository.repository_owner,
            repo: repository.repository_name,
            permission: auditArtifact.request.requested_permission_api_value,
          }),
          {
            maxRetries: options.maxRetries || 2,
            sleep: options.sleep,
          }
        );

        latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

        if (attemptResult.ok) {
          executionResults.push({
            repository_full_name: repository.repository_full_name,
            source_row_number: repository.source_row_number || null,
            execution_result: 'granted',
            failure_reason: null,
          });
          continue;
        }

        executionResults.push({
          repository_full_name: repository.repository_full_name,
          source_row_number: repository.source_row_number || null,
          execution_result: 'failed',
          failure_reason: classifyFailureReason(attemptResult.error),
        });
      }
    } else if (isTeamRepoAccessRemoval) {
      for (const repository of reconciliationPlan.removals_to_apply) {
        const attemptResult = await executeWithBoundedRetry(
          () => api.removeTeamRepositoryPermission({
            organization: auditArtifact.request.organization,
            teamSlug: auditArtifact.request.team_slug,
            owner: repository.repository_owner,
            repo: repository.repository_name,
          }),
          {
            maxRetries: options.maxRetries || 2,
            sleep: options.sleep,
          }
        );

        latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

        if (attemptResult.ok) {
          executionResults.push({
            repository_full_name: repository.repository_full_name,
            source_row_number: repository.source_row_number || null,
            execution_result: 'removed',
            failure_reason: null,
          });
          continue;
        }

        executionResults.push({
          repository_full_name: repository.repository_full_name,
          source_row_number: repository.source_row_number || null,
          execution_result: 'failed',
          failure_reason: classifyFailureReason(attemptResult.error),
        });
      }
    } else {
      for (const person of reconciliationPlan.people_to_add) {
        const attemptResult = await executeWithBoundedRetry(
          () => api.addOrUpdateTeamMembership({
            organization: auditArtifact.request.organization,
            teamSlug: auditArtifact.request.team_slug,
            username: person.username,
          }),
          {
            maxRetries: options.maxRetries || 2,
            sleep: options.sleep,
          }
        );

        latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

        if (attemptResult.ok) {
          executionResults.push({
            username: person.username,
            source_row_number: person.source_row_number || null,
            source_comment_id: person.source_comment_id || null,
            execution_result: attemptResult.value.state === 'pending' ? 'pending' : 'added',
            failure_reason: null,
          });
          continue;
        }

        executionResults.push({
          username: person.username,
          source_row_number: person.source_row_number || null,
          source_comment_id: person.source_comment_id || null,
          execution_result: 'failed',
          failure_reason: classifyFailureReason(attemptResult.error),
        });
      }
    }
  }

  const tenantRepoCreationExecutionResult = isTenantRepoCreation
    ? executionResults.find((result) =>
        result.repository_full_name === reconciliationPlan.repository_full_name &&
        result.result_kind === 'repository_creation' &&
        (result.execution_result === 'created' || result.execution_result === 'failed' || result.execution_result === 'noop')
      )
    : null;
  const tenantRepoPermissionExecutionResult = isTenantRepoCreation
    ? [...executionResults].reverse().find((result) =>
        result.repository_full_name === reconciliationPlan.repository_full_name &&
        result.result_kind === 'repo_admin_grant' &&
        (result.execution_result === 'granted' || result.execution_result === 'failed' || result.execution_result === 'noop')
      )
    : null;
  const tenantRepoCustomPropertiesExecutionResult = isTenantRepoCreation
    ? [...executionResults].reverse().find((result) =>
        result.repository_full_name === reconciliationPlan.repository_full_name &&
        result.result_kind === 'custom_properties' &&
        (result.execution_result === 'mutated' || result.execution_result === 'failed' || result.execution_result === 'noop')
      )
    : null;
  const hostedRunnerExecutionResult = (isHostedRunnerCreation || isHostedRunnerDeletion || isHostedRunnerMove)
    ? [...executionResults].reverse().find((result) =>
        result.runner_name === reconciliationPlan.runner_name_derived &&
        ['created', 'deleted', 'moved', 'failed', 'noop'].includes(result.execution_result)
      )
    : null;
  const runnerGroupExecutionResult = isRunnerGroupCreation
    ? [...executionResults].reverse().find((result) =>
        result.runner_group_name === reconciliationPlan.runner_group_name_derived &&
        ['created', 'failed', 'noop'].includes(result.execution_result)
      )
    : null;

  const executionOutcome = buildExecutionOutcome({
    executionResults,
    operationLabel: isTenantCreation
      ? 'tenant_bootstrap'
      : isTenantRepoCreation
        ? 'tenant_repository'
        : (isHostedRunnerCreation || isHostedRunnerDeletion || isHostedRunnerMove)
          ? 'hosted_runner'
          : isRunnerGroupCreation
            ? 'runner_group'
        : isTeamCreation
          ? 'team'
          : isTeamHierarchy
            ? 'child link'
            : (isTeamRepoAccess || isTeamRepoAccessRemoval)
              ? 'repository'
              : 'membership',
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
    },
    intake_mode: auditArtifact.request && auditArtifact.request.intake_mode,
    duplicate_row_count: auditArtifact.request && auditArtifact.request.bulk_csv_submission
      ? auditArtifact.request.bulk_csv_submission.duplicate_row_count
      : 0,
    invalid_row_count: auditArtifact.request && auditArtifact.request.bulk_csv_submission
      ? auditArtifact.request.bulk_csv_submission.invalid_row_count
      : 0,
    repository_creation_result: isTenantRepoCreation
      ? tenantRepoCreationExecutionResult && tenantRepoCreationExecutionResult.execution_result === 'created'
        ? 'created'
        : tenantRepoCreationExecutionResult && tenantRepoCreationExecutionResult.execution_result === 'failed'
          ? 'failed'
          : 'noop'
      : null,
    repo_admin_grant_result: isTenantRepoCreation
      ? tenantRepoPermissionExecutionResult && tenantRepoPermissionExecutionResult.execution_result === 'granted'
        ? 'granted'
        : tenantRepoPermissionExecutionResult && tenantRepoPermissionExecutionResult.execution_result === 'failed'
          ? 'failed'
          : 'noop'
      : null,
    owned_topology_action: isTenantRepoCreation
      ? reconciliationPlan.owned_topology_action || 'not_applicable'
      : null,
    approved_context_marker: isTenantRepoCreation
      ? auditArtifact.approval && auditArtifact.approval.approved_context_marker || null
      : null,
    latest_context_marker: isTenantRepoCreation
      ? auditArtifact.approval && auditArtifact.approval.latest_context_marker || null
      : null,
    execution_context_marker: isTenantRepoCreation
      ? tenantRepoValidation && tenantRepoValidation.canonical_tenant_context && tenantRepoValidation.canonical_tenant_context.context_marker || auditArtifact.request && auditArtifact.request.context_marker || null
      : null,
    topology_mode: isTenantRepoCreation
      ? tenantRepoValidation && tenantRepoValidation.validation_findings && tenantRepoValidation.validation_findings.topology_mode || null
      : null,
    tenant_id: isTenantRepoCreation
      ? tenantRepoValidation && tenantRepoValidation.canonical_tenant_context && (tenantRepoValidation.canonical_tenant_context.tenant_id || tenantRepoValidation.canonical_tenant_context.tenant_key) || null
      : null,
    tenant_team_slug: isTenantRepoCreation
      ? tenantRepoValidation && tenantRepoValidation.canonical_tenant_context && tenantRepoValidation.canonical_tenant_context.tenant_team_slug || null
      : null,
    repo_admin_team_slug: isTenantRepoCreation
      ? tenantRepoValidation && tenantRepoValidation.canonical_tenant_context && tenantRepoValidation.canonical_tenant_context.repo_admin_team_slug || null
      : null,
    topology_persistence_result: isTenantRepoCreation
      ? reconciliationPlan.topology_persistence_result || null
      : null,
    cicd_capability: isTenantCreation
      ? reconciliationPlan.cicd_capability_decision || null
      : null,
    cicd_topology_update_outcome: isTenantCreation
      ? reconciliationPlan.cicd_topology_update_result && reconciliationPlan.cicd_topology_update_result.status || null
      : null,
    repository_custom_properties_result: isTenantRepoCreation
      ? tenantRepoCustomPropertiesExecutionResult && tenantRepoCustomPropertiesExecutionResult.execution_result === 'mutated'
        ? 'mutated'
        : tenantRepoCustomPropertiesExecutionResult && tenantRepoCustomPropertiesExecutionResult.execution_result === 'failed'
          ? 'failed'
          : 'noop'
      : null,
    repository_custom_properties_failure_reason: isTenantRepoCreation && tenantRepoCustomPropertiesExecutionResult && tenantRepoCustomPropertiesExecutionResult.execution_result === 'failed'
      ? tenantRepoCustomPropertiesExecutionResult.failure_reason || 'unknown_error'
      : null,
    repository_custom_properties_failure_status_code: isTenantRepoCreation && tenantRepoCustomPropertiesExecutionResult && tenantRepoCustomPropertiesExecutionResult.execution_result === 'failed'
      ? tenantRepoCustomPropertiesExecutionResult.status_code || null
      : null,
    repository_custom_properties_failure_detail: isTenantRepoCreation && tenantRepoCustomPropertiesExecutionResult && tenantRepoCustomPropertiesExecutionResult.execution_result === 'failed'
      ? tenantRepoCustomPropertiesExecutionResult.detail || null
      : null,
    runner_creation_result: isHostedRunnerCreation
      ? hostedRunnerExecutionResult && hostedRunnerExecutionResult.execution_result === 'created'
        ? 'created'
        : hostedRunnerExecutionResult && hostedRunnerExecutionResult.execution_result === 'failed'
          ? 'failed'
          : 'noop'
      : null,
    runner_deletion_result: isHostedRunnerDeletion
      ? hostedRunnerExecutionResult && hostedRunnerExecutionResult.execution_result === 'deleted'
        ? 'deleted'
        : hostedRunnerExecutionResult && hostedRunnerExecutionResult.execution_result === 'failed'
          ? 'failed'
          : 'noop'
      : null,
    runner_move_result: isHostedRunnerMove
      ? hostedRunnerExecutionResult && hostedRunnerExecutionResult.execution_result === 'moved'
        ? 'moved'
        : hostedRunnerExecutionResult && hostedRunnerExecutionResult.execution_result === 'failed'
          ? 'failed'
          : 'noop'
      : null,
    runner_group_creation_result: isRunnerGroupCreation
      ? runnerGroupExecutionResult && runnerGroupExecutionResult.execution_result === 'created'
        ? 'created'
        : runnerGroupExecutionResult && runnerGroupExecutionResult.execution_result === 'failed'
          ? 'failed'
          : 'noop'
      : null,
    created_runner_id: isHostedRunnerCreation ? reconciliationPlan.created_runner_id ?? null : null,
    created_runner_status: isHostedRunnerCreation ? reconciliationPlan.created_runner_status || null : null,
    moved_runner_id: isHostedRunnerMove ? reconciliationPlan.existing_runner_id ?? null : null,
    target_runner_group_id: isHostedRunnerMove ? reconciliationPlan.target_runner_group_id ?? null : null,
    created_runner_group_id: isRunnerGroupCreation ? reconciliationPlan.created_runner_group_id ?? null : null,
    audit_persistence_result: (isTenantRepoCreation || isTenantRunnerOperation) ? 'pending' : null,
    mutation_token_source: mutationDecision && mutationDecision.tokenInfo && mutationDecision.tokenInfo.source
      ? mutationDecision.tokenInfo.source
      : null,
    mutation_token_kind: mutationDecision && mutationDecision.tokenInfo && mutationDecision.tokenInfo.token_kind
      ? mutationDecision.tokenInfo.token_kind
      : null,
    mutation_token_is_pat_backed: Boolean(mutationDecision && mutationDecision.tokenInfo && mutationDecision.tokenInfo.is_pat_backed),
    artifact_path: artifactPath,
    rate_limit_snapshot: latestRateLimitSnapshot,
  });
  if (
    isTenantRepoCreation &&
    executionOutcome.topology_persistence_result &&
    executionOutcome.topology_persistence_result.status === 'failed'
  ) {
    executionOutcome.rollback_status = 'manual_remediation_required';
    executionOutcome.summary = `${executionOutcome.summary} Topology owned-entry persistence failed after repository mutation; compensating action or manual remediation is required.`;
  }
  const requestStatus = deriveApprovedExecutionTerminalState(executionOutcome, {
    operation,
    intakeMode: auditArtifact.request && auditArtifact.request.intake_mode,
    approvalStatus: auditArtifact.approval && auditArtifact.approval.approval_status,
  });
  const isExecutedNoMutationOutcome =
    requestStatus === 'executed' &&
    executionOutcome.mutation_count === 0 &&
    executionOutcome.pending_count === 0 &&
    executionOutcome.failure_count === 0 &&
    executionOutcome.rejected_count === 0;
  if (isTeamCreation && executionOutcome.created_count > 0) {
    executionOutcome.summary = `${executionOutcome.summary} Note: GitHub automatically makes the authenticated creator a team maintainer when a new team is created, so the creator becomes a team maintainer as an operational constraint of this workflow.`;
  }
  if (isTenantCreation) {
    const intendedTenantAdmin = reconciliationPlan.tenant_admin_intended_login || auditArtifact.request.tenant_admin_login || auditArtifact.request.requester_login || 'n/a';
    const creatorMaintainerBehavior = reconciliationPlan.creator_maintainer_behavior
      ? 'GitHub automatically makes the authenticated creator a team maintainer when a new team is created.'
      : 'Creator maintainership behavior not recorded.';
    const finalMaintainerAction = reconciliationPlan.tenant_bootstrap_final_maintainer_action || 'Final maintainer list action not recorded.';
    executionOutcome.summary = `${executionOutcome.summary} Intended tenant admin: ${intendedTenantAdmin}. Auto-added creator maintainer behavior: ${creatorMaintainerBehavior} Final maintainer list action taken: ${finalMaintainerAction}`;
  }
  const operationExecutionLabel = isTenantCreation
    ? 'tenant bootstrap execution'
    : isTenantRepoCreation
      ? 'tenant repository execution'
      : isHostedRunnerCreation
        ? 'tenant hosted-runner creation'
        : isHostedRunnerMove
          ? 'tenant hosted-runner move'
        : isHostedRunnerDeletion
          ? 'tenant hosted-runner deletion'
          : isRunnerGroupCreation
            ? 'tenant runner-group creation'
      : isTeamCreation
        ? 'team creation'
        : isTeamHierarchy
          ? 'child-team execution'
          : (isTeamRepoAccess || isTeamRepoAccessRemoval)
            ? 'repository-access execution'
            : 'execution';
  const summaryPrefix =
    isExecutedNoMutationOutcome
      ? `Request is already satisfied. Additional approval comments do not trigger a new ${isTenantCreation ? 'tenant bootstrap' : isTenantRepoCreation ? 'tenant repository' : isHostedRunnerCreation ? 'tenant hosted-runner' : isHostedRunnerMove ? 'tenant hosted-runner move' : isHostedRunnerDeletion ? 'tenant hosted-runner deletion' : isRunnerGroupCreation ? 'tenant runner-group' : isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team' : (isTeamRepoAccess || isTeamRepoAccessRemoval) ? 'repository-access' : 'membership'} mutation run.`
      : requestStatus === 'executed'
        ? `Approved ${operationExecutionLabel} completed.`
        : requestStatus === 'partially_executed'
          ? `Approved ${operationExecutionLabel} completed with partial failure.`
          : `Approved ${operationExecutionLabel} failed.`;

  auditArtifact.request.request_status = requestStatus;
  auditArtifact.reconciliation = reconciliationPlan;
  auditArtifact.reconciliation.rate_limit_snapshot = latestRateLimitSnapshot;
  auditArtifact.execution = {
    ...executionOutcome,
    summary: `${summaryPrefix} ${executionOutcome.summary}`,
  };

  const updatedArtifact = buildAuditArtifact({
    request: auditArtifact.request,
    validation: auditArtifact.validation,
    assignment: auditArtifact.assignment,
    approval: auditArtifact.approval,
    reconciliationPlan: auditArtifact.reconciliation,
    executionOutcome: auditArtifact.execution,
    runContext: {
      run_id: env.GITHUB_RUN_ID || auditArtifact.metadata && auditArtifact.metadata.run_id,
      run_attempt: env.GITHUB_RUN_ATTEMPT || auditArtifact.metadata && auditArtifact.metadata.run_attempt,
      operation: operation || auditArtifact.metadata && auditArtifact.metadata.operation,
      artifact_name: path.basename(artifactPath),
      artifact_retention_days: env.AUDIT_ARTIFACT_RETENTION_DAYS || '',
    },
  });

  let auditPersistenceResult = 'persisted';
  try {
    fs.writeFileSync(artifactPath, toAuditArtifactJson({
      request: updatedArtifact.request,
      validation: updatedArtifact.validation,
      assignment: updatedArtifact.assignment,
      approval: updatedArtifact.approval,
      reconciliationPlan: updatedArtifact.reconciliation,
      executionOutcome: updatedArtifact.execution,
      runContext: updatedArtifact.metadata,
    }), 'utf8');
  } catch (error) {
    auditPersistenceResult = 'failed';
    updatedArtifact.execution.failure_count = (updatedArtifact.execution.failure_count || 0) + 1;
    updatedArtifact.execution.rollback_status = 'manual_remediation_required';
    updatedArtifact.request.request_status = updatedArtifact.request.request_status === 'executed'
      ? 'partially_executed'
      : 'failed';
    updatedArtifact.execution.summary = `${updatedArtifact.execution.summary} Audit artifact persistence failed: ${error.message}.`;
  }

  if (isTenantRepoCreation || isTenantRunnerOperation) {
    updatedArtifact.execution.audit_persistence_result = auditPersistenceResult;
  }

  const shouldAddTerminalLabel =
    updatedArtifact.request &&
    updatedArtifact.request.issue_number != null &&
    typeof api.addIssueLabels === 'function' &&
    (updatedArtifact.request.intake_mode === 'csv_attachment' || isTenantRepoCreation || isTenantCreation || isTeamCreation || isTenantRunnerOperation);

  if (shouldAddTerminalLabel) {
    const labelPrefix = terminalStateLabelPrefix(operation);
    const targetLabel = `${labelPrefix}${updatedArtifact.request.request_status}`;
    try {
      if (typeof api.listIssueLabels === 'function' && typeof api.removeIssueLabel === 'function') {
        const existingLabels = await api.listIssueLabels({
          repository: updatedArtifact.request.repository,
          issueNumber: updatedArtifact.request.issue_number,
        });

        const managedTerminalLabels = new Set(buildTerminalStateLabels(buildTerminalLabelPrefixes(operation)));
        const staleTerminalLabels = existingLabels
          .filter((label) => managedTerminalLabels.has(label) && label !== targetLabel);

        for (const staleLabel of staleTerminalLabels) {
          await api.removeIssueLabel({
            repository: updatedArtifact.request.repository,
            issueNumber: updatedArtifact.request.issue_number,
            label: staleLabel,
          });
        }
      }

      await api.addIssueLabels({
        repository: updatedArtifact.request.repository,
        issueNumber: updatedArtifact.request.issue_number,
        labels: [targetLabel],
      });
    } catch (labelError) {
      // Non-fatal: label application failure should not degrade an otherwise successful execution.
      console.warn(`[warn] Failed to add terminal state label: ${labelError.message}`);
    }
  }

  writeGitHubOutput('execution-status', updatedArtifact.request.request_status, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
  emitAuditSummary(updatedArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });

  if (shouldSetExitCode && updatedArtifact.request.request_status !== 'executed') {
    process.exitCode = 1;
  }

  return updatedArtifact;
}

if (require.main === module) {
  runApprovedExecution({ setProcessExitCode: true }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildValidatedChildLinks,
  buildValidatedPeople,
  buildValidatedRepositoryGrants,
  buildValidatedTeams,
  classifyFailureReason,
  deriveApprovedExecutionTerminalState,
  deriveRequestStatus,
  runApprovedExecution,
};
