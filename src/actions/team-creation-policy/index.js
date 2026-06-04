'use strict';

const { loadWorkflowToken } = require('../../workflow-support/load-workflow-token');

function normalizeComparableLogin(value) {
  return String(value || '').toLowerCase();
}

function isEligibleTeamCreationApprover(context = {}) {
  const approverLogin = normalizeComparableLogin(
    context.approver_login || context.approverLogin || ''
  );
  const intendedOwnerLogin = normalizeComparableLogin(
    context.intended_owner_login || context.intendedOwnerLogin || ''
  );

  return Boolean(approverLogin && intendedOwnerLogin && approverLogin === intendedOwnerLogin);
}

function hasPatBackedOrgMutationToken(tokenInfo) {
  return Boolean(tokenInfo && tokenInfo.token && tokenInfo.is_pat_backed);
}

function assertTeamCreationAllowed(context = {}, options = {}) {
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
    throw new Error(`Team creation blocked because approval status is ${approvalStatus}`);
  }

  if (!isEligibleTeamCreationApprover(context)) {
    throw new Error('Team creation blocked because the approver does not match the intended owner');
  }

  if (!tokenInfo || !tokenInfo.token) {
    throw new Error('Team creation blocked because no workflow token is available');
  }

  if (options.requireOrgMutation !== false && !hasPatBackedOrgMutationToken(tokenInfo)) {
    throw new Error('Team creation blocked because the workflow token is not PAT-backed for org mutation');
  }

  return {
    allowed: true,
    reason: 'approved',
    tokenInfo,
  };
}

function buildTeamCreationPermissionGuard(context = {}, options = {}) {
  const decision = assertTeamCreationAllowed(context, options);

  return {
    can_mutate: decision.allowed,
    reason: decision.reason,
    token_source: decision.tokenInfo.source,
    token_kind: decision.tokenInfo.token_kind,
    is_pat_backed: decision.tokenInfo.is_pat_backed,
  };
}

function assertTenantBootstrapCreationAllowed(context = {}, options = {}) {
  const decision = assertTeamCreationAllowed(context, options);
  if (!context.designated_approver_login) {
    throw new Error('Tenant bootstrap blocked because designated approver is missing');
  }
  return decision;
}

module.exports = {
  assertTeamCreationAllowed,
  assertTenantBootstrapCreationAllowed,
  buildTeamCreationPermissionGuard,
  hasPatBackedOrgMutationToken,
  isEligibleTeamCreationApprover,
  normalizeComparableLogin,
};