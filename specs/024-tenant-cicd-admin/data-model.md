# Data Model: Tenant CI/CD Admin Bootstrap

## TenantCicdBootstrapRequest

- Purpose: Parsed request envelope for one tenant bootstrap run with CI/CD admin extension.
- Fields:
  - request_id
  - issue_number
  - repository
  - requester_login
  - organization
  - tenant_name_input
  - tenant_display_name
  - tenant_key
  - designated_approver_login
  - dry_run
  - justification
  - request_status: `submitted` | `awaiting_approval` | `approved` | `executed` | `partially_executed` | `failed_after_approved_execution` | `rejected`
- Validation rules:
  - Must preserve all baseline request validation constraints from spec 014.
  - Exactly one organization and one tenant per request.

## DerivedTenantTeamSetV2

- Purpose: Deterministic desired tenant team topology for this feature version.
- Fields:
  - tenant_team_name (`<TenantName>_Tenant`)
  - tenant_team_slug
  - repo_admin_team_name (`<TenantName>_RepoAdmins`)
  - repo_admin_team_slug
  - cicd_admin_team_name (`<TenantName>_Tenant_CICDAdmin`)
  - cicd_admin_team_slug
  - derivation_status: `valid` | `invalid` | `conflicting`
  - conflict_details
- Validation rules:
  - All derived names/slugs must be deterministic, valid, and non-empty.
  - Slugs cannot conflict with each other or ambiguously conflict with unrelated teams.

## TeamHierarchyPlanV2

- Purpose: Parent-child team relationship state for baseline and CICDAdmin hierarchy checks.
- Fields:
  - tenant_parent_slug
  - repo_admin_child_slug
  - cicd_admin_child_slug
  - repo_admin_current_parent_slug
  - cicd_admin_current_parent_slug
  - repo_admin_hierarchy_status: `already_linked` | `link_required` | `reparent_blocked` | `missing_team`
  - cicd_admin_hierarchy_status: `already_linked` | `link_required` | `reparent_blocked` | `missing_team`
- Validation rules:
  - Re-parenting from unrelated parent remains blocked in this version.
  - CICDAdmin hierarchy must follow deterministic policy for this feature.

## TenantTopologyStructureRelation

- Purpose: Durable topology relation for CICDAdmin parent-child linkage under tenant parent team.
- Fields:
  - parent_team_name (`<TenantName>_Tenant`)
  - parent_team_slug
  - child_team_name (`<TenantName>_Tenant_CICDAdmin`)
  - child_team_slug
  - relation_status: `applied` | `noop` | `blocked` | `failed`
  - conflict_reason
- Validation rules:
  - Parent must be the tenant parent team.
  - Child must be the CICDAdmin team.
  - Conflicting parent mappings are blocked in this version.

## CicdCapabilityIntent

- Purpose: Requested tenant CI/CD administration intent and path selection state.
- Fields:
  - requested: true
  - primary_path_eligible: boolean
  - primary_path_name
  - fallback_path_eligible: boolean
  - fallback_path_name
  - selected_path: `primary` | `fallback` | `none`
  - policy_decision: `approved` | `blocked`
  - capability_status: `requested` | `applied` | `skipped` | `blocked` | `unavailable` | `failed`
  - reason_code
  - reason_message
- Validation rules:
  - Must reject any selected path that implies unauthorized broad org-wide privilege expansion.
  - Must never imply organization-owner grant.

## CicdCapabilityEvidence

- Purpose: Durable machine-readable evidence for capability decisions and outcomes.
- Fields:
  - capability_status
  - reason_code
  - evaluated_prerequisites
  - denied_prerequisites
  - selected_path
  - applied_targets
  - blocked_targets
  - api_responses_summary
  - observed_at
- Validation rules:
  - `reason_code` required for statuses: `blocked`, `unavailable`, `failed`.
  - Evidence must be present for non-applied outcomes.

## TenantRegistryRecordV2

- Purpose: Durable per-tenant registry record extended for CICDAdmin semantics.
- Fields:
  - baseline fields from spec 014 registry model
  - cicd_admin_team_name
  - cicd_admin_team_slug
  - cicd_topology_relation
  - cicd_capability_status: `requested` | `applied` | `skipped` | `blocked` | `unavailable` | `failed`
  - cicd_capability_reason_code
  - cicd_capability_evidence_ref
  - last_capability_evaluated_at
- Validation rules:
  - Registry path remains deterministic: `tenant-registry/<tenant_key>.json`.
  - Status and reason fields must be consistent with execution outcome.

## TenantCicdReconciliationPlan

- Purpose: Desired-vs-current state diff for idempotent execution.
- Fields:
  - teams_to_create
  - teams_already_present
  - hierarchy_actions
  - requester_bootstrap_action
  - cicd_capability_action: `apply` | `skip` | `block` | `unavailable` | `fail`
  - dry_run
  - drift_detected
- State transitions:
  - `submitted` -> `awaiting_approval` (valid)
  - `awaiting_approval` -> `approved`
  - `approved` -> `executed` | `partially_executed` | `failed_after_approved_execution`

## TenantCicdExecutionOutcome

- Purpose: Per-run audit-grade execution summary.
- Fields:
  - run_id
  - run_attempt
  - request_status
  - team_create_outcomes
  - hierarchy_outcomes
  - requester_bootstrap_outcome
  - cicd_capability_outcome
  - registry_persistence_outcome
  - rollback_status
  - remediation_instructions
  - error_summary
- Validation rules:
  - Full success requires converged team/hierarchy/bootstrap state and a non-failed registry write.
  - Capability blocked/unavailable/failure after other successful mutations must result in partial/blocking completion semantics per policy.
