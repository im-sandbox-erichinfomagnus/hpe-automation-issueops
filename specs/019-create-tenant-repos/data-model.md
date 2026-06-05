# Data Model: Tenant Repository Creation IssueOps Workflow

## TenantRepoCreationRequest

- Purpose: Parsed request envelope for one tenant-scoped repository-creation operation.
- Fields:
  - request_id
  - issue_number
  - repository
  - requester_login
  - organization
  - repository_name_input
  - repository_name_normalized
  - designated_approver_login
  - dry_run
  - justification
  - request_status: `submitted` | `validation_failed` | `awaiting_approval` | `approved` | `blocked` | `executed` | `no_op` | `partial_failure` | `failed_after_approved_execution`
- Validation rules:
  - Exactly one target organization and one repository name are required.
  - Repository name must normalize safely and deterministically.
  - Dry-run flag must be explicit boolean-compatible input.

## CanonicalTenantContext

- Purpose: One authoritative tenant-scoped boundary record used to permit or block repository mutation.
- Fields:
  - tenant_key
  - tenant_display_name
  - organization
  - registry_ref
  - tenant_team_name (`X_Tenant`)
  - tenant_team_slug
  - repo_admin_team_name (`X_RepoAdmin`)
  - repo_admin_team_slug
  - governance_relation_status: `valid` | `missing_repo_admin` | `wrong_parent` | `conflicting` | `unknown`
  - tenant_match_count
  - tenant_resolution_status: `resolved` | `no_match` | `ambiguous` | `registry_conflict`
  - context_marker
- Validation rules:
  - Exactly one valid tenant context must resolve.
  - Registry organization and live organization must agree.
  - `X_RepoAdmin` must exist and be a child of `X_Tenant`.

## RequesterTenantAuthorization

- Purpose: Authorization evidence tying requester identity to the resolved tenant context.
- Fields:
  - requester_login
  - tenant_team_slug
  - repo_admin_team_slug
  - tenant_role_state: `active_maintainer` | `active_member` | `absent` | `unknown`
  - repo_admin_membership_state: `active_member` | `absent` | `unknown`
  - authorization_status: `authorized` | `unauthorized` | `ambiguous` | `blocked`
  - blocking_reason_codes
- Validation rules:
  - Requester must be `active_maintainer` on `X_Tenant`.
  - Requester must be `active_member` of `X_RepoAdmin` for v1.

## RepoCreationApprovalDecision

- Purpose: Approval-gate evidence bound to the latest validated tenant context.
- Fields:
  - approval_status: `pending` | `approved` | `denied` | `invalidated`
  - approver_login
  - approver_authorization_state: `authorized` | `unauthorized` | `unknown`
  - approved_context_marker
  - latest_context_marker
  - approved_at
  - decision_note
- Validation rules:
  - Approver must be designated and currently authorized for the resolved organization.
  - Approved context marker must match the latest validated context marker.

## TenantRepoReconciliationPlan

- Purpose: Desired-vs-current state diff used to execute idempotent repository creation and governance grant.
- Fields:
  - organization_visible
  - repository_exists
  - current_repo_admin_permission: `admin` | `non_admin` | `missing` | `unknown`
  - desired_repo_admin_permission: `admin`
  - creation_action: `create_repository` | `noop` | `reject`
  - permission_action: `grant_admin` | `noop` | `reject`
  - dry_run
  - rate_limit_snapshot
  - boundary_revalidation_status: `matched` | `mismatched` | `unknown`
- Validation rules:
  - Mutation is allowed only when boundary revalidation status is `matched`.
  - Existing conflicting repository state outside safe in-scope reconciliation is rejected.

## TenantRepoAuditArtifact

- Purpose: Durable machine-readable evidence for validation, approval, execution, and final status retained as a workflow artifact for the run.
- Fields:
  - issue_number
  - run_id
  - run_attempt
  - artifact_name
  - artifact_retention_days
  - requester_login
  - approver_login
  - organization
  - repository_name
  - tenant_key
  - tenant_team_slug
  - repo_admin_team_slug
  - context_marker
  - validation_findings
  - approval_decision
  - reconciliation_plan
  - execution_steps
  - final_request_status
  - rollback_status
  - remediation_instructions
- Validation rules:
  - Artifact must distinguish boundary-blocked, validation-failed, awaiting_approval, approved, no_op, executed, failed_after_approved_execution, and partial_failure outcomes.
  - Artifact must be uploaded for every validation, approval, and execution path, even when mutation is blocked.

## TenantRepoExecutionOutcome

- Purpose: Final per-step execution and recovery record for one repository request.
- Fields:
  - request_status
  - repository_creation_result: `created` | `noop` | `failed`
  - repo_admin_grant_result: `granted` | `noop` | `failed`
  - audit_persistence_result: `persisted` | `failed`
  - rollback_status: `not_needed` | `manual_remediation_required`
  - error_summary
  - remediation_instructions
- State transitions:
  - `submitted` -> `validation_failed` | `awaiting_approval`
  - `awaiting_approval` -> `approved` | `blocked`
  - `approved` -> `executed` | `no_op` | `partial_failure` | `failed_after_approved_execution`