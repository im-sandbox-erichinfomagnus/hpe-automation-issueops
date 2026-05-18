# Data Model: Add Team Members Workflow

## TeamMembershipRequest

- **Purpose**: Represents the parsed and normalized user request to add one or
  more people to a GitHub team.
- **Fields**:
  - `request_id`: Stable identifier derived from issue number and run context.
  - `issue_number`: GitHub issue number carrying the request.
  - `repository`: Repository hosting the IssueOps workflow.
  - `requester_login`: GitHub login of the requester.
  - `organization`: Target GitHub organization slug.
  - `team_slug`: Target team slug after normalization.
  - `requested_people`: List of normalized requested usernames.
  - `request_status`: `submitted | validation_failed | awaiting_approval | approved | denied | executed | partially_executed | failed`.
  - `submitted_at`: Timestamp of request intake.
- **Validation rules**:
  - `organization` and `team_slug` are required.
  - `requested_people` must contain at least one unique normalized username.
  - Duplicate usernames are deduplicated but tracked in validation findings.

## RequestedPerson

- **Purpose**: Tracks the validation and execution status of each requested
  username.
- **Fields**:
  - `username`: Normalized GitHub login.
  - `resolution_status`: `resolved | unresolved`.
  - `current_membership_state`: `active | absent | unknown`.
  - `desired_action`: `noop | add_member | reject`.
  - `execution_result`: `not_started | added | noop | failed`.
  - `failure_reason`: Optional error classification.
- **Validation rules**:
  - `username` must be non-empty after normalization.
  - `resolution_status=unresolved` blocks mutation for that user.

## ApprovalDecision

- **Purpose**: Captures the privileged approval gate required before mutation.
- **Fields**:
  - `approval_status`: `pending | approved | denied | invalidated`.
  - `approver_login`: GitHub login of the reviewer.
  - `approver_role`: `org_owner | other`.
  - `approved_at`: Timestamp for approval decisions.
  - `decision_source`: Approval signal source such as comment command,
    review event, or workflow dispatch input.
  - `decision_note`: Optional human justification.
- **Validation rules**:
  - Only `org_owner` can move status to `approved`.
  - Approval must be rechecked before mutation if the workflow is re-run.

## ReconciliationPlan

- **Purpose**: Represents the diff between current GitHub team state and the
  approved desired state.
- **Fields**:
  - `team_exists`: Boolean validation result.
  - `team_sync_blocked`: Boolean indicating IdP-managed synchronization.
  - `current_members`: Current active or pending members discovered.
  - `people_to_add`: Requested people absent from current team membership.
  - `people_already_present`: Requested people already active or pending.
  - `people_rejected`: Requested people blocked by validation or policy.
  - `dry_run`: Boolean indicating whether this plan is simulation-only.
  - `rate_limit_snapshot`: Last relevant rate-limit header values captured.
- **State transitions**:
  - `draft` -> `validated`
  - `validated` -> `approved_for_execution`
  - `approved_for_execution` -> `executed` or `partially_executed` or `failed`

## ExecutionOutcome

- **Purpose**: Durable result of a run, suitable for audit and requester
  reporting.
- **Fields**:
  - `run_id`: GitHub Actions run identifier.
  - `run_attempt`: Attempt number.
  - `mutation_count`: Number of successful membership writes.
  - `noop_count`: Number of already-satisfied requested memberships.
  - `pending_count`: Number of pending invitation memberships.
  - `failure_count`: Number of failed requested memberships.
  - `rollback_status`: `not_needed | compensating_action_required | manual_follow_up_required`.
  - `summary`: Human-readable workflow result.
  - `artifact_path`: Stored audit artifact reference.
- **Validation rules**:
  - `mutation_count + noop_count + pending_count + failure_count` should equal
    the number of validated requested people that reached reconciliation.