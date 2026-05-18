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
    organization: env.PARSED_ORGANIZATION || '',
    target_team: env.PARSED_TARGET_TEAM || '',
    parent_team: env.PARSED_PARENT_TEAM || '',
    designated_approver: env.PARSED_DESIGNATED_APPROVER || '',
    requested_repositories: env.PARSED_REQUESTED_REPOSITORIES || '',
    permission_level: env.PARSED_PERMISSION_LEVEL || '',
    requested_child_teams: env.PARSED_REQUESTED_CHILD_TEAMS || '',
    intended_owner: env.PARSED_INTENDED_OWNER || '',
    requested_team_names: env.PARSED_REQUESTED_TEAM_NAMES || '',
    team_slug: env.PARSED_TEAM_SLUG || '',
    requested_people: env.PARSED_REQUESTED_PEOPLE || '',
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
    parsedRequest.permission_level ||
    parsedRequest.parsed_permission_level
  );
}

function isTeamCreationParsedRequest(parsedRequest = {}) {
  return Boolean(
    parsedRequest.intended_owner ||
    parsedRequest.parsed_intended_owner ||
    parsedRequest.requested_team_names ||
    parsedRequest.parsed_requested_team_names
  );
}

function isTeamHierarchyParsedRequest(parsedRequest = {}) {
  return Boolean(
    parsedRequest.parent_team ||
    parsedRequest.parsed_parent_team ||
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
  const parsedRequest = readParsedRequestFromEnv(env);
  const isTeamRepoAccess = isTeamRepoAccessParsedRequest(parsedRequest);
  const isTeamHierarchy = isTeamHierarchyParsedRequest(parsedRequest);
  const isTeamCreation = isTeamCreationParsedRequest(parsedRequest);
  const request = (isTeamRepoAccess
    ? parseTeamRepoAccessRequest
    : isTeamHierarchy
    ? parseTeamHierarchyRequest
    : isTeamCreation
      ? parseTeamCreationRequest
      : parseTeamMembershipRequest)({
    parsedRequest,
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

  let validation;
  let reconciliationPlan = {};
  try {
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
        validation = await validateTeamRepoAccessRequest(request, {
          getOrganization: ({ organization }) => api.getOrganization({ organization }),
          getTeamBySlug: ({ organization, teamSlug }) =>
            api.getTeamBySlug({ organization, teamSlug }),
          getRepository: ({ owner, repo }) => api.getRepository({ owner, repo }),
          getTeamRepositoryPermission: ({ organization, teamSlug, owner, repo }) =>
            api.getTeamRepositoryPermission({ organization, teamSlug, owner, repo }),
          getOrganizationMembership: ({ organization, username }) =>
            api.getOrganizationMembership({ organization, username }),
        });
        reconciliationPlan = reconcileTeamRepoAccess({
          request: validation.request,
          requested_repository_grants: validation.requested_repository_grants,
          organization_exists: validation.organization_visible,
          team_exists: validation.team_exists,
          dry_run: validation.request.dry_run,
        });
      } else if (isTeamHierarchy) {
        validation = await validateTeamHierarchyRequest(request, {
          getOrganization: ({ organization }) => api.getOrganization({ organization }),
          listTeams: ({ organization }) => api.listOrgTeams({ organization }),
          resolveTeamMembership: ({ organization, teamSlug, username }) =>
            api.getMembershipForUser({ organization, teamSlug, username }),
        });
        reconciliationPlan = reconcileTeamHierarchy({
          request: validation.request,
          requested_child_links: validation.requested_child_links,
          organization_exists: validation.organization_visible,
          parent_team_exists: validation.parent_team_exists,
          dry_run: validation.request.dry_run,
        });
      } else if (isTeamCreation) {
        validation = await validateTeamCreationRequest(request, {
          getOrganization: ({ organization }) => api.getOrganization({ organization }),
          resolveMembership: ({ organization, username }) =>
            api.getOrganizationMembership({ organization, username }),
          listTeams: ({ organization }) => api.listOrgTeams({ organization }),
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
      } else {
        validation = await validateTeamMembershipRequest(request, {
          getTeam: ({ organization, teamSlug }) => api.getTeamBySlug({ organization, teamSlug }),
          resolveUser: ({ organization, username }) =>
            api.getOrganizationMembership({ organization, username }),
        });
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
      requested_people: [],
      request: {
        ...request,
        request_status: 'validation_failed',
      },
    };
  }

  const executionOutcome = buildExecutionOutcome({
    executionResults: [],
    operationLabel: isTeamRepoAccess ? 'repository' : isTeamHierarchy ? 'child_link' : isTeamCreation ? 'team' : 'membership',
  });

  executionOutcome.summary = validation.is_valid
    ? isTeamRepoAccess
      ? 'Request is validated and stored as approval-ready. No repository-access mutation was attempted.'
      : isTeamHierarchy
      ? 'Request is validated and stored as approval-ready. No child-team mutation was attempted.'
      : isTeamCreation
      ? 'Request is validated and stored as approval-ready. No team creation was attempted.'
      : 'Request is validated and stored as approval-ready. No membership mutation was attempted.'
    : isTeamRepoAccess
      ? 'Request validation failed. No repository-access mutation was attempted.'
      : isTeamHierarchy
      ? 'Request validation failed. No child-team mutation was attempted.'
      : isTeamCreation
      ? 'Request validation failed. No team creation was attempted.'
      : 'Request validation failed. No membership mutation was attempted.';

  const auditArtifact = buildAuditArtifact({
    request: validation.request,
    validation,
    approval: {
      approval_status: validation.is_valid ? 'pending' : 'not_requested',
      approver_role: 'other',
    },
    reconciliationPlan,
    executionOutcome,
    runContext: {
      run_id: env.GITHUB_RUN_ID,
      run_attempt: env.GITHUB_RUN_ATTEMPT,
    },
  });

  const artifactPath = path.resolve(
    env.AUDIT_ARTIFACT_PATH ||
      path.join(
        'artifacts',
        `${isTeamRepoAccess ? 'add-team-repo-access' : isTeamHierarchy ? 'add-child-teams' : isTeamCreation ? 'create-org-teams' : 'add-team-members'}-validation-${env.ISSUE_NUMBER || 'manual'}.json`
      )
  );

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
  isTeamRepoAccessParsedRequest,
  isTeamHierarchyParsedRequest,
  isTeamCreationParsedRequest,
  parseParsedRequestJson,
  readParsedRequestFromEnv,
  runRequestValidation,
};