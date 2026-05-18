# Implementation Plan: Add Team Repository Access Workflow

**Branch**: `005-add-team-repo-access` | **Date**: 2026-05-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-add-team-repo-access/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Build an IssueOps workflow that accepts requests in the central administration
repository to grant one existing GitHub team a single requested permission level
on one or more existing repositories in a target GitHub organization, validates
organization, team, repository, and approver eligibility, enforces central
approval by one designated target organization owner, and grants only missing
eligible repository access. The implementation will use YAML issue forms,
`issue-ops/parser`, thin GitHub Actions workflow shims, shared Node-based
workflow support modules under `src`, a PAT-backed workflow credential stored as
`ISSUEOPS_GITHUB_TOKEN`, structured audit artifacts, and reconciliation-first
execution with dry-run and bounded retry behavior.

## Technical Context

**Workflow Runtime**: GitHub Actions reusable workflows on `ubuntu-latest` with `actions/setup-node@v6` using Node.js 24  
**Primary Dependencies**: `issue-ops/parser@v5`, GitHub REST team repository-permission endpoints from Node-based workflow support modules, `actions/upload-artifact@v7`, `rhysd/actionlint@v1`  
**Authentication Model**: A PAT-backed workflow token loaded from the `ISSUEOPS_GITHUB_TOKEN` secret is used for central-repository issue updates, target organization validation, target organization owner verification, repository and team visibility checks, and repository team-permission mutation  
**Configuration Surface**: YAML issue forms, reusable workflow inputs, workflow and job permissions, normalized repository-role mappings, and shared policy checks under `src/`  
**Testing**: `actionlint`, parser fixture tests, approval-policy tests, repository-access reconciliation contract tests, integration dry-run tests, and replay tests for idempotent no-op reruns  
**Target Platform**: GitHub-hosted runners using repository or organization secrets for token injection  
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: GitHub step summaries, machine-readable JSON audit artifacts, and central-issue requester-facing run summaries  
**Constraints**: least privilege within PAT scope, approval before mutation, additive repository-access-only workflow scope, built-in repository roles only in v1, no permission removal or downgrades, reject archived repositories, REST API rate-limit backoff, no repo-hosted source of truth  
**Scale/Scope**: Centralized enterprise IssueOps workflow for repeated team repository-access requests across multiple target organizations, starting with one-team multi-repository grant batches only

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Authorization requirements are defined for every privileged action, including requester,
  approver, and executing identity boundaries.
- [x] Validation strategy covers issue form parsing, schema input checks, actor eligibility,
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

Use the constitution section `Repository Structure Conventions` to keep the feature layout and repository paths aligned with the repository-standard structure.

### Documentation (this feature)

```text
specs/005-add-team-repo-access/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── add-team-repo-access-workflow.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    add-team-repo-access.yml
  workflows/
    add-team-repo-access.yml

src/
  actions/
    team-repo-access-policy/
  workflow-support/
    parse-team-repo-access-request.*
    normalize-requested-repositories.*
    normalize-requested-permission.*
    validate-team-repo-access-request.*
    reconcile-team-repo-access.*
    resolve-team-repo-access-approver.*
    github-team-repo-api.*
    load-workflow-token.*
    handle-rate-limit.*
    build-audit-artifact.*
    build-execution-outcome.*
  scripts/
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*

tests/
  contract/
    add-team-repo-access-parser-fixture.test.*
    add-team-repo-access-approval-policy.test.*
    reconcile-team-repo-access-contract.test.*
  fixtures/
    github-api/
  integration/
    add-team-repo-access-request.test.*
    add-team-repo-access-approval.test.*
    add-team-repo-access-workflow.test.*
```

**Structure Decision**: Use the repository-standard IssueOps layout from the
constitution without exception. Keep `.github/ISSUE_TEMPLATE/add-team-repo-access.yml`
as the intake surface, keep `.github/workflows/add-team-repo-access.yml` as the
thin GitHub-required shim, reuse the repository's staged Node runners under
`src/scripts/`, and place parsing, normalization, authorization, reconciliation,
GitHub team-repository API helpers, PAT loading, rate-limit handling, and audit
generation under `src/workflow-support/`. Testing stays repo-local under
`tests/` with parser and approval-policy contract coverage plus workflow
integration checks.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
