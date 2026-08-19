'use strict';

const { loadWorkflowToken } = require('../../workflow-support/load-workflow-token');

const DEFAULT_ALLOWED_APPROVER_ROLES = ['org_owner', 'org_member'];

function isEligibleApproverRole(role, options = {}) {
  const allowedApproverRoles = options.allowedApproverRoles || DEFAULT_ALLOWED_APPROVER_ROLES;
  return allowedApproverRoles.includes(role);
}

function assertMutationAllowed(context = {}, options = {}) {
  const approvalStatus = context.approval_status || context.approvalStatus || 'pending';
  const approverRole = context.approver_role || context.approverRole || 'other';
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
    throw new Error(`Mutation blocked because approval status is ${approvalStatus}`);
  }

  if (!isEligibleApproverRole(approverRole, options)) {
    throw new Error(`Mutation blocked because approver role ${approverRole} is not eligible`);
  }

  if (!tokenInfo || !tokenInfo.token) {
    throw new Error('Mutation blocked because no workflow token is available');
  }

  return {
    allowed: true,
    reason: 'approved',
    tokenInfo,
  };
}

function buildPermissionGuard(context = {}, options = {}) {
  const decision = assertMutationAllowed(context, options);

  return {
    can_mutate: decision.allowed,
    reason: decision.reason,
    token_source: decision.tokenInfo.source,
    is_pat_backed: decision.tokenInfo.is_pat_backed,
  };
}

function assertTenantBootstrapMembershipAllowed(context = {}, options = {}) {
  const decision = assertMutationAllowed(context, {
    ...options,
    allowedApproverRoles: options.allowedApproverRoles || ['org_owner', 'target_org_owner'],
  });
  if (!context.requester_login) {
    throw new Error('Tenant membership bootstrap blocked because requester login is missing');
  }
  return decision;
}

module.exports = {
  DEFAULT_ALLOWED_APPROVER_ROLES,
  assertMutationAllowed,
  assertTenantBootstrapMembershipAllowed,
  buildPermissionGuard,
  isEligibleApproverRole,
};