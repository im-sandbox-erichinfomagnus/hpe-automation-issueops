# Data Model: Tenant GitHub-Hosted Runner Deletion IssueOps Workflow

## HostedRunnerDeletionRequest

- Purpose: Parsed request envelope for one tenant hosted-runner deletion operation.
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
  - runner_deletion_scope: `organization`
  - designated_approver_login
  - dry_run
  - business_justification
  - submitted_at
  - intake_mode: `manual`
  - request_status: `submitted` | `validation_failed` | `awaiting_approval` | `approved` | `executed` | `partially_executed` | `failed`
- Validation rules:
  - Exactly one target organization, one tenant name, and one runner name are required.
  - Dry-run flag must be explicit boolean-compatible input.

## TenantCicdContext

- Purpose: Resolved tenant governance context authorizing the requester for CI/CD administration (shared shape with 021).
- Fields: see `specs/021-create-tenant-hosted-runner/data-model.md`; the context marker uses operation `hosted_runner_deletion`.

## TargetRunnerResolution

- Purpose: Resolved live hosted-runner target for the derived tenant-prefixed name.
- Fields:
  - runner_exists
  - existing_runner_id
  - existing_runner_status: platform status string (`Ready` | `Provisioning` | `Shutdown` | `Deleting` | `Stuck` | empty)
- Validation rules:
  - Resolution is by exact case-insensitive derived-name match against the organization hosted-runner listing.
  - An absent runner is a valid, no-op-converging state.

## HostedRunnerDeletionPlan

- Purpose: Desired-versus-current state diff used to execute idempotent runner deletion.
- Fields:
  - organization_visible
  - runner_exists
  - existing_runner_id
  - runner_name_derived
  - deletion_action: `delete_hosted_runner` | `noop` | `reject`
  - blocked_reason: `boundary_mismatch` | `missing_tenant_context` | null
  - dry_run
  - rate_limit_snapshot
  - boundary_revalidation_status: `matched` | `mismatched`
  - state: `blocked` | `validated` | `approved_for_execution`
- State transitions:
  - `submitted` -> `awaiting_approval` (valid)
  - `awaiting_approval` -> `approved`
  - `approved` -> `executed` | `partially_executed` | `failed`

## HostedRunnerDeletionOutcome

- Purpose: Audit-grade per-step execution and completion result.
- Fields:
  - run_id
  - run_attempt
  - request_status
  - runner_deletion_result: `deleted` | `noop` | `failed` | `not_started`
  - rollback_status
  - remediation_instructions
  - error_summary
- Validation rules:
  - Full success requires the derived runner to be absent (deleted or already absent) in the target organization.
  - A platform 404 on deletion is recorded as no-op convergence.
