# Quickstart: Manage Cost Centers IssueOps Workflow

## Goal

Bulk create, rename, and delete GitHub Enterprise billing cost centers from one CSV spreadsheet per issue, gate mutation behind a designated-approver `approved` comment plus an enterprise-billing PAT, apply changes idempotently in a deterministic order, and leave auditable evidence for validation, approval, and execution.

## Prerequisites

- GitHub Issues and issue forms enabled in this repository.
- An enterprise slug for the GitHub Enterprise account that owns the cost centers.
- A designated approver who is an enterprise owner or billing manager and whose GitHub login is named in the request. They are the only login whose `approved` comment unlocks execution.
- `ISSUEOPS_GITHUB_TOKEN` configured as a classic PAT with `manage_billing:enterprise`, held by an enterprise owner or billing manager. GitHub App and fine-grained tokens are not accepted. Without this token the workflow runs fail-soft and dry-run only.
- The repository `github.token` is used for issue context, comment reads, and terminal-label application.

## Setup Verification

1. Confirm these implementation files exist and are committed:
   - `.github/ISSUE_TEMPLATE/manage-cost-centers.yml` - issue form with `enterprise`, `designated_approver`, `cost_centers`, `dry_run`, `justification` fields
   - `.github/workflows/manage-cost-centers.yml` - main workflow with validation, approval, and execution steps
2. Confirm test targets exist:
   - `tests/contract/manage-cost-centers-parser-fixture.test.js`
   - `tests/contract/manage-cost-centers-validation.test.js`
   - `tests/integration/manage-cost-centers-workflow.test.js`
3. Run the suite: `node --test`.

## Workflow Path

1. Requester opens a Manage cost centers issue, filling in:
   - Enterprise slug
   - Designated approver login (the enterprise owner or billing manager who will comment `approved`)
   - Cost centers spreadsheet (CSV, rendered as csv)
   - Dry-run mode (default `true` - set `false` to execute)
   - Business justification
2. The workflow resolves issue context, parses the body with `issue-ops/parser@v5` into `PARSED_ENTERPRISE`, `PARSED_DESIGNATED_APPROVER`, `PARSED_COST_CENTERS`, `PARSED_DRY_RUN`, and `PARSED_JUSTIFICATION`, runs validation, and emits an audit artifact with `awaiting_approval` (or `validation_failed`).
3. The designated approver posts the comment `approved` on the issue.
4. The approval gate confirms the commenter login equals the designated approver and sets `approval-status` to `approved`.
5. Approved execution runs only when `approval-status == 'approved'`:
   - The policy guard `assertCostCenterMutationAllowed` requires approved, designated_approver, dry-run off, and a PAT-backed token.
   - Execution re-validates against live cost centers, then applies creates, then renames, then deletes with bounded retry.
   - A terminal label `issueops:manage-cost-centers:<status>` is applied to the issue.
6. The audit artifact is uploaded as a workflow artifact for every run.

## CSV Contract

Header must include at least `cost_center` and `action`. A row only fills the columns its action uses. Fields may be double-quoted to contain commas, and the whole block may be wrapped in a ```csv code fence. Duplicate rows are deduped. Data rows are numbered 1-based excluding the header.

| Column | Required | Meaning |
|---|---|---|
| cost_center | yes | The cost-center name (the human key) |
| action | yes | One of create, rename, delete |
| new_name | rename only | The new name for a rename |
| cost_center_id | optional | UUID to disambiguate same-named cost centers |
| force | optional | Set true to delete a cost center that still has resources |

Example:

```csv
cost_center,action,new_name,cost_center_id,force
Platform Engineering,create,,,
AI Model Routing,rename,AI Platform Routing,,
Retired Sandbox,delete,,,false
```

## Validated Scenario Runbook

### Scenario 1: Happy path - create, rename, delete with live access

**Preconditions**: `ISSUEOPS_GITHUB_TOKEN` is a PAT with enterprise billing access. `dry_run` = `false`. The create name is new, the rename target resolves to exactly one cost center, and the delete target is empty.

1. Open a Manage cost centers issue with a spreadsheet that creates one cost center, renames another, and deletes a third.
2. Confirm validation reaches `awaiting_approval` with a per-row table showing `create_cost_center`, `rename_cost_center`, and `delete_cost_center`.
3. Post `approved` from the designated approver account.
4. Confirm execution shows `Request status: executed`, `Executed: created 1, renamed 1, deleted 1`, and the label `issueops:manage-cost-centers:executed`.

### Scenario 2: Blocked delete plus force

**Preconditions**: A delete target still has attached resources.

1. Submit a delete row without `force`. Confirm the row is rejected with `delete_blocked` and the per-row detail lists the attached resources.
2. Re-submit the same delete row with `force` = `true`. Confirm the row classifies as `delete_cost_center` and, after approval, executes as `deleted`.

### Scenario 3: Ambiguous name

**Preconditions**: Two active cost centers share the same name.

1. Submit a rename or delete row that names the shared name with no `cost_center_id`.
2. Confirm the row is rejected with `ambiguous_cost_center` and the detail lists the candidate ids.
3. Re-submit the row with `cost_center_id` set to the correct id. Confirm the row resolves to one target and classifies correctly.

### Scenario 4: Rename collision

**Preconditions**: The new_name is already used by a different cost center.

1. Submit a rename row whose `new_name` matches an existing different cost center.
2. Confirm the row is rejected with `name_taken` and no rename is applied.
3. Confirm a rename to the cost center's current name instead records a `noop`.

### Scenario 5: Dry-run

1. Submit a request with `Dry-run mode` = `true` (the default).
2. Approve with the designated approver.
3. Confirm the summary shows the full plan and per-row outcomes but no cost center was created, renamed, or deleted, and the execution note states no mutation was attempted because the request is dry-run only.

### Scenario 6: Denied approval

1. Submit a valid request.
2. Post `approved` from an account that is not the designated approver.
3. Confirm `Approval: denied`, the approval note says the comment does not authorize cost-center mutation, and execution does not run.

### Scenario 7: Fail-soft with no token

**Preconditions**: `ISSUEOPS_GITHUB_TOKEN` is not configured.

1. Submit a valid request.
2. Confirm validation warns `Could not list live cost centers (no enterprise billing access)`, marks actionable rows `planned (unverified)`, and still reaches `awaiting_approval`.
3. Confirm that even after approval no mutation runs because the request is dry-run only without a PAT-backed token. When the token lands, execution re-resolves each row against live cost centers.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| `Validation: failed` with "Enterprise slug is required" or "A designated approver is required" | Required field empty in the issue form | Fill enterprise and designated approver and re-submit |
| `Validation: failed` with "header must include at least the columns: cost_center, action" | CSV header missing required columns | Fix the header row |
| Row shows `rejected (ambiguous_cost_center)` | Name matches more than one active cost center | Set `cost_center_id` to one of the listed candidate ids |
| Row shows `rejected (delete_blocked)` | Delete target still has attached resources | Detach resources via the allocation op, or set `force` = `true` |
| Row shows `rejected (name_taken)` | Rename new_name already used by another cost center | Pick a free name or rename the other cost center first |
| Row shows `rejected (conflicting_rows)` | Two rows target the same cost center with different actions | Remove or reconcile the conflicting rows |
| Live access shows `false (plan computed from spreadsheet)` | No `ISSUEOPS_GITHUB_TOKEN` configured | Plan is unverified and dry-run only; configure the enterprise billing PAT to execute |
| `Approval: denied` | Comment came from a login other than the designated approver | Have the named designated approver comment exactly `approved` |
| Execution blocked with "token is not a PAT" | `ISSUEOPS_GITHUB_TOKEN` is missing or not a classic PAT | Configure a classic PAT with `manage_billing:enterprise` |
| `Request status: partially_executed` or `failed` | Some cost-center API calls failed after bounded retry | Read per-row failure reasons; re-run the idempotent plan to converge |
| Label not applied to issue | `gh label create` step failed, or token lacks issues:write | Check the Ensure terminal state labels exist step log |
