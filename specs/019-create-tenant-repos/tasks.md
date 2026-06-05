# Tasks: Tenant Repository Creation IssueOps Workflow

**Input**: Design documents from `/specs/019-create-tenant-repos/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Tests are required for this feature. Include parser and fixture coverage, tenant-resolution and authorization coverage, approval-binding coverage, execution idempotency coverage, dry-run no-mutation coverage, partial-failure coverage, and bounded retry/rate-limit coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare issue-form, workflow, fixtures, and contract baselines for tenant-scoped repository creation.

- [X] T001 Create feature fixture scaffolding in tests/fixtures/create-tenant-repos-issue.md and tests/fixtures/create-tenant-repos-comments.json
- [X] T002 Create feature contract test scaffolding in tests/contract/create-tenant-repos-parser-fixture.test.js and tests/contract/create-tenant-repos-validation.test.js
- [X] T003 Create feature integration test scaffolding in tests/integration/create-tenant-repos-request.test.js and tests/integration/create-tenant-repos-workflow.test.js
- [X] T004 [P] Validate and update workflow contract details in specs/019-create-tenant-repos/contracts/create-tenant-repos-workflow.yaml
- [X] T005 [P] Validate and update operator verification details in specs/019-create-tenant-repos/quickstart.md
- [X] T006 [P] Add create-tenant-repos issue form skeleton in .github/ISSUE_TEMPLATE/create-tenant-repos.yml
- [X] T007 [P] Add create-tenant-repos workflow shim skeleton in .github/workflows/create-tenant-repos.yml

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement shared parsing, tenant-resolution, approval, reconciliation, and observability plumbing required before any user story work.

**CRITICAL**: No user story implementation starts until this phase is complete.

- [X] T008 Implement operation-aware parser routing for create-tenant-repos in src/scripts/run-request-validation.js
- [X] T009 [P] Implement tenant repository request parser module in src/workflow-support/parse-tenant-repo-request.js
- [X] T010 [P] Implement tenant context resolver against tenant-registry main-branch data in src/workflow-support/resolve-tenant-context-from-registry.js
- [X] T011 [P] Implement tenant repository request validator module in src/workflow-support/validate-tenant-repo-request.js
- [X] T012 [P] Implement tenant repository approver resolver module in src/workflow-support/resolve-tenant-repo-approver.js
- [X] T013 [P] Implement tenant repository reconciliation planner module in src/workflow-support/reconcile-tenant-repo-creation.js
- [X] T014 [P] Extend approval-gate routing for tenant repository creation in src/workflow-support/approval-gate.js and src/scripts/run-approval-gate.js
- [X] T015 [P] Extend approved-execution routing for tenant repository creation in src/scripts/run-approved-execution.js
- [X] T016 [P] Extend audit artifact and execution outcome builders for tenant repository fields plus retained artifact metadata in src/workflow-support/build-audit-artifact.js and src/workflow-support/build-execution-outcome.js
- [X] T017 Add summary rendering, dry-run reporting, retained artifact publication hooks, and bounded retry hooks for tenant repository operations in src/scripts/emit-audit-summary.js and src/workflow-support/handle-rate-limit.js

**Checkpoint**: Foundational plumbing is ready for story-by-story implementation.

---

## Phase 3: User Story 1 - Validate Tenant-Scoped Repository Requests (Priority: P1) 🎯 MVP

**Goal**: Accept repository-creation intake, resolve one canonical tenant context, and block ambiguous or unauthorized requests before approval.

**Independent Test**: Submit valid and invalid requests and verify the workflow reaches `awaiting_approval` only when one tenant context resolves, requester authorization passes, a retained audit artifact is emitted, and no mutation occurs.

### Tests for User Story 1

- [X] T018 [P] [US1] Add parser fixture tests for organization, repository name, designated approver, dry_run, and justification in tests/contract/create-tenant-repos-parser-fixture.test.js
- [X] T019 [P] [US1] Add validation tests for no-tenant-match, ambiguous-tenant-match, and repository-name normalization failures in tests/contract/create-tenant-repos-validation.test.js
- [X] T020 [P] [US1] Add validation tests for tenant-registry missing, malformed, and registry-live conflict scenarios in tests/contract/create-tenant-repos-validation.test.js
- [X] T021 [P] [US1] Add integration test proving validation produces canonical tenant context and no mutation in tests/integration/create-tenant-repos-request.test.js

### Implementation for User Story 1

- [X] T022 [P] [US1] Implement issue form fields and request constraints in .github/ISSUE_TEMPLATE/create-tenant-repos.yml
- [X] T023 [US1] Implement repository-name normalization and structured request parsing in src/workflow-support/parse-tenant-repo-request.js
- [X] T024 [US1] Implement exact-one `X_Tenant` resolution from requester identity, request metadata, and tenant-registry in src/workflow-support/resolve-tenant-context-from-registry.js
- [X] T025 [US1] Implement governance validation for `X_RepoAdmin`, requester maintainer status, requester team membership, and dry-run intent in src/workflow-support/validate-tenant-repo-request.js
- [X] T026 [US1] Surface tenant-resolution findings, authorization findings, retained audit artifact persistence, and no-mutation validation status in src/workflow-support/build-audit-artifact.js and src/scripts/emit-audit-summary.js

**Checkpoint**: User Story 1 is independently functional and testable as MVP.

---

## Phase 4: User Story 2 - Require Context-Bound Approval for Repository Creation (Priority: P2)

**Goal**: Enforce designated approver authorization and reject stale or context-mismatched approvals before execution.

**Independent Test**: Evaluate approval comments from valid, stale, and unauthorized approvers and verify only current context-bound approval unlocks execution.

### Tests for User Story 2

- [X] T027 [P] [US2] Add approval-gate tests for designated authorized approver acceptance in tests/contract/create-tenant-repos-validation.test.js and tests/integration/create-tenant-repos-request.test.js
- [X] T028 [P] [US2] Add approval-gate tests for stale-context, unauthorized-approver, and central-assignment denial outcomes in tests/integration/create-tenant-repos-request.test.js

### Implementation for User Story 2

- [X] T029 [P] [US2] Implement approver authorization resolution for tenant repository requests in src/workflow-support/resolve-tenant-repo-approver.js
- [X] T030 [US2] Enforce context-marker binding and approval invalidation for tenant repository operations in src/workflow-support/approval-gate.js
- [X] T031 [US2] Wire create-tenant-repos approval outputs and guarded execution gate in .github/workflows/create-tenant-repos.yml and src/scripts/run-approval-gate.js
- [X] T032 [US2] Emit approval authorization evidence, lifecycle state transitions, retained audit artifact persistence, and stale-approval findings in src/workflow-support/build-audit-artifact.js and src/scripts/emit-audit-summary.js

**Checkpoint**: User Stories 1 and 2 are independently functional and testable.

---

## Phase 5: User Story 3 - Create In-Scope Repository and Apply Tenant Governance (Priority: P3)

**Goal**: After approval, revalidate tenant context, create the repository if needed, grant admin to `X_RepoAdmin`, and report no-op or partial-failure outcomes safely.

**Independent Test**: Run approved requests for missing, existing, and drifted repository states and verify create/no-op/block/partial-failure behavior with team-admin governance only.

### Tests for User Story 3

- [X] T033 [P] [US3] Add integration test for happy-path repository creation and `X_RepoAdmin` admin grant in tests/integration/create-tenant-repos-workflow.test.js
- [X] T034 [P] [US3] Add integration test for existing-repository no-op and missing-grant reconciliation in tests/integration/create-tenant-repos-workflow.test.js
- [X] T035 [P] [US3] Add integration test for execution-time boundary mismatch blocking before mutation in tests/integration/create-tenant-repos-workflow.test.js
- [X] T036 [P] [US3] Add integration test for permission-grant failure, retained audit artifact persistence failure, and rate-limit retry outcomes in tests/integration/create-tenant-repos-workflow.test.js

### Implementation for User Story 3

- [X] T037 [P] [US3] Implement repository existence checks and create-only-when-missing reconciliation in src/workflow-support/reconcile-tenant-repo-creation.js
- [X] T038 [US3] Implement `X_RepoAdmin` admin grant apply/no-op logic and direct-admin avoidance in src/workflow-support/reconcile-tenant-repo-creation.js and src/actions/repo-permission-policy/index.js
- [X] T039 [US3] Implement execution-time boundary revalidation and fail-closed blocked outcomes in src/scripts/run-approved-execution.js and src/workflow-support/reconcile-tenant-repo-creation.js
- [X] T040 [US3] Wire tenant repository execution flow, least-privilege permissions, and retained audit artifact upload in .github/workflows/create-tenant-repos.yml and src/actions/repo-creation-policy/index.js
- [X] T041 [US3] Emit per-step mutation, no-op, partial-failure, lifecycle state, artifact-persistence, rollback, and remediation details in src/workflow-support/build-execution-outcome.js, src/workflow-support/build-audit-artifact.js, and src/scripts/emit-audit-summary.js

**Checkpoint**: All user stories are independently functional and testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize documentation, contracts, regressions, and operator confidence across all stories.

- [X] T042 [P] Update workflow contract to match implemented fields, transitions, and permission semantics in specs/019-create-tenant-repos/contracts/create-tenant-repos-workflow.yaml
- [X] T043 [P] Update quickstart runbook with validated happy-path, no-op, blocked, and partial-failure scenarios in specs/019-create-tenant-repos/quickstart.md
- [X] T044 [P] Add cross-story regression assertions for dry-run no-mutation, no direct individual admin, and fail-closed token-capability behavior in tests/integration/create-tenant-repos-request.test.js and tests/integration/create-tenant-repos-workflow.test.js
- [X] T045 Run end-to-end feature test suite for tenant repository creation in tests/contract/create-tenant-repos-parser-fixture.test.js, tests/contract/create-tenant-repos-validation.test.js, tests/integration/create-tenant-repos-request.test.js, and tests/integration/create-tenant-repos-workflow.test.js

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1): no dependencies.
- Foundational (Phase 2): depends on Setup and blocks all user stories.
- User Story phases (Phase 3 onward): all depend on Foundational completion.
- Polish (Phase 6): depends on completion of selected user stories.

### User Story Dependencies

- US1 (P1): can begin immediately after Foundational.
- US2 (P2): can begin after Foundational and depends on US1 context markers and validation outputs.
- US3 (P3): can begin after Foundational and depends on US2 approval outcomes plus US1 tenant-resolution evidence.

### Story Completion Order

1. US1 (MVP)
2. US2
3. US3

### Within Each User Story

- Tests must be written first and fail before implementation changes.
- Parsing and validation must precede approval and execution flow updates.
- Approval gates must be enforced before privileged mutation calls.
- Reconciliation and execution outcome logic must complete before final observability outputs are finalized.

### Parallel Opportunities

- Setup tasks T004-T007 can run in parallel.
- Foundational tasks T009-T016 can run in parallel after T008.
- US1 tests T018-T021 can run in parallel.
- US2 tests T027-T028 can run in parallel.
- US3 tests T033-T036 can run in parallel.
- Polish tasks T042-T044 can run in parallel.

---

## Parallel Example: User Story 1

- Task: T018 [US1] in tests/contract/create-tenant-repos-parser-fixture.test.js
- Task: T019 [US1] in tests/contract/create-tenant-repos-validation.test.js
- Task: T021 [US1] in tests/integration/create-tenant-repos-request.test.js

## Parallel Example: User Story 2

- Task: T027 [US2] in tests/contract/create-tenant-repos-validation.test.js and tests/integration/create-tenant-repos-request.test.js
- Task: T028 [US2] in tests/integration/create-tenant-repos-request.test.js
- Task: T029 [US2] in src/workflow-support/resolve-tenant-repo-approver.js

## Parallel Example: User Story 3

- Task: T033 [US3] in tests/integration/create-tenant-repos-workflow.test.js
- Task: T034 [US3] in tests/integration/create-tenant-repos-workflow.test.js
- Task: T037 [US3] in src/workflow-support/reconcile-tenant-repo-creation.js

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 Setup.
2. Complete Phase 2 Foundational prerequisites.
3. Complete Phase 3 (US1).
4. Validate US1 independently before proceeding.

### Incremental Delivery

1. Deliver US1 and verify tenant resolution, authorization, and dry-run no-mutation behavior.
2. Deliver US2 and verify context-bound approval semantics.
3. Deliver US3 and verify repository creation, idempotent no-op, and partial-failure handling.
4. Run Phase 6 polish and full regression suite.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. After Foundational completion:
   - Engineer A: US1 parsing, tenant resolution, and contract tests.
   - Engineer B: US2 approval-gate and approver authorization logic.
   - Engineer C: US3 reconciliation, permission grant logic, and integration tests.
3. Merge story increments independently after each story checkpoint.

---

## Notes

- [P] indicates tasks that can execute concurrently when dependencies are satisfied.
- [US1], [US2], [US3] provide story traceability.
- Suggested MVP scope: through Phase 3 (US1).
- All tasks use explicit file paths and are aligned to repository structure conventions.
