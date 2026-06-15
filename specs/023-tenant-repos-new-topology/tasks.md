# Tasks: Tenant Repos on New Topology

**Input**: Design documents from `/specs/023-tenant-repos-new-topology/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Tests are required by constitution and this feature specification for parser, authorization, reconciliation, dry-run/no-op, observability, and duplicate-validation behavior.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Align workflow/spec artifacts for topology-enhanced create-tenant-repos implementation.

- [X] T001 Update feature contract metadata and validation date in specs/023-tenant-repos-new-topology/contracts/create-tenant-repos-topology-workflow.yaml
- [X] T002 Align quickstart command set with existing test files and naming in specs/023-tenant-repos-new-topology/quickstart.md
- [X] T003 [P] Add concrete topology fixtures in tests/fixtures/tenant-repos-topology/canonical-tenant-topology.json, tests/fixtures/tenant-repos-topology/legacy-tenant-topology.json, and tests/fixtures/tenant-repos-topology/owned-duplicate-tenant-topology.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build shared topology-read and ownership-entry primitives required by all stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Add canonical-topology-first with legacy-fallback tenant projection helper in src/workflow-support/resolve-tenant-context-from-registry.js
- [X] T005 [P] Add repository-name normalization and owned-repository collision utility in src/workflow-support/validate-tenant-repo-request.js
- [X] T006 [P] Add owned-entry builder with deterministic non-visibility defaults in src/workflow-support/reconcile-tenant-repo-creation.js
- [X] T007 Add audit helpers for topology mode, defaults_applied, and owned-entry append/no-op state in src/workflow-support/build-audit-artifact.js
- [X] T008 [P] Extend execution-outcome model for ownedTopologyAction states in src/workflow-support/build-execution-outcome.js
- [X] T009 Wire shared topology/owned helpers into validation and execution scripts in src/scripts/run-request-validation.js
- [X] T010 Wire shared topology/owned helpers into approved execution flow in src/scripts/run-approved-execution.js
- [X] T010A [P] Add shared bounded retry/rate-limit handling for topology registry reads and owned-entry persistence paths in src/workflow-support/handle-rate-limit.js and src/workflow-support/reconcile-tenant-repo-creation.js
- [X] T010B Add rollback/compensating outcome handling for partial topology persistence failures in src/workflow-support/build-execution-outcome.js and src/scripts/run-approved-execution.js

**Checkpoint**: Foundational topology/owned primitives are complete.

---

## Phase 3: User Story 1 - Validate Repository Requests Against New Tenant Topology (Priority: P1) 🎯 MVP

**Goal**: Validate tenant-scoped repository requests using canonical topology fields with fail-closed behavior.

**Independent Test**: Submit requests against canonical topology fixtures and verify approval-ready/blocked outcomes without mutation.

### Tests for User Story 1

- [X] T011 [P] [US1] Add contract tests for canonical topology resolution and requester governance checks in tests/contract/create-tenant-repos-validation.test.js
- [X] T012 [P] [US1] Add integration test for approval-ready validation path with canonical topology in tests/integration/create-tenant-repos-workflow.test.js
- [X] T012A [P] [US1] Add parser contract test for required visibility field and non-default visibility behavior in tests/contract/create-tenant-repos-parser.test.js

### Implementation for User Story 1

- [X] T013 [US1] Update canonical topology field extraction (tenantId, teams.structure, accessModel) in src/workflow-support/resolve-tenant-context-from-registry.js
- [X] T014 [US1] Enforce canonical topology governance relationship checks (tenant root and repo-admin linkage) in src/workflow-support/validate-tenant-repo-request.js
- [X] T015 [US1] Update validation summary language to report canonical topology fields consulted in src/scripts/emit-audit-summary.js
- [X] T016 [US1] Ensure dry-run path returns validation evidence without mutation in src/scripts/run-request-validation.js
- [X] T016A [US1] Ensure visibility is parsed as required issue-form input (without defaulting) in src/workflow-support/parse-tenant-repo-request.js

**Checkpoint**: US1 is independently testable with canonical topology validation.

---

## Phase 4: User Story 4 - Persist Repository Metadata Into Tenant Topology Owned List (Priority: P1)

**Goal**: Append one owned repository entry per successful request, apply non-visibility defaults, and block duplicates.

**Independent Test**: Create multiple repositories for one tenant and verify append-only owned entries, duplicate rejection, and rerun no-duplicate behavior.

### Tests for User Story 4

- [X] T017 [P] [US4] Add contract tests for owned-entry shape, defaults, and visibility-required behavior in tests/contract/create-tenant-repos-topology-owned.test.js
- [X] T018 [P] [US4] Add contract tests for duplicate-name validation against topology.repositories.owned in tests/contract/create-tenant-repos-validation.test.js
- [X] T019 [P] [US4] Add integration tests for append, rerun noop_already_owned, and duplicate blocked paths in tests/integration/create-tenant-repos-workflow.test.js

### Implementation for User Story 4

- [X] T020 [US4] Implement duplicate-name pre-approval validation against topology.repositories.owned using normalized comparison in src/workflow-support/validate-tenant-repo-request.js
- [X] T021 [US4] Implement owned-entry append persistence in src/workflow-support/reconcile-tenant-repo-creation.js
- [X] T022 [US4] Enforce field population for repoName, tenantId, visibility, repoType, lifecycle, migrationWave, source, adminTeam in src/workflow-support/reconcile-tenant-repo-creation.js
- [X] T023 [US4] Apply non-visibility defaults (repoType/lifecycle/migrationWave/source) and prevent visibility defaulting in src/workflow-support/reconcile-tenant-repo-creation.js
- [X] T024 [US4] Initialize topology.repositories.owned to [] when absent before append in src/workflow-support/reconcile-tenant-repo-creation.js
- [X] T025 [US4] Implement idempotent owned-entry no-op behavior on rerun for same normalized repoName + tenantId in src/workflow-support/reconcile-tenant-repo-creation.js
- [X] T026 [US4] Emit duplicate-name validation message with conflicting normalized repo name in src/workflow-support/validate-tenant-repo-request.js
- [X] T027 [US4] Add defaults_applied and owned entry details to audit payload in src/workflow-support/build-audit-artifact.js

**Checkpoint**: US4 is independently testable for append/default/duplicate/idempotency behavior.

---

## Phase 5: User Story 2 - Support Transitional Compatibility With Legacy Tenant Records (Priority: P2)

**Goal**: Keep create-tenant-repos operational across mixed canonical and legacy tenant-registry data.

**Independent Test**: Run validation/execution against legacy-only and canonical records with deterministic equivalent outcomes.

### Tests for User Story 2

- [X] T028 [P] [US2] Add contract tests for canonical-precedence and legacy-fallback tenant projection in tests/contract/create-tenant-repos-validation.test.js
- [X] T029 [P] [US2] Add integration tests for mixed registry modes with stable approval/execution behavior in tests/integration/create-tenant-repos-workflow.test.js

### Implementation for User Story 2

- [X] T030 [US2] Implement explicit topologyMode markers (canonical or legacy_projection) in src/workflow-support/resolve-tenant-context-from-registry.js
- [X] T031 [US2] Map legacy records into equivalent ownedRepositories and governance context in src/workflow-support/resolve-tenant-context-from-registry.js
- [X] T032 [US2] Ensure duplicate-name validation works for legacy projection with ownedRepositories default [] in src/workflow-support/validate-tenant-repo-request.js
- [X] T033 [US2] Surface topology mode in validation and execution summaries in src/scripts/emit-audit-summary.js

**Checkpoint**: US2 is independently testable for compatibility behavior.

---

## Phase 6: User Story 3 - Apply Tenant Governance Using New Topology Access Model (Priority: P3)

**Goal**: Preserve approval-gated repository creation and repo-admin grant while binding outcomes to new topology governance context.

**Independent Test**: Execute approved requests with successful and blocked governance paths and verify topology-aware audit outcomes.

### Tests for User Story 3

- [X] T034 [P] [US3] Add contract tests for topology-aware approval/execution context binding in tests/contract/create-tenant-repos-approval-policy.test.js
- [X] T035 [P] [US3] Add integration tests for execution-time revalidation and boundary-blocked outcomes in tests/integration/create-tenant-repos-workflow.test.js

### Implementation for User Story 3

- [X] T036 [US3] Revalidate canonical tenant governance context immediately before mutation in src/scripts/run-approved-execution.js
- [X] T037 [US3] Ensure repository admin grant uses resolved repo-admin team from topology context in src/workflow-support/reconcile-tenant-repo-creation.js
- [X] T038 [US3] Bind approved execution outcome to latest topology context marker in src/workflow-support/build-execution-outcome.js
- [X] T039 [US3] Add topology-governance identifiers to execution summary and audit sections in src/scripts/emit-audit-summary.js

**Checkpoint**: US3 is independently testable with topology-aware governance execution.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency checks, documentation cleanup, and full regression validation.

- [ ] T040 [P] Refresh contract implementation_status and validated_against notes after code completion in specs/023-tenant-repos-new-topology/contracts/create-tenant-repos-topology-workflow.yaml
- [ ] T041 [P] Update quickstart verification steps with actual test file names and command list in specs/023-tenant-repos-new-topology/quickstart.md
- [ ] T042 Run targeted contract suites for create-tenant-repos behavior in tests/contract/create-tenant-repos-validation.test.js and tests/contract/create-tenant-repos-topology-owned.test.js
- [ ] T043 Run targeted integration suite for create-tenant-repos workflow behavior in tests/integration/create-tenant-repos-workflow.test.js
- [ ] T044 Validate summaries and audit artifacts include topology mode, defaults_applied, and owned append/no-op details in src/scripts/emit-audit-summary.js
- [ ] T045 Run parser and rate-limit/rollback-focused contract suites in tests/contract/create-tenant-repos-parser.test.js and tests/contract/create-tenant-repos-execution-outcome.test.js

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1): No dependencies.
- Foundational (Phase 2): Depends on Setup completion; blocks all user stories.
- User Stories (Phases 3-6): Depend on Foundational completion.
- Polish (Phase 7): Depends on completion of selected user stories.

### User Story Dependencies

- US1 (P1): Starts after Foundational; no dependency on other stories.
- US4 (P1): Starts after Foundational; depends on shared primitives from Phase 2; can proceed in parallel with US1.
- US2 (P2): Starts after Foundational; can proceed in parallel with US1/US4 once shared projection helpers exist.
- US3 (P3): Starts after Foundational; integrates outputs from US1/US4/US2 for execution context and audit completeness.

### Within Each User Story

- Write tests first and confirm failing behavior before implementation.
- Implement parser/validation/reconciliation before summary polish.
- Complete story-level contract and integration tests before marking story complete.

### Parallel Opportunities

- Phase 1: T003 can run in parallel with T001-T002.
- Phase 2: T005, T006, T008, T010A can run in parallel after T004 starts.
- US1: T011, T012, and T012A can run in parallel.
- US4: T017, T018, T019 can run in parallel.
- US2: T028 and T029 can run in parallel.
- US3: T034 and T035 can run in parallel.
- Polish: T040 and T041 can run in parallel.

---

## Parallel Example: User Story 4

```bash
# Run US4 tests in parallel workstreams
Task: "T017 [US4] Add contract tests for owned-entry shape, defaults, and visibility-required behavior in tests/contract/create-tenant-repos-topology-owned.test.js"
Task: "T018 [US4] Add contract tests for duplicate-name validation against topology.repositories.owned in tests/contract/create-tenant-repos-validation.test.js"
Task: "T019 [US4] Add integration tests for append, rerun noop_already_owned, and duplicate blocked paths in tests/integration/create-tenant-repos-workflow.test.js"

# Implement independent US4 units after tests
Task: "T020 [US4] Implement duplicate-name pre-approval validation against topology.repositories.owned using normalized comparison in src/workflow-support/validate-tenant-repo-request.js"
Task: "T021 [US4] Implement owned-entry append persistence in src/workflow-support/reconcile-tenant-repo-creation.js"
Task: "T027 [US4] Add defaults_applied and owned entry details to audit payload in src/workflow-support/build-audit-artifact.js"
```

---

## Implementation Strategy

### MVP First (US1 + US4)

1. Complete Phase 1 and Phase 2.
2. Deliver US1 canonical topology validation.
3. Deliver US4 owned-entry append/default/duplicate behavior.
4. Validate end-to-end approval-ready and duplicate-rejection outcomes.

### Incremental Delivery

1. Foundation complete.
2. Deliver US1 (topology validation) and demo.
3. Deliver US4 (owned persistence and duplicate validation) and demo.
4. Deliver US2 (legacy compatibility hardening).
5. Deliver US3 (execution governance and context binding).
6. Complete polish and regression passes.

### Parallel Team Strategy

1. Team A: Validation path (US1 + US2 contract coverage).
2. Team B: Reconciliation/persistence path (US4 append/idempotency).
3. Team C: Execution and audit path (US3 + polish).

---

## Notes

- All tasks use strict checklist format with Task ID and file path.
- [P] tasks are parallel-safe by file ownership or independent coverage focus.
- Story labels [US1], [US2], [US3], [US4] are applied only in user-story phases.
- Keep workflow shims thin in `.github/workflows/` and business logic in `src/`.
- Preserve fail-closed authorization, approval-gating, reconciliation-first behavior, and deterministic audit outputs.
