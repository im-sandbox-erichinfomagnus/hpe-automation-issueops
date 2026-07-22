# Data Model: Tenant Repository Visibility Dropdown

## Key Entities

### Tenant Repository Creation Request

- `requester_login`: GitHub login of the requester
- `organization`: Target GitHub organization for the new repository
- `repository_name`: Requested repository name
- `designated_approver`: User designated to approve the creation
- `business_justification`: Reason for repository creation
- `dry_run`: Optional flag to run validation without mutation
- `repository_visibility`: Requested visibility for the repository
  - allowed values: `private`, `internal`, `public`
  - default: `private`

### Repository Visibility Validation Result

- `repository_visibility`: Normalized requested visibility value
- `visibility_validation_status`: `valid`, `defaulted`, or `invalid`
- `visibility_validation_reason`: Human-readable reason for invalid values

### Repository Creation Reconciliation Outcome

- `repository_exists`: boolean
- `existing_visibility`: actual visibility if the repository exists
- `requested_visibility`: requested visibility to apply on create
- `visibility_match`: boolean if existing visibility matches requested visibility
- `visibility_conflict`: boolean if the repo exists with a different visibility
- `final_outcome`: `created`, `no_op`, `blocked`, `partial_failure`, or `failed`

## Fields and Relationships

- `repository_visibility` is an attribute of the request and is part of the desired state for repository creation.
- The reconciliation plan should compare `requested_visibility` with the `existing_visibility` of the target repository.
- The workflow should treat a visibility conflict on an existing repository as a blocked or conflict outcome rather than mutating visibility silently.

## Validation Rules

- If `repository_visibility` is absent, default to `private`.
- If `repository_visibility` is present, it must be one of `private`, `internal`, or `public`.
- If the repository already exists, ensure `existing_visibility` matches `requested_visibility` before treating the request as no-op.
