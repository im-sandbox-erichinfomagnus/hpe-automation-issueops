# Implementation Plan: Add Team Members Workflow

**Branch**: `001-add-team-members` | **Date**: 2026-05-13 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-add-team-members/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build an IssueOps workflow that accepts a request to add one or more people to a
GitHub organization team, validates the request and target state, enforces
approval by an organization owner, and reconciles only the
missing memberships. The implementation will use YAML issue forms,
`issue-ops/parser`, reusable GitHub Actions workflows, a PAT-backed workflow
credential for privileged API access, structured audit artifacts, and dry-run
execution before mutation.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Workflow Runtime**: GitHub Actions reusable workflows on `ubuntu-latest`  
**Primary Dependencies**: `issue-ops/parser@v5`, `actions/github-script`, `actions/upload-artifact`, `actionlint`  
**Authentication Model**: A single PAT-backed workflow token, provided to the workflow as the PoC `GITHUB_TOKEN`, is used for repo-local reads, comments, validation, and org team membership mutations  
**Configuration Surface**: YAML issue forms, reusable workflow inputs, workflow/job permissions, policy checks embedded in shared actions  
**Testing**: `actionlint`, parser fixture tests, mocked workflow logic tests, integration dry-run tests, replay tests for idempotent re-runs  
**Target Platform**: GitHub-hosted runners using repository or organization secrets for token injection  
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: GitHub step summaries, machine-readable JSON audit artifacts, issue comments for requester-facing outcome summaries  
**Constraints**: least privilege within PAT scope, approval before mutation, idempotent reconciliation, dry-run support, team-sync `403` handling, REST API rate-limit backoff, no repo-hosted source of truth  
**Scale/Scope**: Organization-wide team membership administration for repeated access requests, starting with add-team-members and expandable to adjacent IssueOps tasks

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Authorization requirements are defined for every privileged action, including requester,
      approver, and executing identity boundaries.
- [x] Validation strategy covers issue form parsing, schema/input checks, actor eligibility,
      and target-state preconditions.
- [x] Reconciliation logic defines current-state reads, drift detection, idempotent no-op
      behavior, and safe re-run semantics.
- [x] Dry-run behavior, rollback or compensating actions, and partial failure handling are
      specified before implementation.
- [x] Structured logging and audit artifacts identify the issue, actor, approvers, API
      operations, reconciliation outcome, and final state.
- [x] GitHub API rate-limit and retry strategy is defined, including handling for secondary
      rate limits or abuse protection.
- [x] Reusable workflow boundaries and shared policy components are identified; one-off logic
      is justified in Complexity Tracking if retained.

Initial gate result: PASS
Post-design gate result: PASS

## Project Structure

### Documentation (this feature)

```text
specs/001-add-team-members/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── add-team-members-workflow.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
.github/
      ISSUE_TEMPLATE/
            add-team-members.yml
      workflows/
            add-team-members.yml

src/
      actions/
            team-membership-policy/
      workflow-support/
            validate-team-membership-request.*
            reconcile-team-members.*
      scripts/
            emit-audit-summary.*

tests/
      contract/
            add-team-members-parser-fixture.*
      fixtures/
            add-team-members-issue.md
            github-api/
      integration/
            add-team-members-workflow.*
```

**Structure Decision**: Use the repository's existing `.github/ISSUE_TEMPLATE/`
entry point for issue intake and keep `.github/workflows/` limited to the thin
GitHub-required workflow shim. Place the substantive action code, validation
and reconciliation support, and helper scripts under `src/`. Testing stays
repo-local under `tests/` with parser fixtures, contract coverage, and
workflow integration checks.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
