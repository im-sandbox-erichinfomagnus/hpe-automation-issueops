# Tasks: Add Child Teams Workflow

**Input**: Design documents from `/specs/004-add-child-teams/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Tests are required for this feature. Include parser fixture, authorization, reconciliation, dry-run, observability, partial-failure, and rate-limit coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **IssueOps repository**: `.github/ISSUE_TEMPLATE/`, `.github/workflows/`, `src/`, `tests/`, `specs/`
- Paths below follow the structure defined by the constitution section `Repository Structure Conventions` and `specs/004-add-child-teams/plan.md`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the workflow scaffold and repository-level validation baseline for team-hierarchy automation.

- [x] T001 Create feature scaffolding in `.github/ISSUE_TEMPLATE/add-child-teams.yml`, `.github/workflows/add-child-teams.yml`, `src/actions/team-hierarchy-policy/`, `src/workflow-support/`, `src/scripts/`, `tests/contract/`, `tests/fixtures/github-api/`, and `tests/integration/`
- [x] T002 Add workflow trigger, parser, approval-artifact, and runner conventions to `.github/workflows/add-child-teams.yml` and `specs/004-add-child-teams/quickstart.md`
- [x] T003 [P] Configure workflow linting and validation coverage in `.github/workflows/lint-workflows.yml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement shared parsing, policy, API, audit, and retry primitives required by all user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Create shared request parsing and normalization helpers in `src/workflow-support/parse-team-hierarchy-request.js` and `src/workflow-support/normalize-requested-child-teams.js`
- [x] T005 [P] Extend token loading and hierarchy permission guard helpers in `src/workflow-support/load-workflow-token.js` and `src/actions/team-hierarchy-policy/index.js`
- [x] T006 [P] Extend shared GitHub team API helpers for team lookup, child-team listing, and parent-team updates in `src/workflow-support/github-team-api.js`
- [x] T007 Create shared validation and reconciliation helpers in `src/workflow-support/validate-team-hierarchy-request.js` and `src/workflow-support/reconcile-team-hierarchy.js`
- [x] T008 [P] Extend structured audit and summary helpers in `src/workflow-support/build-audit-artifact.js` and `src/scripts/emit-audit-summary.js`
- [x] T009 Setup retry, dry-run, and execution outcome primitives in `src/workflow-support/handle-rate-limit.js` and `src/workflow-support/build-execution-outcome.js`

**Checkpoint**: Shared foundations are ready; story-specific work can start.

---

## Phase 3: User Story 1 - Submit and Validate Team Hierarchy Requests (Priority: P1) 🎯 MVP

**Goal**: Let a requester submit one parent-team and multi-child-team hierarchy request, validate target-organization and team state, reject duplicates, re-parenting, cycle creation, and out-of-scope inputs, and stop in an approval-ready no-mutation state.

**Independent Test**: Submit requests for an existing parent team and one or more child teams in a target organization and confirm valid requests become approval-ready while malformed, duplicate, missing-team, re-parenting, cycle-creating, or out-of-scope requests fail without changing hierarchy state.

### Tests for User Story 1 ⚠️

- [x] T010 [P] [US1] Add parser fixture coverage for valid, duplicate, missing-team, re-parenting, and cycle-blocked submissions in `tests/contract/add-child-teams-parser-fixture.test.js` and `tests/fixtures/add-child-teams-issue.md`
- [x] T011 [P] [US1] Add validation-path integration coverage for target-organization visibility, parent-team lookup, child-team existence, duplicate child teams, and dry-run preview in `tests/integration/add-child-teams-request.test.js` and `tests/fixtures/github-api/team-hierarchy-validation.json`

### Implementation for User Story 1

- [x] T012 [P] [US1] Implement hierarchy-only issue form fields and validation hints in `.github/ISSUE_TEMPLATE/add-child-teams.yml`
- [x] T013 [P] [US1] Implement the intake workflow shim, parser step, and validation-only exit path in `.github/workflows/add-child-teams.yml`
- [x] T014 [US1] Implement request parsing and child-team normalization flow in `src/workflow-support/parse-team-hierarchy-request.js` and `src/workflow-support/normalize-requested-child-teams.js`
- [x] T015 [US1] Implement preflight validation for organization visibility, parent-team lookup, child-team existence, duplicate child teams, re-parenting rejection, and cycle rejection in `src/workflow-support/validate-team-hierarchy-request.js`
- [x] T016 [US1] Persist approval-ready and validation-failed hierarchy summaries in `src/workflow-support/build-audit-artifact.js` and `src/scripts/run-request-validation.js`
- [x] T017 [US1] Surface reconciliation preview, already-linked no-op classification, and dry-run-only handling in `src/workflow-support/reconcile-team-hierarchy.js` and `.github/workflows/add-child-teams.yml`

**Checkpoint**: User Story 1 is independently testable as a validated, approval-ready request flow with no mutation.

---

## Phase 4: User Story 2 - Approve Hierarchy Changes Through the Central Repository (Priority: P2)

**Goal**: Enforce that only the single designated hierarchy approver for the full request batch can approve in the central repository while central issue assignment remains routing-only.

**Independent Test**: Submit a valid request, assign the central issue for queue visibility, and verify that only the designated hierarchy approver with current target-side authority can unlock execution; invalid, missing, or stale approvals must leave the request blocked.

### Tests for User Story 2 ⚠️

- [X] T018 [P] [US2] Add approval-policy contract tests for designated hierarchy approver, unauthorized commenters, and split-batch rejection in `tests/contract/add-child-teams-approval-policy.test.js` and `tests/fixtures/github-api/team-hierarchy-approver-membership.json`
- [X] T019 [P] [US2] Add approval-gate integration tests for pending, approved, rejected, and stale-authorization approvals in `tests/integration/add-child-teams-approval.test.js` and `tests/fixtures/github-api/team-hierarchy-approver-membership.json`

### Implementation for User Story 2

- [X] T020 [P] [US2] Implement central issue assignment and hierarchy-approver resolution in `src/workflow-support/resolve-team-hierarchy-approver.js` and `src/workflow-support/approval-gate.js`
- [X] T021 [US2] Wire approval-gate enforcement and queue-routing steps into `.github/workflows/add-child-teams.yml`
- [X] T022 [US2] Record approval decisions, central assignment outcomes, and approval invalidation handling in `src/workflow-support/build-audit-artifact.js` and `src/scripts/run-approval-gate.js`
- [X] T023 [US2] Report approval-required, approval-denied, and split-batch outcomes in `src/scripts/emit-audit-summary.js` and `src/actions/team-hierarchy-policy/index.js`

**Checkpoint**: User Stories 1 and 2 work together to create, route, and authorize requests without executing mutations early.

---

## Phase 5: User Story 3 - Attach Only Missing Child Links and Report Outcomes (Priority: P3)

**Goal**: After approval, reconcile current organization hierarchy state, attach only missing child teams under the requested parent, and emit auditable outcomes for success, no-op, partial failure, and retryable throttling.

**Independent Test**: Approve a request containing child teams that are already attached, child teams that still need linking, and a retryable or failing path, then verify that only missing parent-child links are applied and the outcome distinguishes linked, skipped, rejected, and failed items.

### Tests for User Story 3 ⚠️

- [X] T024 [P] [US3] Add reconciliation contract tests for all-new, mixed no-op, re-parent-blocked, and cycle-blocked child-team batches in `tests/contract/reconcile-team-hierarchy-contract.test.js` and `tests/fixtures/github-api/team-hierarchy-validation.json`
- [X] T025 [P] [US3] Add end-to-end integration coverage for hierarchy linking, no-op rerun, partial failure, and rate-limit handling in `tests/integration/add-child-teams-workflow.test.js`, `tests/fixtures/github-api/team-hierarchy-update-success.json`, and `tests/fixtures/github-api/team-hierarchy-rate-limit.json`

### Implementation for User Story 3

- [X] T026 [P] [US3] Implement approved reconciliation planning for missing child-team links in `src/workflow-support/reconcile-team-hierarchy.js`
- [X] T027 [US3] Implement child-team parent update and latest hierarchy reads in `src/workflow-support/github-team-api.js`
- [X] T028 [US3] Implement bounded retry, stop conditions, and partial-failure tracking for hierarchy mutations in `src/workflow-support/handle-rate-limit.js` and `src/workflow-support/build-execution-outcome.js`
- [X] T029 [US3] Implement the approved execution runner and final hierarchy mutation summary handling in `src/scripts/run-approved-execution.js` and `src/scripts/emit-audit-summary.js`
- [X] T030 [US3] Wire approved execution, artifact upload, and idempotent rerun behavior into `.github/workflows/add-child-teams.yml`

**Checkpoint**: All user stories are independently testable and the full approved child-team linking flow is functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Harden documentation, regressions, and operator guidance across all user stories.

- [X] T031 [P] Update feature guidance and workflow contract examples in `specs/004-add-child-teams/quickstart.md` and `specs/004-add-child-teams/contracts/add-child-teams-workflow.yaml`
- [X] T032 Refactor shared hierarchy policy checks into `src/actions/team-hierarchy-policy/index.js`
- [X] T033 Validate audit artifact fields and requester-facing summaries in `tests/integration/add-child-teams-workflow.test.js` and `tests/contract/run-request-validation-env.test.js`
- [X] T034 [P] Add regression coverage for ancestor-child cycle requests, out-of-scope instructions, and PAT-mapping failures in `tests/contract/add-child-teams-parser-fixture.test.js`, `tests/contract/add-child-teams-approval-policy.test.js`, and `tests/contract/run-request-validation-env.test.js`
- [X] T035 Run end-to-end quickstart validation against `specs/004-add-child-teams/quickstart.md`

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
Task: "Add parser fixture coverage in tests/contract/add-child-teams-parser-fixture.test.js and tests/fixtures/add-child-teams-issue.md"
Task: "Add validation-path integration coverage in tests/integration/add-child-teams-request.test.js and tests/fixtures/github-api/team-hierarchy-validation.json"

# Implement independent request-intake surfaces together:
Task: "Implement hierarchy-only issue form fields and validation hints in .github/ISSUE_TEMPLATE/add-child-teams.yml"
Task: "Implement the intake workflow shim, parser step, and validation-only exit path in .github/workflows/add-child-teams.yml"
```

## Parallel Example: User Story 2

```bash
# Write the User Story 2 tests together:
Task: "Add approval-policy contract tests in tests/contract/add-child-teams-approval-policy.test.js and tests/fixtures/github-api/team-hierarchy-approver-membership.json"
Task: "Add approval-gate integration tests in tests/integration/add-child-teams-approval.test.js and tests/fixtures/github-api/team-hierarchy-approver-membership.json"

# Implement independent approval components together:
Task: "Implement central issue assignment and hierarchy-approver resolution in src/workflow-support/resolve-team-hierarchy-approver.js and src/workflow-support/approval-gate.js"
Task: "Report approval-required, approval-denied, and split-batch outcomes in src/scripts/emit-audit-summary.js and src/actions/team-hierarchy-policy/index.js"
```

## Parallel Example: User Story 3

```bash
# Write the User Story 3 tests together:
Task: "Add reconciliation contract tests in tests/contract/reconcile-team-hierarchy-contract.test.js and tests/fixtures/github-api/team-hierarchy-validation.json"
Task: "Add end-to-end integration coverage in tests/integration/add-child-teams-workflow.test.js, tests/fixtures/github-api/team-hierarchy-update-success.json, and tests/fixtures/github-api/team-hierarchy-rate-limit.json"

# Implement independent execution components together:
Task: "Implement approved reconciliation planning for missing child-team links in src/workflow-support/reconcile-team-hierarchy.js"
Task: "Implement bounded retry, stop conditions, and partial-failure tracking in src/workflow-support/handle-rate-limit.js and src/workflow-support/build-execution-outcome.js"
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
3. Add User Story 2 to enforce central approval and queue routing.
4. Add User Story 3 to perform approved reconciliation and child-team linking.
5. Finish with cross-cutting regression, documentation, and end-to-end validation.

### Parallel Team Strategy

1. One developer handles workflow scaffolding and parser foundations.
2. One developer handles policy, approval, and audit logic after foundational helpers exist.
3. One developer handles reconciliation, mutation, and retry tests once approval artifacts are stable.

---

## Notes

- [P] tasks touch different files and can be run in parallel.
- Every user story includes explicit testing, authorization, reconciliation, observability, and rate-limit work where relevant.
- File paths are intentionally concrete so the task list is directly executable.
- Suggested MVP scope: Phase 1 + Phase 2 + Phase 3 (User Story 1 only).