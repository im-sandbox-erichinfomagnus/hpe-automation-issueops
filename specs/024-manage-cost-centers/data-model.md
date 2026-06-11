# Data Model: Manage Cost Centers IssueOps Workflow

## CostCenterChangeRequest

- Purpose: Parsed request envelope for one cost-center change spreadsheet.
- Fields:
  - request_id
  - issue_number
  - repository
  - requester_login
  - enterprise
  - enterprise_normalized
  - designated_approver_login
  - dry_run
  - business_justification
  - submitted_at
  - intake_mode (always `manual` for this workflow)
  - request_status: `submitted` | `validation_failed` | `awaiting_approval` | `approved` | `executed` | `partially_executed` | `failed`
  - csv_header
  - csv_schema_status: `valid` | `invalid_header` | `empty`
  - unsupported_columns
  - duplicate_row_count
  - requested_changes (list of CostCenterChangeRow)
- Validation rules:
  - Enterprise slug and designated approver are required.
  - The CSV header must include at least `cost_center` and `action`.
  - dry_run defaults to true when absent.

## CostCenterChangeRow

- Purpose: One parsed and evaluated spreadsheet row describing a single cost-center change.
- Fields:
  - source_row_number (1-based, excludes the header)
  - cost_center_input
  - action_input
  - action: `create` | `rename` | `delete`
  - new_name_input
  - new_name
  - cost_center_id (optional UUID disambiguator)
  - force
  - resolved_cost_center_id
  - resolved_name
  - desired_action: `create_cost_center` | `rename_cost_center` | `delete_cost_center` | `noop` | `reject`
  - validation_status: `valid` | `unverified` | `noop` | `rejected`
  - failure_reason: `invalid_action` | `missing_cost_center` | `missing_new_name` | `name_too_long` | `ambiguous_cost_center` | `not_found` | `name_taken` | `delete_blocked` | `conflicting_rows` | null
  - detail
  - execution_result (added at execution): `created` | `renamed` | `deleted` | `noop` | `failed`
- Validation rules:
  - cost_center and action are required on every row.
  - action must be one of create, rename, delete.
  - rename requires new_name.
  - Names must be at most 255 characters.
  - Ambiguous name with no cost_center_id is rejected with candidate ids listed.
  - A delete of a non-empty cost center is rejected unless force is true.

## CostCenterReconciliationPlan

- Purpose: Deterministically ordered execution plan built from the actionable rows.
- Fields:
  - creates (rows with desired_action create_cost_center)
  - renames (rows with desired_action rename_cost_center)
  - deletes (rows with desired_action delete_cost_center)
  - noops (rows with validation_status noop)
  - rejected (rows with validation_status rejected)
  - ordered (creates, then renames, then deletes)
  - mutation_count
  - noop_count
  - rejected_count
  - dry_run
  - blocked_reason: `no_rows` | null
  - state: `blocked` | `validated` | `approved_for_execution`
- Validation rules:
  - Only rows marked valid or unverified are carried as actionable.
  - A plan with no rows is blocked with reason no_rows.
  - A dry-run plan reports state validated and applies no change.

## CostCenterApprovalDecision

- Purpose: Approval-gate evidence for one cost-center change request.
- Fields:
  - approval_status: `pending` | `approved` | `denied` | `not_requested`
  - approver_login
  - approver_role: `designated_approver` | `other`
  - approved_at
  - decision_source (e.g. `comment`)
  - decision_note
- Validation rules:
  - Approval is approved only when the commenter login equals the designated approver login.
  - Any non-designated commenter yields approver_role other and approval_status denied.
  - When validation is not valid, approval_status is not_requested.

## CostCenterExecutionOutcome

- Purpose: Per-step execution and recovery record for one cost-center change request.
- Fields:
  - created_count
  - renamed_count
  - deleted_count
  - noop_count
  - failure_count
  - executed_count (created + renamed + deleted)
  - rollback_status: `not_needed` | `manual_follow_up_required`
  - summary
  - results (per-row records with execution_result and failure_reason)
- State transitions:
  - `submitted` -> `validation_failed` | `awaiting_approval`
  - `awaiting_approval` -> `approved` | `awaiting_approval` (denied or pending stays awaiting)
  - `approved` -> `executed` | `partially_executed` | `failed`
- Notes:
  - request_status is executed when failure_count is 0, partially_executed when some rows applied or no-op'd while others failed, and failed when nothing applied and at least one row failed.
  - On any failure rollback_status is manual_follow_up_required; recovery is an idempotent re-run, not an automated compensating mutation.
  - A blocked policy-guard outcome (no PAT, not approved, dry-run) records zero counts with no cost-center mutation attempted.
