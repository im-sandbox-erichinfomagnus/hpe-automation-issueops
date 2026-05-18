# Data Model: Create Organization Teams Workflow

## TeamCreationRequest

- **Purpose**: Represents the parsed and normalized request to create one or
  more empty teams in a target GitHub organization.
- **Fields**:
  - `request_id`: Stable identifier derived from issue number and run context.
  - `issue_number`: GitHub issue number carrying the request.
  - `repository`: Repository hosting the central IssueOps workflow.
  - `requester_login`: GitHub login of the requester.
  - `organization`: Target GitHub organization slug.
  - `intended_owner_login`: Single GitHub login designated to approve the full
    batch and later own the requested teams operationally.
  - `requested_teams`: List of normalized requested team definitions.
  - `request_status`: `submitted | validation_failed | awaiting_approval | approved | executed | partially_executed | failed`.
  - `submitted_at`: Timestamp of request intake.
- **Validation rules**:
  - `organization` is required.
  - `intended_owner_login` is required and must be shared across the full batch.
  - `requested_teams` must contain at least one unique normalized team name.
  - Team member lists, parent-team fields, and repository grants are not valid
    request inputs for this workflow.

## RequestedTeamDefinition

- **Purpose**: Tracks the validation and execution status of each requested
  team.
- **Fields**:
  - `requested_name`: Requested team display name before normalization.
  - `normalized_slug`: GitHub-style normalized slug used for duplicate checks.
  - `intended_owner_login`: Intended owner inherited from the request-level
    owner field.
  - `validation_status`: `valid | duplicate | conflicting | existing | rejected`.
  - `desired_action`: `create_team | noop | reject`.
  - `execution_result`: `not_started | created | noop | failed`.
  - `created_team_id`: GitHub team identifier when creation succeeds.
  - `failure_reason`: Optional error classification.
- **Validation rules**:
  - `requested_name` must be non-empty and slug-normalizable.
  - `normalized_slug` must be unique within the request batch.
  - `intended_owner_login` must refer to an active member of the target
    organization.

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

## ApprovalDecision

- **Purpose**: Captures the explicit approval gate required before mutation.
- **Fields**:
  - `approval_status`: `pending | approved | denied | invalidated`.
  - `approver_login`: GitHub login of the reviewer.
  - `approver_membership_state`: `active | pending | absent | unknown`.
  - `approved_at`: Timestamp for approval decisions.
  - `decision_source`: Approval signal source such as issue comment command.
  - `decision_note`: Optional human justification.
- **Validation rules**:
  - Only the shared `intended_owner_login` may move status to `approved`.
  - Approval must be rechecked before mutation if the workflow is re-run.

## ReconciliationPlan

- **Purpose**: Represents the diff between current target organization team
  state and the approved desired state.
- **Fields**:
  - `organization_exists`: Boolean validation result.
  - `teams_to_create`: Requested teams absent from the target organization.
  - `teams_already_present`: Requested teams already present in the target
    organization.
  - `teams_rejected`: Requested teams blocked by validation or policy.
  - `dry_run`: Boolean indicating whether this plan is simulation-only.
  - `rate_limit_snapshot`: Last relevant rate-limit header values captured.
- **State transitions**:
  - `draft` -> `validated`
  - `validated` -> `approved_for_execution`
  - `approved_for_execution` -> `executed` or `partially_executed` or `failed`

## ExecutionOutcome

- **Purpose**: Durable per-run result suitable for audit and requester
  reporting.
- **Fields**:
  - `run_id`: GitHub Actions run identifier.
  - `run_attempt`: Attempt number.
  - `created_count`: Number of successful team creations.
  - `noop_count`: Number of already-satisfied requested teams.
  - `failure_count`: Number of failed requested teams.
  - `rollback_status`: `not_needed | compensating_action_required | manual_follow_up_required`.
  - `summary`: Human-readable workflow result.
  - `artifact_path`: Stored audit artifact reference.
- **Validation rules**:
  - `created_count + noop_count + failure_count` should equal the number of
    requested teams that reached reconciliation.