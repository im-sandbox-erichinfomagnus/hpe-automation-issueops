'use strict';

const { loadWorkflowToken } = require('../../workflow-support/load-workflow-token');

function normalizeComparableLogin(value) {
  return String(value || '').toLowerCase();
}

function isEligibleCostCenterApprover(context = {}) {
  const approverLogin = normalizeComparableLogin(
    context.approver_login || context.approverLogin || ''
  );
  const intendedApproverLogin = normalizeComparableLogin(
    context.intended_approver_login || context.intendedApproverLogin || ''
  );

  return Boolean(approverLogin && intendedApproverLogin && approverLogin === intendedApproverLogin);
}

function hasPatBackedBillingToken(tokenInfo) {
  return Boolean(tokenInfo && tokenInfo.token && tokenInfo.is_pat_backed);
}

function assertCostCenterAllowed(context = {}, options = {}) {
  const approvalStatus = context.approval_status || context.approvalStatus || 'pending';
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
    throw new Error(`Cost center execution blocked because approval status is ${approvalStatus}`);
  }

  if (!isEligibleCostCenterApprover(context)) {
    throw new Error('Cost center execution blocked because the approver does not match the named intended approver');
  }

  if (!tokenInfo || !tokenInfo.token) {
    throw new Error('Cost center execution blocked because no workflow token is available');
  }

  if (options.requireBillingToken !== false && !hasPatBackedBillingToken(tokenInfo)) {
    throw new Error('Cost center execution blocked because the workflow token is not a PAT with enterprise billing access');
  }

  return {
    allowed: true,
    reason: 'approved',
    tokenInfo,
  };
}

module.exports = {
  assertCostCenterAllowed,
  hasPatBackedBillingToken,
  isEligibleCostCenterApprover,
  normalizeComparableLogin,
};
