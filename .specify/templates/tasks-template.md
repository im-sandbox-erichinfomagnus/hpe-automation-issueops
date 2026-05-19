---

description: "Task list template for feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: The examples below include test tasks. Tests are REQUIRED whenever the constitution or feature specification requires them. For IssueOps automation, this normally includes parser, authorization, reconciliation, dry-run, rollback, observability, and rate-limit coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **IssueOps repository**: `.github/ISSUE_TEMPLATE/`, `.github/workflows/`, `src/`, `tests/`, `specs/`
- Paths shown below assume the repository layout defined by the constitution section `Repository Structure Conventions` - adjust only when the plan explicitly records an approved exception

<!-- 
  ============================================================================
  IMPORTANT: The tasks below are SAMPLE TASKS for illustration purposes only.
  
  The /speckit.tasks command MUST replace these with actual tasks based on:
  - User stories from spec.md (with their priorities P1, P2, P3...)
  - Feature requirements from plan.md
  - Entities from data-model.md
  - Endpoints from contracts/
  
  Tasks MUST be organized by user story so each story can be:
  - Implemented independently
  - Tested independently
  - Delivered as an MVP increment
  
  DO NOT keep these sample tasks in the generated tasks.md file.
  ============================================================================
-->

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create issue form, workflow, action, docs, and test directories per implementation plan
- [ ] T002 Install and wire shared workflow dependencies (for example `issue-ops/parser`, actionlint, test fixtures)
- [ ] T003 [P] Configure linting, workflow validation, and YAML formatting tools

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

Examples of foundational tasks (adjust based on your project):

- [ ] T004 Create shared issue parsing and validation pipeline
- [ ] T005 [P] Implement authorization, approval-gate, and least-privilege permission model
- [ ] T006 [P] Create reusable workflow or shared action for GitHub API access and policy checks
- [ ] T007 Create reconciliation helpers for current-state reads, drift detection, and no-op outcomes
- [ ] T008 Configure structured logging, workflow summaries, and audit artifact generation
- [ ] T009 Setup dry-run, rollback, and rate-limit handling primitives

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T010 [P] [US1] Parser and issue-form fixture test in tests/contract/test_[name].*
- [ ] T011 [P] [US1] Integration test for approval, reconciliation no-op, and successful mutation in tests/integration/test_[name].*

### Implementation for User Story 1

- [ ] T012 [P] [US1] Create or update issue form in .github/ISSUE_TEMPLATE/[feature].yml
- [ ] T013 [P] [US1] Add reusable workflow or shared action logic in .github/workflows/ or .github/actions/
- [ ] T014 [US1] Implement authorization and approval-gate checks for the requested operation
- [ ] T015 [US1] Implement reconciliation and idempotent mutation logic for the feature
- [ ] T016 [US1] Add dry-run, rollback or compensating behavior, and failure summaries
- [ ] T017 [US1] Add structured logging, audit artifacts, and GitHub API rate-limit handling

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 2 ⚠️

- [ ] T018 [P] [US2] Parser, validation, or policy contract test in tests/contract/test_[name].*
- [ ] T019 [P] [US2] Integration test for approval, mutation, rollback, or re-run behavior in tests/integration/test_[name].*

### Implementation for User Story 2

- [ ] T020 [P] [US2] Extend issue form or policy configuration for the second workflow path
- [ ] T021 [US2] Implement reusable workflow or action changes for the second capability
- [ ] T022 [US2] Implement authorization, reconciliation, and mutation flow for the second capability
- [ ] T023 [US2] Integrate shared logging, rollback, and rate-limit handling components

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - [Title] (Priority: P3)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 3 ⚠️

- [ ] T024 [P] [US3] Contract test for parser, schema, or reusable workflow inputs in tests/contract/test_[name].*
- [ ] T025 [P] [US3] Integration test for end-to-end issue submission, approval, reconciliation, and reporting in tests/integration/test_[name].*

### Implementation for User Story 3

- [ ] T026 [P] [US3] Add issue form and workflow inputs for the third capability
- [ ] T027 [US3] Implement reusable workflow logic and GitHub API interactions for the third capability
- [ ] T028 [US3] Implement dry-run, reconciliation, mutation, and audit outputs for the third capability

**Checkpoint**: All user stories should now be independently functional

---

[Add more user story phases as needed, following the same pattern]

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] TXXX [P] Documentation updates in docs/
- [ ] TXXX Refactor duplicated workflow or action logic into reusable components
- [ ] TXXX Validate observability outputs, audit artifacts, and operator runbooks
- [ ] TXXX [P] Add extra regression tests for no-op, rollback, and rate-limit scenarios
- [ ] TXXX Security hardening and permission minimization review
- [ ] TXXX Run quickstart.md or workflow validation end to end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - May integrate with US1/US2 but should be independently testable

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- Issue form and parser contract before workflow mutation logic
- Authorization and approval gates before privileged API calls
- Core reconciliation logic before integration
- Dry-run and rollback behavior before enabling mutation by default
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Models within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together (if tests requested):
Task: "Parser and issue-form fixture test in tests/contract/test_[name].*"
Task: "Integration test for approval, reconciliation no-op, and successful mutation in tests/integration/test_[name].*"

# Launch independent workflow setup work for User Story 1 together:
Task: "Create or update issue form in .github/ISSUE_TEMPLATE/[feature].yml"
Task: "Add reusable workflow or shared action logic in .github/workflows/ or .github/actions/"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Keep file paths and generated artifacts aligned with the constitution section `Repository Structure Conventions`
- Verify tests fail before implementing
- Include explicit tasks for authorization, reconciliation, dry-run, rollback, observability, and rate-limit handling whenever the story mutates GitHub state
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
