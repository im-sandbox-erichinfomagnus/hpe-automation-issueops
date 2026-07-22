# Tasks: Tenant GitHub-Hosted Runner Deletion IssueOps Workflow

**Input**: Design documents from `/specs/022-delete-tenant-hosted-runner/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/delete-tenant-hosted-runner-workflow.yaml, feature 021 shared modules
**Constitution**: Use the constitution section `Repository Structure Conventions` for repository paths.

**Tests**: Write tests first per user story, confirm they fail, then implement.
**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create feature documentation set under `specs/022-delete-tenant-hosted-runner/`
- [x] T002 [P] Create issue form `.github/ISSUE_TEMPLATE/delete-tenant-hosted-runner.yml`
- [x] T003 [P] Create thin workflow shim `.github/workflows/delete-tenant-hosted-runner.yml`

**Checkpoint**: Intake surfaces exist; no business logic yet.

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: Feature 021's shared modules (`github-runner-api.js`, `resolve-tenant-cicd-context-from-registry.js`, `hosted-runner-policy`, `resolve-hosted-runner-approver.js`) must exist before story phases.

- [x] T004 Verify 021 shared modules are present and expose listHostedRunners/deleteHostedRunner
- [x] T005 Implement `src/workflow-support/parse-hosted-runner-deletion-request.js` reusing the 021 derivation helpers

**Checkpoint**: Foundational plumbing is ready.

## Phase 3: User Story 1 - Submit and Validate Tenant Runner Deletion Requests (Priority: P1) 🎯 MVP

**Goal**: Tenant-authorized deletion requests become approval-ready with the live runner id resolved; everything else fails closed.

**Independent Test**: Submit requests across authorization and runner-existence permutations.

### Tests for User Story 1 ⚠️

- [x] T006 [P] [US1] Contract test `tests/contract/delete-tenant-hosted-runner-validation.test.js` covering parser equivalence (full/base name), authorization, missing-team fail-closed, runner resolution, and absent-runner no-op marking

### Implementation for User Story 1

- [x] T007 [US1] Implement `src/workflow-support/validate-hosted-runner-deletion-request.js`
- [x] T008 [US1] Implement `src/workflow-support/reconcile-hosted-runner-deletion.js`
- [x] T009 [US1] Wire deletion detection and validation branch into `src/scripts/run-request-validation.js` (after creation detection, before tenant-creation detection)
- [x] T010 [US1] Extend the hosted-runner summary section in `src/scripts/emit-audit-summary.js` for deletion
- [x] T011 [US1] Create fixture `tests/fixtures/delete-tenant-hosted-runner-issue.md`

**Checkpoint**: Validation pipeline produces audit artifacts and approval-ready states.

## Phase 4: User Story 2 - Approve Tenant Runner Deletion in Central Repo (Priority: P2)

**Goal**: Only a designated active target-org owner can unlock execution.

### Tests for User Story 2 ⚠️

- [x] T012 [P] [US2] Approval coverage inside `tests/integration/delete-tenant-hosted-runner-workflow.test.js`

### Implementation for User Story 2

- [x] T013 [US2] Register `hosted_runner_deletion` approval mode in `src/workflow-support/approval-gate.js` (shared resolver with 021)
- [x] T014 [US2] Extend `src/scripts/run-approval-gate.js` operation handling for deletion

**Checkpoint**: Approval gate enforces designated active-owner approval bound to validated context.

## Phase 5: User Story 3 - Reconcile and Execute Tenant Runner Deletion (Priority: P3)

**Goal**: Approved requests converge idempotently: delete when present, no-op when absent, block on boundary mismatch.

### Tests for User Story 3 ⚠️

- [x] T015 [P] [US3] Integration test `tests/integration/delete-tenant-hosted-runner-workflow.test.js` covering delete path, absent-runner no-op, and boundary mismatch blocking

### Implementation for User Story 3

- [x] T016 [US3] Add `hosted_runner_deletion` execution branch to `src/scripts/run-approved-execution.js` (boundary revalidation, policy guard, deleteHostedRunner mutation, 404-as-noop, outcome fields, terminal labels)
- [x] T017 [US3] Add operation label prefix `issueops:delete-tenant-hosted-runner:` to terminal-state label maps
- [x] T018 [US3] Extend `src/workflow-support/build-audit-artifact.js` operation detection for deletion

**Checkpoint**: Approved execution converges and emits full audit evidence.

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T019 [P] Update README supported-operations list with `delete-tenant-hosted-runner`
- [x] T020 [P] Run full `node --test` suite and confirm no regressions against the pre-feature baseline

## Dependencies & Execution Order

### Phase Dependencies

- Phase 2 depends on feature 021's foundational modules.
- Phases 3-5 proceed in priority order (US1 -> US2 -> US3).
- Phase 6 depends on all story phases.

### User Story Dependencies

- US2 consumes the audit artifact produced by US1 validation.
- US3 consumes the approval decision produced by US2.

## Implementation Strategy

MVP first: Phase 3 delivers a validating, approval-ready intake path; US2/US3 unlock approval and execution incrementally.

## Notes

- This feature is intentionally thin: it reuses the 021 authorization and API foundations and adds only deletion-specific parse/validate/reconcile logic plus dispatcher wiring.
