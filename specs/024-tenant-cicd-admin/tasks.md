# Tasks: Tenant CI/CD Admin Bootstrap

**Input**: Design documents from `/specs/024-tenant-cicd-admin/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Tests are required by constitution and this feature specification for parser, authorization, reconciliation, dry-run/no-op, partial-failure handling, observability, and bounded retry behavior.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Align feature artifacts, fixtures, and workflow contract scaffolding for implementation.

- [X] T001 Sync contract metadata and status notes in specs/024-tenant-cicd-admin/contracts/create-tenant-cicd-admin-workflow.yaml
- [X] T002 [P] Add feature fixture directory and seed JSON fixtures in tests/fixtures/create-tenant-model-cicd/capability-available.json and tests/fixtures/create-tenant-model-cicd/capability-unavailable.json
- [X] T003 [P] Add hierarchy-conflict and dry-run fixture payloads in tests/fixtures/create-tenant-model-cicd/hierarchy-conflict.json and tests/fixtures/create-tenant-model-cicd/dry-run.json
- [X] T004 Align operator verification commands and scenario references in specs/024-tenant-cicd-admin/quickstart.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build shared primitives required by all user stories.

**CRITICAL**: No user story implementation starts until this phase is complete.

- [X] T005 Extend tenant derivation helper for CICDAdmin team name/slug in src/workflow-support/parse-tenant-creation-request.js
- [X] T006 [P] Add shared CICD capability path evaluation helper in src/workflow-support/reconcile-tenant-creation.js
- [X] T007 [P] Add shared policy check helper for unsafe org-wide privilege expansion in src/workflow-support/validate-tenant-creation-request.js
- [X] T008 Add shared capability outcome taxonomy mapper in src/workflow-support/build-execution-outcome.js
- [X] T009 [P] Extend audit artifact schema for cicd capability fields in src/workflow-support/build-audit-artifact.js
- [X] T010 Add registry persistence extension-field mapper in src/workflow-support/persist-tenant-registry-record.js
- [X] T010A Add topology structure persistence mapper for CICDAdmin parent-child relation in src/workflow-support/persist-tenant-registry-record.js
- [X] T011 [P] Add bounded retry wrapper for capability-related API calls in src/workflow-support/handle-rate-limit.js
- [X] T012 Wire foundational capability helpers into validation and execution scripts in src/scripts/run-request-validation.js and src/scripts/run-approved-execution.js

**Checkpoint**: Foundational capability primitives complete; user stories can begin.

---

## Phase 3: User Story 1 - Bootstrap Tenant Teams With CICDAdmin Addition (Priority: P1) MVP

**Goal**: Preserve baseline tenant bootstrap while adding deterministic third-team derivation and reconciliation.

**Independent Test**: Approved request creates missing `<TenantName>_Tenant_CICDAdmin`, preserves baseline teams/hierarchy, and reruns as no-op.

### Tests for User Story 1

- [X] T013 [P] [US1] Add parser and fixture contract coverage for third-team derivation in tests/contract/create-tenant-model-parser.test.js and tests/contract/create-tenant-model-parser-fixture.test.js
- [X] T014 [P] [US1] Add validation contract coverage for CICDAdmin slug validity and collisions in tests/contract/create-tenant-model-validation.test.js
- [X] T014A [P] [US1] Add validation contract coverage for CICDAdmin topology parent-child consistency and conflict blocking in tests/contract/create-tenant-model-validation.test.js
- [X] T015 [P] [US1] Add integration coverage for create/no-op rerun with third team in tests/integration/create-tenant-model-workflow.test.js

### Implementation for User Story 1

- [X] T016 [US1] Implement deterministic CICDAdmin team derivation in src/workflow-support/parse-tenant-creation-request.js
- [X] T017 [US1] Implement CICDAdmin existence and create-only-if-missing reconciliation in src/workflow-support/reconcile-tenant-creation.js
- [X] T018 [US1] Implement CICDAdmin hierarchy validation and conflict blocking in src/workflow-support/validate-tenant-creation-request.js
- [X] T018A [US1] Implement CICDAdmin topology parent-child validation and conflict blocking in src/workflow-support/validate-tenant-creation-request.js
- [X] T019 [US1] Extend approved-execution mutation plan with CICDAdmin team operations in src/scripts/run-approved-execution.js
- [X] T020 [US1] Extend summary output for third-team outcomes in src/scripts/emit-audit-summary.js

**Checkpoint**: US1 is independently functional and testable.

---

## Phase 4: User Story 2 - Apply CI/CD Admin Capability Safely Under Platform Constraints (Priority: P2)

**Goal**: Apply capability only through policy-approved safe paths; fail closed when tenant-safe representation is not possible.

**Independent Test**: Capability-available scenario applies safe path; unavailable scenario returns blocked/unavailable with reason codes and no unsafe org-wide grants.

### Tests for User Story 2

- [X] T021 [P] [US2] Add capability policy contract tests for primary/fallback/none path selection in tests/contract/create-tenant-model-validation.test.js
- [X] T022 [P] [US2] Add reconciliation contract tests for capability status taxonomy mapping in tests/contract/create-tenant-model-audit-summary.test.js
- [X] T023 [P] [US2] Add integration tests for capability-available and capability-unavailable runs in tests/integration/create-tenant-model-workflow.test.js

### Implementation for User Story 2

- [X] T024 [US2] Implement capability prerequisite evaluation and safe-path selection in src/workflow-support/validate-tenant-creation-request.js
- [X] T025 [US2] Implement primary path capability assignment execution in src/workflow-support/reconcile-tenant-creation.js
- [X] T026 [US2] Implement fallback repository-scoped capability assignment for tenant-owned repositories in src/workflow-support/reconcile-tenant-creation.js
- [X] T027 [US2] Implement fail-closed blocked/unavailable handling for unsafe or unsupported paths in src/scripts/run-approved-execution.js
- [X] T028 [US2] Add capability path and reason-code reporting to audit summary in src/scripts/emit-audit-summary.js

**Checkpoint**: US2 is independently functional and testable.

---

## Phase 5: User Story 3 - Preserve Baseline Governance, Idempotency, and Audit Outcomes (Priority: P3)

**Goal**: Keep baseline approval, dry-run, and rerun safety unchanged while extending registry and observability for CICD outcomes.

**Independent Test**: Unauthorized approval remains blocked; dry-run emits full plan with zero mutations; partial-failure path records remediation and durable evidence.

### Tests for User Story 3

- [X] T029 [P] [US3] Add approval-gate and authorization non-regression tests in tests/contract/create-tenant-model-compatibility.test.js and tests/contract/create-tenant-model-validation.test.js
- [X] T030 [P] [US3] Add registry extension and commit/no-op behavior tests in tests/contract/create-tenant-model-registry-commit.test.js
- [X] T030A [P] [US3] Add contract tests for topology.teams.structure CICDAdmin relation apply/noop behavior in tests/contract/create-tenant-model-registry-commit.test.js
- [X] T031 [P] [US3] Add integration tests for dry-run and partial-failure remediation in tests/integration/create-tenant-model-workflow.test.js and tests/integration/create-tenant-model-request.test.js
- [X] T031A [P] [US3] Add negative contract tests asserting no branch/tag/push ruleset mutation paths are invoked in tests/contract/create-tenant-model-compatibility.test.js
- [X] T031B [P] [US3] Add negative contract tests asserting no tenant-boundary hardening mutations occur outside scoped enhancement in tests/contract/create-tenant-model-compatibility.test.js
- [X] T031C [P] [US3] Add explicit non-regression test asserting repository-creation workflow behavior remains unchanged in tests/contract/create-tenant-model-compatibility.test.js

### Implementation for User Story 3

- [X] T032 [US3] Ensure approval-gate semantics remain unchanged for new capability path in src/scripts/run-approval-gate.js
- [X] T033 [US3] Ensure execution-time revalidation and drift detection include CICD capability state in src/scripts/run-approved-execution.js
- [X] T034 [US3] Extend registry record persistence with cicd status, reason, and evidence reference in src/workflow-support/persist-tenant-registry-record.js
- [X] T034A [US3] Extend registry persistence with CICDAdmin topology relation outcome (`applied`, `noop`, `blocked`, `failed`) in src/workflow-support/persist-tenant-registry-record.js
- [X] T035 [US3] Extend audit artifact builder with required cicd observability fields in src/workflow-support/build-audit-artifact.js
- [X] T036 [US3] Extend execution outcome classification for partial-failure and remediation guidance in src/workflow-support/build-execution-outcome.js

**Checkpoint**: US3 is independently functional and testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening, documentation sync, and focused regression execution.

- [ ] T037 [P] Update contract implementation status and validated-against references in specs/024-tenant-cicd-admin/contracts/create-tenant-cicd-admin-workflow.yaml
- [ ] T038 [P] Refresh quickstart with final test commands and expected summary snippets in specs/024-tenant-cicd-admin/quickstart.md
- [ ] T039 Run targeted contract suites for create-tenant-model CICD enhancement in tests/contract/create-tenant-model-parser.test.js tests/contract/create-tenant-model-validation.test.js tests/contract/create-tenant-model-registry-commit.test.js tests/contract/create-tenant-model-audit-summary.test.js tests/contract/create-tenant-model-compatibility.test.js
- [ ] T040 Run targeted integration suites for CICD enhancement in tests/integration/create-tenant-model-workflow.test.js and tests/integration/create-tenant-model-request.test.js
- [ ] T041 Validate audit artifact and step summary include cicd selected path/status/reason and remediation guidance in src/scripts/emit-audit-summary.js and src/workflow-support/build-audit-artifact.js
- [ ] T042 Perform least-privilege permission review for workflow and token scopes in .github/workflows/create-tenant-model.yml

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 Setup: no dependencies.
- Phase 2 Foundational: depends on Phase 1 and blocks all user stories.
- Phase 3 US1: depends on Phase 2.
- Phase 4 US2: depends on Phase 2 and integrates US1-derived team state.
- Phase 5 US3: depends on Phase 2 and validates integrated behavior across US1 and US2.
- Phase 6 Polish: depends on completion of desired user stories.

### User Story Dependencies

- US1 (P1): starts after foundational work; no dependency on other stories.
- US2 (P2): starts after foundational work; can run in parallel with US1.
- US3 (P3): starts after foundational work for baseline non-regression checks, but US3 integration validation that references capability outcomes MUST run after US2 implementation tasks (T024-T028).

### Within Each User Story

- Tests are written first and must fail before implementation.
- Parser/validation before mutating reconciliation logic.
- Reconciliation before summary and observability polish.
- Story-level contract and integration tests pass before story completion.

### Parallel Opportunities

- Setup: T002 and T003 in parallel.
- Foundational: T006, T007, T009, and T011 in parallel after T005 starts.
- US1 tests: T013, T014, T015 in parallel.
- US2 tests: T021, T022, T023 in parallel.
- US3 tests: T029, T030, T031, T031A, T031B, and T031C in parallel.
- Polish: T037 and T038 in parallel.

---

## Parallel Example: User Story 2

```bash
# Parallel test work for US2
Task: "T021 [US2] Add capability policy contract tests for primary/fallback/none path selection"
Task: "T022 [US2] Add reconciliation contract tests for capability status taxonomy mapping"
Task: "T023 [US2] Add integration tests for capability-available and capability-unavailable runs"

# Parallel implementation work after tests are in place
Task: "T024 [US2] Implement capability prerequisite evaluation and safe-path selection"
Task: "T026 [US2] Implement fallback repository-scoped capability assignment for tenant-owned repositories"
Task: "T028 [US2] Add capability path and reason-code reporting to audit summary"
```

---

## Implementation Strategy

### MVP First (US1)

1. Complete Phase 1 and Phase 2.
2. Deliver US1 third-team derivation and reconciliation.
3. Validate US1 independently via contract and integration tests.

### Incremental Delivery

1. Foundation complete.
2. Deliver US1 and validate.
3. Deliver US2 capability safety paths and validate.
4. Deliver US3 governance/observability/registry non-regression and validate.
5. Complete polish and run focused regressions.

### Parallel Team Strategy

1. Team A: parser/validation and contract tests.
2. Team B: reconciliation and capability execution paths.
3. Team C: audit/summary/registry extensions and integration verification.

---

## Notes

- All tasks follow required checklist format with Task ID and exact file paths.
- Story labels are used only in user-story phases.
- Keep workflow shim logic thin in `.github/workflows/` and business logic in `src/`.
- Preserve fail-closed authorization and explicit approval-gate semantics from spec 014.
