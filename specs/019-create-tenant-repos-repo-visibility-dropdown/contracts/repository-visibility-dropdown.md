# Contracts: Repository Visibility Dropdown

## Issue Form Contract

The tenant repository creation issue form MUST emit a normalized payload field:

- `repository_visibility`
  - Type: string
  - Allowed values: `private`, `internal`, `public`
  - Default: `private`

The parser must map the issue form dropdown name to this field and include it in the structured request JSON.

## Parser Contract

- `parseRepositoryVisibility(requestPayload)` MUST return:
  - `repository_visibility`: one of `private`, `internal`, `public`
  - `repository_visibility_source`: `user_selected` or `default`

- If the field is absent, the parser MUST return `repository_visibility = private`.
- If the field is present but invalid, the parser MUST fail validation with a clear `invalid_visibility` error code.

## Validation Contract

- Valid request payloads MUST only include allowed visibility values.
- The validation response MUST expose `requested_visibility`, `allowed_repository_visibilities`, and `visibility_validation_status`.
- For invalid visibility, the response MUST include `visibility_validation_reason` and produce a `validation_failed` request status.
- For unsupported visibility in a target organization, the response MUST set `visibility_validation_status = unsupported_visibility` and keep the request fail-closed.

## Execution Contract

- Repository creation requests MUST use `requested_visibility` as the create-time visibility parameter.
- Existing repositories with matching visibility MUST be treated as no-op.
- Existing repositories with mismatched visibility MUST be reported as `visibility_conflict` and block execution.
- Successful repository creation MUST persist `actual_visibility` from the GitHub repository response.

## Audit Contract

- Audit artifacts MUST include `requested_visibility`, `actual_visibility`, `visibility_conflict`, and `blocked_reason`.
- Step summaries MUST display requested visibility, actual visibility, visibility validation status, and whether the repository was created, already existed, or had a visibility conflict.
