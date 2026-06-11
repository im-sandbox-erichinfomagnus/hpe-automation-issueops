'use strict';

const { loadWorkflowToken } = require('../../workflow-support/load-workflow-token');

const DEFAULT_ALLOWED_APPROVER_ROLES = ['designated_approver'];

function isEligibleApproverRole(role, options = {}) {
  const allowedApproverRoles = options.allowedApproverRoles || DEFAULT_ALLOWED_APPROVER_ROLES;
  return allowedApproverRoles.includes(role);
}

function assertCostCenterMutationAllowed(context = {}, options = {}) {
  const approvalStatus = context.approval_status || context.approvalStatus || 'pending';
  const approverRole = context.approver_role || context.approverRole || 'other';
  const dryRun = Boolean(context.dry_run ?? context.dryRun);
  const tokenInfo = context.tokenInfo || loadWorkflowToken({ required: !dryRun });

  if (dryRun) {
    return { allowed: false, reason: 'dry_run', tokenInfo };
  }

  if (approvalStatus !== 'approved') {
    throw new Error(`Cost-center mutation blocked because approval status is ${approvalStatus}`);
  }

  if (!isEligibleApproverRole(approverRole, options)) {
    throw new Error(`Cost-center mutation blocked because approver role ${approverRole} is not eligible`);
  }

  if (!tokenInfo || !tokenInfo.token) {
    throw new Error('Cost-center mutation blocked because no workflow token is available');
  }

  // Cost-center endpoints require a classic PAT (no GitHub App or fine-grained tokens).
  if (!tokenInfo.is_pat_backed) {
    throw new Error('Cost-center mutation blocked because the workflow token is not a PAT with enterprise billing access');
  }

  return { allowed: true, reason: 'approved', tokenInfo };
}

module.exports = {
  DEFAULT_ALLOWED_APPROVER_ROLES,
  assertCostCenterMutationAllowed,
  isEligibleApproverRole,
};
