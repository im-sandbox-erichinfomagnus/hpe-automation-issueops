'use strict';

// Operations whose caller must hold an active GitHub organization membership
// at mutation time rather than relying only on stale approval context.
const ORG_MEMBER_REQUIREMENT_OPERATIONS = [
  'team_membership',
  'team_creation',
  'team_hierarchy',
  'team_repo_access',
  'team_repo_access_removal',
];

// Tenant creation still requires org_admin at mutation time.
const ORG_ADMIN_MUTATION_OPERATIONS = ['tenant_creation'];

// Operations requiring at least active org_member revalidation at mutation time.
const ORG_MEMBER_MUTATION_OPERATIONS = [...ORG_MEMBER_REQUIREMENT_OPERATIONS];

function getAutomaticRequesterRequirement(operation) {
  if (ORG_MEMBER_REQUIREMENT_OPERATIONS.includes(operation)) {
    return 'org_member';
  }

  if (ORG_ADMIN_MUTATION_OPERATIONS.includes(operation)) {
    return 'org_admin';
  }

  return 'validated_operation_permission';
}

function normalizeLogin(value) {
  return String(value || '').trim();
}

// Deliberately looser than hasAutomaticRequesterAuthorization in
// run-approved-execution.js, which additionally requires authorized === true
// before it synthesizes a compatibility approval context. This predicate only
// asks whether the artifact carries an automatic authorization record at all,
// because an artifact claiming approval with authorized false must still be
// rechecked rather than treated as a manual run that needs no check.
function hasAutomaticAuthorizationRecord(approval = {}) {
  return Boolean(
    approval &&
    approval.decision_source === 'automatic_demo' &&
    approval.approval_status === 'approved' &&
    approval.requester_authorization
  );
}

// Decides whether the caller's live organization role has to be reconfirmed
// immediately before mutation, and for whom. Automatic authorization replaces the
// human approval comment with a requester role check, so that role is the only
// thing standing between the request and the mutation and it is re-read here.
// Manual runs keep the approval-comment gate, which is evaluated live in the
// approval phase, so they are left alone.
function resolveCallerOrgRoleRequirement(auditArtifact = {}) {
  const request = auditArtifact.request || {};
  const approval = auditArtifact.approval || {};
  const operation = (auditArtifact.metadata && auditArtifact.metadata.operation) || 'team_membership';
  const mode = hasAutomaticAuthorizationRecord(approval) ? 'automatic' : 'manual';

  if (mode !== 'automatic') {
    return {
      required: false,
      mode,
      operation,
      organization: request.organization || '',
      subjects: [],
      reason: 'manual_approval_comment_gate',
    };
  }

  if (!ORG_ADMIN_MUTATION_OPERATIONS.includes(operation) && !ORG_MEMBER_MUTATION_OPERATIONS.includes(operation)) {
    return {
      required: false,
      mode,
      operation,
      organization: request.organization || '',
      subjects: [],
      reason: 'tenant_scoped_authorization_revalidated_by_operation_validator',
    };
  }

  const requesterAuthorization = approval.requester_authorization || {};
  const requesterRequirement = getAutomaticRequesterRequirement(operation);
  return {
    required: true,
    mode,
    operation,
    organization: request.organization || '',
    subjects: [
      {
        kind: 'requester',
        login: normalizeLogin(requesterAuthorization.requester_login || request.requester_login),
        requirement: requesterRequirement,
      },
    ],
    reason: requesterRequirement === 'org_admin'
      ? 'org_level_mutation_requires_live_org_admin'
      : 'org_level_mutation_requires_live_org_member',
  };
}

async function inspectSubject(subject, context = {}) {
  const organization = context.organization;
  const getOrganizationMembership = context.getOrganizationMembership;
  const base = {
    kind: subject.kind,
    login: subject.login,
    requirement: subject.requirement,
    observed_state: 'unknown',
    observed_role: 'unknown',
    authorized: false,
    failure_reason: null,
  };

  if (!organization || !subject.login) {
    return { ...base, failure_reason: 'caller_login_missing' };
  }

  // The capability check only selects which lookup to use. A caller check is
  // never skipped because an adapter happens not to expose the lookup.
  if (typeof getOrganizationMembership !== 'function') {
    return { ...base, failure_reason: 'caller_org_role_lookup_unavailable' };
  }

  let result;
  try {
    result = typeof context.executeWithRetry === 'function'
      ? await context.executeWithRetry(
          () => getOrganizationMembership({ organization, username: subject.login }),
          { maxRetries: context.maxRetries || 2, sleep: context.sleep }
        )
      : await getOrganizationMembership({ organization, username: subject.login });
  } catch (error) {
    return { ...base, failure_reason: 'caller_org_role_lookup_failed' };
  }

  const membership = result && result.membership ? result.membership : null;
  const exists = Boolean(result && result.exists);
  if (!exists || !membership) {
    return { ...base, observed_state: 'absent', observed_role: 'none', failure_reason: 'caller_org_membership_absent' };
  }

  const observedState = String(membership.state || 'unknown').toLowerCase();
  const observedRole = String(membership.role || 'unknown').toLowerCase();
  if (observedState !== 'active') {
    return {
      ...base,
      observed_state: observedState,
      observed_role: observedRole,
      failure_reason: 'caller_org_membership_not_active',
    };
  }

  if (subject.requirement === 'org_admin' && observedRole !== 'admin') {
    return {
      ...base,
      observed_state: observedState,
      observed_role: observedRole,
      failure_reason: 'caller_is_not_org_admin',
    };
  }

  return {
    ...base,
    observed_state: observedState,
    observed_role: observedRole,
    authorized: true,
  };
}

// Reads the caller's current organization membership and fails closed on a
// missing login, an unavailable or failing lookup, a non-active membership, or a
// role that no longer satisfies the requirement. Performs reads only.
async function revalidateCallerOrgRole(input = {}) {
  const auditArtifact = input.auditArtifact || {};
  const requirement = resolveCallerOrgRoleRequirement(auditArtifact);
  const rateLimitSnapshot = input.rateLimitSnapshot || null;

  if (!requirement.required) {
    return {
      required: false,
      authorized: true,
      mode: requirement.mode,
      operation: requirement.operation,
      reason: requirement.reason,
      checked_subjects: [],
      failure_reason: null,
      rate_limit_snapshot: rateLimitSnapshot,
    };
  }

  const checkedSubjects = [];
  for (const subject of requirement.subjects) {
    checkedSubjects.push(await inspectSubject(subject, {
      organization: requirement.organization,
      getOrganizationMembership: input.getOrganizationMembership,
      executeWithRetry: input.executeWithRetry,
      maxRetries: input.maxRetries,
      sleep: input.sleep,
    }));
  }

  const firstFailure = checkedSubjects.find((subject) => subject.authorized !== true) || null;
  return {
    required: true,
    authorized: !firstFailure,
    mode: requirement.mode,
    operation: requirement.operation,
    reason: requirement.reason,
    checked_subjects: checkedSubjects,
    failure_reason: firstFailure ? firstFailure.failure_reason : null,
    rate_limit_snapshot: rateLimitSnapshot,
  };
}

module.exports = {
  ORG_ADMIN_MUTATION_OPERATIONS,
  ORG_MEMBER_MUTATION_OPERATIONS,
  ORG_MEMBER_REQUIREMENT_OPERATIONS,
  getAutomaticRequesterRequirement,
  resolveCallerOrgRoleRequirement,
  revalidateCallerOrgRole,
};
