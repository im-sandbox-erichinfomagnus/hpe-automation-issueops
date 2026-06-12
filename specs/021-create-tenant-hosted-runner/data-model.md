# Data Model: Tenant GitHub-Hosted Runner Creation IssueOps Workflow

## HostedRunnerCreationRequest

- Purpose: Parsed request envelope for one tenant hosted-runner creation operation.
- Fields:
  - request_id
  - issue_number
  - repository
  - requester_login
  - organization
  - tenant_name_input
  - tenant_name_normalized
  - runner_base_name_input
  - runner_name_derived
  - runner_image_id
  - runner_image_source: `github` | `partner` | `custom`
  - runner_size
  - runner_group_name_input
  - maximum_runners
  - designated_approver_login
  - dry_run
  - business_justification
  - submitted_at
  - intake_mode: `manual`
  - request_status: `submitted` | `validation_failed` | `awaiting_approval` | `approved` | `executed` | `partially_executed` | `failed`
- Validation rules:
  - Exactly one target organization, one tenant name, and one runner base name are required.
  - Dry-run flag must be explicit boolean-compatible input.
  - Maximum runners, when provided, must parse as a positive integer.

## TenantCicdContext

- Purpose: Resolved tenant governance context authorizing the requester for topology administration.
- Fields:
  - tenant_key
  - tenant_display_name
  - organization
  - registry_ref
  - tenant_team_name
  - tenant_team_slug
  - topology_admin_team_name (`<tenant-slug>-admin`)
  - topology_admin_team_slug
  - topology_admin_team_exists
  - governance_relation_status: `valid` | `missing_tenant_team` | `missing_cicd_admin_team`
  - requester_admin_membership_state: `active_member` | `active_maintainer` | `pending` | `absent` | `unknown`
  - authorization_status: `authorized` | `unauthorized` | `blocked` | `ambiguous`
  - tenant_resolution_status: `resolved` | `no_match` | `ambiguous` | `registry_conflict`
  - context_marker
- Validation rules:
  - Tenant context must resolve to exactly one registry record for the target organization.
  - Authorization requires active membership (member or maintainer) on the derived topology admin team.
  - Missing tenant team or missing topology admin team blocks the request.

## DerivedRunnerName

- Purpose: Deterministic tenant-prefixed runner name derivation record.
- Fields:
  - tenant_prefix
  - runner_base_name_normalized
  - derived_name
  - derivation_status: `valid` | `invalid` | `empty`
  - constraint_findings
- Validation rules:
  - Derived name must be 1-64 characters from `[A-Za-z0-9._-]`.
  - Derived name must start with the tenant prefix followed by an underscore.

## RunnerGroupResolution

- Purpose: Resolved runner-group target for hosted-runner placement.
- Fields:
  - requested_group_name
  - resolution_mode: `explicit_tenant_group` | `organization_default`
  - resolved_group_id
  - resolved_group_name
  - resolution_status: `resolved` | `not_found` | `pattern_mismatch` | `default_unresolved`
- Validation rules:
  - Explicit group names must carry the tenant naming prefix.
  - Explicit group names must resolve to an existing organization runner group.
  - Default resolution requires an organization runner group marked `default`.

## HostedRunnerApprovalDecision

- Purpose: Central approval-gate evidence for hosted-runner creation execution.
- Fields:
  - approval_status: `pending` | `approved` | `denied` | `invalidated` | `not_requested`
  - approver_login
  - approver_role: `target_org_owner` | `other`
  - approver_authorization_state: `authorized` | `unauthorized` | `unknown`
  - approved_at
  - decision_note
- Validation rules:
  - Approver must be designated and currently an active organization owner.

## HostedRunnerReconciliationPlan

- Purpose: Desired-versus-current state diff used to execute idempotent runner creation.
- Fields:
  - organization_visible
  - runner_exists
  - existing_runner_id
  - creation_action: `create_hosted_runner` | `noop` | `reject`
  - runner_group_resolution
  - blocked_reason: `boundary_mismatch` | `missing_tenant_context` | `unresolved_runner_group` | null
  - dry_run
  - rate_limit_snapshot
  - boundary_revalidation_status: `matched` | `mismatched`
  - state: `blocked` | `validated` | `approved_for_execution`
- State transitions:
  - `submitted` -> `awaiting_approval` (valid)
  - `awaiting_approval` -> `approved`
  - `approved` -> `executed` | `partially_executed` | `failed`

## HostedRunnerExecutionOutcome

- Purpose: Audit-grade per-step execution and completion result.
- Fields:
  - run_id
  - run_attempt
  - request_status
  - runner_creation_result: `created` | `noop` | `failed` | `not_started`
  - created_runner_id
  - created_runner_status
  - rollback_status
  - remediation_instructions
  - error_summary
- Validation rules:
  - Full success requires the derived runner to exist (created or pre-existing no-op) in the target organization.
  - Platform-accepted creation that cannot be confirmed yields partial failure, not full success.
