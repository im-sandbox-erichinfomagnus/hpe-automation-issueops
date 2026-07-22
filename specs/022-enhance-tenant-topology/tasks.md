# Tasks: Enhance Tenant Topology Model

**Input**: Design documents from `specs/022-enhance-tenant-topology/`
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/tenant-topology-workflow.yaml`, `quickstart.md`

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Tests are REQUIRED for this feature per constitution and spec testing expectations.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., [US1], [US2], [US3])
- Every task includes an exact file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize feature artifacts and baseline fixtures for tenant topology enhancement.

- [X] T001 Create topology enhancement fixture directory and baseline fixture file in tests/fixtures/create-tenant-model/
- [X] T002 [P] Add feature contract scaffold references for topology enhancement in specs/022-enhance-tenant-topology/contracts/tenant-topology-workflow.yaml
- [X] T003 [P] Add shared test helper constants for topology field defaults in tests/fixtures/create-tenant-model/topology-defaults.json

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build shared parsing, validation, reconciliation, and observability primitives required by all stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Extend request parsing surface for new issue-form fields in src/workflow-support/parse-tenant-model-request.js
- [X] T005 [P] Add enum and boolean normalization helpers for tenantType/environment/governance in src/workflow-support/parse-tenant-model-request.js
- [X] T006 [P] Add compatibility projection helper for legacy tenant records in src/workflow-support/parse-tenant-model-request.js
- [X] T007 Implement shared topology validation primitives in src/workflow-support/validate-tenant-model-request.js
- [X] T008 [P] Implement canonical topology draft builder for root/admin/repo-admin derivation in src/workflow-support/reconcile-tenant-creation.js
- [X] T009 [P] Extend audit artifact base schema with compatibility mode and canonical topology markers in src/workflow-support/build-audit-artifact.js
- [X] T010 Add foundational parser and validator contract coverage for new field set in tests/contract/create-tenant-model-validation.test.js
- [X] T034 Implement explicit dry-run execution path and no-mutation status output in src/scripts/run-approved-execution.js
- [X] T035 Implement explicit rollback or compensating-status recording for partial failures in src/scripts/run-approved-execution.js
- [X] T036 Implement bounded retry and rate-limit handling hooks for topology mutation calls in src/scripts/run-approved-execution.js
- [X] T037 Implement structured logging fields for validation, reconciliation, mutation, and compatibility mode in src/workflow-support/build-audit-artifact.js
- [X] T038 Add integration tests for dry-run no-mutation and rollback status transitions in tests/integration/create-tenant-model-workflow.test.js
- [X] T039 Add contract tests for rate-limit retry evidence and structured logging fields in tests/contract/create-tenant-model-audit-summary.test.js

**Checkpoint**: Foundation ready - user story implementation can begin.

---

## Phase 3: User Story 1 - Create Tenant With New Topology Schema (Priority: P1) 🎯 MVP

**Goal**: Persist canonical topology-first tenant records from tenant creation requests.

**Independent Test**: Submit a valid create-tenant-model request and verify canonical record fields (`tenantId`, `tenantName`, `tenantType`, `topology`, `externalMappings`, `metadata`) and default empty arrays are persisted correctly.

### Tests for User Story 1

- [X] T011 [P] [US1] Add parser contract tests for tenant_type and topology derivation in tests/contract/create-tenant-model-parser.test.js
- [X] T012 [P] [US1] Add integration test for canonical topology persistence on approved execution in tests/integration/create-tenant-model-workflow.test.js

### Implementation for User Story 1

- [X] T013 [P] [US1] Add tenant_type/governance/external-mapping/metadata fields to issue intake in .github/ISSUE_TEMPLATE/create-tenant-model.yml
- [X] T014 [US1] Implement canonical tenant record assembly in src/scripts/run-request-validation.js
- [X] T015 [US1] Persist topology.organization, topology.teams, topology.repositories.owned, and topology.runnerTopology.runnerGroups in src/scripts/run-approved-execution.js
- [X] T016 [US1] Update summary emission for canonical tenant fields in src/scripts/emit-audit-summary.js
- [X] T017 [US1] Add regression fixture for valid canonical topology request in tests/fixtures/create-tenant-model/canonical-topology-valid.json

**Checkpoint**: User Story 1 is fully functional and independently testable.

---

## Phase 4: User Story 2 - Enforce Tenant Boundary Governance And Access Policy (Priority: P2)

**Goal**: Enforce governance and access model semantics with fail-closed behavior.

**Independent Test**: Submit valid/invalid governance and environment combinations and verify validation outcomes, stored policy fields, and blocked execution behavior when preconditions fail.

### Tests for User Story 2

- [X] T018 [P] [US2] Add contract tests for governance booleans and mandatory policy semantics in tests/contract/create-tenant-model-validation.test.js
- [X] T019 [P] [US2] Add integration test for fail-closed policy/authorization precondition handling in tests/integration/create-tenant-model-workflow.test.js

### Implementation for User Story 2

- [X] T020 [US2] Implement governance policy validation and mandatory flag enforcement in src/workflow-support/validate-tenant-model-request.js
- [X] T021 [US2] Implement accessModel enforcement and logical roles persistence in src/scripts/run-request-validation.js
- [X] T022 [US2] Enforce tenant-boundary pre-mutation guardrails in src/scripts/run-approved-execution.js
- [X] T023 [US2] Extend audit and summary policy reporting in src/workflow-support/build-audit-artifact.js

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Maintain Compatibility With Existing Tenant Records (Priority: P3)

**Goal**: Support legacy-record reads with canonical-write behavior and deterministic rerun outcomes.

**Independent Test**: Execute validation/reconciliation using legacy tenant registry records and verify dual-read compatibility, canonical-write output, and idempotent reruns.

### Tests for User Story 3

- [X] T024 [P] [US3] Add contract tests for legacy-to-canonical projection in tests/contract/create-tenant-model-compatibility.test.js
- [X] T025 [P] [US3] Add integration test for mixed legacy/new record execution and rerun idempotency in tests/integration/create-tenant-model-workflow.test.js

### Implementation for User Story 3

- [X] T026 [US3] Implement dual-read compatibility projection in src/workflow-support/parse-tenant-model-request.js
- [X] T027 [US3] Implement canonical-write migration path for legacy records in src/scripts/run-approved-execution.js
- [X] T028 [US3] Add compatibility mode and provenance output fields in src/scripts/emit-audit-summary.js
- [X] T029 [US3] Add legacy record fixtures for migration tests in tests/fixtures/create-tenant-model/legacy-tenant-record.json
- [X] T040 [US3] Implement lifecycle-status equivalence mapping from legacy active semantics in src/scripts/run-request-validation.js
- [X] T041 [P] [US3] Add contract test for lifecycle-status equivalence in tests/contract/create-tenant-model-compatibility.test.js

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening, documentation alignment, and full regression confidence.

- [X] T030 [P] Update workflow contract details to match implemented behavior in specs/022-enhance-tenant-topology/contracts/tenant-topology-workflow.yaml
- [X] T031 Validate quickstart instructions against implemented commands and paths in specs/022-enhance-tenant-topology/quickstart.md
- [X] T032 [P] Add summary/artifact regression tests for deterministic request statuses in tests/contract/create-tenant-model-audit-summary.test.js
- [X] T033 Run full feature regression suites and capture outcomes in test_output.txt

---

## Phase 7: Post-Phase Enhancements (Org Roles)

**Purpose**: Materialize canonical access-model roles as organization-level role resources and align docs/contracts.

- [X] T042 Implement organization-role API support and tenant-bootstrap role provisioning in src/workflow-support/github-team-api.js and src/scripts/run-approved-execution.js
- [X] T043 [P] Add parser/validator coverage for topology.accessModel.organizationRoleSpecifications in tests/contract/create-tenant-model-parser.test.js and tests/contract/create-tenant-model-validation.test.js
- [X] T044 [P] Add integration coverage for organization-role creation outcomes in tests/integration/create-tenant-model-workflow.test.js
- [X] T045 Update specification artifacts for organization-role provisioning behavior in specs/022-enhance-tenant-topology/spec.md, specs/022-enhance-tenant-topology/research.md, specs/022-enhance-tenant-topology/data-model.md, specs/022-enhance-tenant-topology/contracts/tenant-topology-workflow.yaml, and specs/022-enhance-tenant-topology/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Stories (Phases 3-5)**: Depend on Foundational completion.
- **Polish (Phase 6)**: Depends on completion of target user stories.

### User Story Dependencies

- **US1 (P1)**: Starts after Foundational; no dependency on US2/US3.
- **US2 (P2)**: Starts after Foundational; can run independently of US1 implementation order but integrates with shared foundations.
- **US3 (P3)**: Starts after Foundational; can run independently but validates compatibility against US1 canonical model.

### Within Each User Story

- Implement tests first and ensure they fail before implementation tasks.
- Complete parser/validation changes before mutation-path changes.
- Complete audit/summary updates before final story checkpoint.

## Parallel Opportunities

- **Setup**: T002 and T003 can run in parallel after T001 scaffolding decision.
- **Foundational**: T005, T006, T008, and T009 can run in parallel after T004.
- **Foundational**: T005, T006, T008, T009, T036, and T037 can run in parallel after T004.
- **US1**: T011 and T012 can run in parallel; T013 can run parallel to test writing.
- **US2**: T018 and T019 can run in parallel.
- **US3**: T024, T025, and T041 can run in parallel.
- **Polish**: T030 and T032 can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Run US1 test tasks in parallel workstreams:
Task T011: tests/contract/create-tenant-model-parser.test.js
Task T012: tests/integration/create-tenant-model-workflow.test.js

# Run US1 setup task in parallel with test authoring:
Task T013: .github/ISSUE_TEMPLATE/create-tenant-model.yml
```

---

## Implementation Strategy

### MVP First (US1)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Validate canonical topology persistence and defaults end-to-end.
4. Demo/deploy MVP behavior.

### Incremental Delivery

1. Deliver US1 canonical topology persistence.
2. Deliver US2 governance and access enforcement.
3. Deliver US3 legacy compatibility migration.
4. Finish with Phase 6 polish and full regression.

### Team Parallelization Strategy

1. Team completes Setup and Foundational together.
2. After Phase 2, split ownership:
   - Engineer A: US1
   - Engineer B: US2
   - Engineer C: US3
3. Integrate and run Phase 6 hardening.

---

## Notes

- All tasks follow strict checklist format.
- [P] tasks are parallel-safe by file separation and dependency ordering.
- User-story labels are applied only to story-phase tasks.
- Tests are explicitly included per constitution and spec requirements.
- File paths align with repository structure conventions.
