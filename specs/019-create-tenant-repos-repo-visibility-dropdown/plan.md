# Implementation Plan: Tenant Repository Visibility Dropdown

**Branch**: `019-create-tenant-repos-repo-visibility-dropdown` | **Date**: 2026-06-04 | **Spec**: `spec.md`
**Input**: Feature specification from `specs/019-create-tenant-repos-repo-visibility-dropdown/spec.md`

## Summary

Enhance the tenant repository creation IssueOps workflow to include a repository visibility dropdown in the issue form. The dropdown will expose `private`, `internal`, and `public` options, defaulting to `private`. The requested visibility will be parsed into the normalized `repository_visibility` field, validated against allowed values, and applied when creating the repository. Existing tenant boundary, approval, and governance validation should remain unchanged.

## Technical Context

**Workflow Runtime**: GitHub Actions reusable workflows on `ubuntu-latest`.
**Primary Dependencies**: `issue-ops/parser`, GitHub REST API via existing workflow support modules, Node.js task scripts.
**Authentication Model**: `ISSUEOPS_GITHUB_TOKEN` and `GITHUB_TOKEN` with least-privilege access for validation, approval, and repository creation.
**Configuration Surface**: GitHub issue form in `/.github/ISSUE_TEMPLATE`, reusable workflow inputs in `/.github/workflows`, parser output and workflow-support modules in `/src/workflow-support`.
**Organization Support Determination**: Requested visibility support will be validated against target-organization repository creation capability or configured tenant repository policy during request validation.
**Testing**: Contract tests under `/tests/contract`, fixture updates under `/tests/fixtures`, integration or dry-run tests under `/tests/integration`.
**Target Platform**: GitHub-hosted runners.
**Project Type**: IssueOps automation repository with reusable workflows and issue templates.
**Observability**: Structured audit artifacts, GitHub step summaries, and workflow outputs.
**Constraints**: least privilege, approval gates, idempotent reconciliation, fail-closed behavior.
**Scale/Scope**: tenant-scoped repository creation workflow enhancement.

## Constitution Check

- [x] Authorization requirements are defined for every privileged action, including requester, approver, and executing identity boundaries.
- [x] Validation strategy covers issue form parsing, schema/input checks, actor eligibility, and target-state preconditions.
- [x] Reconciliation logic defines current-state reads, drift detection, idempotent no-op behavior, and safe re-run semantics.
- [x] Dry-run behavior, rollback or compensating actions, and partial failure handling are specified before implementation.
- [x] Structured logging and audit artifacts identify the issue, actor, approvers, API operations, reconciliation outcome, and final state.
- [x] GitHub API rate-limit and retry strategy is defined in the spec, including handling for secondary rate limits or abuse protection.
- [x] Reusable workflow boundaries and shared policy components are identified; one-off logic is justified in Complexity Tracking only if necessary.

## Project Structure

This feature will follow the repository conventions from the constitution.

### Documentation (this feature)

```text
specs/019-create-tenant-repos-repo-visibility-dropdown/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── repository-visibility-dropdown.md
├── spec.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    create-tenant-repos.yml
  workflows/
    create-tenant-repos.yml
src/
  workflow-support/
    parse-tenant-repo-request.js
    validate-tenant-repo-request.js
    reconcile-tenant-repo-creation.js
  scripts/
    emit-audit-summary.js
tests/
  contract/
  fixtures/
  integration/
```

**Structure Decision**: Keep the visibility dropdown change limited to issue form schema, parser integration, validation rules, and repository creation execution logic in shared workflow support modules. No new top-level workflow files are required beyond the existing tenant repository creation workflow entrypoint.

## Complexity Tracking

No constitution violations are required for this feature. The enhancement fits into the existing IssueOps workflow architecture and does not introduce new repository boundaries.

## Next Plan Steps

1. Implement issue form update with visibility dropdown and default `private`.
2. Extend request parser schema to normalize `repository_visibility`.
3. Add validation rules for allowed visibility values and default behavior for absent values.
4. Update reconciliation logic to apply visibility on repository creation and to surface mismatched existing visibility as a blocked outcome.
5. Add contract tests, parser fixture coverage, and integration tests for create-time visibility behavior.
6. Ensure audit artifact and summary output record the selected visibility.
