# Manage Tenant Variables

## Purpose

Manage tenant-scoped organization Actions variables through one IssueOps request. The spreadsheet path supports create, update, and delete operations without granting organization-wide variable administration to the requester.

## Requirements

- The request identifies the organization, tenant, operation, designated approver, dry-run setting, and business justification.
- The primary input is `variables_csv`, with one `name,value` row per variable. Delete rows may omit the value.
- Every variable name is normalized into the tenant namespace before validation or mutation.
- The requester must be an active maintainer of the tenant top team or otherwise satisfy the canonical tenant-admin authorization path.
- The designated approver must be an active organization owner and must comment exactly `approved`.
- Validation and execution re-read tenant membership and organization state so authorization cannot be carried across a stale approval.
- Each row records its authorization, planned action, execution result, and failure reason.
- An unauthorized or invalid row is rejected without hiding the result of other rows.
- Dry-run performs no mutation. Re-running an already satisfied request converges to no-op.

## Acceptance

- An authorized tenant admin can create, update, and delete tenant-prefixed variables from spreadsheet rows.
- A requester outside the tenant boundary is rejected before mutation.
- A variable outside the tenant namespace cannot be targeted.
- The issue comment, Actions summary, and JSON audit artifact agree on the final result.
