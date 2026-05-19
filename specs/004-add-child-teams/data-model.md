# Data Model: Add Child Teams Workflow

## TeamHierarchyRequest

- **Purpose**: Represents the parsed and normalized request to attach one or
  more existing child teams under one existing parent team in a target GitHub
  organization.
- **Fields**:
  - `request_id`: Stable identifier derived from issue number and run context.
  - `issue_number`: GitHub issue number carrying the request.
  - `repository`: Repository hosting the central IssueOps workflow.
  - `requester_login`: GitHub login of the requester.
  - `organization`: Target GitHub organization slug.
  - `parent_team_slug`: Normalized identifier of the requested parent team.
  - `parent_team_name`: Display name of the requested parent team from the
    request.
  - `designated_approver_login`: Single GitHub login designated to approve the
    full request batch.
  - `requested_child_links`: List of normalized requested child-team entries.
  - `request_status`: `submitted | validation_failed | awaiting_approval | approved | executed | partially_executed | failed`.
  - `dry_run`: Whether mutation is allowed after approval.
  - `submitted_at`: Timestamp of request intake.
- **Validation rules**:
  - `organization`, `parent_team_slug`, and `designated_approver_login` are
    required.
  - `requested_child_links` must contain at least one unique child-team entry.
  - Out-of-scope inputs such as team creation, deletion, membership, or
    repository permissions are invalid.

## RequestedChildLink

- **Purpose**: Tracks validation and execution status for one requested
  parent-child relationship.
- **Fields**:
  - `requested_child_name`: Requested child-team display name before
    normalization.
  - `child_team_slug`: Normalized child-team slug used for comparison and API
    calls.
  - `current_parent_slug`: Current parent-team slug if the child already has one.
  - `validation_status`: `valid | already_linked | missing_child | duplicate | conflicting | reparent_blocked | cycle_blocked | rejected`.
  - `desired_action`: `link_child | noop | reject`.
  - `execution_result`: `not_started | linked | noop | failed`.
  - `failure_reason`: Optional error classification.
- **Validation rules**:
  - `child_team_slug` must be non-empty and unique within the request batch.
  - A child already attached to the requested parent becomes `already_linked`.
  - A child attached to a different parent becomes `reparent_blocked` for this
    feature version.

## CentralAssignmentDecision

- **Purpose**: Records central issue routing that provides queue ownership and
  operational visibility in the hosting repository.
- **Fields**:
  - `assignment_status`: `not_attempted | assigned | already_satisfied | failed`.
  - `assigned_login`: GitHub login of the central-repository owner assigned to
    the issue.
  - `assignment_note`: Optional reason or failure note.
  - `assigned_at`: Timestamp for the last successful assignment decision.
- **Validation rules**:
  - Assignment does not change approval eligibility.
  - Assignment failure must not be treated as approval failure if request
    validation otherwise succeeds.

## HierarchyApprovalDecision

- **Purpose**: Captures the explicit approval gate required before mutation.
- **Fields**:
  - `approval_status`: `pending | approved | denied | invalidated`.
  - `approver_login`: GitHub login of the reviewer.
  - `approver_authorization_state`: `authorized | unauthorized | unknown`.
  - `approved_at`: Timestamp for approval decisions.
  - `decision_source`: Approval signal source such as issue comment command.
  - `decision_note`: Optional human justification.
- **Validation rules**:
  - Only the shared `designated_approver_login` may move status to `approved`.
  - Approval must be rechecked before mutation if the workflow is re-run.

## HierarchyReconciliationPlan

- **Purpose**: Represents the diff between current team hierarchy state and the
  approved desired state.
- **Fields**:
  - `organization_exists`: Boolean validation result.
  - `parent_team_exists`: Boolean validation result.
  - `child_links_to_apply`: Requested child-team links absent from the target
    parent team.
  - `child_links_already_present`: Requested child-team links already satisfied.
  - `child_links_rejected`: Requested child-team links blocked by validation or
    policy.
  - `dry_run`: Whether this plan is simulation-only.
  - `rate_limit_snapshot`: Last relevant rate-limit header values captured.
- **State transitions**:
  - `draft` -> `validated`
  - `validated` -> `approved_for_execution`
  - `approved_for_execution` -> `executed` or `partially_executed` or `failed`

## HierarchyExecutionOutcome

- **Purpose**: Durable per-run result suitable for audit and requester
  reporting.
- **Fields**:
  - `run_id`: GitHub Actions run identifier.
  - `run_attempt`: Attempt number.
  - `linked_count`: Number of successful parent-child links applied.
  - `noop_count`: Number of already-satisfied requested child links.
  - `failure_count`: Number of failed requested child links.
  - `rollback_status`: `not_needed | compensating_action_required | manual_follow_up_required`.
  - `summary`: Human-readable workflow result.
  - `artifact_path`: Stored audit artifact reference.
- **Validation rules**:
  - `linked_count + noop_count + failure_count` should equal the number of
    requested child links that reached reconciliation.