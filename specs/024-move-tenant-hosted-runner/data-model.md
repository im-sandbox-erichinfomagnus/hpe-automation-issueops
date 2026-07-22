# Data Model: Move Tenant GitHub-Hosted Runner

## HostedRunnerMoveRequest

- `request_id`
- `issue_number`
- `repository`
- `requester_login`
- `organization`
- `tenant_name_input`
- `tenant_name_normalized`
- `runner_base_name_input`
- `runner_name_derivation`
- `runner_name_derived`
- `hosted_runner_id_input`
- `hosted_runner_id_valid`
- `target_runner_group_name_input`
- `runner_move_scope`: `organization`
- `designated_approver_login`
- `dry_run`
- `business_justification`
- `context_marker`
- `request_status`

## HostedRunnerResolution

- `runner_exists`
- `runner_resolution_status`: `resolved` | `not_found` | `ambiguous` | `id_mismatch`
- `existing_runner_id`
- `existing_runner_status`
- `current_runner_group_id`

Validation rules:

- Exact case-insensitive derived-name match is required.
- More than one name match requires `hosted_runner_id_input`.
- A supplied id must match one runner with the derived name.

## TargetRunnerGroupResolution

- `requested_group_name`
- `resolved_group_id`
- `resolved_group_name`
- `resolution_status`: `resolved` | `not_found` | `ambiguous`

Validation rules:

- The group must already exist.
- The group name must carry the resolved tenant prefix.
- Another tenant's namespace is rejected.

## HostedRunnerMovePlan

- `organization_visible`
- `runner_exists`
- `existing_runner_id`
- `runner_name_derived`
- `current_runner_group_id`
- `target_runner_group_resolution`
- `target_runner_group_id`
- `target_runner_group_name`
- `runner_already_in_target_group`
- `move_action`: `move_hosted_runner` | `noop` | `reject`
- `blocked_reason`
- `dry_run`
- `boundary_revalidation_status`
- `state`

## HostedRunnerMoveOutcome

- `runner_move_result`: `moved` | `noop` | `failed`
- `moved_runner_id`
- `target_runner_group_id`
- `mutation_count`
- `noop_count`
- `failure_count`
- `rollback_status`
- `audit_persistence_result`
- `summary`

## Lifecycle

`submitted` -> `awaiting_approval` -> `approved` -> `executed`

Validation or execution failures transition to `validation_failed`, `failed`, or `partially_executed`.
