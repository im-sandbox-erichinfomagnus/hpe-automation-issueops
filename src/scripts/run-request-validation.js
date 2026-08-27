'use strict';

const fs = require('fs');
const path = require('path');

const { buildExecutionOutcome } = require('../workflow-support/build-execution-outcome');
const { buildAuditArtifact, toAuditArtifactJson } = require('../workflow-support/build-audit-artifact');
const { createGitHubTeamApi } = require('../workflow-support/github-team-api');
const { createGitHubTeamRepoApi } = require('../workflow-support/github-team-repo-api');
const { createGitHubRunnerApi } = require('../workflow-support/github-runner-api');
const { createGitHubOrgVariablesApi } = require('../workflow-support/github-org-variables-api');
const { createGitHubRepoRulesetsApi } = require('../workflow-support/github-repo-rulesets-api');
const { loadWorkflowToken } = require('../workflow-support/load-workflow-token');
const { parseTeamCreationRequest } = require('../workflow-support/parse-team-creation-request');
const { parseTenantRepoRequest } = require('../workflow-support/parse-tenant-repo-request');
const { parseTenantCreationRequest } = require('../workflow-support/parse-tenant-creation-request');
const { parseTeamHierarchyRequest } = require('../workflow-support/parse-team-hierarchy-request');
const { parseTeamMembershipRequest } = require('../workflow-support/parse-team-membership-request');
const { parseTeamRepoAccessRequest } = require('../workflow-support/parse-team-repo-access-request');
const { parseTeamRepoAccessRemovalRequest } = require('../workflow-support/parse-team-repo-access-removal-request');
const { parseHostedRunnerRequest } = require('../workflow-support/parse-hosted-runner-request');
const { parseHostedRunnerDeletionRequest } = require('../workflow-support/parse-hosted-runner-deletion-request');
const { parseHostedRunnerMoveRequest } = require('../workflow-support/parse-hosted-runner-move-request');
const { parseRunnerGroupRequest } = require('../workflow-support/parse-runner-group-request');
const { parseTenantVariablesRequest } = require('../workflow-support/parse-tenant-variables-request');
const { parseOrgVariablesRequest } = require('../workflow-support/parse-org-variables-request');
const { parseTenantSubteamRequest } = require('../workflow-support/parse-tenant-subteam-request');
const { parseRepoAdminMembershipRequest } = require('../workflow-support/parse-repo-admin-membership-request');
const { parseCicdAdminMembershipRequest } = require('../workflow-support/parse-cicd-admin-membership-request');
const { parseRepositoryRulesetRequest } = require('../workflow-support/parse-repository-ruleset-request');
const { reconcileTeamCreation } = require('../workflow-support/reconcile-team-creation');
const { reconcileTenantRepoCreation } = require('../workflow-support/reconcile-tenant-repo-creation');
const { evaluateCicdCapabilityPath, reconcileTenantCreation } = require('../workflow-support/reconcile-tenant-creation');
const { reconcileTeamHierarchy } = require('../workflow-support/reconcile-team-hierarchy');
const { reconcileTeamRepoAccess } = require('../workflow-support/reconcile-team-repo-access');
const { reconcileTeamRepoAccessRemoval } = require('../workflow-support/reconcile-team-repo-access-removal');
const { reconcileHostedRunnerCreation } = require('../workflow-support/reconcile-hosted-runner-creation');
const { reconcileHostedRunnerDeletion } = require('../workflow-support/reconcile-hosted-runner-deletion');
const { reconcileHostedRunnerMove } = require('../workflow-support/reconcile-hosted-runner-move');
const { reconcileRunnerGroupCreation } = require('../workflow-support/reconcile-runner-group-creation');
const { validateTenantCreationRequest } = require('../workflow-support/validate-tenant-creation-request');
const { validateTenantRepoRequest } = require('../workflow-support/validate-tenant-repo-request');
const { validateTeamCreationRequest } = require('../workflow-support/validate-team-creation-request');
const { validateTeamHierarchyRequest } = require('../workflow-support/validate-team-hierarchy-request');
const { validateTeamMembershipRequest } = require('../workflow-support/validate-team-membership-request');
const { validateTeamRepoAccessRequest } = require('../workflow-support/validate-team-repo-access-request');
const { validateTeamRepoAccessRemovalRequest } = require('../workflow-support/validate-team-repo-access-removal-request');
const { validateHostedRunnerRequest } = require('../workflow-support/validate-hosted-runner-request');
const { validateHostedRunnerDeletionRequest } = require('../workflow-support/validate-hosted-runner-deletion-request');
const { validateHostedRunnerMoveRequest } = require('../workflow-support/validate-hosted-runner-move-request');
const { validateRunnerGroupRequest } = require('../workflow-support/validate-runner-group-request');
const { validateTenantVariablesRequest } = require('../workflow-support/validate-tenant-variables-request');
const { validateOrgVariablesRequest } = require('../workflow-support/validate-org-variables-request');
const { validateTenantSubteamRequest } = require('../workflow-support/validate-tenant-subteam-request');
const { reconcileTenantSubteamCreation } = require('../workflow-support/reconcile-tenant-subteam-creation');
const { validateRepoAdminMembershipRequest } = require('../workflow-support/validate-repo-admin-membership-request');
const { reconcileRepoAdminMembership } = require('../workflow-support/reconcile-repo-admin-membership');
const { validateCicdAdminMembershipRequest } = require('../workflow-support/validate-cicd-admin-membership-request');
const { reconcileCicdAdminMembership } = require('../workflow-support/reconcile-cicd-admin-membership');
const { validateRepositoryRulesetRequest } = require('../workflow-support/validate-repository-ruleset-request');
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

function hasParsedRequestValue(value) {
  if (value == null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim() !== '';
  }

  return true;
}

function readParsedRequestFromEnv(env = process.env) {
  const fallbackParsedRequest = {
    organization: env.PARSED_ORGANIZATION || '',
    team: env.PARSED_TEAM || '',
    parsed_tenant_name: env.PARSED_TENANT_NAME || '',
    repository_name: env.PARSED_REPOSITORY_NAME || '',
    parsed_repository_name: env.PARSED_REPOSITORY_NAME || '',
    tenant_name: env.PARSED_TENANT_NAME || '',
    tenant_display_name: env.PARSED_TENANT_NAME || '',
    tenant_type: env.PARSED_TENANT_TYPE || '',
    parsed_tenant_type: env.PARSED_TENANT_TYPE || '',
    tenant_csv: env.PARSED_TENANT_CSV || '',
    parsed_tenant_csv: env.PARSED_TENANT_CSV || '',
    tenant_admin_login: env.PARSED_TENANT_ADMIN_LOGIN || '',
    parsed_tenant_admin_login: env.PARSED_TENANT_ADMIN_LOGIN || '',
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
    runner_name: env.PARSED_RUNNER_NAME || '',
    runner_csv: env.PARSED_RUNNER_CSV || '',
    parsed_runner_csv: env.PARSED_RUNNER_CSV || '',
    runner_image_id: env.PARSED_RUNNER_IMAGE_ID || '',
    runner_image_source: env.PARSED_RUNNER_IMAGE_SOURCE || '',
    runner_size: env.PARSED_RUNNER_SIZE || '',
    runner_group_name: env.PARSED_RUNNER_GROUP_NAME || '',
    runner_groups_csv: env.PARSED_RUNNER_GROUPS_CSV || '',
    parsed_runner_groups_csv: env.PARSED_RUNNER_GROUPS_CSV || '',
    runner_moves_csv: env.PARSED_RUNNER_MOVES_CSV || '',
    parsed_runner_moves_csv: env.PARSED_RUNNER_MOVES_CSV || '',
    hosted_runner_id: env.PARSED_HOSTED_RUNNER_ID || '',
    target_runner_group_name: env.PARSED_TARGET_RUNNER_GROUP_NAME || '',
    maximum_runners: env.PARSED_MAXIMUM_RUNNERS || '',
    runner_group_visibility: env.PARSED_RUNNER_GROUP_VISIBILITY || '',
    allows_public_repositories: env.PARSED_ALLOWS_PUBLIC_REPOSITORIES || '',
    variable_operation: env.PARSED_VARIABLE_OPERATION || '',
    variable_name: env.PARSED_VARIABLE_NAME || '',
    variable_value: env.PARSED_VARIABLE_VALUE || '',
    variables_csv: env.PARSED_VARIABLES_CSV || '',
    org_variable_operation: env.PARSED_ORG_VARIABLE_OPERATION || '',
    parsed_org_variable_operation: env.PARSED_ORG_VARIABLE_OPERATION || '',
    org_variable_name: env.PARSED_ORG_VARIABLE_NAME || '',
    org_variable_value: env.PARSED_ORG_VARIABLE_VALUE || '',
    org_variables_csv: env.PARSED_ORG_VARIABLES_CSV || '',
    subteam_operation: env.PARSED_SUBTEAM_OPERATION || '',
    parsed_subteam_operation: env.PARSED_SUBTEAM_OPERATION || '',
    requested_subteams: env.PARSED_REQUESTED_SUBTEAMS || '',
    parsed_requested_subteams: env.PARSED_REQUESTED_SUBTEAMS || '',
    repo_admin_operation: env.PARSED_REPO_ADMIN_OPERATION || '',
    parsed_repo_admin_operation: env.PARSED_REPO_ADMIN_OPERATION || '',
    cicd_admin_operation: env.PARSED_CICD_ADMIN_OPERATION || '',
    parsed_cicd_admin_operation: env.PARSED_CICD_ADMIN_OPERATION || '',
    repositories_csv: env.PARSED_REPOSITORIES_CSV || '',
    parsed_repositories_csv: env.PARSED_REPOSITORIES_CSV || '',
    repository: env.PARSED_REPOSITORY || '',
    parsed_repository: env.PARSED_REPOSITORY || '',
    ruleset_name: env.PARSED_RULESET_NAME || '',
    parsed_ruleset_name: env.PARSED_RULESET_NAME || '',
    rulesets_csv: env.PARSED_RULESETS_CSV || '',
    parsed_rulesets_csv: env.PARSED_RULESETS_CSV || '',
    target: env.PARSED_TARGET || '',
    parsed_target: env.PARSED_TARGET || '',
    ref_name_pattern: env.PARSED_REF_NAME_PATTERN || '',
    parsed_ref_name_pattern: env.PARSED_REF_NAME_PATTERN || '',
    enforcement: env.PARSED_ENFORCEMENT || '',
    parsed_enforcement: env.PARSED_ENFORCEMENT || '',
    require_pull_request: env.PARSED_REQUIRE_PULL_REQUEST || '',
    parsed_require_pull_request: env.PARSED_REQUIRE_PULL_REQUEST || '',
    block_force_pushes: env.PARSED_BLOCK_FORCE_PUSHES || '',
    parsed_block_force_pushes: env.PARSED_BLOCK_FORCE_PUSHES || '',
    require_linear_history: env.PARSED_REQUIRE_LINEAR_HISTORY || '',
    parsed_require_linear_history: env.PARSED_REQUIRE_LINEAR_HISTORY || '',
    restrict_deletions: env.PARSED_RESTRICT_DELETIONS || '',
    parsed_restrict_deletions: env.PARSED_RESTRICT_DELETIONS || '',
    repository_visibility: env.PARSED_REPOSITORY_VISIBILITY || '',
    parsed_repository_visibility: env.PARSED_REPOSITORY_VISIBILITY || '',
    primary_contact: env.PARSED_PRIMARY_CONTACT || '',
    parsed_primary_contact: env.PARSED_PRIMARY_CONTACT || '',
    secondary_contact: env.PARSED_SECONDARY_CONTACT || '',
    parsed_secondary_contact: env.PARSED_SECONDARY_CONTACT || '',
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
    cicd_capability_requested: env.PARSED_CICD_CAPABILITY_REQUESTED || '',
    parsed_cicd_capability_requested: env.PARSED_CICD_CAPABILITY_REQUESTED || '',
    cicd_primary_path_available: env.PARSED_CICD_PRIMARY_PATH_AVAILABLE || '',
    parsed_cicd_primary_path_available: env.PARSED_CICD_PRIMARY_PATH_AVAILABLE || '',
    cicd_primary_policy_approved: env.PARSED_CICD_PRIMARY_POLICY_APPROVED || '',
    parsed_cicd_primary_policy_approved: env.PARSED_CICD_PRIMARY_POLICY_APPROVED || '',
    cicd_fallback_path_available: env.PARSED_CICD_FALLBACK_PATH_AVAILABLE || '',
    parsed_cicd_fallback_path_available: env.PARSED_CICD_FALLBACK_PATH_AVAILABLE || '',
    cicd_fallback_policy_approved: env.PARSED_CICD_FALLBACK_POLICY_APPROVED || '',
    parsed_cicd_fallback_policy_approved: env.PARSED_CICD_FALLBACK_POLICY_APPROVED || '',
    cicd_tenant_scope_resolvable: env.PARSED_CICD_TENANT_SCOPE_RESOLVABLE || '',
    parsed_cicd_tenant_scope_resolvable: env.PARSED_CICD_TENANT_SCOPE_RESOLVABLE || '',
    cicd_requested_scope: env.PARSED_CICD_REQUESTED_SCOPE || '',
    parsed_cicd_requested_scope: env.PARSED_CICD_REQUESTED_SCOPE || '',
    cicd_requires_broad_org_scope: env.PARSED_CICD_REQUIRES_BROAD_ORG_SCOPE || '',
    parsed_cicd_requires_broad_org_scope: env.PARSED_CICD_REQUIRES_BROAD_ORG_SCOPE || '',
    cicd_requires_org_owner_grant: env.PARSED_CICD_REQUIRES_ORG_OWNER_GRANT || '',
    parsed_cicd_requires_org_owner_grant: env.PARSED_CICD_REQUIRES_ORG_OWNER_GRANT || '',
    dry_run: env.PARSED_DRY_RUN || 'true',
  };

  const parsedRequestJson = parseParsedRequestJson(env.PARSED_REQUEST_JSON);
  if (!parsedRequestJson) {
    return fallbackParsedRequest;
  }

  const mergedParsedRequest = {
    ...parsedRequestJson,
  };

  for (const [key, fallbackValue] of Object.entries(fallbackParsedRequest)) {
    if (!hasParsedRequestValue(mergedParsedRequest[key])) {
      mergedParsedRequest[key] = fallbackValue;
    }
  }

  return mergedParsedRequest;
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
  const hasRepositoriesCsv = Boolean(
    parsedRequest.repositories_csv ||
    parsedRequest.parsed_repositories_csv
  );

  // csv_attachment intake opens with the repository fields blank (they arrive
  // later as an uploaded CSV file), so key on the tenant signal plus the mode.
  const intakeMode = String(
    parsedRequest.intake_mode || parsedRequest.parsed_intake_mode || ''
  ).replace(/[\[\]"'\s,]/g, '').toLowerCase();
  const hasTenantName = Boolean(
    parsedRequest.tenant_name ||
    parsedRequest.parsed_tenant_name ||
    parsedRequest.tenant_display_name
  );
  const isCsvAttachmentTenantRepo = intakeMode === 'csv_attachment' && hasTenantName;

  return (looksLikeRepositoryName || hasRepositoriesCsv || isCsvAttachmentTenantRepo) && !hasTenantModelSpecificSignals;
}

function isHostedRunnerCreationParsedRequest(parsedRequest = {}) {
  return Boolean(
    (parsedRequest.runner_name || parsedRequest.parsed_runner_name) &&
    (parsedRequest.runner_image_id ||
      parsedRequest.parsed_runner_image_id ||
      parsedRequest.runner_size ||
      parsedRequest.parsed_runner_size)
  );
}

function isHostedRunnerDeletionParsedRequest(parsedRequest = {}) {
  return Boolean(
    (parsedRequest.runner_name || parsedRequest.parsed_runner_name) &&
    !(parsedRequest.target_runner_group_name || parsedRequest.parsed_target_runner_group_name) &&
    !(parsedRequest.runner_image_id ||
      parsedRequest.parsed_runner_image_id ||
      parsedRequest.runner_size ||
      parsedRequest.parsed_runner_size)
  );
}

function isHostedRunnerMoveParsedRequest(parsedRequest = {}) {
  return Boolean(
    (parsedRequest.runner_name || parsedRequest.parsed_runner_name) &&
    (parsedRequest.target_runner_group_name || parsedRequest.parsed_target_runner_group_name)
  );
}

function isRunnerGroupCreationParsedRequest(parsedRequest = {}) {
  return Boolean(
    (parsedRequest.runner_group_name || parsedRequest.parsed_runner_group_name) &&
    !(parsedRequest.runner_name || parsedRequest.parsed_runner_name)
  );
}

function isTenantVariablesManagementParsedRequest(parsedRequest = {}) {
  return Boolean(
    parsedRequest.variable_operation ||
    parsedRequest.parsed_variable_operation ||
    parsedRequest.variable_name ||
    parsedRequest.parsed_variable_name ||
    parsedRequest.variables_csv ||
    parsedRequest.parsed_variables_csv
  );
}

function isOrgVariablesManagementParsedRequest(parsedRequest = {}) {
  // The org_variable_operation dropdown is unique to the manage-org-variables
  // form, mirroring how variable_operation anchors tenant-variables routing.
  return Boolean(
    parsedRequest.org_variable_operation ||
    parsedRequest.parsed_org_variable_operation
  );
}

function isTenantSubteamCreationParsedRequest(parsedRequest = {}) {
  // The subteam_operation dropdown is unique to the create-tenant-subteam
  // form, mirroring how variable_operation anchors tenant-variables routing.
  return Boolean(
    parsedRequest.subteam_operation ||
    parsedRequest.parsed_subteam_operation
  );
}

function isRepoAdminMembershipParsedRequest(parsedRequest = {}) {
  // The repo_admin_operation dropdown is unique to the add-repo-admin-to-tenant
  // form, mirroring how variable_operation anchors tenant-variables routing.
  return Boolean(
    parsedRequest.repo_admin_operation ||
    parsedRequest.parsed_repo_admin_operation
  );
}

function isCicdAdminMembershipParsedRequest(parsedRequest = {}) {
  // The cicd_admin_operation dropdown is unique to the add-cicd-admin-to-tenant
  // form, mirroring how variable_operation anchors tenant-variables routing.
  return Boolean(
    parsedRequest.cicd_admin_operation ||
    parsedRequest.parsed_cicd_admin_operation
  );
}

function hasRepositoryRulesetCreateSignals(parsedRequest = {}) {
  return Boolean(
    parsedRequest.target ||
    parsedRequest.parsed_target ||
    parsedRequest.ref_name_pattern ||
    parsedRequest.parsed_ref_name_pattern ||
    parsedRequest.enforcement ||
    parsedRequest.parsed_enforcement ||
    parsedRequest.require_pull_request ||
    parsedRequest.parsed_require_pull_request ||
    parsedRequest.block_force_pushes ||
    parsedRequest.parsed_block_force_pushes ||
    parsedRequest.require_linear_history ||
    parsedRequest.parsed_require_linear_history ||
    parsedRequest.restrict_deletions ||
    parsedRequest.parsed_restrict_deletions
  );
}

function hasRulesetBatchSignal(parsedRequest = {}) {
  return Boolean(parsedRequest.rulesets_csv || parsedRequest.parsed_rulesets_csv);
}

function isRepositoryRulesetCreationParsedRequest(parsedRequest = {}) {
  const hasRulesetSignal = Boolean(
    parsedRequest.ruleset_name ||
    parsedRequest.parsed_ruleset_name ||
    parsedRequest.repository ||
    parsedRequest.parsed_repository ||
    hasRulesetBatchSignal(parsedRequest)
  );
  return hasRulesetSignal && hasRepositoryRulesetCreateSignals(parsedRequest);
}

function isRepositoryRulesetDeletionParsedRequest(parsedRequest = {}) {
  const hasRulesetName = Boolean(parsedRequest.ruleset_name || parsedRequest.parsed_ruleset_name);
  const hasRepository = Boolean(parsedRequest.repository || parsedRequest.parsed_repository);
  const hasSingleItem = hasRulesetName && hasRepository;
  return (hasSingleItem || hasRulesetBatchSignal(parsedRequest)) && !hasRepositoryRulesetCreateSignals(parsedRequest);
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
    hosted_runner_creation: 'issueops:create-tenant-hosted-runner:',
    hosted_runner_deletion: 'issueops:delete-tenant-hosted-runner:',
    hosted_runner_move: 'issueops:move-tenant-hosted-runner:',
    runner_group_creation: 'issueops:create-tenant-runner-groups:',
    tenant_variable_management: 'issueops:manage-tenant-variables:',
    org_variable_management: 'issueops:manage-org-variables:',
    tenant_subteam_creation: 'issueops:create-tenant-subteam:',
    repo_admin_membership: 'issueops:add-repo-admin-to-tenant:',
    cicd_admin_membership: 'issueops:add-cicd-admin-to-tenant:',
    repository_ruleset_creation: 'issueops:create-repository-ruleset:',
    repository_ruleset_deletion: 'issueops:delete-repository-ruleset:',
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





function buildDetailedErrorMessage(error) {
  if (!error) {
    return 'Unknown validation error';
  }

  const parts = [error.message || 'Validation error'];
  
  if (error.status) {
    parts.push(`(HTTP ${error.status})`);
  }

  if (error.payload && error.payload.message) {
    const apiMessage = String(error.payload.message || '').trim();
    if (apiMessage && !parts.includes(apiMessage)) {
      parts.push(`- ${apiMessage}`);
    }
  }

  const baseMessage = String(error.message || '').toLowerCase();
  const payloadMessage = String(error.payload && error.payload.message ? error.payload.message : '').toLowerCase();
  const isTeamListForbidden =
    error.status === 403 &&
    baseMessage.includes('failed to list organization teams');
  const hasRepositoryAdminHint = payloadMessage.includes('must have admin rights to repository');

  if (isTeamListForbidden && hasRepositoryAdminHint) {
    parts.push('- Token lacks required target-org access. Ensure ISSUEOPS_GITHUB_TOKEN is authorized for the target organization and has org/team read permissions.');
    parts.push('- If using fine-grained PAT, it cannot span multiple resource owners. Use a token owned by the target org context or use a classic PAT/GitHub App with required org permissions.');
    parts.push('- If the target org enforces SSO, authorize the token for that org before re-running validation.');
  }

  return parts.join(' ');
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

function buildInsufficientHierarchyTokenValidation(request, tokenInfo) {
  const tokenSource = tokenInfo && tokenInfo.source ? tokenInfo.source : 'unknown';
  return {
    is_valid: false,
    request_status: 'validation_failed',
    errors: [
      `Team hierarchy validation requires ISSUEOPS_GITHUB_TOKEN with org-level access. Current token source: ${tokenSource}.`,
    ],
    warnings: [],
    organization_visible: false,
    parent_team_exists: false,
    designated_approver_authorization: null,
    requested_child_links: (request.requested_child_links || []).map((childLink) => ({
      ...childLink,
      validation_status: 'rejected',
      desired_action: 'reject',
      execution_result: 'not_started',
      failure_reason: 'insufficient_token_scope',
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
    requested_repository_grants: (request.requested_repository_grants || []).map((grant) => ({
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
          `${isOrgVariablesManagementParsedRequest(readParsedRequestFromEnv(env)) ? 'manage-org-variables' : isTenantSubteamCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-tenant-subteam' : isRepoAdminMembershipParsedRequest(readParsedRequestFromEnv(env)) ? 'add-repo-admin-to-tenant' : isCicdAdminMembershipParsedRequest(readParsedRequestFromEnv(env)) ? 'add-cicd-admin-to-tenant' : isTenantVariablesManagementParsedRequest(readParsedRequestFromEnv(env)) ? 'manage-tenant-variables' : isRepositoryRulesetCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-repository-ruleset' : isRepositoryRulesetDeletionParsedRequest(readParsedRequestFromEnv(env)) ? 'delete-repository-ruleset' : isTeamRepoAccessParsedRequest(readParsedRequestFromEnv(env)) ? 'add-team-repo-access' : isTeamRepoAccessRemovalParsedRequest(readParsedRequestFromEnv(env)) ? 'remove-team-repo-access' : isTenantRepoCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-tenant-repos' : isHostedRunnerCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-tenant-hosted-runner' : isHostedRunnerMoveParsedRequest(readParsedRequestFromEnv(env)) ? 'move-tenant-hosted-runner' : isHostedRunnerDeletionParsedRequest(readParsedRequestFromEnv(env)) ? 'delete-tenant-hosted-runner' : isRunnerGroupCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-tenant-runner-groups' : isTenantCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-tenant-model' : isTeamCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-org-teams' : isTeamHierarchyParsedRequest(readParsedRequestFromEnv(env)) ? 'add-child-teams' : 'add-team-members'}-validation-${env.ISSUE_NUMBER || 'manual'}.json`
      )
  );
  const parsedRequest = readParsedRequestFromEnv(env);
  const isOrgVariableManagement = isOrgVariablesManagementParsedRequest(parsedRequest);
  const isTenantSubteamCreation = !isOrgVariableManagement && isTenantSubteamCreationParsedRequest(parsedRequest);
  const isRepoAdminMembership = !isOrgVariableManagement && !isTenantSubteamCreation && isRepoAdminMembershipParsedRequest(parsedRequest);
  const isCicdAdminMembership = !isOrgVariableManagement && !isTenantSubteamCreation && !isRepoAdminMembership && isCicdAdminMembershipParsedRequest(parsedRequest);
  const isTeamRepoAccess = !isOrgVariableManagement && !isTenantSubteamCreation && !isRepoAdminMembership && !isCicdAdminMembership && isTeamRepoAccessParsedRequest(parsedRequest);
        const isTeamRepoAccessRemoval = !isOrgVariableManagement && !isTenantSubteamCreation && !isRepoAdminMembership && !isCicdAdminMembership && isTeamRepoAccessRemovalParsedRequest(parsedRequest);
  const isTenantRepoCreation = !isOrgVariableManagement && !isTenantSubteamCreation && !isRepoAdminMembership && !isCicdAdminMembership && isTenantRepoCreationParsedRequest(parsedRequest);
  const isHostedRunnerCreation = !isTenantRepoCreation && isHostedRunnerCreationParsedRequest(parsedRequest);
  const isHostedRunnerMove = !isTenantRepoCreation && !isHostedRunnerCreation && isHostedRunnerMoveParsedRequest(parsedRequest);
  const isHostedRunnerDeletion = !isTenantRepoCreation && !isHostedRunnerCreation && !isHostedRunnerMove && isHostedRunnerDeletionParsedRequest(parsedRequest);
  const isRunnerGroupCreation = !isTenantRepoCreation && !isHostedRunnerCreation && !isHostedRunnerMove && !isHostedRunnerDeletion && isRunnerGroupCreationParsedRequest(parsedRequest);
  const isTenantRunnerOperation = isHostedRunnerCreation || isHostedRunnerDeletion || isHostedRunnerMove || isRunnerGroupCreation;
  const isTenantVariableManagement = !isTenantRunnerOperation && !isTenantRepoCreation && isTenantVariablesManagementParsedRequest(parsedRequest);
  const isRepositoryRulesetCreation = !isTenantRunnerOperation && !isTenantRepoCreation && !isTenantVariableManagement && isRepositoryRulesetCreationParsedRequest(parsedRequest);
  const isRepositoryRulesetDeletion = !isTenantRunnerOperation && !isTenantRepoCreation && !isTenantVariableManagement && !isRepositoryRulesetCreation && isRepositoryRulesetDeletionParsedRequest(parsedRequest);
  const isRepositoryRulesetOperation = isRepositoryRulesetCreation || isRepositoryRulesetDeletion;
  const isTenantCreation = !isOrgVariableManagement && !isTenantSubteamCreation && !isRepoAdminMembership && !isCicdAdminMembership && !isTenantRunnerOperation && !isTenantVariableManagement && !isRepositoryRulesetOperation && isTenantCreationParsedRequest(parsedRequest);
  const isTeamCreation = !isOrgVariableManagement && !isTenantSubteamCreation && !isRepoAdminMembership && !isCicdAdminMembership && !isTenantVariableManagement && !isRepositoryRulesetOperation && isTeamCreationParsedRequest(parsedRequest);
  const isTeamHierarchy = !isOrgVariableManagement && !isTenantSubteamCreation && !isRepoAdminMembership && !isCicdAdminMembership && !isTenantVariableManagement && !isRepositoryRulesetOperation && isTeamHierarchyParsedRequest(parsedRequest);
  const priorAttachmentRetryState = readPriorAttachmentRetryState(artifactPath);
  const priorArtifact = priorAttachmentRetryState.priorArtifact;
  const issueLabels = readIssueLabelsFromEnv(env);
  const teamHierarchyRepositoryPolicy = parseJsonFromEnv(env.TEAM_HIERARCHY_POLICY_JSON) || {};
  const teamRepoAccessRepositoryPolicy = parseJsonFromEnv(env.TEAM_REPO_ACCESS_POLICY_JSON) || {};
  const operation = isOrgVariableManagement
    ? 'org_variable_management'
    : isTenantSubteamCreation
    ? 'tenant_subteam_creation'
    : isRepoAdminMembership
    ? 'repo_admin_membership'
    : isCicdAdminMembership
    ? 'cicd_admin_membership'
    : isTenantVariableManagement
    ? 'tenant_variable_management'
    : isRepositoryRulesetCreation
    ? 'repository_ruleset_creation'
    : isRepositoryRulesetDeletion
    ? 'repository_ruleset_deletion'
    : isTeamRepoAccess
    ? 'team_repo_access'
    : isTeamRepoAccessRemoval
      ? 'team_repo_access_removal'
    : isTenantRepoCreation
      ? 'tenant_repo_creation'
      : isHostedRunnerCreation
        ? 'hosted_runner_creation'
        : isHostedRunnerMove
          ? 'hosted_runner_move'
          : isHostedRunnerDeletion
            ? 'hosted_runner_deletion'
          : isRunnerGroupCreation
            ? 'runner_group_creation'
      : isTenantCreation
        ? 'tenant_creation'
        : isTeamCreation
          ? 'team_creation'
          : isTeamHierarchy
            ? 'team_hierarchy'
            : 'team_membership';
  const terminalStatusFromIssueLabels = deriveTerminalStatusFromIssueLabels(issueLabels, operation);
  const request = (isOrgVariableManagement
    ? parseOrgVariablesRequest
    : isTenantSubteamCreation
    ? parseTenantSubteamRequest
    : isRepoAdminMembership
    ? parseRepoAdminMembershipRequest
    : isCicdAdminMembership
    ? parseCicdAdminMembershipRequest
    : isTenantVariableManagement
    ? parseTenantVariablesRequest
    : isRepositoryRulesetOperation
    ? parseRepositoryRulesetRequest
    : isTeamRepoAccess
    ? parseTeamRepoAccessRequest
    : isTeamRepoAccessRemoval
      ? parseTeamRepoAccessRemovalRequest
    : isTenantRepoCreation
      ? parseTenantRepoRequest
    : isHostedRunnerCreation
      ? parseHostedRunnerRequest
    : isHostedRunnerMove
      ? parseHostedRunnerMoveRequest
      : isHostedRunnerDeletion
        ? parseHostedRunnerDeletionRequest
    : isRunnerGroupCreation
      ? parseRunnerGroupRequest
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
    rulesetOperation: isRepositoryRulesetDeletion ? 'delete' : isRepositoryRulesetCreation ? 'create' : undefined,
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
    if (operation === 'team_hierarchy' && tokenInfo.source !== 'ISSUEOPS_GITHUB_TOKEN') {
      validation = buildInsufficientHierarchyTokenValidation(request, tokenInfo);
    } else if (!tokenInfo.token) {
      if (operation === 'team_repo_access') {
        validation = buildMissingTokenRepoAccessValidation(request);
      } else if (operation === 'team_repo_access_removal') {
        validation = buildMissingTokenRepoAccessRemovalValidation(request);
      } else if (operation === 'tenant_repo_creation') {
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
      } else if (operation === 'hosted_runner_creation' || operation === 'hosted_runner_deletion' || operation === 'hosted_runner_move' || operation === 'runner_group_creation' || operation === 'tenant_variable_management' || operation === 'org_variable_management' || operation === 'tenant_subteam_creation' || operation === 'repo_admin_membership' || operation === 'cicd_admin_membership' || operation === 'repository_ruleset_creation' || operation === 'repository_ruleset_deletion') {
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
      } else if (operation === 'team_hierarchy') {
        validation = buildMissingTokenHierarchyValidation(request);
      } else if (operation === 'tenant_creation') {
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
      } else if (operation === 'team_creation') {
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
      const runnerApi = (isHostedRunnerCreation || isHostedRunnerDeletion || isHostedRunnerMove || isRunnerGroupCreation)
        ? (options.runnerApi || createGitHubRunnerApi({ token: tokenInfo.token }))
        : null;
      const orgVariablesApi = (isTenantVariableManagement || isOrgVariableManagement)
        ? (options.orgVariablesApi || createGitHubOrgVariablesApi({ token: tokenInfo.token }))
        : null;
      const rulesetsApi = isRepositoryRulesetOperation
        ? (options.rulesetsApi || createGitHubRepoRulesetsApi({ token: tokenInfo.token }))
        : null;
      if (operation === 'team_repo_access') {
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
      } else if (operation === 'team_repo_access_removal') {
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
      } else if (operation === 'tenant_repo_creation') {
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
          issueComments,
          latestFailedValidationAt: priorAttachmentRetryState.latestFailedValidationAt,
          latestFailedValidationAttemptId: priorAttachmentRetryState.latestFailedValidationAttemptId,
          token: tokenInfo.token,
          fetchImpl: options.fetchImpl,
          maxAttachmentBytes: options.maxAttachmentBytes,
          maxRetries: options.maxRetries,
          sleep: options.sleep,
          registryRef: env.TENANT_REGISTRY_REF || 'main',
          registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
        });
        validation.request = {
          ...validation.request,
          no_mutation_evidence: validation.request && validation.request.dry_run
            ? {
                mode: 'dry_run_validation_only',
                no_mutation_planned: true,
              }
            : null,
        };
        reconciliationPlan = reconcileTenantRepoCreation({
          request: validation.request,
          canonical_tenant_context: validation.canonical_tenant_context,
          organization_visible: validation.organization_visible,
          repository_state: validation.repository_state,
          current_repo_admin_permission: validation.current_repo_admin_permission,
          duplicate_owned_repository_conflict: validation.validation_findings && validation.validation_findings.duplicate_owned_repository_conflict,
          dry_run: validation.request.dry_run,
          boundary_revalidation_status: 'matched',
        });
      } else if (operation === 'hosted_runner_creation') {
        validation = await validateHostedRunnerRequest(request, {
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
          listHostedRunners: ({ organization }) => executeGitHubReadWithRetry(
            () => runnerApi.listHostedRunners({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          listRunnerGroups: ({ organization }) => executeGitHubReadWithRetry(
            () => runnerApi.listRunnerGroups({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          registryRef: env.TENANT_REGISTRY_REF || 'main',
          registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
        });
        reconciliationPlan = reconcileHostedRunnerCreation({
          request: validation.request,
          canonical_tenant_context: validation.canonical_tenant_context,
          organization_visible: validation.organization_visible,
          runner_exists: validation.runner_exists,
          existing_runner_id: validation.existing_runner_id,
          runner_group_resolution: validation.runner_group_resolution,
          dry_run: validation.request.dry_run,
          boundary_revalidation_status: 'matched',
        });
      } else if (operation === 'hosted_runner_move') {
        validation = await validateHostedRunnerMoveRequest(request, {
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
          listHostedRunners: ({ organization }) => executeGitHubReadWithRetry(
            () => runnerApi.listHostedRunners({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          listRunnerGroups: ({ organization }) => executeGitHubReadWithRetry(
            () => runnerApi.listRunnerGroups({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          registryRef: env.TENANT_REGISTRY_REF || 'main',
          registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
        });
        reconciliationPlan = reconcileHostedRunnerMove({
          request: validation.request,
          canonical_tenant_context: validation.canonical_tenant_context,
          organization_visible: validation.organization_visible,
          runner_exists: validation.runner_exists,
          existing_runner_id: validation.existing_runner_id,
          current_runner_group_id: validation.current_runner_group_id,
          target_runner_group_resolution: validation.target_runner_group_resolution,
          runner_already_in_target_group: validation.runner_already_in_target_group,
          dry_run: validation.request.dry_run,
          boundary_revalidation_status: 'matched',
        });
      } else if (operation === 'hosted_runner_deletion') {
        validation = await validateHostedRunnerDeletionRequest(request, {
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
          listHostedRunners: ({ organization }) => executeGitHubReadWithRetry(
            () => runnerApi.listHostedRunners({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          registryRef: env.TENANT_REGISTRY_REF || 'main',
          registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
        });
        reconciliationPlan = reconcileHostedRunnerDeletion({
          request: validation.request,
          canonical_tenant_context: validation.canonical_tenant_context,
          organization_visible: validation.organization_visible,
          runner_exists: validation.runner_exists,
          existing_runner_id: validation.existing_runner_id,
          dry_run: validation.request.dry_run,
          boundary_revalidation_status: 'matched',
        });
      } else if (operation === 'runner_group_creation') {
        validation = await validateRunnerGroupRequest(request, {
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
          listRunnerGroups: ({ organization }) => executeGitHubReadWithRetry(
            () => runnerApi.listRunnerGroups({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          registryRef: env.TENANT_REGISTRY_REF || 'main',
          registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
        });
        reconciliationPlan = reconcileRunnerGroupCreation({
          request: validation.request,
          canonical_tenant_context: validation.canonical_tenant_context,
          organization_visible: validation.organization_visible,
          runner_group_exists: validation.runner_group_exists,
          existing_runner_group_id: validation.existing_runner_group_id,
          dry_run: validation.request.dry_run,
          boundary_revalidation_status: 'matched',
        });
      } else if (operation === 'org_variable_management') {
        validation = await validateOrgVariablesRequest(request, {
          getOrganization: ({ organization }) => executeGitHubReadWithRetry(
            () => api.getOrganization({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getOrganizationMembership: ({ organization, username }) => executeGitHubReadWithRetry(
            () => api.getOrganizationMembership({ organization, username }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          listOrganizationVariables: ({ organization }) => executeGitHubReadWithRetry(
            () => orgVariablesApi.listOrganizationVariables({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
        });
        reconciliationPlan = {
          dry_run: Boolean(validation.request && validation.request.dry_run),
          boundary_revalidation_status: 'matched',
          state: validation.request && validation.request.dry_run ? 'validated' : 'approved_for_execution',
        };
      } else if (operation === 'tenant_subteam_creation') {
        const subteamIssueComments = env.ISSUE_NUMBER
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
        validation = await validateTenantSubteamRequest(request, {
          getOrganization: ({ organization }) => executeGitHubReadWithRetry(
            () => api.getOrganization({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getTeamBySlug: ({ organization, teamSlug }) => executeGitHubReadWithRetry(
            () => api.getTeamBySlug({ organization, teamSlug }),
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
          issueComments: subteamIssueComments,
          latestFailedValidationAt: priorAttachmentRetryState.latestFailedValidationAt,
          latestFailedValidationAttemptId: priorAttachmentRetryState.latestFailedValidationAttemptId,
          token: tokenInfo.token,
          fetchImpl: options.fetchImpl,
          maxAttachmentBytes: options.maxAttachmentBytes,
          maxRetries: options.maxRetries,
          sleep: options.sleep,
          registryRef: env.TENANT_REGISTRY_REF || 'main',
          registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
        });
        // Read-only maintainer preview so the validation plan matches what the
        // executor will actually assign on the create-team path.
        const subteamRootMaintainerPreview = validation.is_valid && validation.requested_teams.some((team) => team.desired_action === 'create_team') && typeof api.listTeamMaintainers === 'function'
          ? await executeGitHubReadWithRetry(
              () => api.listTeamMaintainers({
                organization: validation.request.organization,
                teamSlug: validation.request.tenant_team_slug,
              }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            )
          : [];
        reconciliationPlan = reconcileTenantSubteamCreation({
          request: validation.request,
          validatedTeams: validation.requested_teams,
          rootTeamMaintainers: subteamRootMaintainerPreview,
          parent_team_slug: validation.request.parent_team_slug,
          parent_team_id: validation.parent_team_id,
          tenant_root_team_slug: validation.request.tenant_team_slug,
          tenant_root_team_id: validation.root_team_id,
          dry_run: validation.request.dry_run,
        });
      } else if (operation === 'repo_admin_membership') {
        const repoAdminIssueComments = env.ISSUE_NUMBER
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
        validation = await validateRepoAdminMembershipRequest(request, {
          getOrganization: ({ organization }) => executeGitHubReadWithRetry(
            () => api.getOrganization({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getTeamBySlug: ({ organization, teamSlug }) => executeGitHubReadWithRetry(
            () => api.getTeamBySlug({ organization, teamSlug }),
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
          issueComments: repoAdminIssueComments,
          latestFailedValidationAt: priorAttachmentRetryState.latestFailedValidationAt,
          latestFailedValidationAttemptId: priorAttachmentRetryState.latestFailedValidationAttemptId,
          token: tokenInfo.token,
          fetchImpl: options.fetchImpl,
          maxAttachmentBytes: options.maxAttachmentBytes,
          maxRetries: options.maxRetries,
          sleep: options.sleep,
          registryRef: env.TENANT_REGISTRY_REF || 'main',
          registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
        });
        const currentRepoAdminMembers = validation.repo_admin_team_exists && typeof api.listTeamMembers === 'function'
          ? await executeGitHubReadWithRetry(
              () => api.listTeamMembers({
                organization: validation.request.organization,
                teamSlug: validation.request.repo_admin_team_slug,
              }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            )
          : [];
        // Read-only maintainer preview so the validation plan matches what the
        // executor will actually assign on the create-team path.
        const repoAdminRootMaintainerPreview = !validation.repo_admin_team_exists && validation.is_valid && typeof api.listTeamMaintainers === 'function'
          ? await executeGitHubReadWithRetry(
              () => api.listTeamMaintainers({
                organization: validation.request.organization,
                teamSlug: validation.request.tenant_team_slug,
              }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            )
          : [];
        reconciliationPlan = reconcileRepoAdminMembership({
          request: validation.request,
          validatedPeople: validation.requested_people,
          repo_admin_team_exists: validation.repo_admin_team_exists,
          currentMembers: currentRepoAdminMembers,
          rootTeamMaintainers: repoAdminRootMaintainerPreview,
          repo_admin_team_slug: validation.request.repo_admin_team_slug,
          tenant_root_team_slug: validation.request.tenant_team_slug,
          tenant_root_team_id: validation.root_team_id,
          dry_run: validation.request.dry_run,
        });
      } else if (operation === 'cicd_admin_membership') {
        const cicdIssueComments = env.ISSUE_NUMBER
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
        validation = await validateCicdAdminMembershipRequest(request, {
          getOrganization: ({ organization }) => executeGitHubReadWithRetry(
            () => api.getOrganization({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getTeamBySlug: ({ organization, teamSlug }) => executeGitHubReadWithRetry(
            () => api.getTeamBySlug({ organization, teamSlug }),
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
          issueComments: cicdIssueComments,
          latestFailedValidationAt: priorAttachmentRetryState.latestFailedValidationAt,
          latestFailedValidationAttemptId: priorAttachmentRetryState.latestFailedValidationAttemptId,
          token: tokenInfo.token,
          fetchImpl: options.fetchImpl,
          maxAttachmentBytes: options.maxAttachmentBytes,
          maxRetries: options.maxRetries,
          sleep: options.sleep,
          registryRef: env.TENANT_REGISTRY_REF || 'main',
          registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
        });
        const currentCicdMembers = validation.cicd_admin_team_exists && typeof api.listTeamMembers === 'function'
          ? await executeGitHubReadWithRetry(
              () => api.listTeamMembers({
                organization: validation.request.organization,
                teamSlug: validation.request.cicd_admin_team_slug,
              }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            )
          : [];
        // Read-only maintainer preview so the validation plan matches what the
        // executor will actually assign on the create-team path.
        const cicdRootMaintainerPreview = !validation.cicd_admin_team_exists && validation.is_valid && typeof api.listTeamMaintainers === 'function'
          ? await executeGitHubReadWithRetry(
              () => api.listTeamMaintainers({
                organization: validation.request.organization,
                teamSlug: validation.request.tenant_team_slug,
              }),
              { maxRetries: options.maxRetries || 2, sleep: options.sleep }
            )
          : [];
        reconciliationPlan = reconcileCicdAdminMembership({
          request: validation.request,
          validatedPeople: validation.requested_people,
          cicd_admin_team_exists: validation.cicd_admin_team_exists,
          currentMembers: currentCicdMembers,
          rootTeamMaintainers: cicdRootMaintainerPreview,
          cicd_admin_team_slug: validation.request.cicd_admin_team_slug,
          tenant_root_team_slug: validation.request.tenant_team_slug,
          tenant_root_team_id: validation.root_team_id,
          dry_run: validation.request.dry_run,
        });
      } else if (operation === 'tenant_variable_management') {
        validation = await validateTenantVariablesRequest(request, {
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
          listOrganizationVariables: ({ organization }) => executeGitHubReadWithRetry(
            () => orgVariablesApi.listOrganizationVariables({ organization }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          registryRef: env.TENANT_REGISTRY_REF || 'main',
          registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
        });
        reconciliationPlan = {
          dry_run: Boolean(validation.request && validation.request.dry_run),
          boundary_revalidation_status: 'matched',
          state: validation.request && validation.request.dry_run ? 'validated' : 'approved_for_execution',
        };
      } else if (operation === 'repository_ruleset_creation' || operation === 'repository_ruleset_deletion') {
        validation = await validateRepositoryRulesetRequest(request, {
          getOrganization: ({ organization }) => executeGitHubReadWithRetry(
            () => api.getOrganization({ organization }),
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
          getRepositoryCollaboratorPermission: ({ owner, repo, username }) => executeGitHubReadWithRetry(
            () => rulesetsApi.getRepositoryCollaboratorPermission({ owner, repo, username }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          getRepository: ({ owner, repo }) => executeGitHubReadWithRetry(
            () => rulesetsApi.getRepository({ owner, repo }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          listRepositoryRulesets: ({ owner, repo }) => executeGitHubReadWithRetry(
            () => rulesetsApi.listRepositoryRulesets({ owner, repo }),
            { maxRetries: options.maxRetries || 2, sleep: options.sleep }
          ),
          registryRef: env.TENANT_REGISTRY_REF || 'main',
          registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
        });
        reconciliationPlan = {
          dry_run: Boolean(validation.request && validation.request.dry_run),
          boundary_revalidation_status: validation.is_valid ? 'matched' : 'mismatched',
          ruleset_operation: validation.plan && validation.plan.ruleset_operation,
          entries: validation.plan && validation.plan.entries,
          valid_entry_count: validation.plan && validation.plan.valid_entry_count,
          rejected_entry_count: validation.plan && validation.plan.rejected_entry_count,
          state: validation.request && validation.request.dry_run ? 'validated' : 'approved_for_execution',
        };
      } else if (operation === 'tenant_creation') {
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
        const cicdCapabilityIntent = validation.request && validation.request.cicd_capability_intent
          ? validation.request.cicd_capability_intent
          : {
              requested: true,
              primary_path_available: true,
              primary_policy_approved: true,
              fallback_path_available: true,
              fallback_policy_approved: true,
              tenant_scope_resolvable: true,
            };
        const cicdCapabilityDecision = evaluateCicdCapabilityPath(cicdCapabilityIntent);
        validation.request = {
          ...validation.request,
          cicd_capability_intent: cicdCapabilityIntent,
          cicd_capability_status: cicdCapabilityDecision.status,
          cicd_capability_reason_code: cicdCapabilityDecision.reason_code,
        };
        reconciliationPlan = reconcileTenantCreation({
          request: validation.request,
          requested_teams: validation.requested_teams,
          current_teams: validation.existing_teams,
          organization_exists: validation.organization_visible,
          dry_run: validation.request.dry_run,
        });
        reconciliationPlan.cicd_capability_decision = cicdCapabilityDecision;
      } else if (operation === 'team_creation') {
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
      } else if (operation === 'team_hierarchy') {
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
          getOrganizationMembership: ({ organization, username }) => executeGitHubReadWithRetry(
            () => api.getOrganizationMembership({ organization, username }),
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
    // Build appropriate validation error response based on request type
    const detailedErrorMessage = buildDetailedErrorMessage(error);
    if (isTenantVariableManagement || isRepositoryRulesetOperation) {
      validation = {
        is_valid: false,
        request_status: 'validation_failed',
        errors: [detailedErrorMessage],
        warnings: [],
        organization_visible: false,
        designated_approver_authorization: null,
        canonical_tenant_context: null,
        tenant_resolution: {
          tenant_match_count: 0,
          tenant_resolution_status: 'validation_error',
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
      validation = {
        is_valid: false,
        request_status: 'validation_failed',
        errors: [detailedErrorMessage],
        warnings: [],
        organization_visible: false,
        parent_team_exists: false,
        designated_approver_authorization: null,
        requested_child_links: (request.requested_child_links || []).map((childLink) => ({
          ...childLink,
          validation_status: 'rejected',
          desired_action: 'reject',
          execution_result: 'not_started',
          failure_reason: 'validation_error',
        })),
        existing_child_links: [],
        request: {
          ...request,
          request_status: 'validation_failed',
        },
      };
    } else if (isTeamCreation) {
      validation = {
        is_valid: false,
        request_status: 'validation_failed',
        errors: [detailedErrorMessage],
        warnings: [],
        organization_visible: false,
        intended_owner_membership: null,
        bulk_csv_submission: request.bulk_csv_submission,
        csv_row_findings: request.csv_row_findings || [],
        csv_row_numbering_convention: request.csv_row_numbering_convention,
        requested_teams: (request.requested_teams || []).map((team) => ({
          ...team,
          validation_status: 'rejected',
          desired_action: 'reject',
          execution_result: 'not_started',
          failure_reason: 'validation_error',
        })),
        existing_teams: [],
        request: {
          ...request,
          request_status: 'validation_failed',
        },
      };
    } else if (isTenantCreation) {
      validation = {
        is_valid: false,
        request_status: 'validation_failed',
        errors: [detailedErrorMessage],
        warnings: [],
        organization_visible: false,
        designated_approver_authorization: null,
        requester_eligibility: null,
        requested_teams: (request.requested_teams || []).map((team) => ({
          ...team,
          validation_status: 'rejected',
          desired_action: 'reject',
          execution_result: 'not_started',
          failure_reason: 'validation_error',
        })),
        existing_teams: [],
        request: {
          ...request,
          request_status: 'validation_failed',
        },
      };
    } else if (isTenantRepoCreation) {
      validation = {
        is_valid: false,
        request_status: 'validation_failed',
        errors: [detailedErrorMessage],
        warnings: [],
        organization_visible: false,
        designated_approver_authorization: null,
        canonical_tenant_context: null,
        tenant_resolution: {
          tenant_match_count: 0,
          tenant_resolution_status: 'validation_error',
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
    } else if (isTeamRepoAccess) {
      validation = {
        is_valid: false,
        request_status: 'validation_failed',
        errors: [detailedErrorMessage],
        warnings: [],
        organization_visible: false,
        team_exists: false,
        requested_repository_grants: [],
        request: {
          ...request,
          request_status: 'validation_failed',
        },
      };
    } else if (isTeamRepoAccessRemoval) {
      validation = {
        is_valid: false,
        request_status: 'validation_failed',
        errors: [detailedErrorMessage],
        warnings: [],
        organization_visible: false,
        team_exists: false,
        requested_repository_removals: [],
        request: {
          ...request,
          request_status: 'validation_failed',
        },
      };
    } else {
      // Default case for team membership requests
      validation = {
        is_valid: false,
        request_status: 'validation_failed',
        errors: [detailedErrorMessage],
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
  }

  executionOutcome = executionOutcome || buildExecutionOutcome({
    executionResults: [],
    operationLabel: isOrgVariableManagement
      ? 'org_variable'
      : isTenantSubteamCreation
      ? 'tenant_subteam'
      : isRepoAdminMembership
      ? 'repo_admin_membership'
      : isCicdAdminMembership
      ? 'cicd_admin_membership'
      : isTenantVariableManagement
      ? 'variable'
      : isRepositoryRulesetOperation
      ? 'repository_ruleset'
      : (isTeamRepoAccess || isTeamRepoAccessRemoval)
      ? 'repository'
      : isTenantRepoCreation
        ? 'tenant_repository'
        : isHostedRunnerCreation || isHostedRunnerDeletion || isHostedRunnerMove
          ? 'hosted_runner'
          : isRunnerGroupCreation
            ? 'runner_group'
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
    cicd_capability: reconciliationPlan && reconciliationPlan.cicd_capability_decision
      ? reconciliationPlan.cicd_capability_decision
      : null,
    cicd_topology_update_outcome: reconciliationPlan && reconciliationPlan.cicd_topology_update_result
      ? reconciliationPlan.cicd_topology_update_result.status || null
      : null,
  });

  if (!approvalArtifact) {
    executionOutcome.summary = validation.request_status === 'waiting_for_attachment'
      ? 'Request metadata is valid, but execution remains blocked until the requester posts a qualifying CSV attachment comment.'
      : validation.is_valid
      ? isOrgVariableManagement
        ? 'Request is validated and ready for approval. No organization variable mutation was attempted.'
      : isTenantSubteamCreation
        ? 'Request is validated and ready for approval. No tenant subteam mutation was attempted.'
      : isRepoAdminMembership
        ? 'Request is validated and ready for approval. No repo admin team or membership mutation was attempted.'
      : isCicdAdminMembership
        ? 'Request is validated and ready for approval. No CI/CD admin team or membership mutation was attempted.'
        : isTenantVariableManagement
        ? 'Request is validated and ready for approval. No tenant variable mutation was attempted.'
        : isRepositoryRulesetOperation
        ? 'Request is validated and ready for approval. No repository ruleset mutation was attempted.'
        : (isTeamRepoAccess || isTeamRepoAccessRemoval)
        ? 'Request is validated and ready for approval. No repository-access mutation was attempted.'
        : isTenantRepoCreation
        ? 'Request is validated and ready for approval. No tenant repository mutation was attempted.'
        : isHostedRunnerCreation
        ? 'Request is validated and ready for approval. No hosted-runner mutation was attempted.'
        : isHostedRunnerMove
        ? 'Request is validated and ready for approval. No hosted-runner move was attempted.'
        : isHostedRunnerDeletion
        ? 'Request is validated and ready for approval. No hosted-runner deletion was attempted.'
        : isRunnerGroupCreation
        ? 'Request is validated and ready for approval. No runner-group mutation was attempted.'
        : isTenantCreation
        ? 'Request is validated and ready for approval. No tenant bootstrap mutation was attempted.'
        : isTeamCreation
        ? 'Request is validated and ready for approval. No team creation was attempted.'
        : isTeamHierarchy
        ? 'Request is validated and ready for approval. No child-team mutation was attempted.'
        : 'Request is validated and ready for approval. No membership mutation was attempted.'
      : isOrgVariableManagement
        ? 'Request validation failed. No organization variable mutation was attempted.'
      : isTenantSubteamCreation
        ? 'Request validation failed. No tenant subteam mutation was attempted.'
      : isRepoAdminMembership
        ? 'Request validation failed. No repo admin team or membership mutation was attempted.'
      : isCicdAdminMembership
        ? 'Request validation failed. No CI/CD admin team or membership mutation was attempted.'
        : isTenantVariableManagement
        ? 'Request validation failed. No tenant variable mutation was attempted.'
        : isRepositoryRulesetOperation
        ? 'Request validation failed. No repository ruleset mutation was attempted.'
        : (isTeamRepoAccess || isTeamRepoAccessRemoval)
        ? 'Request validation failed. No repository-access mutation was attempted.'
        : isTenantRepoCreation
        ? 'Request validation failed. No tenant repository mutation was attempted.'
        : isHostedRunnerCreation
        ? 'Request validation failed. No hosted-runner mutation was attempted.'
        : isHostedRunnerMove
        ? 'Request validation failed. No hosted-runner move was attempted.'
        : isHostedRunnerDeletion
        ? 'Request validation failed. No hosted-runner deletion was attempted.'
        : isRunnerGroupCreation
        ? 'Request validation failed. No runner-group mutation was attempted.'
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
    // Fallback artifact writing when validation crashes before normal artifact generation
    try {
      const env = process.env;
      const artifactPath = path.resolve(
        env.AUDIT_ARTIFACT_PATH ||
          path.join(
            'artifacts',
              `${isOrgVariablesManagementParsedRequest(readParsedRequestFromEnv(env)) ? 'manage-org-variables' : isTenantSubteamCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-tenant-subteam' : isRepoAdminMembershipParsedRequest(readParsedRequestFromEnv(env)) ? 'add-repo-admin-to-tenant' : isCicdAdminMembershipParsedRequest(readParsedRequestFromEnv(env)) ? 'add-cicd-admin-to-tenant' : isTenantVariablesManagementParsedRequest(readParsedRequestFromEnv(env)) ? 'manage-tenant-variables' : isRepositoryRulesetCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-repository-ruleset' : isRepositoryRulesetDeletionParsedRequest(readParsedRequestFromEnv(env)) ? 'delete-repository-ruleset' : isTeamRepoAccessParsedRequest(readParsedRequestFromEnv(env)) ? 'add-team-repo-access' : isTeamRepoAccessRemovalParsedRequest(readParsedRequestFromEnv(env)) ? 'remove-team-repo-access' : isTenantRepoCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-tenant-repos' : isTenantCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-tenant-model' : isTeamCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-org-teams' : isTeamHierarchyParsedRequest(readParsedRequestFromEnv(env)) ? 'add-child-teams' : 'add-team-members'}-validation-${env.ISSUE_NUMBER || 'manual'}.json`
          )
      );
      
      const stubArtifact = {
        request: { request_status: 'validation_failed' },
        validation: {
          is_valid: false,
          request_status: 'validation_failed',
          errors: [buildDetailedErrorMessage(error)],
          warnings: [],
        },
        approval: { approval_status: 'not_requested', approver_role: 'other' },
        reconciliationPlan: {},
        executionOutcome: {
          terminal_state: 'validation_failed',
          mutation_count: 0,
          summary: `Validation crashed: ${buildDetailedErrorMessage(error)}`,
        },
        metadata: {
          operation: isOrgVariablesManagementParsedRequest(readParsedRequestFromEnv(env)) ? 'org_variable_management' : isTenantSubteamCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'tenant_subteam_creation' : isRepoAdminMembershipParsedRequest(readParsedRequestFromEnv(env)) ? 'repo_admin_membership' : isCicdAdminMembershipParsedRequest(readParsedRequestFromEnv(env)) ? 'cicd_admin_membership' : isTenantVariablesManagementParsedRequest(readParsedRequestFromEnv(env)) ? 'tenant_variable_management' : isRepositoryRulesetCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'repository_ruleset_creation' : isRepositoryRulesetDeletionParsedRequest(readParsedRequestFromEnv(env)) ? 'repository_ruleset_deletion' : isTeamRepoAccessParsedRequest(readParsedRequestFromEnv(env)) ? 'team_repo_access' : isTeamRepoAccessRemovalParsedRequest(readParsedRequestFromEnv(env)) ? 'team_repo_access_removal' : isTenantRepoCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'tenant_repo_creation' : isTenantCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'tenant_creation' : isTeamCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'team_creation' : isTeamHierarchyParsedRequest(readParsedRequestFromEnv(env)) ? 'team_hierarchy' : 'team_membership',
        },
      };

      fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
      fs.writeFileSync(artifactPath, JSON.stringify(stubArtifact, null, 2), 'utf8');
      writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
      writeGitHubOutput('audit-artifact-name', path.basename(artifactPath), env.GITHUB_OUTPUT);
    } catch (fallbackError) {
      console.error('Failed to write fallback artifact:', fallbackError);
    }

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
  isHostedRunnerCreationParsedRequest,
  isHostedRunnerDeletionParsedRequest,
  isHostedRunnerMoveParsedRequest,
  isRunnerGroupCreationParsedRequest,
  isTenantVariablesManagementParsedRequest,
  isOrgVariablesManagementParsedRequest,
  isTenantSubteamCreationParsedRequest,
  isRepoAdminMembershipParsedRequest,
  isCicdAdminMembershipParsedRequest,
  isRepositoryRulesetCreationParsedRequest,
  isRepositoryRulesetDeletionParsedRequest,
  parseParsedRequestJson,
  parseJsonFromEnv,
  readIssueLabelsFromEnv,
  readParsedRequestFromEnv,
  buildCommentContextFromEnv,
  runRequestValidation,
};
