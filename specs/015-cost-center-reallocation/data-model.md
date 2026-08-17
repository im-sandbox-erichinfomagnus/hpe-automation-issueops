# Data Model: Cost Center Reallocation Workflow

## CostCenterReallocationRequest

- **Purpose**: Represents the parsed and normalized request to create
  enterprise cost centers and add or remove user resources from them.
- **Fields**:
  - `request_id`: Stable identifier derived from issue number and run context.
  - `issue_number`: GitHub issue number carrying the request.
  - `repository`: Repository hosting the central IssueOps workflow.
  - `requester_login`: GitHub login of the requester.
  - `enterprise`: Target enterprise slug.
  - `intended_approver_login`: Single GitHub login named to approve the request.
  - `assignments`: List of normalized assignment rows.
  - `dry_run`: Boolean indicating whether this request is simulation-only.
  - `request_status`: `submitted | validation_failed | awaiting_approval | approved | executed | partially_executed | failed`.
  - `submitted_at`: Timestamp of request intake.
- **Validation rules**:
  - `enterprise` is required.
  - `intended_approver_login` is required.
  - `assignments` must contain at least one well-formed row after normalization.
  - Organization and repository resource inputs are not valid request inputs for
    this workflow.

## AssignmentRow

- **Purpose**: Tracks the validation and execution status of each CSV row.
- **Fields**:
  - `cost_center`: Requested cost center name from the row.
  - `login`: Target user login from the row.
  - `action`: Resolved action, `add` or `remove`, defaulting to `add`.
  - `validation_status`: `valid | duplicate | conflicting | unknown_action | rejected`.
  - `desired_action`: `add_resource | remove_resource | noop | reject`.
  - `execution_result`: `not_started | added | removed | noop | failed`.
  - `cost_center_id`: Enterprise cost center identifier when known.
  - `failure_reason`: Optional error classification.
- **Validation rules**:
  - `cost_center` and `login` must be non-empty.
  - `action` must resolve to `add` or `remove` after default application.
  - The combination of `cost_center`, `login`, and `action` must be unique within
    the request batch.

## CostCenterPlan

- **Purpose**: Represents the diff between current enterprise cost center state
  and the approved desired state.
- **Fields**:
  - `enterprise_exists`: Boolean validation result.
  - `live_state_verified`: Boolean indicating whether live cost center state was
    read with an enterprise billing token.
  - `cost_centers_to_create`: Requested cost centers absent from the enterprise.
  - `cost_centers_already_present`: Requested cost centers already present.
  - `resources_to_add`: User resources to add per cost center.
  - `resources_to_remove`: User resources to remove per cost center.
  - `rows_rejected`: Rows blocked by validation or policy.
  - `dry_run`: Boolean indicating whether this plan is simulation-only.
  - `rate_limit_snapshot`: Last relevant rate-limit header values captured.
- **State transitions**:
  - `draft` -> `validated`
  - `validated` -> `approved_for_execution`
  - `approved_for_execution` -> `executed` or `partially_executed` or `failed`

## ApprovalDecision

- **Purpose**: Captures the explicit approval gate required before mutation.
- **Fields**:
  - `approval_status`: `pending | approved | denied | invalidated`.
  - `approver_login`: GitHub login of the reviewer.
  - `approver_match`: `matched | mismatched | unknown`.
  - `approved_at`: Timestamp for approval decisions.
  - `decision_source`: Approval signal source such as issue comment command.
  - `decision_note`: Optional human justification.
- **Validation rules**:
  - Only the named `intended_approver_login` may move status to `approved`.
  - The approval comment body must be exactly `approved`.
  - Approval must be rechecked before mutation if the workflow is re-run.

## ExecutionOutcome

- **Purpose**: Durable per-run result suitable for audit and requester
  reporting.
- **Fields**:
  - `run_id`: GitHub Actions run identifier.
  - `run_attempt`: Attempt number.
  - `created_count`: Number of cost centers created.
  - `added_count`: Number of user resources added.
  - `removed_count`: Number of user resources removed.
  - `noop_count`: Number of already-satisfied rows.
  - `failure_count`: Number of failed rows.
  - `live_state_verified`: Whether live cost center state was confirmed.
  - `rollback_status`: `not_needed | compensating_action_required | manual_follow_up_required`.
  - `summary`: Human-readable workflow result.
  - `artifact_path`: Stored audit artifact reference.
- **Validation rules**:
  - `created_count + added_count + removed_count + noop_count + failure_count`
    should equal the number of rows that reached reconciliation.
  - A dry-run outcome MUST report planned counts without mutating state.
