<!--
Sync Impact Report
Version change: 1.1.0 -> 1.2.0
Modified principles:
- V. Reusable Workflow Architecture and Governance
Added sections:
- Operational Constraints
- Specification and Delivery Gates
- Repository Structure Conventions
Removed sections:
- None
Templates requiring updates:
- None
Follow-up TODOs:
- None
-->
# IssueOps Speckit Constitution

## Core Principles

### I. Reconciliation-First Automation
All automation in this repository MUST treat GitHub as the source of truth and
the repository as the orchestration layer only. Every workflow MUST parse the
issue payload into machine-readable JSON, inspect current GitHub state, compute
drift between requested and actual state, and execute only the changes required
to reconcile that drift. Re-running the same workflow with the same effective
request MUST converge to the same end state without duplicate side effects.
Rationale: IssueOps automation is safe at enterprise scale only when workflows
are idempotent, state-aware, and explicitly no-op when the requested state is
already satisfied.

### II. Least-Privilege and Approval-Gated Execution
Every workflow, job, and reusable component MUST request the minimum GitHub
permissions required for its step, use stored long-lived credentials, and separate read, validation, approval, and mutation stages. Any action that grants access, changes organization membership, alters team relationships, or modifies repository privileges MUST enforce an explicit approval gate before mutation and MUST document the authorization model in the feature specification. Rationale: administrative automation expands blast radius unless privilege boundaries and approval controls are designed into the
workflow itself.

### III. Auditable and Structured Operations
Every workflow run MUST emit structured logs and durable evidence sufficient to
reconstruct who requested the action, what was requested, what state was
observed, what decision was made, what API calls were attempted, and what final
state was reached. Logs and artifacts MUST include correlation identifiers such
as issue number, workflow run id, repository, target resource, actor,
approvers, and reconciliation outcome. Rationale: this repository automates
organization administration, so enterprise governance depends on reliable audit
trails without relying on manual reconstruction.

### IV. Safe Execution, Dry-Run, and Rollback
State-mutating workflows MUST support dry-run execution, preflight validation,
bounded retry behavior, and defined rollback or compensating actions for
partial failure paths. A workflow MUST fail closed when authorization,
validation, approval, or reconciliation prerequisites are not met, and it MUST
leave behind a machine-readable summary of rollback status or manual recovery
steps when full rollback is impossible. Rationale: privileged automation is
only acceptable when operators can inspect intended changes before execution and
recover safely from interrupted or partial mutations.

### V. Reusable Workflow Architecture and Governance
IssueOps capabilities MUST be built from reusable workflows, shared actions, and
issue form templates rather than one-off workflow files. Each automation entry
point MUST use YAML-based issue forms under `/.github/ISSUE_TEMPLATE`, keep
substantive implementation code under `/src`, parse issue bodies with the
`issue-ops/parser` GitHub Action, and centralize common policy logic for
validation, authorization, logging, rate-limit handling, and reconciliation.
Any files that must live under `/.github/workflows` for GitHub compatibility
MUST remain thin entrypoint shims that delegate business logic to versioned
code in `/src`. Rationale: reuse is the control point that keeps enterprise
administrative automation consistent, reviewable, and maintainable as the task
catalog expands while keeping operational code organized outside GitHub control
directories.

## Operational Constraints

This repository MUST host reusable issue forms, reusable workflows, composite
actions, policy configuration, and supporting documentation for GitHub IssueOps
automation. Issue forms belong under `/.github/ISSUE_TEMPLATE`; implementation
code, shared actions, scripts, and workflow support modules belong under
`/src`; and any workflow YAML required under `/.github/workflows` MUST be kept
minimal and orchestration-only. It MUST NOT become the declarative source of
truth for organizational state; the durable system of record remains GitHub
itself. Automation MUST target GitHub APIs and native platform controls,
prefer policy-driven YAML configuration over hard-coded repository-specific
behavior, and treat parser output, validation results, approval decisions,
reconciliation plans, mutation summaries, and rollback summaries as
first-class artifacts.

## Specification and Delivery Gates

Every generated specification for this repository MUST include explicit sections
for authorization requirements, validation strategy, reconciliation logic,
testing expectations, rollback handling, observability requirements, and GitHub
API rate-limit handling. Every implementation plan MUST identify the reusable
workflow boundaries, issue form changes, `/.github` shim scope, `/src`
implementation layout, required permissions, dry-run behavior, logging schema,
and failure recovery path before implementation starts. Every task list MUST
include work items for parser integration, authorization enforcement,
validation, reconciliation, dry-run support, structured logging, rollback or
compensating logic, rate-limit handling, and tests that prove both no-op and
mutating paths.

## Repository Structure Conventions

Future specifications, plans, and task lists in this repository MUST assume and
adhere to the following baseline project structure unless a later constitution
amendment explicitly changes it.

### Feature Documentation Layout

Each feature MUST use a dedicated directory under `/specs/<feature-id>/` and
keep its generated planning artifacts together.

```text
specs/<feature-id>/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Repository Source Layout

Workflow entrypoints, issue forms, source code, and tests MUST follow this
shared repository layout.

```text
.github/
	ISSUE_TEMPLATE/
	workflows/

src/
	actions/
	workflow-support/
	scripts/

tests/
	contract/
	fixtures/
	integration/
```

### Structure Rules

- Issue intake forms MUST live under `/.github/ISSUE_TEMPLATE/`.
- GitHub-required workflow YAML files MUST live under `/.github/workflows/` and remain thin orchestration shims.
- Shared business logic, policy enforcement, API helpers, reconciliation code, and reusable workflow support MUST live under `/src/`.
- Shared actions belong under `/src/actions/`.
- Parsing, validation, authorization, reconciliation, retry, and audit helper modules belong under `/src/workflow-support/`.
- Workflow runner scripts and summary emitters belong under `/src/scripts/`.
- Contract and parser regression tests belong under `/tests/contract/`.
- Static fixtures and mocked API payloads belong under `/tests/fixtures/`.
- End-to-end and workflow-behavior coverage belong under `/tests/integration/`.
- Plans and future specs MUST reference this structure directly instead of depending on any single feature plan as the canonical source.

## Governance

This constitution is authoritative for repository specifications, plans, tasks,
workflow reviews, and pull requests. Amendments MUST be made by updating this
document together with any affected templates or guidance files and MUST record
the governance impact in the Sync Impact Report at the top of this file.

Versioning policy follows semantic versioning for governance: MAJOR for
principle removal or incompatible redefinition, MINOR for new principles or
materially expanded requirements, and PATCH for clarifications that do not
change required behavior.

Compliance review is mandatory for every feature specification, implementation
plan, task list, and pull request. Reviewers MUST verify authorization,
approval-gate coverage, idempotency, reconciliation behavior, dry-run support,
audit evidence, rollback handling, and rate-limit protections before approving
changes that affect operational workflows.

**Version**: 1.2.0 | **Ratified**: 2026-05-13 | **Last Amended**: 2026-05-15
