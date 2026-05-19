# Tasks: Add Team Members Bulk CSV Mode

**Input**: Design documents from `/specs/006-add-team-members-bulk-csv-mode/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Tests are required for this feature. Include manual-path non-regression, CSV parser fixture, CSV validation, approval continuity, reconciliation no-op, audit output, and rate-limit coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., [US1], [US2], [US3])
- Include exact file paths in descriptions

## Path Conventions

- **IssueOps repository**: `.github/ISSUE_TEMPLATE/`, `.github/workflows/`, `src/`, `tests/`, `specs/`
- Paths below follow the structure defined in `specs/006-add-team-members-bulk-csv-mode/plan.md`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the existing add-team-members slice for a bulk CSV enhancement without creating a parallel workflow.

- [X] T001 Create bulk CSV test fixture scaffolding in `tests/fixtures/add-team-members-bulk-csv-issue.md`, `tests/contract/add-team-members-bulk-csv-parser-fixture.test.js`, `tests/contract/add-team-members-bulk-csv-validation.test.js`, and `tests/integration/add-team-members-bulk-csv-request.test.js`
- [X] T002 Update feature contract and operator walkthrough scaffolding in `specs/006-add-team-members-bulk-csv-mode/contracts/add-team-members-bulk-csv-workflow.yaml` and `specs/006-add-team-members-bulk-csv-mode/quickstart.md`
- [X] T003 [P] Confirm workflow lint and runtime assumptions for the touched add-team-members surfaces in `.github/workflows/lint-workflows.yml` and `.github/workflows/add-team-members.yml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement the shared CSV intake and audit primitives that all user stories rely on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Guardrail Tests Before Foundational Changes ⚠️

> **NOTE: Write these tests FIRST and confirm they fail before changing the shared parser, validator, workflow, or summary surfaces in this phase.**

- [X] T034 [P] Add foundational manual-path parser and validation guardrail coverage in `tests/contract/add-team-members-parser-fixture.test.js` and `tests/fixtures/add-team-members-issue.md`
- [X] T035 [P] Add foundational manual-path workflow and approval-ready guardrail coverage in `tests/integration/add-team-members-request.test.js` and `tests/integration/add-team-members-approval.test.js`

- [X] T004 Create the shared CSV normalization helper in `src/workflow-support/normalize-bulk-csv-requested-people.js`
- [X] T005 [P] Extend the normalized request model for `intake_mode`, `bulk_csv_input`, and row findings in `src/workflow-support/parse-team-membership-request.js`
- [X] T006 [P] Extend validation primitives for mutually exclusive intake modes and row-level CSV findings in `src/workflow-support/validate-team-membership-request.js`
- [X] T007 [P] Extend structured audit and execution artifact primitives for intake-mode metadata and CSV findings in `src/workflow-support/build-audit-artifact.js` and `src/workflow-support/build-execution-outcome.js`
- [X] T008 Wire parsed bulk CSV form output into the validation runner in `.github/workflows/add-team-members.yml` and `src/scripts/run-request-validation.js`
- [X] T009 Extend requester-facing summary primitives for CSV validation and execution status in `src/scripts/emit-audit-summary.js`

**Checkpoint**: Shared CSV intake, validation, and audit foundations are ready; user-story work can proceed.

---

## Phase 3: User Story 1 - Preserve Existing Manual Requests (Priority: P1) 🎯 MVP

**Goal**: Keep the existing manual `requested_people` path behaviorally equivalent to feature `001-add-team-members` after the bulk CSV enhancement is introduced.

**Independent Test**: Submit a manual add-team-members request without using the CSV textarea and confirm validation, approval gating, reconciliation, and reporting remain equivalent to the baseline workflow.

### Tests for User Story 1 ⚠️

- [X] T010 [P] [US1] Complete User Story 1 manual non-regression coverage for requester-facing summaries and post-foundation compatibility in `tests/contract/add-team-members-parser-fixture.test.js` and `tests/fixtures/add-team-members-issue.md`
- [X] T011 [P] [US1] Complete User Story 1 manual-path integration coverage for approval-ready no-mutation behavior after the CSV foundation changes in `tests/integration/add-team-members-request.test.js` and `tests/integration/add-team-members-approval.test.js`
- [X] T033 [P] [US1] Add contract-level approval continuity coverage for manual and CSV-compatible approval expectations in `tests/contract/add-team-members-approval-policy.test.js`

### Implementation for User Story 1

- [X] T012 [P] [US1] Update manual-path guidance while keeping `requested_people` available in `.github/ISSUE_TEMPLATE/add-team-members.yml`
- [X] T013 [US1] Preserve manual-mode default parsing and normalized request output in `src/workflow-support/parse-team-membership-request.js`
- [X] T014 [US1] Preserve manual-mode validation and approval-ready artifact behavior in `src/workflow-support/validate-team-membership-request.js` and `src/workflow-support/build-audit-artifact.js`
- [X] T015 [US1] Preserve manual-mode workflow summary and validation runner behavior in `.github/workflows/add-team-members.yml` and `src/scripts/emit-audit-summary.js`

**Checkpoint**: User Story 1 is independently testable as a non-regressed manual request flow.

---

## Phase 4: User Story 2 - Submit High-Volume Membership Requests with Bulk CSV (Priority: P2)

**Goal**: Let requesters submit a valid bulk CSV payload that becomes approval-ready after header, row, and username validation.

**Independent Test**: Submit a request using only the bulk CSV textarea with a valid `username` header and multiple rows; confirm the workflow normalizes the rows, reports duplicates safely, and stops in an approval-ready state.

### Tests for User Story 2 ⚠️

- [X] T016 [P] [US2] Add CSV parser fixture coverage for valid header-based submissions in `tests/contract/add-team-members-bulk-csv-parser-fixture.test.js` and `tests/fixtures/add-team-members-bulk-csv-issue.md`
- [X] T017 [P] [US2] Add CSV validation coverage for missing headers, malformed rows, duplicate rows, blank rows, and dual-input rejection in `tests/contract/add-team-members-bulk-csv-validation.test.js`

### Implementation for User Story 2

- [X] T018 [P] [US2] Update `.github/ISSUE_TEMPLATE/add-team-members.yml` so `requested_people` and `bulk_csv_requested_people` are both form-optional, add the `bulk_csv_requested_people` textarea, and document that validation enforces exactly one populated intake mode
- [X] T019 [US2] Implement header-aware CSV parsing, duplicate detection, and row finding generation in `src/workflow-support/normalize-bulk-csv-requested-people.js`
- [X] T020 [US2] Integrate CSV intake selection and normalized people output in `src/workflow-support/parse-team-membership-request.js`
- [X] T021 [US2] Enforce CSV schema validation, exactly-one-intake-mode rules, and row-level findings in `src/workflow-support/validate-team-membership-request.js` and `src/scripts/run-request-validation.js`
- [X] T022 [US2] Surface CSV validation findings to requesters and reviewers in `src/workflow-support/build-audit-artifact.js` and `src/scripts/emit-audit-summary.js`

**Checkpoint**: User Stories 1 and 2 support both manual and CSV approval-ready request intake paths independently.

---

## Phase 5: User Story 3 - Execute CSV-Driven Requests with Existing Approval and Reconciliation Rules (Priority: P3)

**Goal**: Ensure approved CSV-driven requests reuse the existing approval, reconciliation, no-op, partial-failure, and audit flow without changing downstream mutation semantics.

**Independent Test**: Approve a valid CSV-driven request where some users are already members and verify that only missing users are added, reruns remain no-op, and CSV-specific findings remain visible in the final audit output.

### Tests for User Story 3 ⚠️

- [X] T023 [P] [US3] Add approved CSV request integration coverage in `tests/integration/add-team-members-bulk-csv-request.test.js`
- [X] T024 [P] [US3] Extend rerun, no-op, partial-failure, and rate-limit coverage for CSV-derived requests in `tests/integration/add-team-members-workflow.test.js` and `tests/contract/reconcile-team-members-contract.test.js`

### Implementation for User Story 3

- [X] T025 [P] [US3] Propagate `intake_mode` and CSV row provenance through reconciliation planning in `src/workflow-support/reconcile-team-members.js` and `src/workflow-support/parse-team-membership-request.js`
- [X] T026 [US3] Preserve approved execution semantics for CSV-derived requested people in `.github/workflows/add-team-members.yml` and `src/scripts/run-approved-execution.js`
- [X] T027 [US3] Extend execution outcomes and final summaries for CSV duplicates, invalid-row counts, and approved reruns in `src/workflow-support/build-execution-outcome.js` and `src/scripts/emit-audit-summary.js`
- [X] T028 [US3] Preserve approval-gate and audit-artifact continuity for CSV requests in `src/scripts/run-approval-gate.js` and `src/workflow-support/build-audit-artifact.js`

**Checkpoint**: All user stories are independently testable and CSV-driven execution matches the existing approval-gated reconciliation path.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Harden reuse, documentation, and regression coverage across manual and CSV paths.

- [X] T029 [P] Update operator walkthrough and contract details in `specs/006-add-team-members-bulk-csv-mode/quickstart.md` and `specs/006-add-team-members-bulk-csv-mode/contracts/add-team-members-bulk-csv-workflow.yaml`
- [X] T030 Refactor shared username normalization reuse between `src/workflow-support/normalize-requested-people.js` and `src/workflow-support/normalize-bulk-csv-requested-people.js`
- [X] T031 [P] Add regression coverage for ambiguous intake, quoted usernames, and blank CSV rows in `tests/contract/add-team-members-bulk-csv-validation.test.js` and `tests/integration/add-team-members-request.test.js`
- [X] T032 Run quickstart-aligned end-to-end validation for manual and CSV flows in `tests/integration/add-team-members-request.test.js`, `tests/integration/add-team-members-bulk-csv-request.test.js`, and `tests/integration/add-team-members-workflow.test.js`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion.
- **User Story 2 (Phase 4)**: Depends on Foundational completion and can proceed after manual-path compatibility scaffolding is in place.
- **User Story 3 (Phase 5)**: Depends on User Story 2 because approved execution must consume the CSV-derived request model.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: First deliverable and MVP slice; proves there is no regression in the existing manual path.
- **User Story 2 (P2)**: Builds on the shared CSV intake and validation foundations but should be independently testable without executing mutations.
- **User Story 3 (P3)**: Builds on the validated CSV request path from US2 and reuses the approved execution flow.

### Within Each User Story

- Tests MUST be written and fail before implementation.
- Issue-form and parser contract work come before workflow mutation or summary wiring.
- Validation rules come before approval-ready or execution-ready behavior.
- Reconciliation planning comes before mutation and final audit output wiring.
- Story-specific observability updates must land before the story is considered complete.

### Foundational Sequencing Rule

- `T034` and `T035` MUST fail before `T004` through `T009` begin because those foundational tasks change the shared parser, validator, workflow, and summary surfaces that protect the existing manual path.

### Parallel Opportunities

- `T003` can run in parallel with `T001` and `T002` during Setup.
- `T034` and `T035` can run in parallel before the Foundational implementation tasks start.
- `T005`, `T006`, and `T007` can run in parallel within the Foundational phase after `T034` and `T035` are in place.
- `T010`, `T011`, and `T033` can run in parallel for US1 regression and approval-policy test authoring.
- `T016` and `T017` can run in parallel for US2 CSV test authoring.
- `T023` and `T024` can run in parallel for US3 execution coverage.
- `T029` and `T031` can run in parallel during the Polish phase.

---

## Parallel Example: User Story 2

```bash
# Write the CSV intake tests together:
Task: "Add CSV parser fixture coverage in tests/contract/add-team-members-bulk-csv-parser-fixture.test.js and tests/fixtures/add-team-members-bulk-csv-issue.md"
Task: "Add CSV validation coverage in tests/contract/add-team-members-bulk-csv-validation.test.js"

# Implement independent CSV intake surfaces together:
Task: "Update .github/ISSUE_TEMPLATE/add-team-members.yml so requested_people and bulk_csv_requested_people are both form-optional and bulk_csv_requested_people is available"
Task: "Implement header-aware CSV parsing in src/workflow-support/normalize-bulk-csv-requested-people.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Write and fail the foundational guardrail tests in Phase 2.
3. Complete the remaining Foundational tasks in Phase 2.
4. Complete Phase 3: User Story 1.
5. **STOP and VALIDATE**: Confirm the manual add-team-members path remains behaviorally equivalent to feature `001-add-team-members`.
6. Demo the non-regression slice before introducing CSV-specific behavior.

### Incremental Delivery

1. Finish Setup and Foundational work to establish shared CSV intake, validation, and audit primitives.
2. Deliver User Story 1 to prove manual-path compatibility.
3. Add User Story 2 to enable approval-ready bulk CSV intake.
4. Add User Story 3 to reuse approved execution and reconciliation for CSV-derived requests.
5. Finish with cross-cutting regression, documentation, and end-to-end validation.

### Parallel Team Strategy

1. One developer handles issue-form and workflow shim updates.
2. One developer handles parser, validator, and CSV normalization modules.
3. One developer handles integration coverage, approved execution, and summary output once the normalized request model stabilizes.

---

## Notes

- [P] tasks touch different files and can be run in parallel.
- Every user story includes explicit testing, validation, observability, and reconciliation work where relevant.
- File paths are intentionally concrete so the task list is directly executable.
- Suggested MVP scope: Phase 1 + Phase 2 + Phase 3 (User Story 1 only).
