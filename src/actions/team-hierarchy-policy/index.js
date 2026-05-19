'use strict';

const { loadWorkflowToken } = require('../../workflow-support/load-workflow-token');

function normalizeComparableLogin(value) {
  return String(value || '').toLowerCase();
}

function isEligibleTeamHierarchyApprover(context = {}) {
  const approverLogin = normalizeComparableLogin(
    context.approver_login || context.approverLogin || ''
  );
  const designatedApproverLogin = normalizeComparableLogin(
    context.designated_approver_login || context.designatedApproverLogin || ''
  );
  const authorizationState = String(
    context.approver_authorization_state || context.approverAuthorizationState || 'unknown'
  ).toLowerCase();

  return Boolean(
    approverLogin &&
      designatedApproverLogin &&
      approverLogin === designatedApproverLogin &&
      authorizationState === 'authorized'
  );
}

function hasPatBackedHierarchyMutationToken(tokenInfo) {
  return Boolean(
    tokenInfo &&
      tokenInfo.token &&
      tokenInfo.is_pat_backed &&
      tokenInfo.supports_team_hierarchy_mutation !== false
  );
}

function assertTeamHierarchyAllowed(context = {}, options = {}) {
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
    throw new Error(`Team hierarchy mutation blocked because approval status for this request batch is ${approvalStatus}`);
  }

  if (!isEligibleTeamHierarchyApprover(context)) {
    throw new Error('Team hierarchy mutation blocked because the approver is not the authorized designated approver for this request batch');
  }

  if (!tokenInfo || !tokenInfo.token) {
    throw new Error('Team hierarchy mutation blocked because no workflow token is available');
  }

  if (options.requireOrgMutation !== false && !hasPatBackedHierarchyMutationToken(tokenInfo)) {
    if (tokenInfo && tokenInfo.token && tokenInfo.is_pat_backed && tokenInfo.supports_team_hierarchy_mutation === false) {
      throw new Error('Team hierarchy mutation blocked because the workflow token does not support team hierarchy mutation');
    }

    throw new Error('Team hierarchy mutation blocked because the workflow token is not PAT-backed for org mutation');
  }

  return {
    allowed: true,
    reason: 'approved',
    tokenInfo,
  };
}

function buildTeamHierarchyPermissionGuard(context = {}, options = {}) {
  const decision = assertTeamHierarchyAllowed(context, options);

  return {
    can_mutate: decision.allowed,
    reason: decision.reason,
    token_source: decision.tokenInfo.source,
    token_kind: decision.tokenInfo.token_kind,
    is_pat_backed: decision.tokenInfo.is_pat_backed,
    supports_team_hierarchy_mutation: decision.tokenInfo.supports_team_hierarchy_mutation,
  };
}

module.exports = {
  assertTeamHierarchyAllowed,
  buildTeamHierarchyPermissionGuard,
  hasPatBackedHierarchyMutationToken,
  isEligibleTeamHierarchyApprover,
  normalizeComparableLogin,
};