# Implementation Plan: Create Organization Teams Workflow

**Branch**: `003-create-org-teams` | **Date**: 2026-05-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-create-org-teams/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Build an IssueOps workflow that accepts requests in the central administration
repository to create one or more empty teams in a target GitHub organization,
validates target organization and intended-owner eligibility, enforces central
approval by the single shared intended owner, and creates only missing teams.
The implementation will use YAML issue forms, `issue-ops/parser`, reusable
GitHub Actions workflow stages, a PAT-backed workflow credential stored as
`ISSUEOPS_GITHUB_TOKEN`, structured audit artifacts, and reconciliation-first
execution with dry-run and bounded retry behavior.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Workflow Runtime**: GitHub Actions reusable workflows on `ubuntu-latest`  
**Primary Dependencies**: `issue-ops/parser@v5`, GitHub REST API calls from Node-based workflow support modules, `actions/upload-artifact`, `actionlint`  
**Authentication Model**: A PAT-backed workflow token loaded from the `ISSUEOPS_GITHUB_TOKEN` secret is used for central-repository issue updates, target organization validation, approver verification, and team creation  
**Configuration Surface**: YAML issue forms, reusable workflow inputs, workflow/job permissions, and shared policy checks under `src/`  
**Testing**: `actionlint`, parser fixture tests, mocked workflow logic tests, integration dry-run tests, and replay tests for idempotent no-op reruns  
**Target Platform**: GitHub-hosted runners using repository or organization secrets for token injection  
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: GitHub step summaries, machine-readable JSON audit artifacts, and central-issue requester-facing run summaries  
**Constraints**: least privilege within PAT scope, approval before mutation, empty-team-only workflow scope, idempotent create behavior, no member population in this feature, parent teams out of scope, REST API rate-limit backoff, no repo-hosted source of truth  
**Scale/Scope**: Centralized enterprise IssueOps workflow for repeated team-creation requests across multiple target organizations, starting with empty team creation only

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

Use the constitution section `Repository Structure Conventions` to keep the feature layout and repository paths aligned with the repository-standard structure.

### Documentation (this feature)

```text
specs/003-create-org-teams/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── create-org-teams-workflow.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    create-org-teams.yml
  workflows/
    create-org-teams.yml

src/
  actions/
    team-creation-policy/
  workflow-support/
    parse-team-creation-request.*
    normalize-requested-teams.*
    validate-team-creation-request.*
    reconcile-team-creation.*
    github-team-api.*
  scripts/
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*

tests/
  contract/
  fixtures/
  integration/
```

**Structure Decision**: Use the repository-standard IssueOps layout from the
constitution without exception. Keep `.github/ISSUE_TEMPLATE/create-org-teams.yml`
as the intake surface, keep `.github/workflows/create-org-teams.yml` as the thin
GitHub-required shim, and place validation, approval, reconciliation, PAT
loading, GitHub API helpers, and audit generation under `src/`. Testing stays
repo-local under `tests/` with parser and policy contract coverage plus workflow
integration checks.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
