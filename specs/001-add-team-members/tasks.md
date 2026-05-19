# Tasks: Add Team Members Workflow

**Input**: Design documents from `/specs/001-add-team-members/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are required for this feature. Include parser fixture, authorization, reconciliation, dry-run, rollback, observability, and rate-limit coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **IssueOps repository**: `.github/ISSUE_TEMPLATE/`, `.github/workflows/`, `src/`, `tests/`
- Paths below follow the structure defined in `specs/001-add-team-members/plan.md`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the repository scaffolding and workflow validation baseline for this feature.

- [x] T001 Create feature scaffolding in `.github/ISSUE_TEMPLATE/add-team-members.yml`, `.github/workflows/add-team-members.yml`, `src/actions/team-membership-policy/`, `src/workflow-support/`, `src/scripts/`, `tests/contract/`, `tests/fixtures/github-api/`, and `tests/integration/`
- [x] T002 Add workflow dependency and runner conventions to `.github/workflows/add-team-members.yml` and `specs/001-add-team-members/quickstart.md`
- [x] T003 [P] Configure workflow linting and validation in `.github/workflows/lint-workflows.yml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement shared parsing, policy, API, logging, and retry primitives required by all user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Create shared request parsing and normalization helpers in `src/workflow-support/parse-team-membership-request.js` and `src/workflow-support/normalize-requested-people.js`
- [x] T005 [P] Implement token loading and permission guard helpers in `src/workflow-support/load-workflow-token.js` and `src/actions/team-membership-policy/index.js`
- [x] T006 [P] Implement shared GitHub team API client helpers in `src/workflow-support/github-team-api.js`
- [x] T007 Create shared validation and reconciliation helpers in `src/workflow-support/validate-team-membership-request.js` and `src/workflow-support/reconcile-team-members.js`
- [x] T008 [P] Implement structured audit and summary helpers in `src/workflow-support/build-audit-artifact.js` and `src/scripts/emit-audit-summary.js`
- [x] T009 Setup retry, dry-run, and partial-failure primitives in `src/workflow-support/handle-rate-limit.js` and `src/workflow-support/build-execution-outcome.js`

**Checkpoint**: Shared foundations are ready; story-specific work can start.

---

## Phase 3: User Story 1 - Request Team Membership Changes (Priority: P1) 🎯 MVP

**Goal**: Let a requester submit a valid add-team-members request, validate the target team and requested people, and route the request to approval without mutating membership.

**Independent Test**: Submit a request for an existing team with valid people and confirm the workflow records validation results and stops in an approval-ready state with no membership mutation.

### Tests for User Story 1 ⚠️

- [x] T010 [P] [US1] Add parser fixture coverage for valid, duplicate, and empty submissions in `tests/contract/add-team-members-parser-fixture.test.js` and `tests/fixtures/add-team-members-issue.md`
- [x] T011 [P] [US1] Add validation-path integration coverage for existing-team and missing-team requests in `tests/integration/add-team-members-request.test.js` and `tests/fixtures/github-api/team-validation.json`

### Implementation for User Story 1

- [x] T012 [P] [US1] Implement the issue form fields and validation hints in `.github/ISSUE_TEMPLATE/add-team-members.yml`
- [x] T013 [P] [US1] Implement the intake workflow shim and parser step in `.github/workflows/add-team-members.yml`
- [x] T014 [US1] Implement request validation and normalization flow in `src/workflow-support/validate-team-membership-request.js`
- [x] T015 [US1] Persist approval-ready request summaries and validation failures in `src/workflow-support/build-audit-artifact.js` and `src/scripts/emit-audit-summary.js`
- [x] T016 [US1] Wire dry-run-only request processing and no-mutation exit behavior in `.github/workflows/add-team-members.yml`

**Checkpoint**: User Story 1 is independently testable as a validated, approval-ready request flow.

---

## Phase 4: User Story 2 - Approve Privileged Membership Changes (Priority: P2)

**Goal**: Enforce that only an organization owner can approve the request before execution proceeds.

**Independent Test**: Submit a valid request and verify that execution remains blocked until an eligible approver approves it; invalid or missing approvals must not unlock mutation.

### Tests for User Story 2 ⚠️

- [x] T017 [P] [US2] Add approval-policy contract tests for organization owner, and invalid approvers in `tests/contract/approval-policy.test.js`
- [x] T018 [P] [US2] Add approval-gate integration tests for approved, denied, and missing-approval paths in `tests/integration/add-team-members-approval.test.js` and `tests/fixtures/github-api/approver-roles.json`

### Implementation for User Story 2

- [x] T019 [P] [US2] Implement approver role resolution and approval signal parsing in `src/workflow-support/resolve-approver-role.js` and `src/workflow-support/approval-gate.js`
- [x] T020 [US2] Wire approval-gate enforcement into `.github/workflows/add-team-members.yml`
- [x] T021 [US2] Record approval decisions and invalidation handling in `src/workflow-support/build-audit-artifact.js`
- [x] T022 [US2] Report approval-required and approval-denied outcomes in `src/scripts/emit-audit-summary.js`

**Checkpoint**: User Stories 1 and 2 work together to create and authorize requests without executing mutations early.

---

## Phase 5: User Story 3 - Reconcile Membership and Report Outcome (Priority: P3)

**Goal**: After approval, reconcile current team state, add only missing people, and emit auditable outcomes for success, no-op, failure, and compensating-recovery paths.

**Independent Test**: Approve a request where some people are already team members and confirm that only missing people are added while no-op, rate-limit, failure, and compensating-recovery outcomes are reported accurately.

### Tests for User Story 3 ⚠️

- [x] T023 [P] [US3] Add reconciliation contract tests for all-new, partially-satisfied, and fully-satisfied membership states in `tests/contract/reconcile-team-members-contract.test.js` and `tests/fixtures/github-api/current-team-members.json`
- [x] T024 [P] [US3] Add end-to-end integration coverage for mutation, no-op rerun, partial failure, failed-subset recovery instructions, and rate-limit handling in `tests/integration/add-team-members-workflow.test.js`, `tests/fixtures/github-api/add-member-success.json`, and `tests/fixtures/github-api/rate-limit-response.json`

### Implementation for User Story 3

- [x] T025 [P] [US3] Implement reconciliation planning for target team state in `src/workflow-support/reconcile-team-members.js`
- [x] T026 [US3] Implement team membership mutation handling in `src/workflow-support/github-team-api.js`
- [x] T027 [US3] Implement bounded retry and stop conditions for rate-limit and team-sync failures in `src/workflow-support/handle-rate-limit.js`
- [x] T028 [US3] Implement final execution outcome reporting and compensating recovery handling for partial-success executions, including failed-subset remediation instructions, in `src/workflow-support/build-execution-outcome.js`
- [x] T029 [US3] Wire approved execution, mutation, compensating-recovery artifacts, and final audit artifact upload in `.github/workflows/add-team-members.yml`

**Checkpoint**: All user stories are independently testable and the full approved mutation flow is functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Harden documentation, regression coverage, and operator guidance across all user stories.

- [x] T030 [P] Update feature usage and operator guidance in `specs/001-add-team-members/quickstart.md` and `specs/001-add-team-members/contracts/add-team-members-workflow.yaml`
- [x] T031 Refactor duplicated workflow policy logic into `src/actions/team-membership-policy/index.js`
- [x] T032 Validate audit artifact fields and requester-facing summaries in `tests/integration/add-team-members-workflow.test.js`
- [x] T033 [P] Add regression coverage for duplicate usernames, invalid users, and stale approvals in `tests/contract/add-team-members-parser-fixture.test.js` and `tests/integration/add-team-members-approval.test.js`
- [x] T034 Run end-to-end quickstart validation against `specs/001-add-team-members/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion.
- **User Story 2 (Phase 4)**: Depends on User Story 1 request intake artifacts because approval operates on validated requests.
- **User Story 3 (Phase 5)**: Depends on User Story 2 approval gating because mutation is not allowed before approval.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: First deliverable and MVP slice.
- **User Story 2 (P2)**: Builds on the validated request path from US1.
- **User Story 3 (P3)**: Builds on the validated and approved request path from US1 and US2.

### Within Each User Story

- Tests MUST be written and fail before implementation.
- Issue form and parser contract work come before workflow mutation logic.
- Authorization and approval gates come before privileged API calls.
- Reconciliation planning comes before mutation wiring.
- Dry-run, rollback, and observability behavior must be in place before the story is considered complete.

### Parallel Opportunities

- `T003` can run in parallel with `T001` and `T002` after the feature scaffold is defined.
- `T005`, `T006`, and `T008` can run in parallel within the foundational phase.
- `T010` and `T011` can run in parallel for US1 test authoring.
- `T012` and `T013` can run in parallel once US1 tests exist.
- `T017` and `T018` can run in parallel for US2 test authoring.
- `T023` and `T024` can run in parallel for US3 test authoring.
- `T030` and `T033` can run in parallel during the polish phase.

---

## Parallel Example: User Story 1

```bash
# Write the User Story 1 tests together:
Task: "Add parser fixture coverage in tests/contract/add-team-members-parser-fixture.test.js and tests/fixtures/add-team-members-issue.md"
Task: "Add validation-path integration coverage in tests/integration/add-team-members-request.test.js and tests/fixtures/github-api/team-validation.json"

# Implement independent request-intake surfaces together:
Task: "Implement the issue form fields and validation hints in .github/ISSUE_TEMPLATE/add-team-members.yml"
Task: "Implement the intake workflow shim and parser step in .github/workflows/add-team-members.yml"
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
2. Deliver User Story 1 as the request intake MVP.
3. Add User Story 2 to enforce privileged approval.
4. Add User Story 3 to perform approved reconciliation and mutation.
5. Finish with cross-cutting regression, documentation, and end-to-end validation.

### Parallel Team Strategy

1. One developer handles workflow scaffolding and parser foundations.
2. One developer handles policy, audit, and approval logic after foundational helpers exist.
3. One developer handles reconciliation and mutation tests once approval artifacts are stable.

---

## Notes

- [P] tasks touch different files and can be run in parallel.
- Every user story includes explicit testing, authorization, reconciliation, observability, and rate-limit work where relevant.
- File paths are intentionally concrete so the task list is directly executable.
- Suggested MVP scope: Phase 1 + Phase 2 + Phase 3 (User Story 1 only).