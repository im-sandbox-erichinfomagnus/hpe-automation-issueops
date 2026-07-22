'use strict';

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}

function buildCanonicalTopologyDraft(request = {}) {
  if (request.topology && request.topology.teams && Array.isArray(request.topology.teams.structure)) {
    return request.topology;
  }

  const tenantKey = normalizeSlug(request.tenant_key || request.tenant_display_name || 'tenant');
  const rootSlug = `${tenantKey}-root`;

  return {
    organization: {
      orgName: String(request.organization || '').toLowerCase(),
    },
    teams: {
      tenantRootTeam: rootSlug,
      structure: [
        { team: rootSlug, parent: null, type: 'root' },
        { team: `${tenantKey}-admin`, parent: rootSlug, type: 'admin' },
        { team: `${tenantKey}-repo-admin`, parent: rootSlug, type: 'repo-admin' },
      ],
    },
    repositories: {
      owned: [],
    },
    runnerTopology: {
      runnerGroups: [],
    },
    accessModel: {
      enforcement: 'tenant-boundary',
      roles: ['tenant-admin', 'repo-admin', 'developer', 'viewer'],
    },
  };
}

function evaluateCicdCapabilityPath(intent = {}) {
  const normalizedIntent = intent && typeof intent === 'object' ? intent : {};
  const requested = normalizedIntent.requested !== false;
  const primaryAvailable = Boolean(normalizedIntent.primary_path_available || normalizedIntent.primaryPathAvailable);
  const primaryApproved = Boolean(normalizedIntent.primary_policy_approved || normalizedIntent.primaryPolicyApproved);
  const fallbackAvailable = Boolean(normalizedIntent.fallback_path_available || normalizedIntent.fallbackPathAvailable);
  const fallbackApproved = Boolean(normalizedIntent.fallback_policy_approved || normalizedIntent.fallbackPolicyApproved);
  const tenantScopeResolvable = Boolean(normalizedIntent.tenant_scope_resolvable || normalizedIntent.tenantScopeResolvable);
  const unsafeScope = Boolean(normalizedIntent.unsafe_scope || normalizedIntent.unsafeScope);

  if (!requested) {
    return {
      selected_path: 'none',
      status: 'skipped',
      reason_code: 'not_requested',
      reason_message: 'CI/CD capability intent is not requested for this run.',
    };
  }

  if (unsafeScope) {
    return {
      selected_path: 'none',
      status: 'blocked',
      reason_code: 'unsafe_scope',
      reason_message: 'Requested capability path implies broad org-wide scope and is blocked by policy.',
    };
  }

  if (primaryAvailable && primaryApproved && tenantScopeResolvable) {
    return {
      selected_path: 'primary',
      status: 'applied',
      reason_code: null,
      reason_message: 'Primary capability path is available and policy-approved.',
    };
  }

  if (fallbackAvailable && fallbackApproved && tenantScopeResolvable) {
    return {
      selected_path: 'fallback',
      status: 'applied',
      reason_code: null,
      reason_message: 'Fallback capability path is available and policy-approved.',
    };
  }

  return {
    selected_path: 'none',
    status: 'unavailable',
    reason_code: 'capability_unavailable',
    reason_message: 'No safe CI/CD capability path is available for this request.',
  };
}

function reconcileTenantCreation(input = {}) {
  const request = input.request || {};
  const validatedTeams = input.validatedTeams || input.requested_teams || [];
  const currentTeams = input.currentTeams || input.current_teams || [];
  const currentMap = new Map(
    currentTeams
      .filter((team) => team && team.slug)
      .map((team) => [String(team.slug).toLowerCase(), team])
  );

  const teamsToCreate = [];
  const teamsAlreadyPresent = [];
  const teamsRejected = [];

  for (const team of validatedTeams) {
    if (team.validation_status !== 'valid' && team.validation_status !== 'existing') {
      teamsRejected.push({ ...team, desired_action: 'reject' });
      continue;
    }

    const existing = currentMap.get(String(team.normalized_slug || '').toLowerCase());
    if (existing || team.desired_action === 'noop' || team.validation_status === 'existing') {
      teamsAlreadyPresent.push({
        ...team,
        desired_action: 'noop',
        current_team_id: existing ? existing.id || null : team.current_team_id || null,
      });
      continue;
    }

    teamsToCreate.push({
      ...team,
      desired_action: 'create_team',
      current_team_id: null,
    });
  }

  const tenantParentSlug = String(request.tenant_team_slug || request.parent_team_slug || '').toLowerCase();
  const parentTeam = currentMap.get(tenantParentSlug) || null;

  const childLinksToApply = [];
  const childLinksAlreadyPresent = [];
  const childLinksRejected = [];
  for (const requestedChildLink of request.requested_child_links || []) {
    const childSlug = String(requestedChildLink.child_team_slug || '').toLowerCase();
    const childTeam = currentMap.get(childSlug) || null;
    const childParentSlug = childTeam && childTeam.parent && childTeam.parent.slug
      ? String(childTeam.parent.slug).toLowerCase()
      : null;

    if (!parentTeam || !childTeam) {
      continue;
    }

    if (childParentSlug === tenantParentSlug) {
      childLinksAlreadyPresent.push({ child_team_slug: childSlug, parent_team_slug: tenantParentSlug });
      continue;
    }

    if (childParentSlug && childParentSlug !== tenantParentSlug) {
      childLinksRejected.push({ child_team_slug: childSlug, parent_team_slug: childParentSlug, failure_reason: 'reparent_blocked' });
      continue;
    }

    childLinksToApply.push({ child_team_slug: childSlug, parent_team_slug: tenantParentSlug });
  }

  const tenantAdminMembership = input.tenantAdminMembership || input.requesterMembership || null;
  const tenantAdminBootstrapAction = tenantAdminMembership && tenantAdminMembership.membership && tenantAdminMembership.membership.role === 'maintainer'
    ? 'noop'
    : 'ensure_maintainer';

  const canonicalTopologyDraft = buildCanonicalTopologyDraft(request);
  const fallbackCapabilityTargets = canonicalTopologyDraft && canonicalTopologyDraft.repositories && Array.isArray(canonicalTopologyDraft.repositories.owned)
    ? canonicalTopologyDraft.repositories.owned
        .map((repo) => {
          const owner = String(repo && repo.owner || '').trim();
          const name = String(repo && repo.name || '').trim();
          if (!owner || !name) {
            return null;
          }
          return {
            repository_full_name: `${owner}/${name}`,
            repository_owner: owner,
            repository_name: name,
          };
        })
        .filter(Boolean)
    : [];
  let cicdCapabilityDecision = evaluateCicdCapabilityPath(request.cicd_capability_intent || null);
  if (cicdCapabilityDecision.selected_path === 'fallback' && fallbackCapabilityTargets.length === 0) {
    cicdCapabilityDecision = {
      selected_path: 'none',
      status: 'unavailable',
      reason_code: 'capability_unavailable',
      reason_message: 'Fallback capability path requires tenant-owned repositories.',
    };
  }
  const cicdCapabilityAssignmentPlan = {
    selected_path: cicdCapabilityDecision.selected_path,
    status: cicdCapabilityDecision.status,
    reason_code: cicdCapabilityDecision.reason_code,
    targets: cicdCapabilityDecision.selected_path === 'fallback'
      ? fallbackCapabilityTargets
      : [],
  };
  const cicdAdminTeamSlug = String(request.cicd_admin_team_slug || '').toLowerCase();
  const cicdAdminTeamRequested = Boolean(cicdAdminTeamSlug);
  const cicdAdminTeamCreatePlanned = cicdAdminTeamRequested && teamsToCreate.some((team) =>
    String(team.normalized_slug || '').toLowerCase() === cicdAdminTeamSlug
  );
  const cicdAdminTeamAlreadyPresent = cicdAdminTeamRequested && teamsAlreadyPresent.some((team) =>
    String(team.normalized_slug || '').toLowerCase() === cicdAdminTeamSlug
  );

  return {
    organization_exists: input.organization_exists !== false,
    teams_to_create: teamsToCreate,
    teams_already_present: teamsAlreadyPresent,
    teams_rejected: teamsRejected,
    child_links_to_apply: childLinksToApply,
    child_links_already_present: childLinksAlreadyPresent,
    child_links_rejected: childLinksRejected,
    tenant_admin_bootstrap_action: tenantAdminBootstrapAction,
    requester_bootstrap_action: tenantAdminBootstrapAction,
    registry_persistence_action: 'write',
    intake_mode: request.intake_mode || 'manual',
    canonical_topology_draft: canonicalTopologyDraft,
    compatibility_mode: request.compatibility && request.compatibility.mode ? request.compatibility.mode : 'canonical',
    canonical_topology_markers: {
      root_team: canonicalTopologyDraft.teams ? canonicalTopologyDraft.teams.tenantRootTeam : null,
      structure_node_count: canonicalTopologyDraft.teams && Array.isArray(canonicalTopologyDraft.teams.structure)
        ? canonicalTopologyDraft.teams.structure.length
        : 0,
    },
    cicd_capability_decision: cicdCapabilityDecision,
    cicd_capability_action: cicdCapabilityDecision.selected_path === 'primary'
      ? 'apply_primary'
      : cicdCapabilityDecision.selected_path === 'fallback'
        ? 'apply_fallback'
        : cicdCapabilityDecision.status,
    cicd_capability_assignment_plan: cicdCapabilityAssignmentPlan,
    cicd_admin_team_requested: cicdAdminTeamRequested,
    cicd_admin_team_create_planned: cicdAdminTeamCreatePlanned,
    cicd_admin_team_already_present: cicdAdminTeamAlreadyPresent,
    cicd_topology_update_action: request.cicd_admin_team_slug ? 'evaluate' : 'not_applicable',
    cicd_topology_update_result: null,
    dry_run: Boolean(input.dry_run ?? request.dry_run),
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    state: teamsRejected.length > 0 || childLinksRejected.length > 0
      ? 'blocked'
      : 'approved_for_execution',
  };
}

module.exports = {
  buildCanonicalTopologyDraft,
  evaluateCicdCapabilityPath,
  reconcileTenantCreation,
};
