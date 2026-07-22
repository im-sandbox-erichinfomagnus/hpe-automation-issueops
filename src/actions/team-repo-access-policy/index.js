'use strict';

const { loadWorkflowToken } = require('../../workflow-support/load-workflow-token');
const {
  comparePermissionStrength,
  getPermissionRank,
  isSupportedPermissionApiValue,
  isSupportedPermissionLabel,
  normalizeRequestedPermission,
} = require('../../workflow-support/normalize-requested-permission');

const DEFAULT_ALLOWED_APPROVER_ROLES = ['target_org_owner'];
const DEFAULT_ATTACHMENT_MAX_BYTES = 1024 * 1024;

function normalizePositiveInteger(value) {
  if (value == null || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function resolveTeamRepoAccessAttachmentMaxBytes(context = {}) {
  const direct = normalizePositiveInteger(context.attachment_max_bytes ?? context.attachmentMaxBytes);
  if (direct != null) {
    return direct;
  }

  const policy = context.repository_policy || context.repositoryPolicy || context.policy || {};
  const policyValue = normalizePositiveInteger(policy.attachment_max_bytes ?? policy.attachmentMaxBytes);
  if (policyValue != null) {
    return policyValue;
  }

  return DEFAULT_ATTACHMENT_MAX_BYTES;
}

function isEligibleApproverRole(role, options = {}) {
  const allowedApproverRoles = options.allowedApproverRoles || DEFAULT_ALLOWED_APPROVER_ROLES;
  return allowedApproverRoles.includes(role);
}

function isEligibleTeamRepoAccessApprover(context = {}, options = {}) {
  const approverLogin = String(context.approver_login || context.approverLogin || '').toLowerCase();
  const designatedApproverLogin = String(
    context.designated_approver_login || context.designatedApproverLogin || ''
  ).toLowerCase();
  const approverRole = context.approver_role || context.approverRole || 'other';
  const authorizationState =
    context.approver_authorization_state || context.approverAuthorizationState || 'unknown';

  return (
    approverLogin &&
    approverLogin === designatedApproverLogin &&
    authorizationState === 'authorized' &&
    isEligibleApproverRole(approverRole, options)
  );
}

function assertRepositoryAccessAllowed(context = {}, options = {}) {
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
    throw new Error(`Repository access mutation blocked because approval status is ${approvalStatus}`);
  }

  if (!isEligibleTeamRepoAccessApprover({
    ...context,
    approver_role: approverRole,
  }, options)) {
    throw new Error(`Repository access mutation blocked because approver role ${approverRole} is not eligible`);
  }

  if (!tokenInfo || !tokenInfo.token) {
    throw new Error('Repository access mutation blocked because no workflow token is available');
  }

  if (!tokenInfo.supports_team_repo_access_mutation || !tokenInfo.is_pat_backed) {
    throw new Error('Repository access mutation blocked because the workflow token is not PAT-backed for repository-access mutation');
  }

  return {
    allowed: true,
    reason: 'approved',
    tokenInfo,
  };
}

function buildRepositoryAccessPermissionGuard(context = {}, options = {}) {
  const decision = assertRepositoryAccessAllowed(context, options);

  return {
    can_mutate: decision.allowed,
    reason: decision.reason,
    token_source: decision.tokenInfo.source,
    token_kind: decision.tokenInfo.token_kind,
    is_pat_backed: decision.tokenInfo.is_pat_backed,
  };
}

module.exports = {
  DEFAULT_ATTACHMENT_MAX_BYTES,
  DEFAULT_ALLOWED_APPROVER_ROLES,
  assertRepositoryAccessAllowed,
  buildRepositoryAccessPermissionGuard,
  comparePermissionStrength,
  getPermissionRank,
  isEligibleApproverRole,
  isEligibleTeamRepoAccessApprover,
  isSupportedPermissionApiValue,
  isSupportedPermissionLabel,
  normalizePositiveInteger,
  normalizeRequestedPermission,
  resolveTeamRepoAccessAttachmentMaxBytes,
};