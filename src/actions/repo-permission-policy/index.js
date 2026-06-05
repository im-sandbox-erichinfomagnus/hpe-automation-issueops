'use strict';

const { loadWorkflowToken } = require('../../workflow-support/load-workflow-token');

const DEFAULT_ALLOWED_APPROVER_ROLES = ['target_org_owner'];

function isEligibleApproverRole(role, options = {}) {
  const allowedApproverRoles = options.allowedApproverRoles || DEFAULT_ALLOWED_APPROVER_ROLES;
  return allowedApproverRoles.includes(role);
}

function assertRepoAdminTeamPermissionAllowed(context = {}, options = {}) {
  const approvalStatus = context.approval_status || context.approvalStatus || 'pending';
  const approverRole = context.approver_role || context.approverRole || 'other';
  const approverAuthorizationState =
    context.approver_authorization_state || context.approverAuthorizationState || 'unknown';
  const dryRun = Boolean(context.dry_run ?? context.dryRun);
  const repoAdminTeamSlug = context.repo_admin_team_slug || context.repoAdminTeamSlug || '';
  const tokenInfo = context.tokenInfo || loadWorkflowToken({ required: !dryRun });

  if (dryRun) {
    return {
      allowed: false,
      reason: 'dry_run',
      tokenInfo,
    };
  }

  if (approvalStatus !== 'approved') {
    throw new Error(`Repository permission grant blocked because approval status is ${approvalStatus}`);
  }

  if (!isEligibleApproverRole(approverRole, options) || approverAuthorizationState !== 'authorized') {
    throw new Error(`Repository permission grant blocked because approver role ${approverRole} is not eligible`);
  }

  if (!repoAdminTeamSlug) {
    throw new Error('Repository permission grant blocked because repo-admin team slug is missing');
  }

  if (!tokenInfo || !tokenInfo.token) {
    throw new Error('Repository permission grant blocked because no workflow token is available');
  }

  if (!tokenInfo.is_pat_backed || !tokenInfo.supports_team_repo_access_mutation) {
    throw new Error('Repository permission grant blocked because the workflow token is not PAT-backed for repository mutation');
  }

  return {
    allowed: true,
    reason: 'approved',
    tokenInfo,
    direct_admin_avoidance: 'enforced_team_only',
  };
}

module.exports = {
  DEFAULT_ALLOWED_APPROVER_ROLES,
  assertRepoAdminTeamPermissionAllowed,
  isEligibleApproverRole,
};
