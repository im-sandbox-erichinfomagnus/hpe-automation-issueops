# Tasks: Tenant Creation IssueOps Workflow

**Input**: Design documents from `/specs/014-create-tenant-model/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Tests are required for this feature. Include parser and fixture coverage, approval authorization coverage, reconciliation idempotency coverage, dry-run no-mutation coverage, durable registry persistence success/failure coverage, and bounded retry/partial-failure coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare issue-form/workflow surfaces, feature fixtures, and contract baselines for tenant creation.

- [ ] T001 Create feature fixture scaffolding in tests/fixtures/create-tenant-model-issue.md and tests/fixtures/create-tenant-model-comments.json
- [ ] T002 Create feature contract test scaffolding in tests/contract/create-tenant-model-parser-fixture.test.js and tests/contract/create-tenant-model-validation.test.js
- [ ] T003 Create feature integration test scaffolding in tests/integration/create-tenant-model-request.test.js and tests/integration/create-tenant-model-workflow.test.js
- [ ] T004 [P] Create workflow contract baseline in specs/014-create-tenant-model/contracts/create-tenant-model-workflow.yaml
- [ ] T005 [P] Create operator verification baseline in specs/014-create-tenant-model/quickstart.md
- [ ] T006 [P] Add create-tenant-model form skeleton in .github/ISSUE_TEMPLATE/create-tenant-model.yml
- [ ] T007 [P] Add create-tenant-model workflow shim skeleton in .github/workflows/create-tenant-model.yml

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement shared request parsing, authorization, reconciliation primitives, and observability plumbing required by all user stories.

**CRITICAL**: No user story implementation starts until this phase is complete.

- [ ] T008 Implement operation-aware parser wiring for create-tenant-model in src/scripts/run-request-validation.js
- [ ] T009 [P] Implement tenant request parser module in src/workflow-support/parse-tenant-creation-request.js
- [ ] T010 [P] Implement tenant request validator module in src/workflow-support/validate-tenant-creation-request.js
- [ ] T011 [P] Implement tenant approver resolver module in src/workflow-support/resolve-tenant-creation-approver.js
- [ ] T012 [P] Implement tenant reconciliation planner module in src/workflow-support/reconcile-tenant-creation.js
- [ ] T013 [P] Implement tenant registry persistence helper module in src/workflow-support/persist-tenant-registry-record.js
- [ ] T014 [P] Extend approval gate operation routing for tenant creation in src/workflow-support/approval-gate.js
- [ ] T015 [P] Extend approved execution routing for tenant creation in src/scripts/run-approved-execution.js
- [ ] T016 [P] Extend audit artifact model for tenant fields and registry results in src/workflow-support/build-audit-artifact.js
- [ ] T017 [P] Extend execution summary rendering for tenant operation outcomes in src/scripts/emit-audit-summary.js
- [ ] T018 Add token and permission guard assertions for tenant mutation prerequisites in src/actions/team-creation-policy/index.js, src/actions/team-hierarchy-policy/index.js, and src/actions/team-membership-policy/index.js
- [ ] T019 Add bounded retry and partial-failure handling hooks for tenant operation in src/workflow-support/handle-rate-limit.js and src/scripts/run-approved-execution.js
- [ ] T020 Add durable registry persistence mode env wiring plus fail-fast missing-directory behavior that still emits fallback artifact evidence in .github/workflows/create-tenant-model.yml and src/workflow-support/persist-tenant-registry-record.js

**Checkpoint**: Foundational plumbing is ready for story-by-story implementation.

---

## Phase 3: User Story 1 - Submit and Validate Tenant Bootstrap Requests (Priority: P1) 🎯 MVP

**Goal**: Accept tenant creation intake and validate tenant naming, derived team/slugs, hierarchy preconditions, requester eligibility, and dry-run intent before mutation.

**Independent Test**: Submit valid and invalid tenant requests and verify the workflow reaches awaiting_approval only for valid requests, while invalid requests fail with clear findings and no mutation.

### Tests for User Story 1

- [ ] T021 [P] [US1] Add parser fixture tests for organization, tenant name, designated approver, dry_run, and justification in tests/contract/create-tenant-model-parser-fixture.test.js
- [ ] T022 [P] [US1] Add validation tests for tenant-name normalization and derived team-slug collisions in tests/contract/create-tenant-model-validation.test.js
- [ ] T023 [P] [US1] Add validation tests for missing organization, missing tenant name, and unsafe registry path handling in tests/contract/create-tenant-model-validation.test.js
- [ ] T024 [P] [US1] Add integration test proving dry-run yields reconciliation plan with no mutation in tests/integration/create-tenant-model-request.test.js

### Implementation for User Story 1

- [ ] T025 [P] [US1] Implement issue form fields and constraints for tenant intake in .github/ISSUE_TEMPLATE/create-tenant-model.yml
- [ ] T026 [US1] Implement deterministic tenant key/name and derived team-name generation in src/workflow-support/parse-tenant-creation-request.js
- [ ] T027 [US1] Implement validation for organization visibility, team slug conflicts, re-parent preconditions, and requester eligibility in src/workflow-support/validate-tenant-creation-request.js
- [ ] T028 [US1] Implement dry-run validation and reconciliation-intent reporting in src/workflow-support/validate-tenant-creation-request.js and src/scripts/emit-audit-summary.js
- [ ] T029 [US1] Surface validation findings and no-mutation status in audit artifacts in src/workflow-support/build-audit-artifact.js

**Checkpoint**: User Story 1 is independently functional and testable as MVP.

---

## Phase 4: User Story 2 - Approve Tenant Creation in Central Repo (Priority: P2)

**Goal**: Enforce explicit approval by designated active target-org owner and keep central assignment routing-only.

**Independent Test**: Verify approval by designated active owner unlocks execution while non-owner or non-designated approvals are denied.

### Tests for User Story 2

- [ ] T030 [P] [US2] Add approval-gate tests for designated active-owner approval acceptance in tests/contract/create-tenant-model-validation.test.js and tests/integration/create-tenant-model-request.test.js
- [ ] T031 [P] [US2] Add approval-gate tests for non-owner and non-designated denial outcomes in tests/integration/create-tenant-model-request.test.js
- [ ] T032 [P] [US2] Add tests confirming central issue assignment never implies approval in tests/integration/create-tenant-model-request.test.js
- [ ] T054 [P] [US2] Add explicit missing-token and insufficient-token fail-closed tests in tests/contract/create-tenant-model-validation.test.js and tests/integration/create-tenant-model-request.test.js

### Implementation for User Story 2

- [ ] T033 [P] [US2] Implement approver role resolution against organization membership state in src/workflow-support/resolve-tenant-creation-approver.js
- [ ] T034 [US2] Enforce approval-mode routing and decision notes for tenant operation in src/workflow-support/approval-gate.js
- [ ] T035 [US2] Wire approval-gate outputs for create-tenant-model workflow path in src/scripts/run-approval-gate.js and .github/workflows/create-tenant-model.yml
- [ ] T036 [US2] Emit approval authorization evidence in audit and summary outputs in src/workflow-support/build-audit-artifact.js and src/scripts/emit-audit-summary.js

**Checkpoint**: User Stories 1 and 2 are independently functional and testable.

---

## Phase 5: User Story 3 - Reconcile Tenant Structure and Persist Registry (Priority: P3)

**Goal**: After approval, reconcile team creation/hierarchy/bootstrap idempotently and persist durable per-tenant registry record with partial-failure semantics on persistence failure.

**Independent Test**: Run approved requests for new, partially-existing, and fully-existing tenant states and verify apply/no-op behavior plus blocked or partial status when durable registry persistence fails.

### Tests for User Story 3

- [ ] T037 [P] [US3] Add integration test for full happy-path bootstrap (create teams, link child, requester maintainer, registry created) in tests/integration/create-tenant-model-workflow.test.js
- [ ] T038 [P] [US3] Add integration test for idempotent no-op rerun with existing converged state in tests/integration/create-tenant-model-workflow.test.js
- [ ] T039 [P] [US3] Add integration test for re-parent blocked scenario in tests/integration/create-tenant-model-workflow.test.js
- [ ] T040 [P] [US3] Add integration test for requester promotion from member to maintainer in tests/integration/create-tenant-model-workflow.test.js
- [ ] T041 [P] [US3] Add integration test for durable registry write failure yielding partial/blocking result in tests/integration/create-tenant-model-workflow.test.js
- [ ] T042 [P] [US3] Add integration test for bounded retry and partial-failure reporting under simulated rate-limit conditions in tests/integration/create-tenant-model-workflow.test.js

### Implementation for User Story 3

- [ ] T043 [P] [US3] Implement reconciliation flow for create-missing teams and no-op existing teams in src/workflow-support/reconcile-tenant-creation.js
- [ ] T044 [US3] Implement hierarchy link apply/no-op/reparent-block logic in src/workflow-support/reconcile-tenant-creation.js
- [ ] T045 [US3] Implement requester maintainer add/promote/no-op logic in src/workflow-support/reconcile-tenant-creation.js and src/workflow-support/github-team-api.js
- [ ] T046 [P] [US3] Implement durable per-tenant registry write path and deterministic file naming without runtime folder-creation logic in src/workflow-support/persist-tenant-registry-record.js
- [ ] T047 [US3] Implement registry fallback artifact evidence and blocked/partial final-state semantics in src/scripts/run-approved-execution.js and src/workflow-support/build-execution-outcome.js
- [ ] T048 [US3] Wire tenant execution flow into create-tenant-model workflow shim in .github/workflows/create-tenant-model.yml
- [ ] T049 [US3] Emit per-step mutation/no-op/persistence outcomes and remediation guidance in src/workflow-support/build-audit-artifact.js and src/scripts/emit-audit-summary.js
- [ ] T055 [US3] Implement preferred automated commit-or-PR registry persistence path for tenant records in src/workflow-support/persist-tenant-registry-record.js and src/scripts/run-approved-execution.js
- [ ] T056 [P] [US3] Add integration coverage for preferred commit-or-PR registry persistence path in tests/integration/create-tenant-model-workflow.test.js

**Checkpoint**: All user stories are independently functional and testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening and cross-story consistency for docs, contracts, and regression confidence.

- [ ] T050 [P] Update workflow contract to match implemented fields, transitions, and persistence outcomes in specs/014-create-tenant-model/contracts/create-tenant-model-workflow.yaml
- [ ] T051 [P] Update quickstart runbook with validated happy-path, no-op rerun, and failure remediations in specs/014-create-tenant-model/quickstart.md
- [ ] T052 [P] Add cross-story regression assertions for unauthorized mutation prevention and dry-run no-mutation in tests/integration/create-tenant-model-request.test.js and tests/integration/create-tenant-model-workflow.test.js
- [ ] T053 Run end-to-end feature test suite for tenant creation in tests/contract/create-tenant-model-parser-fixture.test.js, tests/contract/create-tenant-model-validation.test.js, tests/integration/create-tenant-model-request.test.js, and tests/integration/create-tenant-model-workflow.test.js

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1): no dependencies.
- Foundational (Phase 2): depends on Setup and blocks all user stories.
- User Story phases (Phase 3 onward): all depend on Foundational completion.
- Polish (Phase 6): depends on completion of selected user stories.

### User Story Dependencies

- US1 (P1): can begin immediately after Foundational.
- US2 (P2): can begin after Foundational and integrates with US1 parser/validation context.
- US3 (P3): can begin after Foundational and depends on approval outcomes from US2 for execution-path validation.

### Story Completion Order

1. US1 (MVP)
2. US2
3. US3

### Within Each User Story

- Tests must be written first and fail before implementation changes.
- Parser and validation work must precede approval and execution flow updates.
- Approval gates must be enforced before privileged mutation calls.
- Reconciliation and persistence logic must complete before final observability outputs are finalized.

### Parallel Opportunities

- Setup tasks marked [P] can run in parallel.
- Foundational tasks T009-T017 and T019-T020 can run in parallel after T008.
- US1 tests T021-T024 can run in parallel.
- US2 tests T030-T032 and T054 can run in parallel.
- US3 tests T037-T042 and T056 can run in parallel.
- Polish tasks T050-T052 can run in parallel.

---

## Parallel Example: User Story 1

- Task: T021 [US1] in tests/contract/create-tenant-model-parser-fixture.test.js
- Task: T022 [US1] in tests/contract/create-tenant-model-validation.test.js
- Task: T024 [US1] in tests/integration/create-tenant-model-request.test.js

## Parallel Example: User Story 2

- Task: T030 [US2] in tests/contract/create-tenant-model-validation.test.js and tests/integration/create-tenant-model-request.test.js
- Task: T031 [US2] in tests/integration/create-tenant-model-request.test.js
- Task: T032 [US2] in tests/integration/create-tenant-model-request.test.js
- Task: T054 [US2] in tests/contract/create-tenant-model-validation.test.js and tests/integration/create-tenant-model-request.test.js

## Parallel Example: User Story 3

- Task: T037 [US3] in tests/integration/create-tenant-model-workflow.test.js
- Task: T038 [US3] in tests/integration/create-tenant-model-workflow.test.js
- Task: T041 [US3] in tests/integration/create-tenant-model-workflow.test.js
- Task: T056 [US3] in tests/integration/create-tenant-model-workflow.test.js

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 Setup.
2. Complete Phase 2 Foundational prerequisites.
3. Complete Phase 3 (US1).
4. Validate US1 independently before proceeding.

### Incremental Delivery

1. Deliver US1 and verify request parsing/validation and dry-run behavior.
2. Deliver US2 and verify approval gating semantics.
3. Deliver US3 and verify reconciliation, idempotency, and durable registry persistence behavior.
4. Run Phase 6 polish and full regression suite.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. After Foundational completion:
   - Engineer A: US1 implementation and contract tests.
   - Engineer B: US2 approval-gate and authorization paths.
   - Engineer C: US3 reconciliation, persistence, and integration tests.
3. Merge story increments independently after each story-level checkpoint.

---

## Notes

- [P] indicates tasks that can execute concurrently when dependencies are satisfied.
- [US1], [US2], [US3] provide story traceability.
- Suggested MVP scope: through Phase 3 (US1).
- All tasks use explicit file paths and are aligned to repository structure conventions.
