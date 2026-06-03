'use strict';

const fs = require('fs');
const path = require('path');

const { assertTeamHierarchyAllowed } = require('../actions/team-hierarchy-policy');
const { assertTeamCreationAllowed } = require('../actions/team-creation-policy');
const { assertMutationAllowed } = require('../actions/team-membership-policy');
const { assertRepositoryAccessAllowed } = require('../actions/team-repo-access-policy');
const { buildAuditArtifact, toAuditArtifactJson } = require('../workflow-support/build-audit-artifact');
const { buildExecutionOutcome } = require('../workflow-support/build-execution-outcome');
const { createGitHubTeamApi } = require('../workflow-support/github-team-api');
const { createGitHubTeamRepoApi } = require('../workflow-support/github-team-repo-api');
const { executeWithBoundedRetry } = require('../workflow-support/handle-rate-limit');
const { reconcileTeamHierarchy } = require('../workflow-support/reconcile-team-hierarchy');
const { reconcileTeamCreation } = require('../workflow-support/reconcile-team-creation');
const { reconcileTeamMembers } = require('../workflow-support/reconcile-team-members');
const { reconcileTeamRepoAccess } = require('../workflow-support/reconcile-team-repo-access');
const { validateTeamRepoAccessRequest } = require('../workflow-support/validate-team-repo-access-request');
const { emitAuditSummary } = require('./emit-audit-summary');

const TERMINAL_STATE_LABEL_PREFIX = 'issueops:add-team-members:';

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

function buildPreMutationFailureArtifact(options = {}) {
  const auditArtifact = options.auditArtifact;
  const artifactPath = options.artifactPath;
  const env = options.env || process.env;
  const operationLabel = options.operationLabel;
  const rateLimitSnapshot = options.rateLimitSnapshot || null;
  const failureMessage = options.failureMessage;

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

  fs.writeFileSync(artifactPath, toAuditArtifactJson({
    request: updatedArtifact.request,
    validation: updatedArtifact.validation,
    assignment: updatedArtifact.assignment,
    approval: updatedArtifact.approval,
    reconciliationPlan: updatedArtifact.reconciliation,
    executionOutcome: updatedArtifact.execution,
    runContext: updatedArtifact.metadata,
  }), 'utf8');

  writeGitHubOutput('execution-status', updatedArtifact.request.request_status, env.GITHUB_OUTPUT);
  writeGitHubOutput('audit-artifact-path', artifactPath, env.GITHUB_OUTPUT);
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
  const isTeamHierarchy = auditArtifact.metadata && auditArtifact.metadata.operation === 'team_hierarchy';
  const isTeamCreation = auditArtifact.metadata && auditArtifact.metadata.operation === 'team_creation';

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
    mutationDecision = isTeamCreation
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
      operationLabel: isTeamCreation ? 'team' : isTeamHierarchy ? 'child link' : isTeamRepoAccess ? 'repository' : 'membership',
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
    auditArtifact.execution.summary = `${error.message}. No ${isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team mutation' : isTeamRepoAccess ? 'repository-access mutation' : 'membership mutation'} was attempted.`;
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
    auditArtifact.execution.summary = `Approved execution remains blocked because the request is dry-run only. No ${isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team mutation' : isTeamRepoAccess ? 'repository-access mutation' : 'membership mutation'} was attempted.`;
    auditArtifact.execution.rollback_status = auditArtifact.execution.rollback_status || 'not_needed';
    writeGitHubOutput('execution-status', mutationDecision.reason, env.GITHUB_OUTPUT);
    emitAuditSummary(auditArtifact, { summaryPath: env.GITHUB_STEP_SUMMARY, overwrite: true });
    return auditArtifact;
  }

  const api = options.createApi
    ? options.createApi({ token: mutationDecision.tokenInfo.token, auditArtifact })
    : isTeamRepoAccess
      ? createGitHubTeamRepoApi({ token: mutationDecision.tokenInfo.token })
      : createGitHubTeamApi({ token: mutationDecision.tokenInfo.token });
  let repoAccessValidation = auditArtifact.validation;
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
  }
  const currentTeams = (isTeamCreation || isTeamHierarchy)
    ? await api.listOrgTeams({
        organization: auditArtifact.request.organization,
      })
    : null;
  let latestRateLimitSnapshot = auditArtifact.reconciliation && auditArtifact.reconciliation.rate_limit_snapshot || null;
  let currentMembers = [];
  if (!isTeamCreation && !isTeamHierarchy && !isTeamRepoAccess) {
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
        operationLabel: 'membership',
        rateLimitSnapshot: latestRateLimitSnapshot,
        failureMessage: `Approved execution stopped before membership mutation because the current team state could not be read safely (${failureReason}). Retry the request later or investigate the GitHub API response before resuming.`,
      });
    }

    currentMembers = currentMembersResult.value;
  }
  const reconciliationPlan = isTeamCreation
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

  if (isTeamCreation) {
    for (const team of reconciliationPlan.teams_already_present) {
      executionResults.push({
        normalized_slug: team.normalized_slug,
        requested_name: team.requested_name,
        source_row_number: team.source_row_number || null,
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
        execution_result: 'noop',
        failure_reason: null,
      });
    }

    for (const childLink of reconciliationPlan.child_links_rejected) {
      executionResults.push({
        team_slug: childLink.child_team_slug,
        requested_name: childLink.requested_name || childLink.requested_child_name,
        source_row_number: childLink.source_row_number || null,
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
    if (isTeamCreation) {
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
          execution_result: 'failed',
          failure_reason: classifyFailureReason(attemptResult.error),
        });
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
            execution_result: 'linked',
            failure_reason: null,
          });
          continue;
        }

        executionResults.push({
          team_slug: childLink.child_team_slug,
          requested_name: childLink.requested_name || childLink.requested_child_name,
          source_row_number: childLink.source_row_number || null,
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

  const executionOutcome = buildExecutionOutcome({
    executionResults,
    operationLabel: isTeamCreation ? 'team' : isTeamHierarchy ? 'child link' : isTeamRepoAccess ? 'repository' : 'membership',
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
    rate_limit_snapshot: latestRateLimitSnapshot,
  });
  const requestStatus = deriveRequestStatus(executionOutcome);
  if (isTeamCreation && executionOutcome.created_count > 0) {
    executionOutcome.summary = `${executionOutcome.summary} Note: GitHub automatically makes the authenticated creator a team maintainer when a new team is created, so the creator becomes a team maintainer as an operational constraint of this workflow.`;
  }
  const summaryPrefix =
    requestStatus === 'executed'
      ? `Approved ${isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team execution' : isTeamRepoAccess ? 'repository-access execution' : 'execution'} completed.`
      : requestStatus === 'partially_executed'
        ? `Approved ${isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team execution' : isTeamRepoAccess ? 'repository-access execution' : 'execution'} completed with partial failure.`
        : `Approved ${isTeamCreation ? 'team creation' : isTeamHierarchy ? 'child-team execution' : isTeamRepoAccess ? 'repository-access execution' : 'execution'} failed.`;

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
    },
  });

  fs.writeFileSync(artifactPath, toAuditArtifactJson({
    request: updatedArtifact.request,
    validation: updatedArtifact.validation,
    assignment: updatedArtifact.assignment,
    approval: updatedArtifact.approval,
    reconciliationPlan: updatedArtifact.reconciliation,
    executionOutcome: updatedArtifact.execution,
    runContext: updatedArtifact.metadata,
  }), 'utf8');

  if (
    !isTeamCreation &&
    !isTeamHierarchy &&
    !isTeamRepoAccess &&
    updatedArtifact.request &&
    updatedArtifact.request.intake_mode === 'csv_attachment' &&
    updatedArtifact.request.issue_number != null &&
    typeof api.addIssueLabels === 'function'
  ) {
    await api.addIssueLabels({
      repository: updatedArtifact.request.repository,
      issueNumber: updatedArtifact.request.issue_number,
      labels: [`${TERMINAL_STATE_LABEL_PREFIX}${updatedArtifact.request.request_status}`],
    });
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
  deriveRequestStatus,
  runApprovedExecution,
};