'use strict';

const { loadWorkflowToken } = require('../../workflow-support/load-workflow-token');

// Tenant self-serve operations (per Evan's team): the caller gate validated at
// intake is the authorization; no separate approval step is required.
const TENANT_SELF_SERVE_OPERATIONS = [
  'cicd_admin_membership',
  'repo_admin_membership',
  'tenant_subteam_creation',
  'org_variable_management',
];

function isTenantSelfServeOperation(operation) {
  return TENANT_SELF_SERVE_OPERATIONS.includes(String(operation || ''));
}

function assertTenantSelfServeMutationAllowed(context = {}) {
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
    throw new Error(`Tenant self-serve mutation blocked because request status is ${approvalStatus}`);
  }

  if (!tokenInfo || !tokenInfo.token) {
    throw new Error('Tenant self-serve mutation blocked because no workflow token is available');
  }

  if (!tokenInfo.is_pat_backed || !tokenInfo.supports_org_mutation) {
    throw new Error('Tenant self-serve mutation blocked because the workflow token is not PAT-backed for organization mutation');
  }

  return {
    allowed: true,
    reason: 'approved',
    tokenInfo,
  };
}

module.exports = {
  TENANT_SELF_SERVE_OPERATIONS,
  assertTenantSelfServeMutationAllowed,
  isTenantSelfServeOperation,
};
