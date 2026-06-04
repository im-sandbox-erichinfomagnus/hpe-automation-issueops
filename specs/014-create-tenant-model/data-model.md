# Data Model: Tenant Creation IssueOps Workflow

## TenantCreationRequest

- Purpose: Parsed request envelope for one tenant bootstrap operation.
- Fields:
  - request_id
  - issue_number
  - repository
  - requester_login
  - organization
  - tenant_name_input
  - tenant_display_name
  - tenant_key
  - dry_run
  - justification
  - designated_approver_login
  - request_status: `submitted` | `awaiting_approval` | `approved` | `denied` | `executed` | `partially_executed` | `failed_after_approved_execution`
- Validation rules:
  - Exactly one target organization and one tenant name are required.
  - Tenant key must normalize safely and deterministically.
  - Dry-run flag must be explicit boolean-compatible input.

## DerivedTenantTeamSet

- Purpose: Deterministic desired team topology for tenant bootstrap.
- Fields:
  - tenant_team_name (`TenantName_Tenant`)
  - tenant_team_slug
  - repo_admin_team_name (`TenantName_RepoAdmins`)
  - repo_admin_team_slug
  - derivation_status: `valid` | `invalid` | `conflicting`
  - conflict_details
- Validation rules:
  - Both derived names/slugs must be valid and non-empty.
  - Derived slugs cannot conflict with each other.
  - Derived slugs cannot ambiguously conflict with unrelated existing teams.

## TenantHierarchyLink

- Purpose: Desired parent-child relationship between derived tenant teams.
- Fields:
  - parent_team_slug (tenant_team_slug)
  - child_team_slug (repo_admin_team_slug)
  - current_parent_slug
  - validation_status: `valid` | `already_linked` | `reparent_blocked` | `missing_team`
  - desired_action: `link_child` | `noop` | `reject`
- Validation rules:
  - Re-parenting from a different existing parent is rejected in this version.

## RequesterMaintainerBootstrap

- Purpose: Maintainer-role reconciliation record for requester on `TenantName_Tenant`.
- Fields:
  - team_slug
  - requester_login
  - current_membership_state: `absent` | `active_member` | `active_maintainer` | `unknown`
  - desired_role: `maintainer`
  - desired_action: `promote_to_maintainer` | `add_as_maintainer` | `noop` | `reject`
  - failure_reason
- Validation rules:
  - Requester must be valid for target organization/team membership mutation.
  - Only requester bootstrap is allowed by this feature.

## TenantRegistryRecord

- Purpose: Durable, per-tenant governance record under `tenant-registry/` in repository.
- Fields:
  - tenant_key
  - tenant_display_name
  - organization
  - tenant_team_name
  - tenant_team_slug
  - repo_admin_team_name
  - repo_admin_team_slug
  - bootstrap_tenant_admin_login
  - requester_login
  - approver_login
  - lifecycle_status: `active` | `blocked` | `partial_failure` | `decommissioned`
  - created_at
  - updated_at
  - created_by_run_id
  - last_updated_by_run_id
  - source_issue_number
  - source_branch
- Validation rules:
  - Registry file path must be safe and deterministic (for example `tenant-registry/<tenant_key>.json`).
  - Per-tenant record uniqueness enforced by tenant_key + organization.

## ApprovalDecision

- Purpose: Central approval-gate evidence for tenant creation execution.
- Fields:
  - approval_status: `pending` | `approved` | `denied` | `invalidated`
  - approver_login
  - approver_role: `target_org_owner` | `other`
  - approver_authorization_state: `authorized` | `unauthorized` | `unknown`
  - approved_at
  - decision_note
- Validation rules:
  - Approver must be designated and currently active organization owner.

## TenantReconciliationPlan

- Purpose: Desired-vs-current state diff used to execute idempotent mutation.
- Fields:
  - organization_visible
  - derived_teams
  - teams_to_create
  - teams_already_present
  - hierarchy_action
  - requester_bootstrap_action
  - registry_persistence_action
  - dry_run
  - rate_limit_snapshot
- State transitions:
  - `submitted` -> `awaiting_approval` (valid)
  - `awaiting_approval` -> `approved`
  - `approved` -> `executed` | `partially_executed` | `failed_after_approved_execution`

## TenantCreationExecutionOutcome

- Purpose: Audit-grade per-step execution and completion result.
- Fields:
  - run_id
  - run_attempt
  - request_status
  - teams_created_count
  - teams_noop_count
  - hierarchy_link_result
  - requester_bootstrap_result
  - registry_persistence_result: `created` | `updated` | `noop` | `failed`
  - rollback_status
  - remediation_instructions
  - error_summary
- Validation rules:
  - Full success requires converged team/hierarchy/bootstrap state and successful durable registry persistence.
  - Registry persistence failure yields partial/blocking result, not full success.
