'use strict';

const { parseHostedRunnerMoveRequest } = require('./parse-hosted-runner-move-request');
const {
  resolveNamespaceOwner,
  resolveTenantCicdContextFromRegistry,
} = require('./resolve-tenant-cicd-context-from-registry');

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function buildCanonicalTenantContext(tenantResolution) {
  const resolvedContext = tenantResolution.resolved_context;
  if (!resolvedContext) {
    return null;
  }

  return {
    tenant_key: resolvedContext.tenant_key,
    tenant_display_name: resolvedContext.tenant_display_name,
    organization: resolvedContext.organization,
    registry_ref: resolvedContext.registry_ref,
    tenant_team_name: resolvedContext.tenant_team_name,
    tenant_team_slug: resolvedContext.tenant_team_slug,
    cicd_admin_team_name: resolvedContext.cicd_admin_team_name,
    cicd_admin_team_slug: resolvedContext.cicd_admin_team_slug,
    governance_relation_status: resolvedContext.governance_relation_status,
    requester_cicd_membership_state: resolvedContext.requester_cicd_membership_state,
    tenant_match_count: tenantResolution.tenant_match_count,
    tenant_resolution_status: tenantResolution.tenant_resolution_status,
    context_marker: resolvedContext.context_marker,
  };
}

function appendTenantResolutionFindings(request, tenantResolution, errors, warnings) {
  if (tenantResolution.registry_missing_directory) {
    errors.push('Tenant registry directory is missing in the workflow workspace.');
  }

  if (tenantResolution.registry_malformed_files && tenantResolution.registry_malformed_files.length > 0) {
    warnings.push('One or more tenant registry records were malformed and ignored.');
  }

  if (tenantResolution.tenant_resolution_status === 'no_match') {
    const missingCicdTeamCandidate = (tenantResolution.candidates || []).find(
      (candidate) => candidate.governance_relation_status === 'missing_cicd_admin_team'
    );
    const unauthorizedCandidate = (tenantResolution.candidates || []).find(
      (candidate) => candidate.authorization_status === 'unauthorized'
    );

    if (missingCicdTeamCandidate) {
      errors.push(
        `The derived tenant CI/CD admin team '${missingCicdTeamCandidate.cicd_admin_team_name}' does not exist in organization '${request.organization}'. Provision the team before managing tenant runners.`
      );
    } else if (unauthorizedCandidate) {
      errors.push(
        `Requester '${request.requester_login}' is not an active member of the tenant CI/CD admin team '${unauthorizedCandidate.cicd_admin_team_name}'.`
      );
    } else {
      errors.push(
        `No authorized tenant CI/CD context was found for tenant name '${request.tenant_name_input}' in organization '${request.organization}'.`
      );
      if (tenantResolution.available_tenant_display_names && tenantResolution.available_tenant_display_names.length > 0) {
        warnings.push(`Available tenant names in this organization: ${tenantResolution.available_tenant_display_names.join(', ')}`);
      }
    }
  } else if (tenantResolution.tenant_resolution_status === 'ambiguous') {
    errors.push(`Tenant name '${request.tenant_name_input}' matched multiple authorized tenant CI/CD contexts and is ambiguous.`);
  } else if (tenantResolution.tenant_resolution_status === 'registry_conflict') {
    errors.push('Tenant registry data is malformed or conflicting for the target organization.');
  }

  if (!tenantResolution.resolved_context) {
    errors.push('Canonical tenant CI/CD context did not resolve.');
  }
}

async function validateHostedRunnerMoveRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseHostedRunnerMoveRequest(input);
  const errors = [];
  const warnings = [];

  if (!request.organization) {
    errors.push('Target organization is required.');
  }
  if (!request.tenant_name_input) {
    errors.push('Tenant name is required.');
  }
  if (!request.runner_base_name_input) {
    errors.push('Runner name is required.');
  }
  if (request.hosted_runner_id_valid === false) {
    errors.push('Hosted runner id must be a positive integer when provided.');
  }
  if (!request.target_runner_group_name_input) {
    errors.push('Target runner group name is required.');
  }
  if (!request.designated_approver_login) {
    errors.push('A designated approver is required.');
  }

  const runnerNameDerivation = request.runner_name_derivation || {};
  if (runnerNameDerivation.derivation_status !== 'valid') {
    for (const finding of runnerNameDerivation.constraint_findings || []) {
      errors.push(finding);
    }
    if (!runnerNameDerivation.constraint_findings || runnerNameDerivation.constraint_findings.length === 0) {
      errors.push('Runner name derivation failed.');
    }
  }

  let organizationVisible = false;
  if (request.organization && typeof options.getOrganization === 'function') {
    const organizationResult = await options.getOrganization({ organization: request.organization });
    organizationVisible = Boolean(organizationResult && organizationResult.exists);
    if (!organizationVisible) {
      errors.push('The target organization does not exist or is not visible to the workflow identity.');
    }
  }

  const tenantResolution = await resolveTenantCicdContextFromRegistry(
    {
      requester_login: request.requester_login,
      organization: request.organization,
      tenant_name_input: request.tenant_name_input,
      tenant_name_normalized: request.tenant_name_normalized,
      operation: 'hosted_runner_move',
      target_resource_name: `${request.runner_name_derived}->${request.target_runner_group_name_input}`,
      designated_approver_login: request.designated_approver_login,
    },
    {
      registryDirectory: options.registryDirectory,
      registryRef: options.registryRef,
      listTeams: options.listTeams,
      getMembershipForUser: options.getMembershipForUser,
    }
  );

  appendTenantResolutionFindings(request, tenantResolution, errors, warnings);
  const resolvedContext = tenantResolution.resolved_context;

  if (resolvedContext && request.runner_name_derived) {
    const runnerNamespaceOwner = resolveNamespaceOwner(
      request.runner_name_derived,
      tenantResolution.available_tenant_display_names
    );
    if (
      runnerNamespaceOwner &&
      normalizeLogin(runnerNamespaceOwner) !== normalizeLogin(resolvedContext.tenant_display_name)
    ) {
      errors.push(
        `Derived runner name '${request.runner_name_derived}' falls within the naming namespace of tenant '${runnerNamespaceOwner}' and cannot be managed through tenant '${resolvedContext.tenant_display_name}'.`
      );
    }
  }

  if (resolvedContext && request.target_runner_group_name_input) {
    const groupNamespaceOwner = resolveNamespaceOwner(
      request.target_runner_group_name_input,
      tenantResolution.available_tenant_display_names
    );
    const tenantPrefix = `${String(resolvedContext.tenant_display_name || '').trim().replace(/\s+/g, '_').toLowerCase()}_`;
    if (
      groupNamespaceOwner &&
      normalizeLogin(groupNamespaceOwner) !== normalizeLogin(resolvedContext.tenant_display_name)
    ) {
      errors.push(
        `Runner group name '${request.target_runner_group_name_input}' falls within the naming namespace of tenant '${groupNamespaceOwner}' and cannot be targeted through tenant '${resolvedContext.tenant_display_name}'.`
      );
    } else if (!normalizeLogin(request.target_runner_group_name_input).startsWith(tenantPrefix)) {
      errors.push(
        `Runner group name '${request.target_runner_group_name_input}' does not carry the tenant naming prefix for tenant '${resolvedContext.tenant_display_name}'.`
      );
    }
  }

  let designatedApproverAuthorization = { state: 'unknown', role: 'other' };
  if (request.organization && request.designated_approver_login && typeof options.getOrganizationMembership === 'function') {
    const approverMembership = await options.getOrganizationMembership({
      organization: request.organization,
      username: request.designated_approver_login,
    });
    const approverState = normalizeLogin(approverMembership && approverMembership.membership && approverMembership.membership.state) || 'absent';
    const approverRole = normalizeLogin(approverMembership && approverMembership.membership && approverMembership.membership.role) || 'other';
    designatedApproverAuthorization = {
      state: approverState === 'active' && approverRole === 'admin' ? 'authorized' : 'unauthorized',
      role: approverRole,
    };
    if (designatedApproverAuthorization.state !== 'authorized') {
      errors.push('Designated approver must be an active target organization owner.');
    }
  }

  let runnerExists = false;
  let existingRunnerId = null;
  let existingRunnerStatus = '';
  let currentRunnerGroupId = null;
  let runnerResolutionStatus = 'not_found';
  if (request.organization && request.runner_name_derived && typeof options.listHostedRunners === 'function') {
    const runners = await options.listHostedRunners({ organization: request.organization });
    const nameMatches = (runners || []).filter(
      (runner) => normalizeLogin(runner.name) === normalizeLogin(request.runner_name_derived)
    );
    const matches = request.hosted_runner_id_input == null
      ? nameMatches
      : nameMatches.filter((runner) => Number(runner.id) === Number(request.hosted_runner_id_input));

    if (request.hosted_runner_id_input != null && nameMatches.length > 0 && matches.length === 0) {
      errors.push(
        `Hosted runner id '${request.hosted_runner_id_input}' does not match runner '${request.runner_name_derived}'.`
      );
      runnerResolutionStatus = 'id_mismatch';
    } else if (matches.length === 0) {
      errors.push(`Hosted runner '${request.runner_name_derived}' was not found in organization '${request.organization}'.`);
    } else if (matches.length > 1 && request.hosted_runner_id_input == null) {
      errors.push(
        `Hosted runner name '${request.runner_name_derived}' matched multiple runners. Provide the hosted runner id to disambiguate.`
      );
      runnerResolutionStatus = 'ambiguous';
    } else {
      const runner = matches[0];
      runnerExists = true;
      existingRunnerId = runner.id;
      existingRunnerStatus = runner.status || '';
      currentRunnerGroupId = runner.runner_group_id ?? null;
      runnerResolutionStatus = 'resolved';
    }
  }

  let targetRunnerGroupResolution = {
    requested_group_name: request.target_runner_group_name_input || '',
    resolved_group_id: null,
    resolved_group_name: '',
    resolution_status: 'not_found',
  };
  if (request.organization && request.target_runner_group_name_input && typeof options.listRunnerGroups === 'function') {
    const groups = await options.listRunnerGroups({ organization: request.organization });
    const matches = (groups || []).filter(
      (group) => normalizeLogin(group.name) === normalizeLogin(request.target_runner_group_name_input)
    );
    if (matches.length === 0) {
      errors.push(
        `Runner group '${request.target_runner_group_name_input}' was not found in organization '${request.organization}'.`
      );
    } else if (matches.length > 1) {
      errors.push(`Runner group name '${request.target_runner_group_name_input}' is ambiguous in organization '${request.organization}'.`);
      targetRunnerGroupResolution.resolution_status = 'ambiguous';
    } else {
      targetRunnerGroupResolution = {
        requested_group_name: request.target_runner_group_name_input,
        resolved_group_id: matches[0].id,
        resolved_group_name: matches[0].name,
        resolution_status: 'resolved',
      };
    }
  }

  const runnerAlreadyInTargetGroup = Boolean(
    runnerExists &&
    targetRunnerGroupResolution.resolution_status === 'resolved' &&
    Number(currentRunnerGroupId) === Number(targetRunnerGroupResolution.resolved_group_id)
  );
  if (runnerAlreadyInTargetGroup) {
    warnings.push(
      `Hosted runner '${request.runner_name_derived}' is already in runner group '${targetRunnerGroupResolution.resolved_group_name}'; execution will converge as no-op.`
    );
  }
  if (request.dry_run) {
    warnings.push('Dry-run is enabled; reconciliation intent is reported without mutation.');
  }

  const requestStatus = errors.length === 0 ? 'awaiting_approval' : 'validation_failed';
  const canonicalTenantContext = buildCanonicalTenantContext(tenantResolution);
  const enrichedRequest = {
    ...request,
    tenant_key: canonicalTenantContext ? canonicalTenantContext.tenant_key : '',
    tenant_display_name: canonicalTenantContext ? canonicalTenantContext.tenant_display_name : '',
    tenant_team_name: canonicalTenantContext ? canonicalTenantContext.tenant_team_name : '',
    tenant_team_slug: canonicalTenantContext ? canonicalTenantContext.tenant_team_slug : '',
    cicd_admin_team_name: canonicalTenantContext ? canonicalTenantContext.cicd_admin_team_name : '',
    cicd_admin_team_slug: canonicalTenantContext ? canonicalTenantContext.cicd_admin_team_slug : '',
    context_marker: canonicalTenantContext ? canonicalTenantContext.context_marker : '',
    request_status: requestStatus,
  };

  return {
    is_valid: errors.length === 0,
    request_status: requestStatus,
    errors,
    warnings,
    organization_visible: organizationVisible,
    designated_approver_authorization: designatedApproverAuthorization,
    canonical_tenant_context: canonicalTenantContext,
    tenant_resolution: {
      tenant_match_count: tenantResolution.tenant_match_count,
      tenant_resolution_status: tenantResolution.tenant_resolution_status,
      candidates: tenantResolution.candidates,
      registry_ref: tenantResolution.registry_ref,
      registry_directory: tenantResolution.registry_directory,
      registry_malformed_files: tenantResolution.registry_malformed_files,
      registry_missing_directory: tenantResolution.registry_missing_directory,
      requested_tenant_name: tenantResolution.requested_tenant_name,
      requested_tenant_name_normalized: tenantResolution.requested_tenant_name_normalized,
      candidate_registry_record_count: tenantResolution.candidate_registry_record_count,
      available_tenant_display_names: tenantResolution.available_tenant_display_names || [],
    },
    runner_exists: runnerExists,
    existing_runner_id: existingRunnerId,
    existing_runner_status: existingRunnerStatus,
    current_runner_group_id: currentRunnerGroupId,
    runner_resolution_status: runnerResolutionStatus,
    target_runner_group_resolution: targetRunnerGroupResolution,
    runner_already_in_target_group: runnerAlreadyInTargetGroup,
    validation_findings: {
      tenant_resolution_status: tenantResolution.tenant_resolution_status,
      governance_relation_status: canonicalTenantContext ? canonicalTenantContext.governance_relation_status : 'unknown',
      requester_cicd_membership_state: canonicalTenantContext ? canonicalTenantContext.requester_cicd_membership_state : 'unknown',
      context_marker: canonicalTenantContext ? canonicalTenantContext.context_marker : '',
      runner_name_derivation: request.runner_name_derivation,
      runner_resolution_status: runnerResolutionStatus,
      current_runner_group_id: currentRunnerGroupId,
      target_runner_group_resolution: targetRunnerGroupResolution,
      runner_already_in_target_group: runnerAlreadyInTargetGroup,
      dry_run_no_mutation: Boolean(request.dry_run),
    },
    no_mutation_planned: true,
    request: enrichedRequest,
  };
}

module.exports = {
  validateHostedRunnerMoveRequest,
};
