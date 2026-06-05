# Quickstart: Tenant Repository Visibility Dropdown

## What this feature adds

This enhancement adds a `repository visibility` dropdown to the tenant repository creation issue form. Requesters can choose `private`, `internal`, or `public` visibility, and the workflow defaults to `private` if no value is selected.

## How it works

1. Issue form includes a visibility dropdown field.
2. The parser normalizes the selected value into `repository_visibility` and records whether it was `user_selected` or applied by `default`.
3. Validation confirms the value is allowed, defaults to `private` when absent, and emits structured visibility findings including allowed values and rejection reasons.
4. Execution creates the repository with the requested visibility, preserves the actual created visibility in the audit artifact, and records a blocked conflict when an existing repository already has different visibility.
5. Audit output and GitHub step summaries include requested visibility, actual visibility, visibility validation status, and visibility conflict details.

## Implementation touchpoints

- `/.github/ISSUE_TEMPLATE/` update for the visibility dropdown.
- `/src/workflow-support/` parser and validation modules update.
- Reconciliation logic update to apply visibility on create and handle existing-repo visibility conflicts.
- Contract tests under `/tests/contract/` and fixtures under `/tests/fixtures/`.

## What to verify

- New repository creation requests with explicit `public`, `internal`, and `private` values.
- Default behavior when visibility is omitted.
- Validation failure for invalid or unsupported values, including allowed-value guidance in the summary.
- Existing repositories with matching visibility remain no-op.
- Existing repositories with mismatched visibility fail closed as `visibility_conflict`.
- Audit artifacts and summary output include `repository_visibility`, requested visibility, actual visibility, and conflict details.

## Example outcomes

- Omitted visibility: parsed as `private`, `repository_visibility_source = default`
- Explicit `internal`: parsed as `internal`, validated, then created as `internal`
- Explicit invalid value such as `secret`: request fails validation with `visibility_validation_status = invalid_visibility`
- Existing `public` repo with requested `private`: execution stops with `blocked_reason = visibility_conflict`
