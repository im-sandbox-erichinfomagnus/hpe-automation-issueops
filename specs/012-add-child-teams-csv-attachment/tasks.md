# Tasks: Add Child Teams CSV Attachment Intake

**Input**: Design documents from `/specs/012-add-child-teams-csv-attachment/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Tests are required for this feature. Include manual-path non-regression, waiting-for-attachment handling, requester-only attachment acceptance, attachment provenance and row-level findings, designated-approver continuity, reconciliation no-op behavior, dry-run behavior, terminal-state ignore behavior, and rate-limit coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare feature-specific fixtures, contract surfaces, and workflow-entry assumptions for add-child-teams CSV attachment intake.
- [X] T000 Enable CodeQL and Dependabot for the branch of this enhancement
- [X] T001 Create feature fixture files in tests/fixtures/add-child-teams-csv-attachment-issue.md and tests/fixtures/add-child-teams-csv-attachment-comments.json
- [X] T002 Create feature contract test files in tests/contract/add-child-teams-csv-attachment-parser-fixture.test.js and tests/contract/add-child-teams-csv-attachment-validation.test.js
- [X] T003 Create feature integration test file in tests/integration/add-child-teams-csv-attachment-request.test.js
- [X] T004 [P] Update workflow contract narrative in specs/012-add-child-teams-csv-attachment/contracts/add-child-teams-csv-attachment-workflow.yaml
- [X] T005 [P] Update operator flow documentation in specs/012-add-child-teams-csv-attachment/quickstart.md
- [X] T006 [P] Confirm lint and trigger assumptions in .github/workflows/lint-workflows.yml and .github/workflows/add-child-teams.yml
- [X] T050 [P] Add least-privilege permission contract checks for `ISSUEOPS_GITHUB_TOKEN` usage boundaries across validation, approval, and execution paths in tests/contract/add-child-teams-approval-policy.test.js and tests/integration/add-child-teams-approval.test.js

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement shared attachment-intake primitives and lifecycle guards required by all user stories.

**CRITICAL**: No user story work begins until this phase completes.

### Guardrail Tests Before Foundational Changes

- [X] T007 [P] Add manual-path parser guardrail assertions in tests/contract/add-child-teams-parser-fixture.test.js and tests/fixtures/add-child-teams-issue.md
- [X] T008 [P] Add manual-path approval and workflow guardrail assertions in tests/integration/add-child-teams-request.test.js and tests/integration/add-child-teams-approval.test.js

### Foundational Implementation

- [X] T009 Create shared attachment comment fixtures for waiting, valid, invalid, ambiguous, and superseded attempts in tests/fixtures/add-child-teams-csv-attachment-comments.json
- [X] T010 [P] Implement requester-comment candidate resolution helpers in src/workflow-support/resolve-csv-attachment-comment.js
- [X] T011 [P] Implement attachment download, bounded size checks, and UTF-8 decoding in src/workflow-support/download-csv-attachment.js
- [X] T012 [P] Implement attachment hashing and provenance helpers in src/workflow-support/hash-attachment-content.js
- [X] T013 [P] Extend request parsing model for intake_mode and waiting lifecycle in src/workflow-support/parse-team-hierarchy-request.js
- [X] T014 [P] Extend request validation model for attachment lifecycle boundaries in src/workflow-support/validate-team-hierarchy-request.js
- [X] T015 [P] Extend audit artifact schema for attachment provenance and lifecycle evidence in src/workflow-support/build-audit-artifact.js
- [X] T016 [P] Extend execution outcome model for waiting and terminal-state attachment behavior in src/workflow-support/build-execution-outcome.js
- [X] T017 Wire issue_comment attachment context into validation runner in src/scripts/run-request-validation.js and .github/workflows/add-child-teams.yml
- [X] T018 Preserve dry-run and bounded retry behavior for attachment-intake paths in src/scripts/run-request-validation.js, src/scripts/run-approved-execution.js, and src/workflow-support/handle-rate-limit.js
- [X] T019 Add terminal-state restore and label-detection primitives for fresh runners in src/scripts/restore-request-audit-artifact.js and src/workflow-support/validate-team-hierarchy-request.js

**Checkpoint**: Attachment lifecycle and shared validation/audit primitives are ready.

---

## Phase 3: User Story 1 - Preserve Manual Requests and Safe Waiting Lifecycle (Priority: P1)

**Goal**: Preserve baseline manual behavior while ensuring csv_attachment requests stay blocked in waiting state until a qualifying attachment is accepted.

**Independent Test**: Submit one manual request and one csv_attachment request; confirm manual behavior matches baseline and attachment request remains waiting with no approval readiness or mutation.

### Tests for User Story 1

- [X] T020 [P] [US1] Add manual non-regression and intake-mode parser coverage in tests/contract/add-child-teams-parser-fixture.test.js
- [X] T021 [P] [US1] Add waiting-for-attachment workflow and approval-block coverage in tests/integration/add-child-teams-request.test.js and tests/integration/add-child-teams-approval.test.js
- [X] T022 [P] [US1] Add approval-policy checks that waiting requests cannot advance in tests/contract/add-child-teams-approval-policy.test.js
- [X] T046 [P] [US1] Add routing-versus-approval guardrail coverage proving central assignment never grants approval in tests/contract/add-child-teams-approval-policy.test.js and tests/integration/add-child-teams-approval.test.js

### Implementation for User Story 1

- [X] T023 [P] [US1] Update intake form for manual versus csv_attachment mode in .github/ISSUE_TEMPLATE/add-child-teams.yml
- [X] T024 [US1] Preserve manual normalization path while deriving waiting_for_attachment state in src/workflow-support/parse-team-hierarchy-request.js
- [X] T025 [US1] Enforce exactly-one-intake-mode and waiting-state validation in src/workflow-support/validate-team-hierarchy-request.js
- [X] T026 [US1] Surface waiting-state and manual-path continuity in src/workflow-support/build-audit-artifact.js, src/workflow-support/build-execution-outcome.js, and src/scripts/emit-audit-summary.js
- [X] T047 [US1] Enforce routing-only central assignment semantics in approval evaluation and summaries in src/workflow-support/approval-gate.js, src/scripts/run-approval-gate.js, and src/scripts/emit-audit-summary.js

**Checkpoint**: User Story 1 is independently testable as MVP.

---

## Phase 4: User Story 2 - Accept, Validate, and Correct Attachment CSV Intake (Priority: P2)

**Goal**: Accept requester-authored CSV attachment comments, validate row semantics, and support deterministic correction via later requester comments.

**Independent Test**: Submit csv_attachment request, post valid attachment and reach approval-ready state, then post invalid followed by corrected attachment and confirm newest eligible post-failure requester comment is selected.

### Tests for User Story 2

- [X] T027 [P] [US2] Add parser fixture coverage for attachment comment discovery and candidate selection in tests/contract/add-child-teams-csv-attachment-parser-fixture.test.js and tests/fixtures/add-child-teams-csv-attachment-comments.json
- [X] T028 [P] [US2] Add validation coverage for non-requester, ambiguous, oversized, non-decodable, and malformed CSV attachment cases in tests/contract/add-child-teams-csv-attachment-validation.test.js
- [X] T029 [P] [US2] Add integration coverage for failed then corrected attachment resubmission in tests/integration/add-child-teams-csv-attachment-request.test.js
- [X] T051 [P] [US2] Add validation coverage that CSV findings emit 1-based data-row numbering excluding header row in tests/contract/add-child-teams-csv-attachment-validation.test.js
- [X] T048 [P] [US2] Add validation coverage that attachment size-cap enforcement reads repository policy `attachment_max_bytes` and uses documented default fallback in tests/contract/add-child-teams-csv-attachment-validation.test.js

### Implementation for User Story 2

- [X] T030 [P] [US2] Implement requester-only attachment acceptance and active-candidate supersession rules in src/workflow-support/resolve-csv-attachment-comment.js and src/workflow-support/validate-team-hierarchy-request.js
- [X] T031 [P] [US2] Integrate attachment download and provenance capture into validation flow in src/scripts/run-request-validation.js, src/workflow-support/download-csv-attachment.js, and src/workflow-support/hash-attachment-content.js
- [X] T032 [US2] Reuse bulk CSV child-team normalization semantics for attachment content in src/workflow-support/normalize-bulk-csv-requested-child-teams.js and src/workflow-support/parse-team-hierarchy-request.js
- [X] T033 [US2] Enforce row-level findings, duplicate/conflict handling, and approval blocking until valid CSV in src/workflow-support/validate-team-hierarchy-request.js
- [X] T034 [US2] Emit attachment provenance and validation findings in audit summaries in src/workflow-support/build-audit-artifact.js and src/scripts/emit-audit-summary.js
- [X] T049 [US2] Implement policy-driven `attachment_max_bytes` resolution with default fallback for attachment validation in src/actions/team-hierarchy-policy/, src/workflow-support/download-csv-attachment.js, and src/workflow-support/validate-team-hierarchy-request.js

**Checkpoint**: User Stories 1 and 2 are independently testable.

---

## Phase 5: User Story 3 - Execute with Existing Approval/Reconciliation and Terminal-State Immutability (Priority: P3)

**Goal**: Keep approval and reconciliation semantics unchanged for validated attachment requests and prevent post-terminal comment reprocessing.

**Independent Test**: Execute approved attachment-driven request with mixed no-op and missing links, rerun idempotently, then post new attachment comment and verify no lifecycle reopening.

### Tests for User Story 3

- [X] T035 [P] [US3] Add approved attachment execution and no-op reconciliation coverage in tests/integration/add-child-teams-csv-attachment-request.test.js and tests/integration/add-child-teams-workflow.test.js
- [X] T036 [P] [US3] Add terminal-state immutability and post-terminal ignore coverage in tests/integration/add-child-teams-approval.test.js and tests/integration/add-child-teams-workflow.test.js

### Implementation for User Story 3

- [X] T037 [P] [US3] Propagate accepted attachment metadata through reconciliation planning in src/workflow-support/reconcile-team-hierarchy.js and src/workflow-support/parse-team-hierarchy-request.js
- [X] T038 [US3] Preserve designated approver validation and approval-gate continuity for attachment requests in src/workflow-support/approval-gate.js, src/workflow-support/resolve-team-hierarchy-approver.js, and src/scripts/run-approval-gate.js
- [X] T039 [US3] Reuse approved execution flow for attachment-derived requested_child_links in src/scripts/run-approved-execution.js and .github/workflows/add-child-teams.yml
- [X] T040 [US3] Enforce immutable terminal-state ignore behavior using restored artifacts and operation-aware labels in src/scripts/restore-request-audit-artifact.js, src/workflow-support/validate-team-hierarchy-request.js, and src/scripts/run-request-validation.js
- [X] T041 [US3] Extend outcome reporting for partial failures and operator guidance in src/workflow-support/build-execution-outcome.js and src/scripts/emit-audit-summary.js

**Checkpoint**: All user stories are independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening, cross-story regression, and documentation synchronization.

- [X] T042 [P] Add cross-story regression coverage for dry-run, bounded retries, and rate-limit partial-result reporting in tests/contract/add-child-teams-csv-attachment-validation.test.js and tests/integration/add-child-teams-workflow.test.js
- [X] T043 Refactor shared child-team normalization and validation reuse in src/workflow-support/normalize-requested-child-teams.js, src/workflow-support/normalize-bulk-csv-requested-child-teams.js, and src/workflow-support/validate-team-hierarchy-request.js
- [X] T044 [P] Synchronize contract and quickstart examples with implemented behavior in specs/012-add-child-teams-csv-attachment/contracts/add-child-teams-csv-attachment-workflow.yaml and specs/012-add-child-teams-csv-attachment/quickstart.md
- [X] T045 Run quickstart-aligned end-to-end validation for manual and csv_attachment paths in tests/integration/add-child-teams-request.test.js, tests/integration/add-child-teams-csv-attachment-request.test.js, and tests/integration/add-child-teams-workflow.test.js

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1): No dependencies.
- Foundational (Phase 2): Depends on Setup and blocks all user stories.
- User Story 1 (Phase 3): Depends on Foundational completion.
- User Story 2 (Phase 4): Depends on Foundational completion and builds on waiting-state primitives.
- User Story 3 (Phase 5): Depends on User Story 2 validated attachment model and approval-ready flow.
- Polish (Phase 6): Depends on all user stories targeted for release.

### User Story Dependencies

- US1 (P1): MVP slice for non-regression and safe waiting lifecycle.
- US2 (P2): Builds attachment intake and correction flow after foundational lifecycle wiring.
- US3 (P3): Builds execution and terminal immutability on top of validated attachment intake.

### Within Each User Story

- Tests must fail before implementation tasks begin.
- Intake and parser updates precede approval and execution changes.
- Validation and provenance checks precede approval-readiness transitions.
- Reconciliation and execution changes precede final summary and audit updates.

### Parallel Opportunities

- Setup tasks marked [P] can run together.
- Foundational tasks T010-T016 can run in parallel after T007-T008.
- US1 tests T020-T022 can run in parallel.
- US2 tests T027-T029 and implementation tasks T030-T031 can run in parallel.
- US3 tests T035-T036 can run in parallel with T037 while approval and execution tasks follow.
- Polish tasks T042 and T044 can run in parallel.

---

## Parallel Example: User Story 1

- Task: T020 [US1] in tests/contract/add-child-teams-parser-fixture.test.js
- Task: T021 [US1] in tests/integration/add-child-teams-request.test.js and tests/integration/add-child-teams-approval.test.js
- Task: T022 [US1] in tests/contract/add-child-teams-approval-policy.test.js

## Parallel Example: User Story 2

- Task: T027 [US2] in tests/contract/add-child-teams-csv-attachment-parser-fixture.test.js
- Task: T028 [US2] in tests/contract/add-child-teams-csv-attachment-validation.test.js
- Task: T029 [US2] in tests/integration/add-child-teams-csv-attachment-request.test.js

## Parallel Example: User Story 3

- Task: T035 [US3] in tests/integration/add-child-teams-csv-attachment-request.test.js
- Task: T036 [US3] in tests/integration/add-child-teams-approval.test.js and tests/integration/add-child-teams-workflow.test.js
- Task: T037 [US3] in src/workflow-support/reconcile-team-hierarchy.js and src/workflow-support/parse-team-hierarchy-request.js

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 Setup.
2. Complete Phase 2 Foundational blockers.
3. Complete Phase 3 User Story 1.
4. Validate independent test criteria for US1 before proceeding.

### Incremental Delivery

1. Deliver US1 after setup and foundational phases.
2. Deliver US2 and validate attachment intake and correction independently.
3. Deliver US3 and validate approval/reconciliation continuity plus terminal immutability.
4. Run polish regression tasks before release.

### Parallel Team Strategy

1. Team member A: issue form, parser, and validation lifecycle tasks.
2. Team member B: attachment discovery/download/provenance tasks.
3. Team member C: integration coverage, approval gate, execution, and summary tasks.

---

## Notes

- [P] marks tasks that can execute concurrently with no incomplete dependencies.
- [US1], [US2], and [US3] labels provide story traceability.
- Suggested MVP scope: through Phase 3 (US1).
- Every task includes explicit file paths for direct implementation.
