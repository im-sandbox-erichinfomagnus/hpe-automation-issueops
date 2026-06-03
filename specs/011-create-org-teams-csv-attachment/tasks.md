# Tasks: Create Organization Teams CSV Attachment Intake

**Input**: Design documents from `/specs/011-create-org-teams-csv-attachment/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Tests are required for this feature. Include manual-path non-regression, waiting-for-attachment handling, attachment discovery and provenance validation, intended-owner approval continuity, reconciliation no-op behavior, terminal-state ignore behavior, audit output, dry-run preservation, and rate-limit coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., [US1], [US2], [US3])
- Include exact file paths in descriptions

## Path Conventions

- **IssueOps repository**: `.github/ISSUE_TEMPLATE/`, `.github/workflows/`, `src/`, `tests/`, `specs/`
- Paths below follow the structure defined in `specs/011-create-org-teams-csv-attachment/plan.md`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the existing create-org-teams workflow slice for attachment-based CSV intake without creating a parallel workflow.

- [X] T001 Create attachment-request fixture scaffolding in `tests/fixtures/create-org-teams-csv-attachment-issue.md`, `tests/fixtures/create-org-teams-csv-attachment-comments.json`, `tests/contract/create-org-teams-csv-attachment-parser-fixture.test.js`, `tests/contract/create-org-teams-csv-attachment-validation.test.js`, and `tests/integration/create-org-teams-csv-attachment-request.test.js`
- [X] T002 Create initial attachment contract and operator walkthrough scaffolding in `specs/011-create-org-teams-csv-attachment/contracts/create-org-teams-csv-attachment-workflow.yaml` and `specs/011-create-org-teams-csv-attachment/quickstart.md`
- [X] T003 [P] Confirm workflow lint, runtime, and issue-comment trigger assumptions in `.github/workflows/lint-workflows.yml` and `.github/workflows/create-org-teams.yml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement the shared attachment intake, validation, and observability primitives required by all user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Guardrail Tests Before Foundational Changes ⚠️

> **NOTE: Write these tests FIRST and confirm they fail before changing the shared parser, validator, workflow, or summary surfaces in this phase.**

- [X] T004 [P] Add foundational manual-path parser and validation guardrail coverage in `tests/contract/create-org-teams-parser-fixture.test.js` and `tests/fixtures/create-org-teams-issue.md`
- [X] T005 [P] Add foundational manual-path workflow and approval guardrail coverage in `tests/integration/create-org-teams-request.test.js` and `tests/integration/create-org-teams-approval.test.js`
- [X] T006 Create shared attachment-comment fixture coverage for waiting, valid, invalid, and superseded attempts in `tests/fixtures/create-org-teams-csv-attachment-issue.md` and `tests/fixtures/create-org-teams-csv-attachment-comments.json`
- [X] T007 [P] Create requester-comment attachment discovery primitives in `src/workflow-support/resolve-csv-attachment-comment.js`
- [X] T008 [P] Create attachment download, UTF-8 decode, size-cap, and hashing helpers in `src/workflow-support/download-csv-attachment.js` and `src/workflow-support/hash-attachment-content.js`
- [X] T009 [P] Extend the normalized request model for `intake_mode`, waiting-for-attachment state, and accepted attachment metadata in `src/workflow-support/parse-team-creation-request.js`
- [X] T010 [P] Extend validation and audit-artifact primitives for attachment lifecycle findings in `src/workflow-support/validate-team-creation-request.js` and `src/workflow-support/build-audit-artifact.js`
- [X] T011 Extend execution-outcome and requester-facing summary primitives for waiting, blocking, and provenance states in `src/workflow-support/build-execution-outcome.js` and `src/scripts/emit-audit-summary.js`
- [X] T012 Wire issue-comment attachment context into validation entrypoints in `.github/workflows/create-org-teams.yml` and `src/scripts/run-request-validation.js`
- [X] T013 Preserve dry-run behavior for attachment intake and approved execution in `.github/workflows/create-org-teams.yml`, `src/scripts/run-request-validation.js`, and `src/scripts/run-approved-execution.js`
- [X] T014 Integrate bounded backoff-and-retry rate-limit handling for issue reads, attachment download, validation, reconciliation, and safe stop-before-mutation reporting in `src/workflow-support/handle-rate-limit.js`, `src/workflow-support/download-csv-attachment.js`, `src/scripts/run-request-validation.js`, and `src/scripts/run-approved-execution.js`

**Checkpoint**: Shared attachment intake, validation, and audit foundations are ready; user-story work can proceed.

---

## Phase 3: User Story 1 - Preserve Manual Requests and Hold Attachment Requests Safely (Priority: P1) 🎯 MVP

**Goal**: Keep the existing manual `requested_team_names` path behaviorally equivalent to feature `003` while placing `csv_attachment` requests into a safe waiting-for-attachment state.

**Independent Test**: Submit one manual request and one `csv_attachment` request, then confirm the manual request behaves as before and the attachment-driven request remains blocked in a waiting-for-attachment state without approval readiness or team creation.

### Tests for User Story 1 ⚠️

- [X] T015 [P] [US1] Complete manual non-regression and intake-selector parser coverage in `tests/contract/create-org-teams-parser-fixture.test.js` and `tests/fixtures/create-org-teams-issue.md`
- [X] T016 [P] [US1] Add waiting-for-attachment request integration coverage in `tests/integration/create-org-teams-request.test.js` and `tests/integration/create-org-teams-approval.test.js`
- [X] T017 [P] [US1] Add approval-policy coverage that waiting attachment requests never become approval-ready in `tests/contract/create-org-teams-approval-policy.test.js`

### Implementation for User Story 1

- [X] T018 [P] [US1] Update the issue form for `manual` versus `csv_attachment` selection and remove the textarea bulk CSV path in `.github/ISSUE_TEMPLATE/create-org-teams.yml`
- [X] T019 [US1] Preserve manual normalization and derive `waiting_for_attachment` request state in `src/workflow-support/parse-team-creation-request.js`
- [X] T020 [US1] Enforce exactly-one-intake-mode and waiting-state validation behavior in `src/workflow-support/validate-team-creation-request.js` and `src/scripts/run-request-validation.js`
- [X] T021 [US1] Surface waiting-for-attachment and manual-path continuity in `src/workflow-support/build-audit-artifact.js`, `src/workflow-support/build-execution-outcome.js`, and `src/scripts/emit-audit-summary.js`

**Checkpoint**: User Story 1 is independently testable as a non-regressed manual request flow plus safe attachment waiting state.

---

## Phase 4: User Story 2 - Submit and Correct High-Volume Team Creation Requests Through CSV Attachments (Priority: P2)

**Goal**: Let requesters supply large team-creation batches through requester-authored CSV attachment comments with deterministic validation, provenance capture, and corrected later-comment retry behavior.

**Independent Test**: Submit a `csv_attachment` request, validate acceptance of one requester-authored CSV attachment comment, observe row-level findings for invalid content, then post a corrected later attachment comment and confirm the newer eligible comment supersedes the failed attempt.

### Tests for User Story 2 ⚠️

- [X] T022 [P] [US2] Add attachment discovery and parser-fixture coverage in `tests/contract/create-org-teams-csv-attachment-parser-fixture.test.js` and `tests/fixtures/create-org-teams-csv-attachment-comments.json`
- [X] T023 [P] [US2] Add attachment validation coverage for non-requester, ambiguous, non-CSV, oversized, download-failure, and UTF-8 decode-failure cases in `tests/contract/create-org-teams-csv-attachment-validation.test.js`
- [X] T024 [P] [US2] Add invalid-then-corrected attachment integration coverage in `tests/integration/create-org-teams-csv-attachment-request.test.js`

### Implementation for User Story 2

- [X] T025 [P] [US2] Implement requester-only attachment discovery and deterministic active-candidate selection in `src/workflow-support/resolve-csv-attachment-comment.js`
- [X] T026 [P] [US2] Implement CSV attachment download, bounded size enforcement, UTF-8 decoding, and content hashing in `src/workflow-support/download-csv-attachment.js` and `src/workflow-support/hash-attachment-content.js`
- [X] T027 [US2] Reuse bulk CSV team normalization for attachment content in `src/workflow-support/normalize-bulk-csv-requested-teams.js` and `src/workflow-support/parse-team-creation-request.js`
- [X] T028 [US2] Enforce invalid CSV correction boundaries and newest-eligible-comment selection in `src/workflow-support/validate-team-creation-request.js` and `src/scripts/run-request-validation.js`
- [X] T029 [US2] Surface attachment provenance, linked-URL discovery-source evidence, row findings, duplicate and invalid counts, and blocking reasons in `src/workflow-support/build-audit-artifact.js` and `src/scripts/emit-audit-summary.js`

**Checkpoint**: User Stories 1 and 2 support both manual and attachment-driven approval-ready intake paths independently.

---

## Phase 5: User Story 3 - Execute Validated Attachment-Driven Requests with Existing Approval and Reconciliation Rules (Priority: P3)

**Goal**: Ensure approved attachment-driven requests reuse the existing approval, reconciliation, no-op, rerun, and audit flow without allowing later attachment comments to reopen completed execution.

**Independent Test**: Approve a valid attachment-driven request where some teams already exist, verify that only missing teams are created and reruns remain no-op, then post another attachment comment after execution and confirm the request does not re-enter validation or execution.

### Tests for User Story 3 ⚠️

- [X] T030 [P] [US3] Add approved attachment-driven request execution coverage in `tests/integration/create-org-teams-csv-attachment-request.test.js`
- [X] T031 [P] [US3] Extend rerun, no-op, partial-failure, dry-run, and post-terminal-state ignore coverage in `tests/integration/create-org-teams-workflow.test.js` and `tests/integration/create-org-teams-approval.test.js`

### Implementation for User Story 3

- [X] T032 [P] [US3] Propagate accepted attachment metadata and source-row provenance through reconciliation planning in `src/workflow-support/reconcile-team-creation.js` and `src/workflow-support/parse-team-creation-request.js`
- [X] T033 [US3] Preserve approval-gate behavior and terminal-state ignore handling for attachment requests, including fresh-runner restore of persisted request state, in `src/scripts/run-approval-gate.js`, `src/workflow-support/approval-gate.js`, and `src/scripts/restore-request-audit-artifact.js`
- [X] T034 [US3] Reuse approved execution semantics for attachment-derived requested teams in `.github/workflows/create-org-teams.yml`, `src/scripts/run-approved-execution.js`, and `src/workflow-support/build-execution-outcome.js`
- [X] T035 [US3] Add per-team created-or-not-created recording, compensating recovery guidance, and operator follow-up handling for partial attachment-driven failures in `src/scripts/run-approved-execution.js`, `src/workflow-support/build-execution-outcome.js`, and `src/scripts/emit-audit-summary.js`

**Checkpoint**: All user stories are independently testable and attachment-driven execution matches the existing approval-gated reconciliation path.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Harden shared behavior, documentation, and regression coverage across manual and attachment-driven paths.

- [X] T036 [P] Update operator walkthrough and contract details for implemented attachment behavior in `specs/011-create-org-teams-csv-attachment/quickstart.md` and `specs/011-create-org-teams-csv-attachment/contracts/create-org-teams-csv-attachment-workflow.yaml`
- [X] T037 Refactor shared team-name normalization and attachment-validation reuse in `src/workflow-support/normalize-requested-teams.js`, `src/workflow-support/normalize-bulk-csv-requested-teams.js`, and `src/workflow-support/validate-team-creation-request.js`
- [X] T038 [P] Add regression coverage for size-cap handling, UTF-8 decode failures, ambiguous attachment links, dry-run preservation, bounded retry behavior, rate-limit partial-result reporting, and retry-required outcomes in `tests/contract/create-org-teams-csv-attachment-validation.test.js` and `tests/integration/create-org-teams-workflow.test.js`
- [X] T039 Run quickstart-aligned end-to-end validation for `manual` and `csv_attachment` flows in `tests/integration/create-org-teams-request.test.js`, `tests/integration/create-org-teams-csv-attachment-request.test.js`, and `tests/integration/create-org-teams-workflow.test.js`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion.
- **User Story 2 (Phase 4)**: Depends on Foundational completion and can proceed after the waiting-state foundation is in place.
- **User Story 3 (Phase 5)**: Depends on User Story 2 because approved execution must consume the accepted attachment-derived request model.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: First deliverable and MVP slice; proves manual non-regression and safe blocked handling for attachment requests.
- **User Story 2 (P2)**: Builds on the shared attachment discovery and validation foundation but should be independently testable before approval or mutation.
- **User Story 3 (P3)**: Builds on the validated attachment request path from US2 and reuses the approved execution flow.

### Within Each User Story

- Tests MUST be written and fail before implementation.
- Issue-form and parser contract work come before workflow mutation or summary wiring.
- Attachment discovery and provenance checks come before approval-ready behavior.
- Validation rules come before approval-gate or execution behavior.
- Reconciliation planning comes before mutation and final audit output wiring.
- Story-specific observability updates must land before the story is considered complete.

### Foundational Sequencing Rule

- `T004` and `T005` MUST fail before `T006` through `T014` begin because those foundational tasks change the shared parser, validator, workflow, dry-run, and rate-limit surfaces that protect the existing manual path.

### Parallel Opportunities

- `T003` can run in parallel with `T001` and `T002` during Setup.
- `T004` and `T005` can run in parallel before the Foundational implementation tasks start.
- `T007`, `T008`, `T009`, `T010`, `T013`, and `T014` can run in parallel within the Foundational phase after the guardrail tests are in place.
- `T015`, `T016`, and `T017` can run in parallel for US1 regression and approval-policy test authoring.
- `T022`, `T023`, and `T024` can run in parallel for US2 attachment-intake test authoring.
- `T030` and `T031` can run in parallel for US3 execution and terminal-state coverage.
- `T036` and `T038` can run in parallel during the Polish phase.

---

## Parallel Example: User Story 2

```bash
# Write the attachment intake tests together:
Task: "Add attachment discovery and parser-fixture coverage in tests/contract/create-org-teams-csv-attachment-parser-fixture.test.js and tests/fixtures/create-org-teams-csv-attachment-comments.json"
Task: "Add attachment validation coverage for non-requester, ambiguous, non-CSV, oversized, download-failure, and UTF-8 decode-failure cases in tests/contract/create-org-teams-csv-attachment-validation.test.js"
Task: "Add invalid-then-corrected attachment integration coverage in tests/integration/create-org-teams-csv-attachment-request.test.js"

# Implement independent attachment primitives together:
Task: "Implement requester-only attachment discovery and deterministic active-candidate selection in src/workflow-support/resolve-csv-attachment-comment.js"
Task: "Implement CSV attachment download, bounded size enforcement, UTF-8 decoding, and content hashing in src/workflow-support/download-csv-attachment.js and src/workflow-support/hash-attachment-content.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Write and fail the foundational guardrail tests in Phase 2.
3. Complete the remaining Foundational tasks in Phase 2.
4. Complete Phase 3: User Story 1.
5. **STOP and VALIDATE**: Confirm the manual create-org-teams path remains behaviorally equivalent to feature `003` and `csv_attachment` requests remain blocked in a waiting-for-attachment state.
6. Demo the non-regression slice before enabling attachment processing.

### Incremental Delivery

1. Finish Setup and Foundational work to establish shared attachment intake, validation, and audit primitives.
2. Deliver User Story 1 to prove manual-path compatibility and safe waiting-state behavior.
3. Add User Story 2 to enable approval-ready attachment intake and corrected later-comment retries.
4. Add User Story 3 to reuse approved execution and reconciliation for attachment-derived requests.
5. Finish with cross-cutting regression, documentation, and end-to-end validation.

### Parallel Team Strategy

1. One developer handles issue-form and workflow shim updates.
2. One developer handles attachment discovery, download, and validation modules.
3. One developer handles integration coverage, approval continuity, execution, and summary outputs once the normalized request model stabilizes.

---

## Notes

- [P] tasks touch different files and can be run in parallel.
- Every user story includes explicit testing, validation, observability, and reconciliation work where relevant.
- File paths are intentionally concrete so the task list is directly executable.
- Suggested MVP scope: Phase 1 + Phase 2 + Phase 3 (User Story 1 only).