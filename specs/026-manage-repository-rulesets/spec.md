# Manage Repository Rulesets

## Purpose

Create or delete repository rulesets in spreadsheet batches while authorizing each row against the repository named by that row.

## Requirements

- Create accepts `repository,ruleset_name,target,ref_name_pattern,enforcement,require_pull_request,block_force_pushes,require_linear_history,restrict_deletions`.
- Delete accepts `repository,ruleset_name`.
- The optional header is ignored and every data row receives an independent validation and execution result.
- A row is authorized when the requester has repository admin permission or the repository resolves to a tenant where the requester is an active repo-admin team member or tenant top-team maintainer.
- Imported repositories outside the tenant registry remain supported through direct repository-admin authorization.
- An unauthorized row is rejected without aborting authorized rows in the same request.
- Create is idempotent by ruleset name. Delete is a no-op when the named ruleset is absent.
- The designated approver must be an active organization owner and must comment exactly `approved`.
- Dry-run performs no mutation and records the same per-row authorization evidence as live execution.

## Acceptance

- One request can create or delete rulesets across multiple repositories.
- A mixed-authority request applies authorized rows and rejects the unauthorized row.
- Every row is represented in the issue result, Actions summary, and JSON audit artifact.
