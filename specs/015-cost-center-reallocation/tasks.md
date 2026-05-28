# Tasks: Cost Center Reallocation Workflow

**Input**: Design documents from `/specs/015-cost-center-reallocation/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Tests are required for this feature. Include parser fixture, authorization, reconciliation, dry-run, rollback, observability, and rate-limit coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **IssueOps repository**: `.github/ISSUE_TEMPLATE/`, `.github/workflows/`, `src/`, `tests/`, `specs/`
- Paths below follow the structure defined by the constitution section `Repository Structure Conventions` and `specs/015-cost-center-reallocation/plan.md`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the workflow scaffold and repository-level validation baseline for cost center reallocation automation.

- [ ] T001 Create feature scaffolding in `.github/ISSUE_TEMPLATE/cost-center-reallocation.yml`, `.github/workflows/cost-center-reallocation.yml`, `src/actions/cost-center-policy/`, `src/workflow-support/`, `src/scripts/`, `tests/contract/`, `tests/fixtures/github-api/`, and `tests/integration/`
- [ ] T002 Add workflow trigger, parser, artifact, and runner conventions to `.github/workflows/cost-center-reallocation.yml` and `specs/015-cost-center-reallocation/quickstart.md`
- [ ] T003 [P] Configure workflow linting and validation coverage in `.github/workflows/lint-workflows.yml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement shared parsing, policy, API, audit, and retry primitives required by all user stories, reusing existing repository building blocks without editing the team workflows.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Create request parsing and CSV normalization helpers in `src/workflow-support/parse-cost-center-request.js` and `src/workflow-support/normalize-cost-center-assignments.js`
- [ ] T005 [P] Reuse the existing token loader and add policy guard helpers in `src/actions/cost-center-policy/index.js`
- [ ] T006 [P] Create the enterprise cost center API helpers in `src/workflow-support/github-cost-center-api.js`
- [ ] T007 Create validation and reconciliation helpers in `src/workflow-support/validate-cost-center-request.js` and `src/workflow-support/reconcile-cost-center.js`
- [ ] T008 [P] Reuse structured audit and summary helpers for the cost center runners under `src/scripts/`
- [ ] T009 Reuse the bounded-retry rate-limit handler and dry-run execution-outcome primitives for `src/workflow-support/reconcile-cost-center.js`

**Checkpoint**: Shared foundations are ready; story-specific work can start.

---

## Phase 3: User Story 1 - Submit and Validate Cost Center Reallocation Requests (Priority: P1) 🎯 MVP

**Goal**: Let an operator submit a pasted assignments CSV, validate CSV structure and enterprise input, mark live state unverified when no billing token is available, reject out-of-scope resource input, and stop in an approval-ready no-mutation state.

**Independent Test**: Submit a request with an assignments CSV and confirm valid requests become approval-ready while malformed rows, unknown actions, duplicate rows, or organization and repository resource input fail without changing any cost center.

### Tests for User Story 1 ⚠️

- [ ] T010 [P] [US1] Add parser fixture coverage for valid, duplicate, unknown-action, out-of-scope-resource, and empty submissions in `tests/contract/cost-center-reallocation-parser-fixture.test.js` and `tests/fixtures/cost-center-reallocation-issue.md`
- [ ] T011 [P] [US1] Add validation-path integration coverage for enterprise input, default action application, and degraded live-state handling in `tests/integration/cost-center-reallocation-request.test.js`, `tests/fixtures/github-api/cost-center-validation.json`, and `tests/fixtures/github-api/current-cost-centers.json`

### Implementation for User Story 1

- [ ] T012 [P] [US1] Implement user-resource-only issue form fields and validation hints in `.github/ISSUE_TEMPLATE/cost-center-reallocation.yml`
- [ ] T013 [P] [US1] Implement the intake workflow shim, parser step, and validation-only exit path in `.github/workflows/cost-center-reallocation.yml`
- [ ] T014 [US1] Implement request parsing and CSV normalization flow in `src/workflow-support/parse-cost-center-request.js` and `src/workflow-support/normalize-cost-center-assignments.js`
- [ ] T015 [US1] Implement preflight validation for enterprise input, CSV header and rows, default action, duplicate rejection, out-of-scope resource rejection, and degraded live-state marking in `src/workflow-support/validate-cost-center-request.js`
- [ ] T016 [US1] Persist approval-ready and validation-failed summaries in `src/scripts/run-cost-center-validation.js`
- [ ] T017 [US1] Surface the create-add-remove-no-op reconciliation preview and dry-run-only request handling in `src/workflow-support/reconcile-cost-center.js` and `.github/workflows/cost-center-reallocation.yml`

**Checkpoint**: User Story 1 is independently testable as a validated, approval-ready request flow with no mutation.

---

## Phase 4: User Story 2 - Approve Requests Through the Central Repository (Priority: P2)

**Goal**: Enforce that only the named intended approver can approve the validated request in the central repository using the exact `approved` comment convention.

**Independent Test**: Submit a valid request and verify that only an exact `approved` comment from the named intended approver unlocks execution; invalid or mismatched approvals must leave the request blocked.

### Tests for User Story 2 ⚠️

- [ ] T018 [P] [US2] Add approval-policy contract tests for the named approver, mismatched approvers, and non-exact comment bodies in `tests/contract/cost-center-reallocation-approval-policy.test.js`
- [ ] T019 [P] [US2] Add approval-gate integration tests for pending, approved, and rejected approvals in `tests/integration/cost-center-reallocation-approval.test.js`

### Implementation for User Story 2

- [ ] T020 [P] [US2] Implement named-approver resolution and approval-gate enforcement reusing the `approved` comment convention in `src/actions/cost-center-policy/index.js`
- [ ] T021 [US2] Wire approval-gate enforcement into `.github/workflows/cost-center-reallocation.yml`
- [ ] T022 [US2] Record approval decisions and approval invalidation handling in `src/scripts/run-cost-center-approval.js`
- [ ] T023 [US2] Report approval-required and approval-denied outcomes in `src/scripts/run-cost-center-approval.js`

**Checkpoint**: User Stories 1 and 2 work together to create, route, and authorize requests without executing mutations early.

---

## Phase 5: User Story 3 - Reconcile Cost Centers and Report Outcomes (Priority: P3)

**Goal**: After approval and only when not a dry run, reconcile current enterprise cost center state, create only missing cost centers, add or remove only required user resources, and emit auditable outcomes for success, no-op, partial failure, and retryable throttling.

**Independent Test**: Approve a non-dry-run request containing new cost centers, existing cost centers, add rows, remove rows, and a retryable failing path, then verify that only required changes are applied and the outcome distinguishes created, added, removed, skipped, and failed items.

### Tests for User Story 3 ⚠️

- [ ] T024 [P] [US3] Add reconciliation contract tests for all-new, partially-satisfied, and fully-satisfied batches in `tests/contract/reconcile-cost-center-contract.test.js` and `tests/fixtures/github-api/current-cost-centers.json`
- [ ] T025 [P] [US3] Add end-to-end integration coverage for create, add, remove, no-op rerun, dry-run, partial failure, and rate-limit handling in `tests/integration/cost-center-reallocation-workflow.test.js`, `tests/fixtures/github-api/create-cost-center-success.json`, and `tests/fixtures/github-api/cost-center-rate-limit.json`

### Implementation for User Story 3

- [ ] T026 [P] [US3] Implement approved reconciliation planning for missing cost centers and required resource changes in `src/workflow-support/reconcile-cost-center.js`
- [ ] T027 [US3] Implement enterprise cost center creation and user-resource add and remove calls in `src/workflow-support/github-cost-center-api.js`
- [ ] T028 [US3] Implement bounded retry and stop conditions for cost center throttling and partial failures in `src/workflow-support/reconcile-cost-center.js`
- [ ] T029 [US3] Implement the approved execution runner and final mutation summary handling in `src/scripts/run-cost-center-execution.js`
- [ ] T030 [US3] Wire approved execution, artifact upload, dry-run gating, and idempotent rerun behavior in `.github/workflows/cost-center-reallocation.yml`

**Checkpoint**: All user stories are independently testable and the full approved cost center reconciliation flow is functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Harden documentation, regressions, and operator guidance across all user stories.

- [ ] T031 [P] Update feature guidance and workflow contract examples in `specs/015-cost-center-reallocation/quickstart.md` and `specs/015-cost-center-reallocation/contracts/cost-center-reallocation-workflow.yaml`
- [ ] T032 Refactor shared cost center policy checks into `src/actions/cost-center-policy/index.js`
- [ ] T033 Validate audit artifact fields and requester-facing summaries in `tests/integration/cost-center-reallocation-workflow.test.js`
- [ ] T034 [P] Add regression coverage for out-of-scope resource input, default action application, and the enterprise-billing-token blocker messaging in `tests/contract/cost-center-reallocation-parser-fixture.test.js`, `tests/contract/cost-center-reallocation-approval-policy.test.js`, and `tests/integration/cost-center-reallocation-workflow.test.js`
- [ ] T035 Run end-to-end quickstart validation against `specs/015-cost-center-reallocation/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion.
- **User Story 2 (Phase 4)**: Depends on User Story 1 request-intake artifacts because approval operates on validated requests.
- **User Story 3 (Phase 5)**: Depends on User Story 2 approval gating because mutation is not allowed before approval.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: First deliverable and MVP slice.
- **User Story 2 (P2)**: Builds on the validated request path from US1.
- **User Story 3 (P3)**: Builds on the validated and approved request path from US1 and US2.

### Within Each User Story

- Tests MUST be written and fail before implementation.
- Issue form and parser contract work come before approval or mutation wiring.
- Authorization and approval gates come before privileged API calls.
- Reconciliation planning comes before mutation wiring.
- Dry-run, rollback, observability, and rate-limit behavior must be in place before the story is considered complete.

### Parallel Opportunities

- `T003` can run in parallel with `T001` and `T002` after the feature scaffold is defined.
- `T005`, `T006`, and `T008` can run in parallel within the foundational phase.
- `T010` and `T011` can run in parallel for US1 test authoring.
- `T012` and `T013` can run in parallel once US1 tests exist.
- `T018` and `T019` can run in parallel for US2 test authoring.
- `T024` and `T025` can run in parallel for US3 test authoring.
- `T031` and `T034` can run in parallel during the polish phase.

---

## Parallel Example: User Story 1

```bash
# Write the User Story 1 tests together:
Task: "Add parser fixture coverage in tests/contract/cost-center-reallocation-parser-fixture.test.js and tests/fixtures/cost-center-reallocation-issue.md"
Task: "Add validation-path integration coverage in tests/integration/cost-center-reallocation-request.test.js, tests/fixtures/github-api/cost-center-validation.json, and tests/fixtures/github-api/current-cost-centers.json"

# Implement independent request-intake surfaces together:
Task: "Implement user-resource-only issue form fields and validation hints in .github/ISSUE_TEMPLATE/cost-center-reallocation.yml"
Task: "Implement the intake workflow shim, parser step, and validation-only exit path in .github/workflows/cost-center-reallocation.yml"
```

## Parallel Example: User Story 2

```bash
# Write the User Story 2 tests together:
Task: "Add approval-policy contract tests in tests/contract/cost-center-reallocation-approval-policy.test.js"
Task: "Add approval-gate integration tests in tests/integration/cost-center-reallocation-approval.test.js"

# Implement independent approval components together:
Task: "Implement named-approver resolution and approval-gate enforcement in src/actions/cost-center-policy/index.js"
Task: "Report approval-required and approval-denied outcomes in src/scripts/run-cost-center-approval.js"
```

## Parallel Example: User Story 3

```bash
# Write the User Story 3 tests together:
Task: "Add reconciliation contract tests in tests/contract/reconcile-cost-center-contract.test.js and tests/fixtures/github-api/current-cost-centers.json"
Task: "Add end-to-end integration coverage in tests/integration/cost-center-reallocation-workflow.test.js, tests/fixtures/github-api/create-cost-center-success.json, and tests/fixtures/github-api/cost-center-rate-limit.json"

# Implement independent execution components together:
Task: "Implement approved reconciliation planning in src/workflow-support/reconcile-cost-center.js"
Task: "Implement enterprise cost center creation and user-resource calls in src/workflow-support/github-cost-center-api.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. Validate that a request reaches an approval-ready, no-mutation state.
5. Demo the validated request flow before building approval or mutation.

### Incremental Delivery

1. Finish Setup and Foundational work to establish shared parser, policy, API, and audit helpers.
2. Deliver User Story 1 as the request-intake MVP.
3. Add User Story 2 to enforce central approval.
4. Add User Story 3 to perform approved reconciliation and cost center changes.
5. Finish with cross-cutting regression, documentation, and end-to-end validation.

### Parallel Team Strategy

1. One developer handles workflow scaffolding and parser foundations.
2. One developer handles policy, approval, and audit logic after foundational helpers exist.
3. One developer handles reconciliation, execution, and retry tests once approval artifacts are stable.

---

## Notes

- [P] tasks touch different files and can be run in parallel.
- Every user story includes explicit testing, authorization, reconciliation, observability, and rate-limit work where relevant.
- File paths are intentionally concrete so the task list is directly executable.
- Suggested MVP scope: Phase 1 + Phase 2 + Phase 3 (User Story 1 only).
