'use strict';

const { resolveApproverRole } = require('./resolve-approver-role');
const { resolveTeamCreationApprover } = require('./resolve-team-creation-approver');
const { resolveTeamHierarchyApprover } = require('./resolve-team-hierarchy-approver');
const { resolveTeamRepoAccessApprover } = require('./resolve-team-repo-access-approver');
const { resolveTenantRepoApprover } = require('./resolve-tenant-repo-approver');
const { resolveTenantCreationApprover } = require('./resolve-tenant-creation-approver');
const { resolveHostedRunnerApprover } = require('./resolve-hosted-runner-approver');
const { resolveRunnerGroupApprover } = require('./resolve-runner-group-approver');
const { resolveTenantVariablesApprover } = require('./resolve-tenant-variables-approver');
const { resolveCicdAdminMembershipApprover } = require('./resolve-cicd-admin-membership-approver');
const { resolveRepositoryRulesetApprover } = require('./resolve-repository-ruleset-approver');

const APPROVAL_COMMAND = 'approved';

const TENANT_RUNNER_APPROVAL_MODES = [
  'hosted_runner_creation',
  'hosted_runner_deletion',
  'hosted_runner_move',
  'runner_group_creation',
  'tenant_variable_management',
  'cicd_admin_membership',
  'repository_ruleset_creation',
  'repository_ruleset_deletion',
];

function describeTenantRunnerMutation(approvalMode) {
  if (approvalMode === 'hosted_runner_deletion') {
    return 'tenant hosted-runner deletion';
  }

  if (approvalMode === 'hosted_runner_move') {
    return 'tenant hosted-runner move';
  }

  if (approvalMode === 'runner_group_creation') {
    return 'tenant runner group creation';
  }

  if (approvalMode === 'tenant_variable_management') {
    return 'tenant variable management';
  }

  if (approvalMode === 'cicd_admin_membership') {
    return 'tenant CI/CD admin membership';
  }

  if (approvalMode === 'repository_ruleset_creation') {
    return 'repository ruleset creation';
  }

  if (approvalMode === 'repository_ruleset_deletion') {
    return 'repository ruleset deletion';
  }

  return 'tenant hosted-runner creation';
}

function sortEventsDescending(events = []) {
  return [...events].sort((left, right) => {
    return String(right.created_at || '').localeCompare(String(left.created_at || ''));
  });
}

function isApprovalComment(body = '', approvalCommand = APPROVAL_COMMAND) {
  return String(body || '').trim().toLowerCase() === approvalCommand;
}

function findLatestApprovalComment(issueComments = [], approvalCommand = APPROVAL_COMMAND, options = {}) {
  const notBefore = options.notBefore || null;

  return sortEventsDescending(issueComments).find((comment) => {
    if (notBefore && String(comment.created_at || '') <= String(notBefore)) {
      return false;
    }

    return isApprovalComment(comment.body, approvalCommand);
  }) || null;
}

function buildPendingApprovalNote(approvalMode, approvalCommand) {
  if (approvalMode === 'team_hierarchy') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the designated hierarchy approver to authorize execution.`;
  }

  if (approvalMode === 'team_creation') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the active intended owner to authorize execution.`;
  }

  if (approvalMode === 'team_repo_access') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the designated target organization owner to authorize execution.`;
  }

  if (approvalMode === 'team_repo_access_removal') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the designated target organization owner to authorize repository-access removal execution.`;
  }

  if (approvalMode === 'tenant_creation') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the designated active target organization owner to authorize execution.`;
  }

  if (approvalMode === 'tenant_repo_creation') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the designated active target organization owner to authorize repository creation execution.`;
  }

  if (TENANT_RUNNER_APPROVAL_MODES.includes(approvalMode)) {
    return `Add an issue comment containing exactly '${approvalCommand}' from the designated active target organization owner to authorize ${describeTenantRunnerMutation(approvalMode)} execution.`;
  }

  return `Add an issue comment containing exactly '${approvalCommand}' as an organization owner to authorize execution.`;
}

function buildPendingAttachmentApprovalNote(approvalMode, approvalCommand) {
  if (approvalMode === 'team_hierarchy') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the designated hierarchy approver after the accepted CSV attachment comment to authorize execution.`;
  }

  if (approvalMode === 'team_creation') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the active intended owner after the accepted CSV attachment comment to authorize execution.`;
  }

  if (approvalMode === 'team_repo_access') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the designated target organization owner after the accepted CSV attachment comment to authorize execution.`;
  }

  if (approvalMode === 'team_repo_access_removal') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the designated target organization owner after the accepted CSV attachment comment to authorize repository-access removal execution.`;
  }

  if (approvalMode === 'tenant_creation') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the designated active target organization owner after the accepted CSV attachment comment to authorize execution.`;
  }

  if (approvalMode === 'tenant_repo_creation') {
    return `Add an issue comment containing exactly '${approvalCommand}' from the designated active target organization owner after the accepted CSV attachment comment to authorize repository creation execution.`;
  }

  return `Add an issue comment containing exactly '${approvalCommand}' as an organization owner after the accepted CSV attachment comment to authorize execution.`;
}

function hasContextMismatch(approvalMode, latestContextMarker, priorApprovedContextMarker) {
  if (approvalMode !== 'tenant_repo_creation' && !TENANT_RUNNER_APPROVAL_MODES.includes(approvalMode)) {
    return false;
  }

  if (!latestContextMarker || !priorApprovedContextMarker) {
    return false;
  }

  return String(latestContextMarker) !== String(priorApprovedContextMarker);
}

async function evaluateApprovalGate(input = {}, options = {}) {
  const approvalCommand = options.approvalCommand || APPROVAL_COMMAND;
  const approvalMode = input.approvalMode || options.approvalMode || 'team_membership';
  const requestStatus = input.request_status || input.requestStatus || '';
  const intakeMode = input.intake_mode || input.intakeMode || '';
  const acceptedAttachmentCommentCreatedAt =
    input.acceptedAttachmentCommentCreatedAt ||
    input.accepted_attachment_submission && input.accepted_attachment_submission.comment_created_at ||
    null;
  const issueComments = input.issueComments || [];
  const priorApprovalStatus = input.priorApprovalStatus || 'pending';
  const latestContextMarker = input.latestContextMarker || input.latest_context_marker || '';
  const priorApprovedContextMarker = input.priorApprovedContextMarker || input.prior_approved_context_marker || '';
  const resolveRole = options.resolveRole || ((args) => {
    if (approvalMode === 'team_creation') {
      return resolveTeamCreationApprover(args, options);
    }

    if (approvalMode === 'team_hierarchy') {
      return resolveTeamHierarchyApprover(args, options);
    }

    if (approvalMode === 'team_repo_access' || approvalMode === 'team_repo_access_removal') {
      return resolveTeamRepoAccessApprover(args, options);
    }

    if (approvalMode === 'tenant_creation') {
      return resolveTenantCreationApprover(args, options);
    }

    if (approvalMode === 'tenant_repo_creation') {
      return resolveTenantRepoApprover(args, options);
    }

    if (approvalMode === 'hosted_runner_creation' || approvalMode === 'hosted_runner_deletion' || approvalMode === 'hosted_runner_move') {
      return resolveHostedRunnerApprover(args, options);
    }

    if (approvalMode === 'runner_group_creation') {
      return resolveRunnerGroupApprover(args, options);
    }

    if (approvalMode === 'tenant_variable_management') {
      return resolveTenantVariablesApprover(args, options);
    }

    if (approvalMode === 'cicd_admin_membership') {
      return resolveCicdAdminMembershipApprover(args, options);
    }

    if (approvalMode === 'repository_ruleset_creation' || approvalMode === 'repository_ruleset_deletion') {
      return resolveRepositoryRulesetApprover(args, options);
    }

    return resolveApproverRole(args, options);
  });

  if (
    (approvalMode === 'team_membership' || approvalMode === 'team_creation' || approvalMode === 'team_hierarchy' || approvalMode === 'team_repo_access' || approvalMode === 'team_repo_access_removal' || approvalMode === 'tenant_creation' || approvalMode === 'tenant_repo_creation') &&
    intakeMode === 'csv_attachment' &&
    requestStatus === 'waiting_for_attachment'
  ) {
    return {
      approval_status: 'not_requested',
      approver_login: '',
      approver_role: 'other',
      decision_source: 'validation',
      decision_note: 'Request is still waiting for a requester-authored CSV attachment comment before approval can be evaluated.',
    };
  }

  const approvalComment = findLatestApprovalComment(issueComments, approvalCommand, {
    notBefore: (approvalMode === 'team_membership' || approvalMode === 'team_creation' || approvalMode === 'team_hierarchy' || approvalMode === 'team_repo_access' || approvalMode === 'team_repo_access_removal' || approvalMode === 'tenant_creation' || approvalMode === 'tenant_repo_creation') && intakeMode === 'csv_attachment'
      ? acceptedAttachmentCommentCreatedAt
      : null,
  });

  if (!approvalComment) {
    const requiresFreshAttachmentApproval =
    (approvalMode === 'team_membership' || approvalMode === 'team_creation' || approvalMode === 'team_hierarchy' || approvalMode === 'team_repo_access' || approvalMode === 'team_repo_access_removal' || approvalMode === 'tenant_creation' || approvalMode === 'tenant_repo_creation') &&
      intakeMode === 'csv_attachment' &&
      acceptedAttachmentCommentCreatedAt;

    const staleContextInvalidation =
      priorApprovalStatus === 'approved' &&
      hasContextMismatch(approvalMode, latestContextMarker, priorApprovedContextMarker);

    return {
      approval_status: priorApprovalStatus === 'approved' ? 'invalidated' : 'pending',
      approver_login: '',
      approver_role: 'other',
      latest_context_marker: latestContextMarker || null,
      approved_context_marker: priorApprovedContextMarker || null,
      decision_source: 'comment',
      decision_note: staleContextInvalidation
        ? `Approval was invalidated because the latest validated context marker changed from '${priorApprovedContextMarker}' to '${latestContextMarker}' and a fresh approval comment is required.`
        : priorApprovalStatus === 'approved'
        ? `The approval comment '${approvalCommand}' is no longer present and execution must remain blocked.`
        : requiresFreshAttachmentApproval
          ? buildPendingAttachmentApprovalNote(approvalMode, approvalCommand)
          : buildPendingApprovalNote(approvalMode, approvalCommand),
    };
  }

  const approver = await resolveRole({
    organization: input.organization,
    approverLogin: approvalComment.user && approvalComment.user.login,
    intendedOwnerLogin: input.intendedOwnerLogin || input.intended_owner_login,
    designatedApproverLogin: input.designatedApproverLogin || input.designated_approver_login,
    parentTeamSlug: input.parentTeamSlug || input.parent_team_slug,
    requestedChildLinks: input.requestedChildLinks || input.requested_child_links || [],
  });
  const approverLogin = approver.approver_login || (approvalComment.user && approvalComment.user.login) || '';

  if (approvalMode === 'team_creation') {
    if (approver.approver_role !== 'intended_owner') {
      return {
        approval_status: 'denied',
        approver_login: approverLogin,
        approver_role: approver.approver_role,
        approver_membership_state: approver.approver_membership_state || 'unknown',
        approved_at: approvalComment.created_at || null,
        decision_source: 'comment',
        decision_note: `The approval comment '${approvalCommand}' was not added by the active intended owner for this request batch and does not authorize team creation.`,
      };
    }

    return {
      approval_status: 'approved',
      approver_login: approverLogin,
      approver_role: approver.approver_role,
      approver_membership_state: approver.approver_membership_state || 'active',
      approved_at: approvalComment.created_at || null,
      decision_source: 'comment',
      decision_note: `The approval comment '${approvalCommand}' was added by the active intended owner for this request batch.`,
    };
  }

  if (approvalMode === 'team_hierarchy') {
    if (approver.approver_role !== 'designated_hierarchy_approver') {
      return {
        approval_status: 'denied',
        approver_login: approverLogin,
        approver_role: approver.approver_role,
        approver_authorization_state: approver.approver_authorization_state || 'unknown',
        approved_at: approvalComment.created_at || null,
        decision_source: 'comment',
        decision_note: `The approval comment '${approvalCommand}' was not added by the authorized designated hierarchy approver and does not authorize team hierarchy mutation.`,
      };
    }

    return {
      approval_status: 'approved',
      approver_login: approverLogin,
      approver_role: approver.approver_role,
      approver_authorization_state: approver.approver_authorization_state || 'authorized',
      approved_at: approvalComment.created_at || null,
      decision_source: 'comment',
      decision_note: `The approval comment '${approvalCommand}' was added by the authorized designated hierarchy approver for this request batch.`,
    };
  }

  if (approvalMode === 'team_repo_access' || approvalMode === 'team_repo_access_removal') {
    if (approver.approver_role !== 'target_org_owner') {
      return {
        approval_status: 'denied',
        approver_login: approverLogin,
        approver_role: approver.approver_role,
        approver_authorization_state: approver.approver_authorization_state || 'unknown',
        approver_membership_state: approver.approver_membership_state || 'unknown',
        approved_at: approvalComment.created_at || null,
        decision_source: 'comment',
        decision_note: `The approval comment '${approvalCommand}' was not added by the authorized designated target organization owner and does not authorize repository-access mutation.`,
      };
    }

    return {
      approval_status: 'approved',
      approver_login: approverLogin,
      approver_role: approver.approver_role,
      approver_authorization_state: approver.approver_authorization_state || 'authorized',
      approver_membership_state: approver.approver_membership_state || 'active',
      approved_at: approvalComment.created_at || null,
      decision_source: 'comment',
      decision_note: `The approval comment '${approvalCommand}' was added by the authorized designated target organization owner for this request batch.`,
    };
  }

  if (approvalMode === 'tenant_creation') {
    if (approver.approver_role !== 'target_org_owner') {
      return {
        approval_status: 'denied',
        approver_login: approverLogin,
        approver_role: approver.approver_role,
        approver_authorization_state: approver.approver_authorization_state || 'unknown',
        approver_membership_state: approver.approver_membership_state || 'unknown',
        approved_at: approvalComment.created_at || null,
        decision_source: 'comment',
        decision_note: `The approval comment '${approvalCommand}' was not added by the authorized designated target organization owner and does not authorize tenant bootstrap mutation.`,
      };
    }

    return {
      approval_status: 'approved',
      approver_login: approverLogin,
      approver_role: approver.approver_role,
      approver_authorization_state: approver.approver_authorization_state || 'authorized',
      approver_membership_state: approver.approver_membership_state || 'active',
      approved_at: approvalComment.created_at || null,
      decision_source: 'comment',
      decision_note: `The approval comment '${approvalCommand}' was added by the authorized designated target organization owner for this tenant bootstrap request.`,
    };
  }

  if (approvalMode === 'tenant_repo_creation') {
    if (approver.approver_role !== 'target_org_owner') {
      return {
        approval_status: 'denied',
        approver_login: approverLogin,
        approver_role: approver.approver_role,
        approver_authorization_state: approver.approver_authorization_state || 'unknown',
        approver_membership_state: approver.approver_membership_state || 'unknown',
        latest_context_marker: latestContextMarker || null,
        approved_context_marker: priorApprovedContextMarker || null,
        approved_at: approvalComment.created_at || null,
        decision_source: 'comment',
        decision_note: `The approval comment '${approvalCommand}' was not added by the authorized designated target organization owner and does not authorize tenant repository creation mutation.`,
      };
    }

    return {
      approval_status: 'approved',
      approver_login: approverLogin,
      approver_role: approver.approver_role,
      approver_authorization_state: approver.approver_authorization_state || 'authorized',
      approver_membership_state: approver.approver_membership_state || 'active',
      latest_context_marker: latestContextMarker || null,
      approved_context_marker: latestContextMarker || null,
      approved_at: approvalComment.created_at || null,
      decision_source: 'comment',
      decision_note: `The approval comment '${approvalCommand}' was added by the authorized designated target organization owner for this tenant repository creation request.`,
    };
  }

  if (TENANT_RUNNER_APPROVAL_MODES.includes(approvalMode)) {
    if (approver.approver_role !== 'target_org_owner') {
      return {
        approval_status: 'denied',
        approver_login: approverLogin,
        approver_role: approver.approver_role,
        approver_authorization_state: approver.approver_authorization_state || 'unknown',
        approver_membership_state: approver.approver_membership_state || 'unknown',
        latest_context_marker: latestContextMarker || null,
        approved_context_marker: priorApprovedContextMarker || null,
        approved_at: approvalComment.created_at || null,
        decision_source: 'comment',
        decision_note: `The approval comment '${approvalCommand}' was not added by the authorized designated target organization owner and does not authorize ${describeTenantRunnerMutation(approvalMode)} mutation.`,
      };
    }

    return {
      approval_status: 'approved',
      approver_login: approverLogin,
      approver_role: approver.approver_role,
      approver_authorization_state: approver.approver_authorization_state || 'authorized',
      approver_membership_state: approver.approver_membership_state || 'active',
      latest_context_marker: latestContextMarker || null,
      approved_context_marker: latestContextMarker || null,
      approved_at: approvalComment.created_at || null,
      decision_source: 'comment',
      decision_note: `The approval comment '${approvalCommand}' was added by the authorized designated target organization owner for this ${describeTenantRunnerMutation(approvalMode)} request.`,
    };
  }

  if (approver.approver_role !== 'org_owner') {
    return {
      approval_status: 'denied',
      approver_login: approverLogin,
      approver_role: approver.approver_role,
      approver_membership_state: approver.approver_membership_state || 'unknown',
      approved_at: approvalComment.created_at || null,
      decision_source: 'comment',
      decision_note: `The approval comment '${approvalCommand}' was added by a non-organization-owner and does not authorize mutation.`,
    };
  }

  return {
    approval_status: 'approved',
    approver_login: approverLogin,
    approver_role: approver.approver_role,
    approver_membership_state: approver.approver_membership_state || 'active',
    approved_at: approvalComment.created_at || null,
    decision_source: 'comment',
    decision_note: `The approval comment '${approvalCommand}' was added by an organization owner.`,
  };
}

module.exports = {
  APPROVAL_COMMAND,
  buildPendingApprovalNote,
  evaluateApprovalGate,
  findLatestApprovalComment,
  isApprovalComment,
};
