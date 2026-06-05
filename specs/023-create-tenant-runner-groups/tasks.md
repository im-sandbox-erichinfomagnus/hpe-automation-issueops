# Tasks: Tenant Runner Group Creation IssueOps Workflow

**Input**: Design documents from `/specs/023-create-tenant-runner-groups/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/create-tenant-runner-groups-workflow.yaml, feature 021 shared modules
**Constitution**: Use the constitution section `Repository Structure Conventions` for repository paths.

**Tests**: Write tests first per user story, confirm they fail, then implement.
**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create feature documentation set under `specs/023-create-tenant-runner-groups/`
- [x] T002 [P] Create issue form `.github/ISSUE_TEMPLATE/create-tenant-runner-groups.yml`
- [x] T003 [P] Create thin workflow shim `.github/workflows/create-tenant-runner-groups.yml`

**Checkpoint**: Intake surfaces exist; no business logic yet.

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: Feature 021's shared modules (`github-runner-api.js` with listRunnerGroups/createRunnerGroup, `resolve-tenant-cicd-context-from-registry.js`) must exist before story phases.

- [x] T004 Verify 021 shared modules are present and expose listRunnerGroups/createRunnerGroup
- [x] T005 [P] Implement `src/workflow-support/parse-runner-group-request.js` with group-name derivation and visibility normalization
- [x] T006 [P] Implement `src/actions/runner-group-policy/index.js` exporting `assertRunnerGroupCreationAllowed`

**Checkpoint**: Foundational plumbing is ready.

## Phase 3: User Story 1 - Submit and Validate Tenant Runner Group Requests (Priority: P1) 🎯 MVP

**Goal**: Tenant-authorized group requests become approval-ready; everything else fails closed with actionable findings.

### Tests for User Story 1 ⚠️

- [x] T007 [P] [US1] Contract test `tests/contract/create-tenant-runner-groups-validation.test.js` covering parser derivation, visibility defaults/rejection, authorization, existing-group no-op marking

### Implementation for User Story 1

- [x] T008 [US1] Implement `src/workflow-support/validate-runner-group-request.js`
- [x] T009 [US1] Implement `src/workflow-support/reconcile-runner-group-creation.js`
- [x] T010 [US1] Wire runner-group detection and validation branch into `src/scripts/run-request-validation.js` (after runner detection, before tenant-creation detection)
- [x] T011 [US1] Add runner-group summary section to `src/scripts/emit-audit-summary.js`
- [x] T012 [US1] Create fixture `tests/fixtures/create-tenant-runner-groups-issue.md`

**Checkpoint**: Validation pipeline produces audit artifacts and approval-ready states.

## Phase 4: User Story 2 - Approve Tenant Runner Group Creation in Central Repo (Priority: P2)

**Goal**: Only a designated active target-org owner can unlock execution.

### Tests for User Story 2 ⚠️

- [x] T013 [P] [US2] Approval coverage inside `tests/integration/create-tenant-runner-groups-workflow.test.js`

### Implementation for User Story 2

- [x] T014 [US2] Implement `src/workflow-support/resolve-runner-group-approver.js`
- [x] T015 [US2] Register `runner_group_creation` approval mode in `src/workflow-support/approval-gate.js`
- [x] T016 [US2] Extend `src/scripts/run-approval-gate.js` operation handling for runner groups

**Checkpoint**: Approval gate enforces designated active-owner approval bound to validated context.

## Phase 5: User Story 3 - Reconcile and Execute Tenant Runner Group Creation (Priority: P3)

**Goal**: Approved requests converge idempotently: create when missing, no-op when present, block on boundary mismatch.

### Tests for User Story 3 ⚠️

- [x] T017 [P] [US3] Integration test `tests/integration/create-tenant-runner-groups-workflow.test.js` covering create path, existing-group no-op, and boundary mismatch blocking

### Implementation for User Story 3

- [x] T018 [US3] Add `runner_group_creation` execution branch to `src/scripts/run-approved-execution.js` (boundary revalidation, policy guard, createRunnerGroup mutation, outcome fields, terminal labels)
- [x] T019 [US3] Add operation label prefix `issueops:create-tenant-runner-groups:` to terminal-state label maps
- [x] T020 [US3] Extend `src/workflow-support/build-audit-artifact.js` operation detection for runner groups

**Checkpoint**: Approved execution converges and emits full audit evidence.

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T021 [P] Update README supported-operations list with `create-tenant-runner-groups`
- [x] T022 [P] Run full `node --test` suite and confirm no regressions against the pre-feature baseline

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

- Repository attachment and runner placement into tenant groups are future features per the tenant design ("move Runner(s) to Tenant Runner Groups").
