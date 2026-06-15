# Tasks: Remove Team Repository Access Workflow

**Input**: Design documents from `/specs/020-remove-team-repo-access/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/remove-team-repo-access-workflow.yaml](./contracts/remove-team-repo-access-workflow.yaml)

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout.

**Tests**: Tests are REQUIRED by this feature specification (TE-001 through TE-011).

**Organization**: Tasks are grouped by user story so each story is independently implementable and testable.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add feature scaffolding, workflow entrypoint, and fixtures required by all stories.

- [x] T001 Create remove-access issue form scaffold in .github/ISSUE_TEMPLATE/remove-team-repo-access.yml
- [x] T002 Create workflow entrypoint scaffold in .github/workflows/remove-team-repo-access.yml
- [x] T003 [P] Create contract test scaffold in tests/contract/remove-team-repo-access-parser-fixture.test.js
- [x] T004 [P] Create integration test scaffold in tests/integration/remove-team-repo-access-request.test.js
- [x] T005 [P] Add baseline fixture payload for manual intake in tests/fixtures/remove-team-repo-access-manual-issue.md
- [x] T006 [P] Add baseline fixture payload for csv attachment intake in tests/fixtures/remove-team-repo-access-csv-issue.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build shared parsing, authorization, validation, reconciliation, observability, dry-run, and retry primitives.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T007 Implement request parsing module for removal operation in src/workflow-support/parse-team-repo-access-removal-request.js
- [x] T008 [P] Wire issue parser outputs into validation runner in src/scripts/run-request-validation.js
- [x] T009 [P] Add designated approver eligibility guard for removal operation in src/workflow-support/resolve-team-repo-approver.js
- [x] T010 [P] Add removal operation branch handling in approval gate in src/scripts/run-approval-gate.js
- [x] T011 Implement shared repository normalization guardrails for removal requests in src/workflow-support/normalize-requested-repositories.js
- [x] T012 [P] Implement duplicate and mixed-organization rejection helper in src/workflow-support/validate-team-repo-access-removal-request.js
- [x] T013 Implement reconciliation planner for remove/noop/reject decisions in src/workflow-support/reconcile-team-repo-access-removal.js
- [x] T014 [P] Add dry-run execution short-circuit and summary shaping in src/scripts/run-approved-execution.js
- [x] T015 [P] Add bounded retry utility usage for removal mutations in src/scripts/run-approved-execution.js
- [x] T016 Add removal-specific audit fields to artifact builder in src/workflow-support/build-audit-artifact.js
- [x] T017 [P] Add removal lifecycle and terminal-state restoration support in src/scripts/restore-request-audit-artifact.js
- [x] T018 [P] Add removal operation summary renderer in src/scripts/emit-audit-summary.js

**Checkpoint**: Foundation ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Preserve Existing Safe Intake and Governance (Priority: P1) 🎯 MVP

**Goal**: Enforce central IssueOps governance semantics for removal requests with explicit approval and routing-only assignment.

**Independent Test**: Submit valid and invalid manual requests and verify validation outcomes, routing behavior, approval gating, and zero mutation before approval.

### Tests for User Story 1

- [x] T019 [P] [US1] Add manual intake parser contract coverage in tests/contract/remove-team-repo-access-parser-fixture.test.js
- [x] T020 [P] [US1] Add invalid field and conflict validation contract coverage in tests/contract/remove-team-repo-access-validation.test.js
- [x] T021 [P] [US1] Add approval-gate authorization contract coverage in tests/contract/remove-team-repo-access-approval.test.js
- [x] T022 [P] [US1] Add manual governance integration scenario in tests/integration/remove-team-repo-access-request.test.js
- [x] T056 [P] [US1] Add multi-approver batch rejection contract coverage in tests/contract/remove-team-repo-access-validation.test.js
- [x] T057 [P] [US1] Add missing or insufficient ISSUEOPS_GITHUB_TOKEN fail-closed coverage in tests/contract/remove-team-repo-access-approval.test.js

### Implementation for User Story 1

- [x] T023 [P] [US1] Implement required fields and intake-mode exclusivity rules in .github/ISSUE_TEMPLATE/remove-team-repo-access.yml
- [x] T024 [P] [US1] Implement issue/comment trigger and least-privilege permissions in .github/workflows/remove-team-repo-access.yml
- [x] T025 [US1] Implement validation taxonomy and human-readable errors for missing/invalid inputs in src/workflow-support/validate-team-repo-access-removal-request.js
- [x] T026 [US1] Enforce assignment-is-routing-only behavior in approval pipeline in src/scripts/run-approval-gate.js
- [x] T027 [US1] Enforce active-org-owner designated approver validation in src/workflow-support/resolve-team-repo-approver.js
- [x] T028 [US1] Emit governance-focused validation and authorization audit fields in src/workflow-support/build-audit-artifact.js
- [x] T058 [US1] Implement multi-approver detection and split-request guidance in src/workflow-support/validate-team-repo-access-removal-request.js
- [x] T059 [US1] Implement credential preflight and fail-closed token handling in src/scripts/run-approved-execution.js

**Checkpoint**: User Story 1 is independently functional and testable.

---

## Phase 4: User Story 2 - Remove Access Through Manual and CSV Attachment Intake (Priority: P2)

**Goal**: Support deterministic manual and csv_attachment intake with waiting lifecycle, requester-only candidate selection, supersession, and row-level diagnostics.

**Independent Test**: Run one manual request and one csv_attachment request that progresses through waiting, candidate selection, and validation with deterministic outcomes.

### Tests for User Story 2

- [x] T029 [P] [US2] Add waiting_for_attachment lifecycle contract coverage in tests/contract/remove-team-repo-access-csv-attachment-validation.test.js
- [x] T030 [P] [US2] Add requester-only and ambiguous-candidate fail-closed coverage in tests/contract/remove-team-repo-access-csv-attachment-validation.test.js
- [x] T031 [P] [US2] Add correction supersession coverage for newest eligible post-failure attachment in tests/contract/remove-team-repo-access-csv-attachment-validation.test.js
- [x] T032 [P] [US2] Add row-level CSV diagnostics and normalization coverage in tests/contract/remove-team-repo-access-csv-attachment-validation.test.js
- [x] T033 [P] [US2] Add csv attachment lifecycle integration scenario in tests/integration/remove-team-repo-access-csv-attachment-request.test.js

### Implementation for User Story 2

- [x] T034 [P] [US2] Add csv_attachment mode guidance and conditional field hints in .github/ISSUE_TEMPLATE/remove-team-repo-access.yml
- [x] T035 [US2] Implement waiting_for_attachment transition and approval block in src/scripts/run-request-validation.js
- [x] T036 [US2] Implement requester-only deterministic candidate resolution for removal operation in src/workflow-support/resolve-csv-attachment-comment.js
- [x] T037 [US2] Implement attachment download, size, decode, and hash validation flow in src/workflow-support/download-csv-attachment.js
- [x] T038 [US2] Implement CSV schema enforcement and row findings for removal requests in src/workflow-support/validate-team-repo-access-removal-request.js
- [x] T039 [US2] Persist attachment provenance and validation attempt metadata in src/workflow-support/build-audit-artifact.js

**Checkpoint**: User Stories 1 and 2 both function independently.

---

## Phase 5: User Story 3 - Execute Safe Removal with Idempotent Reconciliation (Priority: P3)

**Goal**: Remove only existing access, keep already-absent repositories as no-op, preserve idempotency, partial-failure durability, rate-limit handling, and terminal-state immutability.

**Independent Test**: Approve and execute a mixed-state request (some removable, some already absent), rerun for idempotency, and confirm terminal states ignore later attachment comments.

### Tests for User Story 3

- [X] T040 [P] [US3] Add reconciliation classification contract coverage for remove/noop/reject in tests/contract/reconcile-team-repo-access-removal.test.js
- [X] T041 [P] [US3] Add dry-run no-mutation contract coverage in tests/contract/remove-team-repo-access-execution.test.js
- [X] T042 [P] [US3] Add bounded retry and exhausted-budget contract coverage in tests/contract/remove-team-repo-access-execution.test.js
- [X] T043 [P] [US3] Add partial-failure remediation and durable outcomes contract coverage in tests/contract/remove-team-repo-access-execution.test.js
- [X] T044 [P] [US3] Add terminal-state immutability contract coverage in tests/contract/remove-team-repo-access-csv-attachment-validation.test.js
- [X] T045 [P] [US3] Add mixed-state execution and idempotent rerun integration coverage in tests/integration/remove-team-repo-access-execution.test.js
- [X] T060 [P] [US3] Add prohibited-operation scope guardrail regression coverage in tests/contract/remove-team-repo-access-execution.test.js

### Implementation for User Story 3

- [X] T046 [US3] Implement removal mutation executor branch for remove_access decisions in src/scripts/run-approved-execution.js
- [X] T047 [US3] Implement noop_already_absent and drift-aware stale-state handling in src/workflow-support/reconcile-team-repo-access-removal.js
- [X] T048 [US3] Implement partial-failure outcome aggregation and remediation guidance in src/scripts/run-approved-execution.js
- [X] T049 [US3] Enforce terminal-state immutability for post-execution attachment comments in src/scripts/run-request-validation.js
- [X] T050 [US3] Emit per-repository removed/noop/rejected/failed outcome fields in src/workflow-support/build-audit-artifact.js
- [X] T051 [US3] Add operator-facing execution summary distinctions for routing vs approval vs mutation in src/scripts/emit-audit-summary.js
- [X] T061 [US3] Implement explicit operation-scope guardrails that block unrelated admin mutations in src/scripts/run-approved-execution.js

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening across stories.

- [X] T052 [P] Update operator runbook scenarios for removal workflow in specs/020-remove-team-repo-access/quickstart.md
- [X] T053 [P] Validate and align workflow contract with implemented behavior in specs/020-remove-team-repo-access/contracts/remove-team-repo-access-workflow.yaml
- [X] T054 Run actionlint and targeted workflow checks for removal entrypoint in .github/workflows/remove-team-repo-access.yml
- [X] T055 Run contract and integration test suites for feature 020 in tests/integration/remove-team-repo-access-execution.test.js

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies.
- **Phase 2 (Foundational)**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 (US1)**: Depends on Phase 2 and is the MVP.
- **Phase 4 (US2)**: Depends on Phase 2 and integrates with US1 governance primitives.
- **Phase 5 (US3)**: Depends on Phase 2 and uses US1/US2 validation and approval outputs.
- **Phase 6 (Polish)**: Depends on completion of targeted user stories.

### User Story Dependencies

- **US1 (P1)**: Starts after Foundational; no dependency on US2/US3.
- **US2 (P2)**: Starts after Foundational; can proceed in parallel with late US1 hardening but must keep US1 governance behavior intact.
- **US3 (P3)**: Starts after Foundational; requires validated intake and approval outputs from US1/US2.

### Within Each User Story

- Tests are written before implementation and should fail first.
- Issue form/workflow wiring is completed before privileged mutation logic.
- Validation and authorization checks are completed before execution logic.
- Reconciliation decisions are finalized before mutation and summary emission.

### Parallel Opportunities

- Setup tasks marked [P] can run concurrently (fixtures/tests scaffolding).
- Foundational [P] tasks can run in parallel across independent files.
- US1, US2, and US3 test tasks marked [P] can run in parallel within each story.
- Different engineers can progress US2 and US3 in parallel after Foundational completion, with merge coordination around shared files.

---

## Parallel Example: User Story 1

```bash
Task: "T019 [US1] Add manual intake parser contract coverage in tests/contract/remove-team-repo-access-parser-fixture.test.js"
Task: "T020 [US1] Add invalid field and conflict validation contract coverage in tests/contract/remove-team-repo-access-validation.test.js"
Task: "T021 [US1] Add approval-gate authorization contract coverage in tests/contract/remove-team-repo-access-approval.test.js"
```

## Parallel Example: User Story 2

```bash
Task: "T029 [US2] Add waiting_for_attachment lifecycle contract coverage in tests/contract/remove-team-repo-access-csv-attachment-validation.test.js"
Task: "T030 [US2] Add requester-only and ambiguous-candidate fail-closed coverage in tests/contract/remove-team-repo-access-csv-attachment-validation.test.js"
Task: "T031 [US2] Add correction supersession coverage in tests/contract/remove-team-repo-access-csv-attachment-validation.test.js"
```

## Parallel Example: User Story 3

```bash
Task: "T040 [US3] Add reconciliation classification contract coverage in tests/contract/reconcile-team-repo-access-removal.test.js"
Task: "T041 [US3] Add dry-run no-mutation contract coverage in tests/contract/remove-team-repo-access-execution.test.js"
Task: "T042 [US3] Add bounded retry and exhausted-budget contract coverage in tests/contract/remove-team-repo-access-execution.test.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Validate governance safety and approval blocking before any mutation-path work.

### Incremental Delivery

1. Deliver US1 as governance-safe MVP.
2. Add US2 for attachment lifecycle and high-volume intake.
3. Add US3 for execution/idempotency/terminal-state hardening.
4. Finish with Phase 6 cross-cutting verification.

### Suggested MVP Scope

- Deliver through T028 (end of US1) as first releasable increment.

---

## Notes

- All tasks follow strict checklist format: `- [ ] T### [P?] [US?] Description with file path`.
- `[US#]` labels are applied only to user-story phases.
- Setup, Foundational, and Polish phases intentionally omit story labels.
