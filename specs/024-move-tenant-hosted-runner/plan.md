# Implementation Plan: Move Tenant GitHub-Hosted Runner

**Branch**: `021-create-tenant-hosted-runner` | **Date**: 2026-06-12 | **Spec**: [spec.md](./spec.md)

## Summary

Add a fourth tenant runner IssueOps workflow to PR #27. It resolves one existing tenant-prefixed GitHub-hosted runner and one existing tenant runner group, requires tenant admin requester authorization and designated active organization-owner approval, revalidates both boundaries at execution, then updates only the runner's `runner_group_id`.

## Technical Context

**Runtime**: GitHub Actions on `ubuntu-latest`, Node.js 24
**Parser**: `issue-ops/parser@v5`
**Mutation API**: `PATCH /orgs/{org}/actions/hosted-runners/{hosted_runner_id}`
**Authentication**: PAT-backed `ISSUEOPS_GITHUB_TOKEN` with `manage_runners:org` or equivalent fine-grained organization Administration write permission
**State Source**: `tenant-registry/` on main plus live organization teams, memberships, runners, and runner groups
**Validation**: `node --test`, `actionlint`, syntax checks, full repository suite
**Observability**: JSON audit artifact, step summary, terminal label, issue comment
**Scope**: One runner, one existing target group, one tenant, one organization

## Constitution Check

- [x] Requester, approver, and execution identity boundaries are explicit.
- [x] Live target state is read before mutation and again after approval.
- [x] Ambiguous runner names fail closed.
- [x] Cross-tenant group targeting fails closed.
- [x] Dry-run and no-op behavior prevent mutation.
- [x] Retry behavior is bounded.
- [x] Audit output includes target ids, current group, target group, action, and result.
- [x] Workflow YAML delegates business logic to shared Node modules.

## Project Structure

```text
.github/
  ISSUE_TEMPLATE/move-tenant-hosted-runner.yml
  workflows/move-tenant-hosted-runner.yml

src/workflow-support/
  parse-hosted-runner-move-request.js
  validate-hosted-runner-move-request.js
  reconcile-hosted-runner-move.js
  github-runner-api.js

src/scripts/
  run-request-validation.js
  run-approval-gate.js
  run-approved-execution.js
  emit-audit-summary.js

tests/
  contract/move-tenant-hosted-runner-validation.test.js
  integration/move-tenant-hosted-runner-workflow.test.js
  fixtures/move-tenant-hosted-runner-issue.md

specs/024-move-tenant-hosted-runner/
```

## Design

1. Parse the runner name, optional numeric id, and required target group.
2. Resolve tenant context using operation `hosted_runner_move` and a context marker bound to both runner and target group.
3. Resolve all exact runner-name matches. Require the id only when needed and verify it matches the name.
4. Resolve the exact target group and enforce the tenant namespace.
5. Reconcile to `move_hosted_runner`, `noop`, or `reject`.
6. Reuse the hosted-runner approval and mutation policy.
7. At execution, rerun validation and PATCH the runner only when the move remains required.
8. Persist the final artifact, label the issue, and post the formatted summary.

## Complexity Tracking

No constitution exceptions are required.
