# Data Model: Add Team Repository Access Workflow

## RepositoryAccessRequest

- **Purpose**: Represents the parsed and normalized request to grant one existing team a specific repository permission level on one or more existing repositories in a target GitHub organization.
- **Fields**:
  - `request_id`: Stable identifier derived from issue number and run context.
  - `issue_number`: GitHub issue number carrying the request.
  - `repository`: Central administration repository hosting the workflow.
  - `requester_login`: GitHub login of the requester.
  - `organization`: Target GitHub organization slug.
  - `team_slug`: Normalized identifier of the requested existing team.
  - `team_name`: Requested team display name from the issue form.
  - `designated_approver_login`: Single GitHub login designated to approve the full request batch.
  - `requested_permission_label`: User-facing permission label from the request, such as `read` or `write`.
  - `requested_permission_api_value`: Normalized GitHub API permission value such as `pull` or `push`.
  - `requested_repository_grants`: List of normalized requested repository entries.
  - `request_status`: `submitted | validation_failed | awaiting_approval | approved | executed | partially_executed | failed`.
  - `dry_run`: Whether mutation is allowed after approval.
  - `submitted_at`: Timestamp of request intake.
- **Validation rules**:
  - `organization`, `team_slug`, `designated_approver_login`, and `requested_permission_api_value` are required.
  - `requested_repository_grants` must contain at least one unique repository entry.
  - Out-of-scope inputs such as repository creation, team creation, team membership, permission removal, or branch protection changes are invalid.

## RequestedRepositoryGrant

- **Purpose**: Tracks validation and execution state for one requested repository permission grant for the target team.
- **Fields**:
  - `requested_repository_name`: Repository identifier as submitted by the requester.
  - `repository_owner`: Normalized repository owner expected to equal the target organization.
  - `repository_name`: Normalized repository name.
  - `repository_full_name`: Normalized `<owner>/<repo>` key used for comparison and API calls.
  - `repository_archived`: Boolean indicating whether the repository is archived.
  - `current_permission_api_value`: Current GitHub API permission value for the team on the repository, or `none` when the team has no explicit access.
  - `current_permission_rank`: Numeric or ordinal value derived from the permission-strength ladder.
  - `validation_status`: `valid | missing_repository | duplicate | conflicting | archived_blocked | exact_match | stronger_existing_access | weaker_existing_access | rejected`.
  - `desired_action`: `grant_access | noop | reject`.
  - `execution_result`: `not_started | granted | noop | failed`.
  - `failure_reason`: Optional error classification or operator-facing note.
- **Validation rules**:
  - `repository_full_name` must be unique within the request batch.
  - Repositories outside the target organization are invalid.
  - Archived repositories become `archived_blocked` for this feature version.
  - Repositories with weaker existing team access become `weaker_existing_access` and are rejected for this feature version.

## CentralAssignmentDecision

- **Purpose**: Records central issue routing that provides queue ownership and operational visibility in the hosting repository.
- **Fields**:
  - `assignment_status`: `not_attempted | assigned | already_satisfied | failed`.
  - `assigned_login`: GitHub login of the central-repository owner assigned to the issue.
  - `assignment_note`: Optional routing or failure note.
  - `assigned_at`: Timestamp of the last successful assignment decision.
- **Validation rules**:
  - Assignment does not change approval eligibility.
  - Assignment failure must not be treated as approval success or approval failure on its own.

## AccessApprovalDecision

- **Purpose**: Captures the explicit approval gate required before repository permission mutation.
- **Fields**:
  - `approval_status`: `pending | approved | denied | invalidated`.
  - `approver_login`: GitHub login of the reviewer who supplied the approval signal.
  - `approver_role`: `target_org_owner | other`.
  - `approver_authorization_state`: `authorized | unauthorized | unknown`.
  - `approved_at`: Timestamp for approval decisions.
  - `decision_source`: Approval signal source such as an issue comment command.
  - `decision_note`: Optional human justification or rejection note.
- **Validation rules**:
  - Only the shared `designated_approver_login` may move status to `approved`.
  - Approval must be rechecked before mutation if the workflow is re-run.

## RepositoryAccessReconciliationPlan

- **Purpose**: Represents the diff between current repository access state and the approved desired state for the target team.
- **Fields**:
  - `organization_exists`: Boolean validation result.
  - `team_exists`: Boolean validation result.
  - `repositories_to_grant`: Requested repositories that need a new permission grant.
  - `repositories_already_satisfied`: Requested repositories already satisfying the requested permission exactly or through stronger access.
  - `repositories_rejected`: Requested repositories blocked by validation or policy.
  - `permission_strength_ladder`: Ordered set used for comparison, from `pull` through `admin`.
  - `dry_run`: Whether this plan is simulation-only.
  - `rate_limit_snapshot`: Last relevant rate-limit header values captured.
- **State transitions**:
  - `draft` -> `validated`
  - `validated` -> `approved_for_execution`
  - `approved_for_execution` -> `executed` or `partially_executed` or `failed`

## RepositoryAccessExecutionOutcome

- **Purpose**: Durable per-run result suitable for audit and requester reporting.
- **Fields**:
  - `run_id`: GitHub Actions run identifier.
  - `run_attempt`: Attempt number.
  - `granted_count`: Number of successful repository permission grants applied.
  - `noop_count`: Number of repositories already satisfying the requested permission.
  - `rejected_count`: Number of repositories blocked before mutation.
  - `failure_count`: Number of repositories whose mutation failed.
  - `rollback_status`: `not_needed | compensating_action_required | manual_follow_up_required`.
  - `summary`: Human-readable workflow result.
  - `artifact_path`: Stored audit artifact reference.
  - `remediation_instructions`: Operator-facing follow-up guidance for failed subsets.
- **Validation rules**:
  - `granted_count + noop_count + rejected_count + failure_count` should equal the number of requested repositories that reached reconciliation.
  - Partial failures must preserve per-repository outcome detail rather than collapsing the run to one batch-level status.
