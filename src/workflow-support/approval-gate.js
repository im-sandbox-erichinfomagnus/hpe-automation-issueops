'use strict';

const { resolveApproverRole } = require('./resolve-approver-role');
const { resolveTeamCreationApprover } = require('./resolve-team-creation-approver');
const { resolveTeamHierarchyApprover } = require('./resolve-team-hierarchy-approver');
const { resolveTeamRepoAccessApprover } = require('./resolve-team-repo-access-approver');

const APPROVAL_COMMAND = 'approved';

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

  return `Add an issue comment containing exactly '${approvalCommand}' as an organization owner after the accepted CSV attachment comment to authorize execution.`;
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
  const resolveRole = options.resolveRole || ((args) => {
    if (approvalMode === 'team_creation') {
      return resolveTeamCreationApprover(args, options);
    }

    if (approvalMode === 'team_hierarchy') {
      return resolveTeamHierarchyApprover(args, options);
    }

    if (approvalMode === 'team_repo_access') {
      return resolveTeamRepoAccessApprover(args, options);
    }

    return resolveApproverRole(args, options);
  });

  if (
    (approvalMode === 'team_membership' || approvalMode === 'team_creation' || approvalMode === 'team_hierarchy' || approvalMode === 'team_repo_access') &&
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
    notBefore: (approvalMode === 'team_membership' || approvalMode === 'team_creation' || approvalMode === 'team_hierarchy' || approvalMode === 'team_repo_access') && intakeMode === 'csv_attachment'
      ? acceptedAttachmentCommentCreatedAt
      : null,
  });

  if (!approvalComment) {
    const requiresFreshAttachmentApproval =
      (approvalMode === 'team_membership' || approvalMode === 'team_creation' || approvalMode === 'team_hierarchy' || approvalMode === 'team_repo_access') &&
      intakeMode === 'csv_attachment' &&
      acceptedAttachmentCommentCreatedAt;

    return {
      approval_status: priorApprovalStatus === 'approved' ? 'invalidated' : 'pending',
      approver_login: '',
      approver_role: 'other',
      decision_source: 'comment',
      decision_note: priorApprovalStatus === 'approved'
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

  if (approvalMode === 'team_repo_access') {
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