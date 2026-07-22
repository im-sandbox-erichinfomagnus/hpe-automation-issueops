# Tasks: Tenant Repository Visibility Dropdown

**Feature**: `specs/019-create-tenant-repos-repo-visibility-dropdown/spec.md`
**Inputs**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/repository-visibility-dropdown.md`

## Phase 1: Setup

- [ ] T001 Create the feature documentation and checklist files in `specs/019-create-tenant-repos-repo-visibility-dropdown/`
- [ ] T002 Ensure `.github/copilot-instructions.md` points to `specs/019-create-tenant-repos-repo-visibility-dropdown/plan.md`
- [ ] T003 [P] Confirm the repository follows the constitution structure for IssueOps features (`.github/ISSUE_TEMPLATE/`, `.github/workflows/`, `src/workflow-support/`, `tests/`)

## Phase 2: Foundational

- [ ] T004 [P] Update `.github/ISSUE_TEMPLATE/create-tenant-repos.yml` to add the repository visibility dropdown with values `private`, `internal`, and `public`, defaulting to `private`
- [ ] T005 [P] Update `.github/workflows/create-tenant-repos.yml` to pass visibility input through the parser and workflow inputs without changing existing tenant authorization flow
- [ ] T006 [P] Update `src/workflow-support/parse-tenant-repo-request.js` to normalize `repository_visibility` and default missing values to `private`
- [ ] T007 [P] Update `src/workflow-support/validate-tenant-repo-request.js` to verify requested visibility is supported by the target organization or configured policy, reject invalid values, and preserve explicit valid values
- [ ] T008 [P] Update `src/workflow-support/reconcile-tenant-repo-creation.js` to create repositories with the requested visibility and treat existing visibility mismatches as a blocked/conflict outcome
- [ ] T009 [P] Update `src/workflow-support/build-audit-artifact.js` and/or `src/scripts/emit-audit-summary.js` to include both `requested_visibility` and `actual_visibility` in audit artifacts and summary output
- [ ] T010 [P] Add or update fixture data in `tests/fixtures/` for `repository_visibility` values and default behavior
- [ ] T011 [P] Update contract definitions in `tests/contract/` or `specs/019-create-tenant-repos-repo-visibility-dropdown/contracts/repository-visibility-dropdown.md` to reflect the new parser output and validation contract

## Phase 3: User Story 1 - Select Repository Visibility When Creating Tenant Repos (Priority: P1)

**Goal**: Enable requesters to choose repository visibility at creation time and default to `private`.

**Independent Test**: Submit a tenant repo create request with explicit and omitted visibility values, then verify parsing and creation behavior.

- [X] T012 [P] [US1] Add parser tests in `tests/contract/` for explicit `private`, `internal`, and `public` visibility values
- [X] T013 [P] [US1] Add parser test in `tests/contract/` for omitted visibility and defaulting to `private`
- [X] T014 [US1] Implement issue-form visibility dropdown parsing in `src/workflow-support/parse-tenant-repo-request.js`
- [X] T015 [US1] Implement initial workflow input handling for `repository_visibility` in `.github/workflows/create-tenant-repos.yml`
- [X] T016 [US1] Add integration test in `tests/integration/` that submits a create request and verifies the parser records requested visibility
- [X] T017 [US1] Update audit artifact expectations to include `requested_visibility`

## Phase 4: User Story 2 - Reject Invalid Visibility Selections Early (Priority: P2)

**Goal**: Prevent invalid visibility values from progressing past validation.

**Independent Test**: Submit a request with an unsupported visibility value and verify validation fails with an explicit invalid-visibility finding.

- [X] T018 [P] [US2] Add validation contract tests in `tests/contract/` for unsupported visibility values
- [X] T019 [US2] Implement invalid visibility rejection in `src/workflow-support/validate-tenant-repo-request.js`
- [X] T020 [US2] Add workflow validation test in `tests/integration/` for rejected invalid visibility values
- [X] T021 [US2] Update validation summary output to display allowed visibility values and invalid selection reason

## Phase 5: User Story 3 - Preserve Intended Visibility in Workflow Execution (Priority: P3)

**Goal**: Ensure repository creation applies requested visibility and existing visibility mismatches are handled safely.

**Independent Test**: Approve a request and execute workflow for new and existing repos, verifying actual visibility behavior and audit output.

- [X] T022 [P] [US3] Add integration tests in `tests/integration/` for repository creation with `private`, `internal`, and `public` visibility
- [X] T023 [US3] Add integration tests in `tests/integration/` for existing repository with matching visibility resulting in no-op
- [X] T024 [US3] Add integration tests in `tests/integration/` for existing repository with mismatched visibility resulting in a blocked or conflict outcome
- [X] T025 [US3] Implement requested visibility application in `src/workflow-support/reconcile-tenant-repo-creation.js`
- [X] T026 [US3] Update execution audit and summary output in `src/workflow-support/build-audit-artifact.js` or `src/scripts/emit-audit-summary.js`
- [X] T027 [US3] Confirm that visibility application does not change existing tenant boundary or approval logic in `src/workflow-support/validate-tenant-repo-request.js`

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T028 [P] Update `specs/019-create-tenant-repos-repo-visibility-dropdown/quickstart.md` with the final visibility behavior and examples
- [X] T029 [P] Review and update `specs/019-create-tenant-repos-repo-visibility-dropdown/contracts/repository-visibility-dropdown.md` after implementation
- [X] T030 [P] Run full contract and integration test suite for `create-tenant-repos` workflows
- [X] T031 [P] Review GitHub step summaries and audit artifacts for the new visibility field in `src/scripts/emit-audit-summary.js`
- [X] T032 [P] Refactor duplicated visibility validation or parser code into shared workflow-support helpers if needed

## Dependencies & Execution Order

- **Phase 1** can start immediately.
- **Phase 2** foundational tasks must complete before User Story phases begin.
- **Phases 3, 4, and 5** can proceed in priority order after the foundation is ready; they can also be worked in parallel by separate team members.
- **Phase 6** is final polishing after all user stories are implemented.

## Parallel Opportunities

- All tasks marked `[P]` are safe to work on in parallel because they affect different files or documentation surfaces.
- Parser and validation changes in `src/workflow-support/` can be developed in parallel with contract and fixture updates in `tests/`.
- User Story testing and audit output polish can proceed in parallel once the feature code paths are implemented.

## Implementation Strategy

- Deliver the MVP by completing User Story 1 first, then adding validation and execution safety for User Stories 2 and 3.
- Keep the issue-form and parser contract stable before mutating repository execution logic.
- Validate each story independently with dedicated tests before moving to the next story.
- Preserve the existing tenant repository creation workflow authorization and approval model while adding visibility support.
