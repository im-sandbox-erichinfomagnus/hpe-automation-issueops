# Data Model: Tenant Runner Group Creation IssueOps Workflow

## RunnerGroupCreationRequest

- Purpose: Parsed request envelope for one tenant runner-group creation operation.
- Fields:
  - request_id
  - issue_number
  - repository
  - requester_login
  - organization
  - tenant_name_input
  - tenant_name_normalized
  - runner_group_base_name_input
  - runner_group_name_derived
  - runner_group_visibility: `selected` | `all` | `private`
  - runner_group_visibility_source: `user_selected` | `default`
  - allows_public_repositories
  - designated_approver_login
  - dry_run
  - business_justification
  - submitted_at
  - intake_mode: `manual`
  - request_status: `submitted` | `validation_failed` | `awaiting_approval` | `approved` | `executed` | `partially_executed` | `failed`
- Validation rules:
  - Exactly one target organization, one tenant name, and one group base name are required.
  - Visibility defaults to `selected`; only the allowed set is accepted.
  - Public-repository allowance defaults to false.

## TenantCicdContext

- Purpose: Resolved tenant governance context authorizing the requester for CI/CD administration (shared shape with 021).
- Fields: see `specs/021-create-tenant-hosted-runner/data-model.md`; the context marker uses operation `runner_group_creation`.

## DerivedRunnerGroupName

- Purpose: Deterministic tenant-prefixed group name derivation record.
- Fields:
  - tenant_prefix
  - group_base_name_normalized
  - derived_name
  - derivation_status: `valid` | `invalid` | `empty`
  - constraint_findings
- Validation rules:
  - Derived name is capped at 100 characters using the runner-name character set.
  - Derived name must start with the tenant prefix followed by an underscore.

## RunnerGroupReconciliationPlan

- Purpose: Desired-versus-current state diff used to execute idempotent group creation.
- Fields:
  - organization_visible
  - runner_group_exists
  - existing_runner_group_id
  - runner_group_name_derived
  - runner_group_visibility
  - allows_public_repositories
  - creation_action: `create_runner_group` | `noop` | `reject`
  - blocked_reason: `boundary_mismatch` | `missing_tenant_context` | null
  - dry_run
  - rate_limit_snapshot
  - boundary_revalidation_status: `matched` | `mismatched`
  - state: `blocked` | `validated` | `approved_for_execution`
- State transitions:
  - `submitted` -> `awaiting_approval` (valid)
  - `awaiting_approval` -> `approved`
  - `approved` -> `executed` | `partially_executed` | `failed`

## RunnerGroupExecutionOutcome

- Purpose: Audit-grade per-step execution and completion result.
- Fields:
  - run_id
  - run_attempt
  - request_status
  - runner_group_creation_result: `created` | `noop` | `failed` | `not_started`
  - created_runner_group_id
  - rollback_status
  - remediation_instructions
  - error_summary
- Validation rules:
  - Full success requires the derived group to exist (created or pre-existing no-op) in the target organization.
  - Platform-accepted creation that cannot be confirmed yields partial failure, not full success.
