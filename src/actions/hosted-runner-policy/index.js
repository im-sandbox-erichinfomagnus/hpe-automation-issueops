'use strict';

const { loadWorkflowToken } = require('../../workflow-support/load-workflow-token');

const DEFAULT_ALLOWED_APPROVER_ROLES = ['target_org_owner'];

function isEligibleApproverRole(role, options = {}) {
  const allowedApproverRoles = options.allowedApproverRoles || DEFAULT_ALLOWED_APPROVER_ROLES;
  return allowedApproverRoles.includes(role);
}

function assertHostedRunnerMutationAllowed(context = {}, options = {}) {
  const approvalStatus = context.approval_status || context.approvalStatus || 'pending';
  const approverRole = context.approver_role || context.approverRole || 'other';
  const approverAuthorizationState =
    context.approver_authorization_state || context.approverAuthorizationState || 'unknown';
  const dryRun = Boolean(context.dry_run ?? context.dryRun);
  const tokenInfo = context.tokenInfo || loadWorkflowToken({ required: !dryRun });

  if (dryRun) {
    return {
      allowed: false,
      reason: 'dry_run',
      tokenInfo,
    };
  }

  if (approvalStatus !== 'approved') {
    throw new Error(`Hosted runner mutation blocked because approval status is ${approvalStatus}`);
  }

  if (!isEligibleApproverRole(approverRole, options) || approverAuthorizationState !== 'authorized') {
    throw new Error(`Hosted runner mutation blocked because approver role ${approverRole} is not eligible`);
  }

  if (!tokenInfo || !tokenInfo.token) {
    throw new Error('Hosted runner mutation blocked because no workflow token is available');
  }

  if (!tokenInfo.is_pat_backed || !tokenInfo.supports_org_mutation) {
    throw new Error('Hosted runner mutation blocked because the workflow token is not PAT-backed for organization mutation');
  }

  return {
    allowed: true,
    reason: 'approved',
    tokenInfo,
  };
}

module.exports = {
  DEFAULT_ALLOWED_APPROVER_ROLES,
  assertHostedRunnerMutationAllowed,
  isEligibleApproverRole,
};
