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
const { buildAuditArtifact, toAuditArtifactJson } = require('../workflow-support/build-audit-artifact');
const { buildExecutionOutcome } = require('../workflow-support/build-execution-outcome');
const { createGitHubTeamApi } = require('../workflow-support/github-team-api');
const { createGitHubTeamRepoApi } = require('../workflow-support/github-team-repo-api');
const { executeWithBoundedRetry } = require('../workflow-support/handle-rate-limit');
const { buildTenantBootstrapRateLimitContext } = require('../workflow-support/handle-rate-limit');
const { persistTenantRegistryRecord } = require('../workflow-support/persist-tenant-registry-record');
const { commitRegistryRecord } = require('../workflow-support/commit-registry-record');
const { reconcileTenantCreation } = require('../workflow-support/reconcile-tenant-creation');
const { reconcileTenantRepoCreation } = require('../workflow-support/reconcile-tenant-repo-creation');
const { reconcileTeamHierarchy } = require('../workflow-support/reconcile-team-hierarchy');
const { reconcileTeamCreation } = require('../workflow-support/reconcile-team-creation');
const { reconcileTeamMembers } = require('../workflow-support/reconcile-team-members');
const { reconcileTeamRepoAccess } = require('../workflow-support/reconcile-team-repo-access');
const { validateTeamRepoAccessRequest } = require('../workflow-support/validate-team-repo-access-request');
const { validateTenantRepoRequest } = require('../workflow-support/validate-tenant-repo-request');
const { emitAuditSummary } = require('./emit-audit-summary');

function terminalStateLabelPrefix(operation) {
  const operationPrefixes = {
    team_creation: 'issueops:create-org-teams:',
    team_hierarchy: 'issueops:add-child-teams:',
    team_repo_access: 'issueops:add-team-repo-access:',
    tenant_repo_creation: 'issueops:create-tenant-repos:',
    tenant_creation: 'issueops:create-tenant-model:',
  };
  return operationPrefixes[operation] || 'issueops:add-team-members:';
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

async function runApprovedExecution(options = {}) {
  const env = options.env || process.env;
  const shouldSetExitCode = options.setProcessExitCode === true;
  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join('artifacts', `add-team-members-validation-${env.ISSUE_NUMBER || 'manual'}.json`)
  );
  const auditArtifact = readAuditArtifact(artifactPath);
  const isTeamRepoAccess = auditArtifact.metadata && auditArtifact.metadata.operation === 'team_repo_access';
  const isTenantRepoCreation = auditArtifact.metadata && auditArtifact.metadata.operation === 'tenant_repo_creation';
  const isTenantCreation = auditArtifact.metadata && auditArtifact.metadata.operation === 'tenant_creation';
  const isTeamHierarchy = auditArtifact.metadata && auditArtifact.metadata.operation === 'team_hierarchy';
  const isTeamCreation = auditArtifact.metadata && auditArtifact.metadata.operation === 'team_creation';
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
      ? assertTenantBootstrapMembershipAllowed({
          approval_status: auditArtifact.approval.approval_status,
          approver_role: auditArtifact.approval.approver_role,
          requester_login: auditArtifact.request.requester_login,
          dry_run: auditArtifact.request.dry_run,
          tokenInfo: options.tokenInfo,
        })
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
      operationLabel: isTeamCreation ? 'team' : isTeamHierarchy ? 'child link' : (isTeamRepoAccess || isTenantRepoCreation) ? 'repository' : 'membership',
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
    auditArtifact.execution.summary = `${error.message}. No ${isTenantCreation ? 'tenant bootstrap mutation' : isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team mutation' : isTenantRepoCreation ? 'tenant repository mutation' : isTeamRepoAccess ? 'repository-access mutation' : 'membership mutation'} was attempted.`;
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
    auditArtifact.execution.summary = `Approved execution remains blocked because the request is dry-run only. No ${isTenantCreation ? 'tenant bootstrap mutation' : isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team mutation' : isTenantRepoCreation ? 'tenant repository mutation' : isTeamRepoAccess ? 'repository-access mutation' : 'membership mutation'} was attempted.`;
    auditArtifact.execution.rollback_status = auditArtifact.execution.rollback_status || 'not_needed';
    writeGitHubOutput('execution-status', mutationDecision.reason, env.GITHUB_OUTPUT);
    emitAuditSummary(auditArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });
    return auditArtifact;
  }

  const api = options.createApi
    ? options.createApi({ token: mutationDecision.tokenInfo.token, auditArtifact })
    : (isTeamRepoAccess || isTenantRepoCreation)
      ? createGitHubTeamRepoApi({ token: mutationDecision.tokenInfo.token })
      : createGitHubTeamApi({ token: mutationDecision.tokenInfo.token });
  const teamApi = options.teamApi || createGitHubTeamApi({ token: mutationDecision.tokenInfo.token });
  let repoAccessValidation = auditArtifact.validation;
  let tenantRepoValidation = auditArtifact.validation;
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
    isTenantRepoCreation &&
    typeof teamApi.getOrganization === 'function' &&
    typeof teamApi.listOrgTeams === 'function' &&
    typeof teamApi.getMembershipForUser === 'function' &&
    typeof teamApi.getOrganizationMembership === 'function' &&
    typeof api.getRepository === 'function' &&
    typeof api.getTeamRepositoryPermission === 'function'
  ) {
    tenantRepoValidation = await validateTenantRepoRequest(auditArtifact.request, {
      getOrganization: ({ organization }) => teamApi.getOrganization({ organization }),
      listTeams: ({ organization }) => teamApi.listOrgTeams({ organization }),
      getMembershipForUser: ({ organization, teamSlug, username }) =>
        teamApi.getMembershipForUser({ organization, teamSlug, username }),
      getOrganizationMembership: ({ organization, username }) =>
        teamApi.getOrganizationMembership({ organization, username }),
      getRepository: ({ owner, repo }) => api.getRepository({ owner, repo }),
      getTeamRepositoryPermission: ({ organization, teamSlug, owner, repo }) =>
        api.getTeamRepositoryPermission({ organization, teamSlug, owner, repo }),
      registryRef: env.TENANT_REGISTRY_REF || 'main',
      registryDirectory: env.TENANT_REGISTRY_DIR || 'tenant-registry',
    });
    auditArtifact.validation = {
      ...auditArtifact.validation,
      ...tenantRepoValidation,
    };
  }
  const teamReadApi = (isTenantRepoCreation || isTenantCreation || isTeamCreation || isTeamHierarchy) ? teamApi : api;
  const currentTeams = (isTenantCreation || isTeamCreation || isTeamHierarchy || isTenantRepoCreation)
    ? await teamReadApi.listOrgTeams({
        organization: auditArtifact.request.organization,
      })
    : null;
  let tenantRequesterMembership = null;
  if (
    isTenantCreation &&
    typeof api.getMembershipForUser === 'function' &&
    auditArtifact.request &&
    auditArtifact.request.tenant_team_slug &&
    auditArtifact.request.requester_login
  ) {
    tenantRequesterMembership = await api.getMembershipForUser({
      organization: auditArtifact.request.organization,
      teamSlug: auditArtifact.request.tenant_team_slug,
      username: auditArtifact.request.requester_login,
    });
  }
  let latestRateLimitSnapshot = auditArtifact.reconciliation && auditArtifact.reconciliation.rate_limit_snapshot || null;
  let currentMembers = [];
  if (!isTenantCreation && !isTeamCreation && !isTeamHierarchy && !isTeamRepoAccess && !isTenantRepoCreation) {
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
        requesterMembership: tenantRequesterMembership,
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
        dry_run: auditArtifact.request.dry_run,
        boundary_revalidation_status: tenantRepoValidation && tenantRepoValidation.is_valid ? 'matched' : 'mismatched',
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
    if (reconciliationPlan.creation_action === 'noop') {
      executionResults.push({
        repository_full_name: reconciliationPlan.repository_full_name,
        execution_result: 'noop',
        failure_reason: null,
      });
    } else if (reconciliationPlan.creation_action === 'reject') {
      executionResults.push({
        repository_full_name: reconciliationPlan.repository_full_name,
        execution_result: 'failed',
        failure_reason: 'boundary_revalidation_mismatch',
      });
    }

    if (reconciliationPlan.permission_action === 'noop') {
      executionResults.push({
        team_slug: auditArtifact.request.repo_admin_team_slug || null,
        execution_result: 'noop',
        failure_reason: null,
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
              privateVisibility: true,
              description: `Tenant-scoped repository for ${auditArtifact.request.tenant_display_name || auditArtifact.request.tenant_name_input || auditArtifact.request.tenant_key || 'tenant'}`,
            }),
            {
              maxRetries: options.maxRetries || 2,
              sleep: options.sleep,
            }
          );

          latestRateLimitSnapshot = attemptResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;

          executionResults.push({
            repository_full_name: reconciliationPlan.repository_full_name,
            execution_result: attemptResult.ok ? 'created' : 'failed',
            failure_reason: attemptResult.ok ? null : classifyFailureReason(attemptResult.error),
          });
        } else if (reconciliationPlan.creation_action === 'noop') {
          executionResults.push({
            repository_full_name: reconciliationPlan.repository_full_name,
            execution_result: 'noop',
            failure_reason: null,
          });
        } else if (reconciliationPlan.creation_action === 'reject') {
          executionResults.push({
            repository_full_name: reconciliationPlan.repository_full_name,
            execution_result: 'failed',
            failure_reason: 'creation_rejected',
          });
        }

        const creationFailed = executionResults.some((result) =>
          result.repository_full_name === reconciliationPlan.repository_full_name &&
          result.execution_result === 'failed' &&
          result.failure_reason !== 'permission_rejected'
        );

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
              execution_result: attemptResult.ok ? 'granted' : 'failed',
              failure_reason: attemptResult.ok ? null : classifyFailureReason(attemptResult.error),
            });
          }
        } else if (reconciliationPlan.permission_action === 'noop') {
          executionResults.push({
            repository_full_name: reconciliationPlan.repository_full_name,
            execution_result: 'noop',
            failure_reason: null,
          });
        } else if (reconciliationPlan.permission_action === 'reject') {
          executionResults.push({
            repository_full_name: reconciliationPlan.repository_full_name,
            execution_result: 'failed',
            failure_reason: 'permission_rejected',
          });
        }
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
        const childTeam = (refreshedTeams || []).find((team) => String(team.slug || '').toLowerCase() === String(auditArtifact.request.repo_admin_team_slug || '').toLowerCase());

        try {
          if (parentTeam && childTeam) {
            assertTenantBootstrapHierarchyAllowed({
              approval_status: auditArtifact.approval.approval_status,
              approver_login: auditArtifact.approval.approver_login,
              designated_approver_login: auditArtifact.request.designated_approver_login,
              approver_authorization_state: auditArtifact.approval.approver_authorization_state,
              parent_team_slug: auditArtifact.request.tenant_team_slug,
              dry_run: auditArtifact.request.dry_run,
              tokenInfo: mutationDecision.tokenInfo,
            });

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

            assertTenantBootstrapMembershipAllowed({
              approval_status: auditArtifact.approval.approval_status,
              approver_role: auditArtifact.approval.approver_role,
              requester_login: auditArtifact.request.requester_login,
              dry_run: auditArtifact.request.dry_run,
              tokenInfo: mutationDecision.tokenInfo,
            });

            const requesterMembership = typeof api.getMembershipForUser === 'function'
              ? await api.getMembershipForUser({
                  organization: auditArtifact.request.organization,
                  teamSlug: parentTeam.slug,
                  username: auditArtifact.request.requester_login,
                })
              : tenantRequesterMembership;

            const requesterRole = requesterMembership && requesterMembership.membership
              ? String(requesterMembership.membership.role || '').toLowerCase()
              : '';

            if (requesterMembership && requesterMembership.state === 'active' && requesterRole === 'maintainer') {
              executionResults.push({
                username: auditArtifact.request.requester_login,
                execution_result: 'noop',
                failure_reason: null,
              });
            } else {
              const membershipResult = await executeWithBoundedRetry(
                () => api.addOrUpdateTeamMembership({
                  organization: auditArtifact.request.organization,
                  teamSlug: parentTeam.slug,
                  username: auditArtifact.request.requester_login,
                  role: 'maintainer',
                }),
                {
                  maxRetries: options.maxRetries || 2,
                  sleep: options.sleep,
                }
              );

              latestRateLimitSnapshot = membershipResult.retry_plan.rate_limit_snapshot || latestRateLimitSnapshot;
              executionResults.push({
                username: auditArtifact.request.requester_login,
                execution_result: membershipResult.ok ? 'added' : 'failed',
                failure_reason: membershipResult.ok ? null : classifyFailureReason(membershipResult.error),
              });
            }
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
          approver_login: auditArtifact.approval.approver_login,
          lifecycle_status: 'active',
          mode: env.TENANT_REGISTRY_PERSISTENCE_MODE,
          requireDirectory: String(env.TENANT_REGISTRY_REQUIRE_DIRECTORY || 'true').toLowerCase() !== 'false',
          registryDirectory: env.TENANT_REGISTRY_DIR,
          artifactDirectory: path.dirname(artifactPath),
        });

        reconciliationPlan.registry_persistence_result = registryResult;
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
        (result.execution_result === 'created' || result.execution_result === 'failed' || result.execution_result === 'noop')
      )
    : null;
  const tenantRepoPermissionExecutionResult = isTenantRepoCreation
    ? [...executionResults].reverse().find((result) =>
        result.repository_full_name === reconciliationPlan.repository_full_name &&
        (result.execution_result === 'granted' || result.execution_result === 'failed' || result.execution_result === 'noop')
      )
    : null;

  const executionOutcome = buildExecutionOutcome({
    executionResults,
    operationLabel: isTenantCreation
      ? 'tenant_bootstrap'
      : isTenantRepoCreation
        ? 'tenant_repository'
        : isTeamCreation
          ? 'team'
          : isTeamHierarchy
            ? 'child link'
            : isTeamRepoAccess
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
    audit_persistence_result: isTenantRepoCreation ? 'pending' : null,
    artifact_path: artifactPath,
    rate_limit_snapshot: latestRateLimitSnapshot,
  });
  const requestStatus = deriveApprovedExecutionTerminalState(executionOutcome, {
    operation,
    intakeMode: auditArtifact.request && auditArtifact.request.intake_mode,
    approvalStatus: auditArtifact.approval && auditArtifact.approval.approval_status,
  });
  if ((isTenantCreation || isTeamCreation) && executionOutcome.created_count > 0) {
    executionOutcome.summary = `${executionOutcome.summary} Note: GitHub automatically makes the authenticated creator a team maintainer when a new team is created, so the creator becomes a team maintainer as an operational constraint of this workflow.`;
  }
  const summaryPrefix =
    requestStatus === 'executed'
      ? `Approved ${isTenantCreation ? 'tenant bootstrap execution' : isTenantRepoCreation ? 'tenant repository execution' : isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team execution' : isTeamRepoAccess ? 'repository-access execution' : 'execution'} completed.`
      : requestStatus === 'partially_executed'
        ? `Approved ${isTenantCreation ? 'tenant bootstrap execution' : isTenantRepoCreation ? 'tenant repository execution' : isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team execution' : isTeamRepoAccess ? 'repository-access execution' : 'execution'} completed with partial failure.`
        : `Approved ${isTenantCreation ? 'tenant bootstrap execution' : isTenantRepoCreation ? 'tenant repository execution' : isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team execution' : isTeamRepoAccess ? 'repository-access execution' : 'execution'} failed.`;

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

  if (isTenantRepoCreation) {
    updatedArtifact.execution.audit_persistence_result = auditPersistenceResult;
  }

  const shouldAddTerminalLabel =
    updatedArtifact.request &&
    updatedArtifact.request.issue_number != null &&
    typeof api.addIssueLabels === 'function' &&
    (updatedArtifact.request.intake_mode === 'csv_attachment' || isTenantRepoCreation);

  if (shouldAddTerminalLabel) {
    const labelPrefix = terminalStateLabelPrefix(operation);
    try {
      await api.addIssueLabels({
        repository: updatedArtifact.request.repository,
        issueNumber: updatedArtifact.request.issue_number,
        labels: [`${labelPrefix}${updatedArtifact.request.request_status}`],
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