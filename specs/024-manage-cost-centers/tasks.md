# Tasks: Manage Cost Centers IssueOps Workflow

**Input**: Design documents from `/specs/024-manage-cost-centers/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Tests are required for this feature. Include CSV parser and fixture coverage, per-row validation coverage, full validate/approve/execute coverage, denied-approver coverage, dry-run no-mutation coverage, fail-soft coverage, and policy-guard coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the issue form, workflow shim, the cost-center REST client, and contract baselines.

- [x] T001 Add manage-cost-centers issue form with enterprise, designated_approver, cost_centers (render csv), dry_run, and justification in .github/ISSUE_TEMPLATE/manage-cost-centers.yml
- [x] T002 Add manage-cost-centers workflow shim with issue context, parser, validation, approval, label, execution, and upload steps in .github/workflows/manage-cost-centers.yml
- [x] T003 [P] Implement the dependency-free enterprise cost-center REST client in src/workflow-support/github-cost-center-billing-api.js
- [x] T004 [P] Add parser/fixture contract test scaffolding in tests/contract/manage-cost-centers-parser-fixture.test.js
- [x] T005 [P] Add validation contract test scaffolding in tests/contract/manage-cost-centers-validation.test.js
- [x] T006 [P] Add integration test scaffolding in tests/integration/manage-cost-centers-workflow.test.js
- [x] T007 [P] Validate and update the workflow contract in specs/024-manage-cost-centers/contracts/manage-cost-centers-workflow.yaml

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement CSV parsing, the audit-artifact builder, the summary emitter, the approver resolver, and the mutation policy guard required before any user story work.

**CRITICAL**: No user story implementation starts until this phase is complete.

- [x] T008 Implement CSV parsing (code-fence unwrap, quoted fields, dedup, 1-based data rows) and request envelope in src/workflow-support/parse-manage-cost-centers-request.js
- [x] T009 [P] Implement the standalone audit-artifact builder in src/workflow-support/build-manage-cost-centers-artifact.js
- [x] T010 [P] Implement the human-readable summary emitter with the per-row outcome table in src/scripts/emit-manage-cost-centers-summary.js
- [x] T011 [P] Implement the designated-approver resolver in src/workflow-support/resolve-manage-cost-centers-approver.js
- [x] T012 [P] Implement the mutation policy guard assertCostCenterMutationAllowed in src/actions/manage-cost-centers-policy/index.js

**Checkpoint**: Foundational plumbing is ready for story-by-story implementation.

---

## Phase 3: User Story 1 - Validate a Cost-Center Change Spreadsheet (Priority: P1) 🎯 MVP

**Goal**: Parse the spreadsheet, classify every row, reject what cannot be applied, and produce an approval-ready plan with no mutation.

**Independent Test**: Submit valid and invalid spreadsheets and verify a per-row plan with structural failures sinking the whole request and per-row rejections sinking only their own rows.

### Tests for User Story 1

- [x] T013 [P] [US1] Add parser tests for quoted fields, code-fence unwrap, dedup, and dry_run defaulting in tests/contract/manage-cost-centers-parser-fixture.test.js
- [x] T014 [P] [US1] Add validation tests for create/rename/delete classification, create-existing noop, delete-missing noop, and rename-to-current noop in tests/contract/manage-cost-centers-validation.test.js
- [x] T015 [P] [US1] Add validation tests for ambiguous name, id disambiguation, name_taken, blocked delete with and without force, invalid action, missing fields, conflicting rows, and structural failures in tests/contract/manage-cost-centers-validation.test.js
- [x] T016 [P] [US1] Add validation test for the fail-soft unverified, approval-ready plan with no live access in tests/contract/manage-cost-centers-validation.test.js

### Implementation for User Story 1

- [x] T017 [US1] Implement per-row validation, target resolution by id then name, cross-row conflict detection, and fail-soft unverified mode in src/workflow-support/validate-manage-cost-centers-request.js
- [x] T018 [US1] Implement the deterministic create-rename-delete reconciliation plan with no_rows blocking in src/workflow-support/reconcile-manage-cost-centers-changes.js
- [x] T019 [US1] Implement the validation runner with optional live access and artifact emission in src/scripts/run-manage-cost-centers-validation.js

**Checkpoint**: User Story 1 is independently functional and testable as MVP.

---

## Phase 4: User Story 2 - Approve Cost-Center Changes Through the Designated Approver (Priority: P2)

**Goal**: Accept `approved` only from the designated approver and block execution otherwise.

**Independent Test**: Post `approved` from the designated approver and from other accounts and verify only the designated approver unlocks execution.

### Tests for User Story 2

- [x] T020 [P] [US2] Add integration test proving a non-designated approver is denied in tests/integration/manage-cost-centers-workflow.test.js
- [x] T021 [P] [US2] Add integration test proving the policy guard blocks execution without a PAT-backed token in tests/integration/manage-cost-centers-workflow.test.js

### Implementation for User Story 2

- [x] T022 [US2] Implement the approval runner that reads the latest approval comment and binds approval to the designated approver in src/scripts/run-manage-cost-centers-approval.js
- [x] T023 [US2] Wire the approval-status execution gate and terminal-label ensure step in .github/workflows/manage-cost-centers.yml

**Checkpoint**: User Stories 1 and 2 are independently functional and testable.

---

## Phase 5: User Story 3 - Execute Cost-Center Changes Idempotently (Priority: P3)

**Goal**: After approval, re-validate against live state, apply creates then renames then deletes with bounded retry, and report a terminal status.

**Independent Test**: Run approved requests against missing, existing, and already satisfied cost centers and verify created/renamed/deleted/noop/failed outcomes and idempotent re-runs.

### Tests for User Story 3

- [x] T024 [P] [US3] Add integration test for the full validate/approve/execute flow applying create, rename, and delete while skipping blocked rows in tests/integration/manage-cost-centers-workflow.test.js
- [x] T025 [P] [US3] Add integration test for dry-run approved execution making no mutation in tests/integration/manage-cost-centers-workflow.test.js

### Implementation for User Story 3

- [x] T026 [US3] Implement the execution runner with live re-validation, deterministic mutation order, bounded retry, failure classification, terminal status, and label application in src/scripts/run-manage-cost-centers-execution.js
- [x] T027 [US3] Wire the approved-execution step and audit-artifact upload in .github/workflows/manage-cost-centers.yml

**Checkpoint**: All user stories are independently functional and testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize documentation, contracts, and the full regression suite.

- [x] T028 [P] Update the workflow contract to match implemented fields, lifecycle states, and API endpoints in specs/024-manage-cost-centers/contracts/manage-cost-centers-workflow.yaml
- [x] T029 [P] Update the quickstart runbook with happy-path, blocked-delete-plus-force, ambiguous-name, rename-collision, dry-run, denied-approval, and fail-soft scenarios in specs/024-manage-cost-centers/quickstart.md
- [x] T030 Run the full feature suite with node --test across tests/contract/manage-cost-centers-parser-fixture.test.js, tests/contract/manage-cost-centers-validation.test.js, and tests/integration/manage-cost-centers-workflow.test.js

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1): no dependencies.
- Foundational (Phase 2): depends on Setup and blocks all user stories.
- User Story phases (Phase 3 onward): all depend on Foundational completion.
- Polish (Phase 6): depends on completion of selected user stories.

### User Story Dependencies

- US1 (P1): can begin immediately after Foundational.
- US2 (P2): can begin after Foundational and depends on US1 validation outputs.
- US3 (P3): can begin after Foundational and depends on US2 approval outcomes plus US1 reconciliation plan.

### Story Completion Order

1. US1 (MVP)
2. US2
3. US3

### Within Each User Story

- Tests must be written first and fail before implementation changes.
- Parsing and validation must precede approval and execution flow updates.
- The approval gate must be enforced before privileged mutation calls.
- Reconciliation and execution-outcome logic must complete before final observability outputs are finalized.

### Parallel Opportunities

- Setup tasks T003-T007 can run in parallel.
- Foundational tasks T009-T012 can run in parallel after T008.
- US1 tests T013-T016 can run in parallel.
- US2 tests T020-T021 can run in parallel.
- US3 tests T024-T025 can run in parallel.
- Polish tasks T028-T029 can run in parallel.

---

## Parallel Example: User Story 1

- Task: T013 [US1] in tests/contract/manage-cost-centers-parser-fixture.test.js
- Task: T014 [US1] in tests/contract/manage-cost-centers-validation.test.js
- Task: T017 [US1] in src/workflow-support/validate-manage-cost-centers-request.js

## Parallel Example: User Story 2

- Task: T020 [US2] in tests/integration/manage-cost-centers-workflow.test.js
- Task: T021 [US2] in tests/integration/manage-cost-centers-workflow.test.js
- Task: T022 [US2] in src/scripts/run-manage-cost-centers-approval.js

## Parallel Example: User Story 3

- Task: T024 [US3] in tests/integration/manage-cost-centers-workflow.test.js
- Task: T025 [US3] in tests/integration/manage-cost-centers-workflow.test.js
- Task: T026 [US3] in src/scripts/run-manage-cost-centers-execution.js

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 Setup.
2. Complete Phase 2 Foundational prerequisites.
3. Complete Phase 3 (US1).
4. Validate US1 independently before proceeding.

### Incremental Delivery

1. Deliver US1 and verify CSV parsing, per-row classification, fail-soft, and dry-run no-mutation behavior.
2. Deliver US2 and verify the designated-approver gate.
3. Deliver US3 and verify idempotent execution and partial-failure handling.
4. Run Phase 6 polish and the full regression suite.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. After Foundational completion:
   - Engineer A: US1 CSV parsing, validation, and reconciliation plus contract tests.
   - Engineer B: US2 approver resolution, approval runner, and policy guard.
   - Engineer C: US3 execution runner, REST client wiring, and integration tests.
3. Merge story increments independently after each story checkpoint.

---

## Notes

- [P] indicates tasks that can execute concurrently when dependencies are satisfied.
- [US1], [US2], [US3] provide story traceability.
- Suggested MVP scope: through Phase 3 (US1).
- All tasks use explicit file paths and are aligned to repository structure conventions.
- This feature is a standalone workflow and does not modify the org/team operation dispatcher.
