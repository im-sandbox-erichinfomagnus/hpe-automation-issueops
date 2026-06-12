# Tasks: Tenant GitHub-Hosted Runner Creation IssueOps Workflow

**Input**: Design documents from `/specs/021-create-tenant-hosted-runner/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/create-tenant-hosted-runner-workflow.yaml
**Constitution**: Use the constitution section `Repository Structure Conventions` for repository paths.

**Tests**: Write tests first per user story, confirm they fail, then implement.
**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create feature documentation set under `specs/021-create-tenant-hosted-runner/` (spec, plan, research, data-model, quickstart, contract, checklist)
- [x] T002 [P] Create issue form `.github/ISSUE_TEMPLATE/create-tenant-hosted-runner.yml` with organization, tenant_name, runner_name, runner_image_id, runner_image_source, runner_size, runner_group_name, maximum_runners, designated_approver, dry_run, justification fields
- [x] T003 [P] Create thin workflow shim `.github/workflows/create-tenant-hosted-runner.yml` following the create-tenant-repos entrypoint pattern

**Checkpoint**: Intake surfaces exist; no business logic yet.

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: Shared modules used by validation, approval, and execution must exist before story phases.

- [x] T004 Implement `src/workflow-support/github-runner-api.js` with hosted-runner and runner-group org endpoints (list/create/delete hosted runners, list/create runner groups, reference reads) following the github-team-api fetch conventions
- [x] T005 Implement `src/workflow-support/resolve-tenant-cicd-context-from-registry.js` deriving `<tenant-slug>-admin` from registry records and authorizing requester membership via live team-membership reads
- [x] T006 [P] Implement `src/workflow-support/parse-hosted-runner-request.js` with runner-name derivation and normalization helpers
- [x] T007 [P] Implement `src/actions/hosted-runner-policy/index.js` exporting `assertHostedRunnerMutationAllowed`

**Checkpoint**: Foundational plumbing is ready for story-by-story implementation.

## Phase 3: User Story 1 - Submit and Validate Tenant Runner Creation Requests (Priority: P1) 🎯 MVP

**Goal**: Valid, tenant-authorized requests become approval-ready; everything else fails closed with actionable findings.

**Independent Test**: Submit requests across authorization and input permutations; only fully valid requests reach `awaiting_approval`.

### Tests for User Story 1 ⚠️

- [x] T008 [P] [US1] Contract test `tests/contract/create-tenant-hosted-runner-parser-fixture.test.js` covering issue-form fixture scaffold, parser field mapping, name derivation, and normalization
- [x] T009 [P] [US1] Contract test `tests/contract/create-tenant-hosted-runner-validation.test.js` covering tenant resolution, topology admin membership authorization, missing-team fail-closed, name-constraint rejection, and runner-group resolution

### Implementation for User Story 1

- [x] T010 [US1] Implement `src/workflow-support/validate-hosted-runner-request.js` (tenant CI/CD context resolution, derived-name validation, image/size presence, runner-group resolution, approver authorization, existing-runner detection)
- [x] T011 [US1] Implement `src/workflow-support/reconcile-hosted-runner-creation.js` (creation_action create_hosted_runner | noop | reject, blocked reasons, dry-run posture)
- [x] T012 [US1] Wire hosted-runner detection and validation branch into `src/scripts/run-request-validation.js` (detection ordered before tenant-creation detection)
- [x] T013 [US1] Add hosted-runner summary section to `src/scripts/emit-audit-summary.js`
- [x] T014 [US1] Create fixtures `tests/fixtures/create-tenant-hosted-runner-issue.md` and `tests/fixtures/create-tenant-hosted-runner-comments.json`

**Checkpoint**: Validation pipeline produces audit artifacts and approval-ready states.

## Phase 4: User Story 2 - Approve Tenant Runner Creation in Central Repo (Priority: P2)

**Goal**: Only a designated active target-org owner can unlock execution; approvals are context-bound.

**Independent Test**: Approval comments from designated owners, non-designated users, and non-owners produce approved/denied outcomes respectively.

### Tests for User Story 2 ⚠️

- [x] T015 [P] [US2] Approval-policy coverage inside `tests/integration/create-tenant-hosted-runner-workflow.test.js` for authorized approval, non-designated denial, and non-owner denial

### Implementation for User Story 2

- [x] T016 [US2] Implement `src/workflow-support/resolve-hosted-runner-approver.js` (designated + active org owner check)
- [x] T017 [US2] Register `hosted_runner_creation` approval mode in `src/workflow-support/approval-gate.js` with context-marker binding
- [x] T018 [US2] Extend `src/scripts/run-approval-gate.js` operation handling and summary messaging for hosted-runner creation

**Checkpoint**: Approval gate enforces designated active-owner approval bound to validated context.

## Phase 5: User Story 3 - Reconcile and Execute Tenant Runner Creation (Priority: P3)

**Goal**: Approved requests converge idempotently: create when missing, no-op when present, block on boundary mismatch.

**Independent Test**: Approved runs against missing/existing runner states and changed governance state produce created/no-op/blocked outcomes.

### Tests for User Story 3 ⚠️

- [x] T019 [P] [US3] Integration test `tests/integration/create-tenant-hosted-runner-workflow.test.js` covering create path, existing-runner no-op, dry-run no-mutation, boundary mismatch blocking, and missing-token fail-closed

### Implementation for User Story 3

- [x] T020 [US3] Add `hosted_runner_creation` execution branch to `src/scripts/run-approved-execution.js` (boundary revalidation, policy guard, createHostedRunner mutation, outcome fields, terminal labels)
- [x] T021 [US3] Add operation label prefix `issueops:create-tenant-hosted-runner:` to terminal-state label maps
- [x] T022 [US3] Extend `src/workflow-support/build-audit-artifact.js` operation detection for hosted-runner creation

**Checkpoint**: Approved execution converges and emits full audit evidence.

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T023 [P] Update README supported-operations list with `create-tenant-hosted-runner`
- [x] T024 [P] Run full `node --test` suite and confirm no regressions against the pre-feature baseline
- [x] T025 Validate workflow YAML with actionlint conventions used by `.github/workflows/lint-workflows.yml`

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 has no dependencies.
- Phase 2 depends on Phase 1.
- Phases 3-5 depend on Phase 2 and proceed in priority order (US1 -> US2 -> US3) because approval consumes validation artifacts and execution consumes approval outputs.
- Phase 6 depends on all story phases.

### User Story Dependencies

- US2 consumes the audit artifact produced by US1 validation.
- US3 consumes the approval decision produced by US2.

### Within Each User Story

- Write tests first, confirm failure, then implement until green.

### Parallel Opportunities

- T002/T003 are parallel after T001.
- T006/T007 are parallel after T004-T005.
- Test-authoring tasks marked [P] can be written in parallel with each other.

## Implementation Strategy

MVP first: Phases 1-3 deliver a validating, approval-ready intake path. US2 and US3 then unlock approval and execution incrementally, keeping every checkpoint independently testable.

## Notes

- The shared modules from Phase 2 (`github-runner-api.js`, `resolve-tenant-cicd-context-from-registry.js`) are also consumed by sibling features 022 (delete hosted runner) and 023 (create tenant runner groups).
- Pre-existing csv-attachment test failures on main (19 at branch time) are outside this feature's scope; the regression gate is "no new failures".
