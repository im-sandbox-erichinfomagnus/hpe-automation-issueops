'use strict';

const fs = require('fs');
const path = require('path');

const { buildExecutionOutcome } = require('../workflow-support/build-execution-outcome');
const { buildAuditArtifact, toAuditArtifactJson } = require('../workflow-support/build-audit-artifact');
const { createGitHubTeamApi } = require('../workflow-support/github-team-api');
const { createGitHubTeamRepoApi } = require('../workflow-support/github-team-repo-api');
const { loadWorkflowToken } = require('../workflow-support/load-workflow-token');
const { parseTeamCreationRequest } = require('../workflow-support/parse-team-creation-request');
const { parseTeamHierarchyRequest } = require('../workflow-support/parse-team-hierarchy-request');
const { parseTeamMembershipRequest } = require('../workflow-support/parse-team-membership-request');
const { parseTeamRepoAccessRequest } = require('../workflow-support/parse-team-repo-access-request');
const { reconcileTeamCreation } = require('../workflow-support/reconcile-team-creation');
const { reconcileTeamHierarchy } = require('../workflow-support/reconcile-team-hierarchy');
const { reconcileTeamRepoAccess } = require('../workflow-support/reconcile-team-repo-access');
const { validateTeamCreationRequest } = require('../workflow-support/validate-team-creation-request');
const { validateTeamHierarchyRequest } = require('../workflow-support/validate-team-hierarchy-request');
const { validateTeamMembershipRequest } = require('../workflow-support/validate-team-membership-request');
const { validateTeamRepoAccessRequest } = require('../workflow-support/validate-team-repo-access-request');
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
    target_team: env.PARSED_TARGET_TEAM || '',
    parent_team: env.PARSED_PARENT_TEAM || '',
    designated_hierarchy_approver: env.PARSED_DESIGNATED_HIERARCHY_APPROVER || '',
    designated_approver: env.PARSED_DESIGNATED_APPROVER || '',
    requested_repositories: env.PARSED_REQUESTED_REPOSITORIES || '',
    bulk_csv_requested_repositories: env.PARSED_BULK_CSV_REQUESTED_REPOSITORIES || '',
    permission_level: env.PARSED_PERMISSION_LEVEL || '',
    requested_child_teams: env.PARSED_REQUESTED_CHILD_TEAMS || '',
    bulk_csv_requested_child_teams: env.PARSED_BULK_CSV_REQUESTED_CHILD_TEAMS || '',
    intended_owner: env.PARSED_INTENDED_OWNER || '',
    intake_mode: env.PARSED_INTAKE_MODE || '',
    requested_team_names: env.PARSED_REQUESTED_TEAM_NAMES || '',
    bulk_csv_requested_team_names: env.PARSED_BULK_CSV_REQUESTED_TEAM_NAMES || '',
    team_slug: env.PARSED_TEAM_SLUG || '',
    requested_people: env.PARSED_REQUESTED_PEOPLE || '',
    intake_mode: env.PARSED_INTAKE_MODE || '',
    bulk_csv_requested_people: env.PARSED_BULK_CSV_REQUESTED_PEOPLE || '',
    business_justification: env.PARSED_BUSINESS_JUSTIFICATION || '',
    dry_run: env.PARSED_DRY_RUN || 'true',
  };
}

function isTeamRepoAccessParsedRequest(parsedRequest = {}) {
  return Boolean(
    parsedRequest.target_team ||
    parsedRequest.parsed_target_team ||
    parsedRequest.requested_repositories ||
    parsedRequest.parsed_requested_repositories ||
    parsedRequest.bulk_csv_requested_repositories ||
    parsedRequest.parsed_bulk_csv_requested_repositories ||
    parsedRequest.permission_level ||
    parsedRequest.parsed_permission_level
  );
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

function isTerminalRequestStatus(status) {
  return ['executed', 'partially_executed', 'failed', 'failed_after_approved_execution'].includes(status);
}

function terminalStateLabelPrefix(operation) {
  const operationPrefixes = {
    team_creation: 'issueops:create-org-teams:',
    team_hierarchy: 'issueops:add-child-teams:',
    team_repo_access: 'issueops:add-team-repo-access:',
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
  const prefix = terminalStateLabelPrefix(operation);
  for (const status of ['executed', 'partially_executed', 'failed_after_approved_execution', 'failed']) {
    if (labels.includes(`${prefix}${status}`)) {
      return status;
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

async function runRequestValidation(options = {}) {
  const env = options.env || process.env;
  const shouldSetProcessExitCode = options.setProcessExitCode !== false && env === process.env;
  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join(
        'artifacts',
        `${isTeamRepoAccessParsedRequest(readParsedRequestFromEnv(env)) ? 'add-team-repo-access' : isTeamCreationParsedRequest(readParsedRequestFromEnv(env)) ? 'create-org-teams' : isTeamHierarchyParsedRequest(readParsedRequestFromEnv(env)) ? 'add-child-teams' : 'add-team-members'}-validation-${env.ISSUE_NUMBER || 'manual'}.json`
      )
  );
  const parsedRequest = readParsedRequestFromEnv(env);
  const isTeamRepoAccess = isTeamRepoAccessParsedRequest(parsedRequest);
  const isTeamCreation = isTeamCreationParsedRequest(parsedRequest);
  const isTeamHierarchy = isTeamHierarchyParsedRequest(parsedRequest);
  const priorAttachmentRetryState = readPriorAttachmentRetryState(artifactPath);
  const priorArtifact = priorAttachmentRetryState.priorArtifact;
  const issueLabels = readIssueLabelsFromEnv(env);
  const teamHierarchyRepositoryPolicy = parseJsonFromEnv(env.TEAM_HIERARCHY_POLICY_JSON) || {};
  const teamRepoAccessRepositoryPolicy = parseJsonFromEnv(env.TEAM_REPO_ACCESS_POLICY_JSON) || {};
  const operation = isTeamRepoAccess ? 'team_repo_access' : isTeamCreation ? 'team_creation' : isTeamHierarchy ? 'team_hierarchy' : 'team_membership';
  const terminalStatusFromIssueLabels = deriveTerminalStatusFromIssueLabels(issueLabels, operation);
  const request = (isTeamRepoAccess
    ? parseTeamRepoAccessRequest
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
  });

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
      } else if (isTeamHierarchy) {
        validation = buildMissingTokenHierarchyValidation(request);
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
      const api = options.api || (isTeamRepoAccess
        ? createGitHubTeamRepoApi({ token: tokenInfo.token })
        : createGitHubTeamApi({ token: tokenInfo.token }));
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
    operationLabel: isTeamRepoAccess ? 'repository' : isTeamCreation ? 'team' : isTeamHierarchy ? 'child_link' : 'membership',
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
      ? isTeamRepoAccess
        ? 'Request is validated and ready for approval. No repository-access mutation was attempted.'
        : isTeamCreation
        ? 'Request is validated and ready for approval. No team creation was attempted.'
        : isTeamHierarchy
        ? 'Request is validated and ready for approval. No child-team mutation was attempted.'
        : 'Request is validated and ready for approval. No membership mutation was attempted.'
      : isTeamRepoAccess
        ? 'Request validation failed. No repository-access mutation was attempted.'
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
  deriveTerminalStatusFromIssueLabels,
  isTeamRepoAccessParsedRequest,
  isTeamHierarchyParsedRequest,
  isTeamCreationParsedRequest,
  parseParsedRequestJson,
  parseJsonFromEnv,
  readIssueLabelsFromEnv,
  readParsedRequestFromEnv,
  buildCommentContextFromEnv,
  runRequestValidation,
};