---

description: "Task list template for feature implementation"
---

# Tasks: Add Business Contacts to Tenant Repository Creation

**Input**: Design documents from `specs/021-add-business-contact-to-repo-creation/`
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/business-contacts.md ✅ | quickstart.md ✅

Use the constitution section `Repository Structure Conventions` as the default authority for repository paths, generated artifact placement, and test layout unless the plan documents an approved exception.

**Tests**: Test tasks are included because spec.md sections TE-001 through TE-013 define explicit required test coverage for parser, validation, audit, integration, and regression paths.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Exact file paths are included in every description

## Path Conventions

- Issue forms: `.github/ISSUE_TEMPLATE/`
- Workflow-support modules: `src/workflow-support/`
- Contract tests: `tests/contract/`
- Fixtures: `tests/fixtures/`
- Integration tests: `tests/integration/`

---

## Phase 1: Setup

**Purpose**: Confirm the existing source and test layout matches the plan structure before making any changes

- [ ] T001 Review existing `src/workflow-support/` and `tests/` directory layout and confirm `parse-tenant-repo-request.js`, `validate-tenant-repo-request.js`, `build-audit-artifact.js`, `tests/contract/`, `tests/fixtures/`, and `tests/integration/` are all present and match the structure in `specs/021-add-business-contact-to-repo-creation/plan.md`

---

## Phase 2: Foundational (Blocking Prerequisite for All User Stories)

**Purpose**: Create `normalize-contact.js` — the shared contact normalisation and format validation module that all user story implementations depend on

**⚠️ CRITICAL**: Tasks T003, T006, T007, T009, T012, T013 all depend on this phase being complete

- [ ] T002 Create `src/workflow-support/normalize-contact.js` exporting `normalizeContact(rawValue)` that returns `{ normalized, type }` where type is `'handle'`, `'email'`, `'absent'`, or `'invalid'`; implement GitHub handle rules (strip leading `@`, regex `^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$`, normalise to lowercase) and email rules (`/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`, case-preserved); treat blank/null/undefined input as `type: 'absent'`; return `type: 'invalid'` when neither format matches — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` `normalize-contact.js` Module Contract

**Checkpoint**: `normalize-contact.js` created and ready — all user story work can begin

---

## Phase 3: User Story 1 — Capture Primary Contact (Priority: P1) 🎯 MVP

**Goal**: A requester submits a tenant repo creation request with a valid GitHub handle or email as `primary_contact`; the value is parsed, validated, and recorded in the audit artifact. Requests with a missing or blank `primary_contact` are rejected before approval.

**Independent Test**: Submit a valid create-repo issue form payload with `primary_contact` set to a GitHub handle and verify the parsed request object contains `primary_contact: 'octocat'` and `primary_contact_type: 'handle'`, validation passes, and the audit artifact contains the contact value.

### Tests for User Story 1

- [ ] T003 [P] [US1] Add parser contract test cases for `primary_contact` to `tests/contract/parse-tenant-repo-request.test.js`: verify bare handle (`octocat`) returns `primary_contact: 'octocat'` / `primary_contact_type: 'handle'`; verify `@`-prefixed handle (`@octocat`) normalises to `primary_contact: 'octocat'` / `primary_contact_type: 'handle'`; verify email (`alice@example.com`) returns `primary_contact_type: 'email'`; verify absent field returns `primary_contact: null` / `primary_contact_type: 'absent'` — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Parser Contract *(complete before T007 — TDD: tests first)*
- [ ] T004 [P] [US1] Add validation contract test cases for `primary_contact` to `tests/contract/validate-tenant-repo-request.test.js`: absent/blank primary rejected with `"Primary contact is required."` error and `request_status: 'validation_failed'`; valid handle passes with no error; valid email passes with no error; assert that a request with `primary_contact = '@octocat'` and a request with `primary_contact = 'octocat'` both produce the same `primary_contact_validation.normalized_value` (`'octocat'`), confirming normalisation is exercised through the validator (TE-007) — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Validation Contract
- [ ] T005 [P] [US1] Create `tests/fixtures/create-tenant-repos-with-contacts.json` fixture file with the following scenario payloads: (a) both contacts as bare GitHub handles, (b) primary as `@`-prefixed handle, (c) primary as email, (d) missing primary contact — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Test Fixture Contract

### Implementation for User Story 1

- [ ] T006 [P] [US1] Add `primary_contact` input field to `.github/ISSUE_TEMPLATE/create-tenant-repos.yml` positioned after the `repository_visibility` dropdown and before the `designated_approver` input; set `required: true`; label "Primary contact"; description stating GitHub handle is preferred over email with placeholder `octocat`; ensure the description also notes that a future enhancement may integrate automatic GitHub handle validation via the GitHub Users API (FR-017) — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Issue Form Contract
- [ ] T007 [US1] Extend `src/workflow-support/parse-tenant-repo-request.js` to `require` `normalizeContact` from `./normalize-contact`, read the raw `primary_contact` field via `readField(parsed, ['primary_contact'])`, pass it through `normalizeContact()`, and add `primary_contact` and `primary_contact_type` to the returned request object — per `specs/021-add-business-contact-to-repo-creation/data-model.md` Extended Entity and `contracts/business-contacts.md` Parser Contract
- [ ] T008 [US1] Extend `src/workflow-support/validate-tenant-repo-request.js` to validate `primary_contact`: push error `"Primary contact is required."` when `primary_contact_type === 'absent'`; push error `"Primary contact '${value}' is not a valid GitHub handle or email address."` when `primary_contact_type === 'invalid'`; add `primary_contact_validation` object (field, submitted_value, detected_type, normalized_value, validation_status, validation_reason) to the returned validation result — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Validation Contract

**Checkpoint**: US1 is independently functional — a request with a valid primary contact parses and validates end-to-end; a request missing primary contact is rejected before approval

---

## Phase 4: User Story 2 — Capture Optional Secondary Contact (Priority: P2)

**Goal**: A requester optionally provides a `secondary_contact`; the workflow accepts requests with or without it, validates the format when provided, and records it in audit outputs. Absent secondary contact never blocks the request.

**Independent Test**: Submit two requests — one with no `secondary_contact` and one with a valid GitHub handle — and verify that both pass validation, the first records `secondary_contact: null` / `secondary_contact_type: 'absent'`, and the second records the handle in the audit artifact.

### Tests for User Story 2

- [ ] T009 [P] [US2] Add parser contract test cases for `secondary_contact` to `tests/contract/parse-tenant-repo-request.test.js`: verify valid handle returns `secondary_contact_type: 'handle'`; verify valid email returns `secondary_contact_type: 'email'`; verify absent field returns `secondary_contact: null` / `secondary_contact_type: 'absent'` — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Parser Contract *(complete before T013 — TDD: tests first)*
- [ ] T010 [P] [US2] Add validation contract test cases for `secondary_contact` to `tests/contract/validate-tenant-repo-request.test.js`: absent secondary passes with no error and `secondary_contact_validation.validation_status: 'absent'`; valid handle passes; valid email passes; add `secondary_contact_validation` object to result assertions — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Validation Contract
- [ ] T011 [P] [US2] Extend `tests/fixtures/create-tenant-repos-with-contacts.json` with the following additional scenarios: (e) both contacts as emails, (f) secondary contact absent with valid primary, (g) pre-enhancement payload with no contact fields at all — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Test Fixture Contract

### Implementation for User Story 2

- [ ] T012 [P] [US2] Add `secondary_contact` input field to `.github/ISSUE_TEMPLATE/create-tenant-repos.yml` positioned after the `primary_contact` input and before `designated_approver`; set `required: false`; label "Secondary contact (optional)"; description stating GitHub handle preferred and placeholder `octocat`; ensure the description also notes that a future enhancement may integrate automatic GitHub handle validation via the GitHub Users API (FR-017) — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Issue Form Contract
- [ ] T013 [US2] Extend `src/workflow-support/parse-tenant-repo-request.js` to read `secondary_contact` via `readField(parsed, ['secondary_contact'])`, pass through `normalizeContact()`, and add `secondary_contact` and `secondary_contact_type` to the returned request object — per `specs/021-add-business-contact-to-repo-creation/data-model.md` Extended Entity and `contracts/business-contacts.md` Parser Contract
- [ ] T014 [US2] Extend `src/workflow-support/validate-tenant-repo-request.js` to validate `secondary_contact` when `secondary_contact_type !== 'absent'`: push error `"Secondary contact '${value}' is not a valid GitHub handle or email address."` when type is `'invalid'`; add `secondary_contact_validation` object to the returned validation result — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Validation Contract

**Checkpoint**: US1 + US2 are both independently functional — all valid combinations of primary and secondary contacts parse, validate, and are carried through the request lifecycle

---

## Phase 5: User Story 3 — Reject Contacts With Invalid Format Early (Priority: P3)

**Goal**: Any request whose primary or secondary contact contains a value that is neither a GitHub handle nor a well-formed email is rejected at validation before the approval gate is reached.

**Independent Test**: Submit requests with invalid format values (freeform name, URL, whitespace-only) and confirm `request_status: 'validation_failed'` with explicit contact-format findings before any approval gate is evaluated.

### Tests for User Story 3

- [ ] T015 [P] [US3] Add unit tests for `src/workflow-support/normalize-contact.js` covering: valid bare handle (`octocat` → `type: 'handle'`); valid `@`-prefixed handle (`@octocat` → `type: 'handle'`); handle with leading/trailing hyphens (invalid → `type: 'invalid'`); handle over 39 characters (invalid → `type: 'invalid'`); handle with spaces (invalid → `type: 'invalid'`); valid email with `+` alias (`alice+repo@example.com` → `type: 'email'`); email with no domain (invalid → `type: 'invalid'`); freeform string with no `@` (invalid → `type: 'invalid'`); blank/null/undefined input (→ `type: 'absent'`) — per `specs/021-add-business-contact-to-repo-creation/data-model.md` GitHub Handle Validation Rules and Email Validation Rules
- [ ] T016 [P] [US3] Extend `tests/fixtures/create-tenant-repos-with-contacts.json` with invalid-format scenarios: (h) `primary_contact` as a freeform name; (i) `primary_contact` valid but `secondary_contact` as an invalid URL; extend `tests/contract/validate-tenant-repo-request.test.js` with assertions that both scenarios produce `validation_failed` with explicit contact format findings — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Test Fixture Contract

### Implementation for User Story 3

- [ ] T017 [US3] Review `src/workflow-support/normalize-contact.js` against all edge cases in `specs/021-add-business-contact-to-repo-creation/spec.md` Edge Cases section (whitespace-only input, handle ending in hyphen, `+` alias email, same value for both contacts); add any missing guards so all edge cases return the correct type without throwing — per `specs/021-add-business-contact-to-repo-creation/data-model.md` GitHub Handle Validation Rules and Email Validation Rules

**Checkpoint**: Invalid contact values are rejected at validation for both primary and secondary fields across all edge cases defined in the spec

---

## Phase 6: User Story 4 — Carry Contact Metadata Through Execution and Audit (Priority: P4)

**Goal**: Both contact values from the validated request appear in every audit artifact and step summary for executed, no-op, and partial-failure workflow runs. Repository creation and governance-grant behaviour are unchanged.

**Independent Test**: Run a full approved happy-path request with both contacts provided and inspect the retained audit artifact JSON — it must contain `primary_contact`, `primary_contact_type`, `secondary_contact`, and `secondary_contact_type` fields matching the submitted values.

### Tests for User Story 4

- [ ] T018 [P] [US4] Add integration test to `tests/integration/create-tenant-repos.test.js` for the happy-path execution scenario: verify audit artifact JSON contains `primary_contact`, `primary_contact_type`, `secondary_contact`, and `secondary_contact_type` matching submitted values; verify step summary text includes both contact values — per spec `SC-003` and `OR-001`
- [ ] T019 [P] [US4] Add integration test to `tests/integration/create-tenant-repos.test.js` for the no-op execution scenario (repository already exists): verify audit artifact still records both contact fields from the current request even when no mutation occurs — per spec acceptance scenario US4.3 and `RL-004`

### Implementation for User Story 4

- [ ] T020 [US4] Extend `src/workflow-support/build-audit-artifact.js` in the `tenant_repo_creation` operation branch to add `primary_contact: request.primary_contact ?? null`, `primary_contact_type: request.primary_contact_type ?? 'absent'`, `secondary_contact: request.secondary_contact ?? null`, and `secondary_contact_type: request.secondary_contact_type ?? 'absent'` to every audit record — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Audit Contract and `data-model.md` Audit Artifact Schema Extension
- [ ] T021 [US4] Extend the workflow step summary emitter (locate the summary-writing section in `src/workflow-support/build-audit-artifact.js` or the dedicated summary script) to display: `Primary contact: <value> (<type>)` or `Primary contact: (not provided)` and the equivalent line for secondary contact — per `specs/021-add-business-contact-to-repo-creation/contracts/business-contacts.md` Audit Contract (Step summaries)

**Checkpoint**: Audit artifacts and step summaries for all execution paths (executed, no-op, partial-failure) include both contact fields

---

## Final Phase: Polish & Cross-Cutting Concerns

**Purpose**: Backward compatibility, regression gate, and dry-run coverage to ensure no predecessor workflow behaviour is altered

- [ ] T022 [P] Add backward-compatibility test to `tests/contract/parse-tenant-repo-request.test.js` using a pre-enhancement fixture payload that contains no `primary_contact` or `secondary_contact` fields; assert both return `null` / `'absent'` with no parse error — per spec `FR-018` and `TE-012`
- [ ] T023 [P] Add regression tests to `tests/integration/create-tenant-repos.test.js` confirming all pre-existing create-tenant-repos test scenarios (without contact fields) continue to produce `awaiting_approval` status, correct audit structure, and no contact-field validation errors — per spec `FR-018` and `TE-013`
- [ ] T024 [P] Add dry-run integration test to `tests/integration/create-tenant-repos.test.js`: submit a dry-run request with both contacts present; verify the dry-run planned output includes `primary_contact` and `secondary_contact` values and no repository mutation occurs — per spec `VS-007` and `TE-007` (predecessor dry-run behaviour unchanged)
- [ ] T025 [US1] Locate the approval-binding context marker or approval snapshot written by `src/workflow-support/validate-tenant-repo-request.js` (or the approval gate module); verify that `primary_contact`, `primary_contact_type`, `secondary_contact`, and `secondary_contact_type` are included in the binding artifact; if absent, extend the binding record to include them so the full lifecycle defined in FR-013 (`parsed request → validation output → approval artifact → execution → audit artifact`) is complete — per spec `FR-013` and `contracts/business-contacts.md` Execution Contract
- [ ] T026 [P] Add a contract or integration test that simulates audit persistence failure after successful repository creation and governance grants; verify the workflow reports `partial_failure` (not silent success) and that the partial artifact still contains the contact fields from the request — per spec `RH-002` and `SC-003`

---

## Dependencies

```
T001 (setup)
  └─ T002 (normalize-contact.js)
       ├─ T007 (parse primary_contact)
       │    └─ T008 (validate primary_contact)
       │         └─ T020 (audit artifact includes contacts)
       │              └─ T021 (step summary)
       └─ T013 (parse secondary_contact)
            └─ T014 (validate secondary_contact)

T005 (fixtures) → T003 (parser tests) → T007 (parser implementation) [TDD order]
T005 (fixtures) → T004 (validator tests) → T008 (validator implementation)

T011 (fixtures ext.) → T009 (parser tests) → T013 (parser implementation)
T011 (fixtures ext.) → T010 (validator tests) → T014 (validator implementation)

T015 (normalize unit tests) → T017 (normalize edge case review)
T016 (invalid fixtures) → runs against T008/T014 implementations

T018, T019 (integration tests) → T020, T021 (audit implementation)

T022, T023, T024 (polish) → all prior phases complete
T025 (approval artifact) → depends on T008 (validate primary_contact)
T026 (partial-failure test) → depends on T020 (audit artifact)
```

## Parallel Execution Examples

### User Story 1
Tasks T003, T004, T005, and T006 touch different files and can run in parallel. T007 depends on T002 (normalize-contact.js); T008 depends on T007.

```
T002 ──► T007 ──► T008
T003 ────────────►  (contract test)
T004 ────────────►  (contract test)
T005 ────────────►  (fixture file)
T006 ────────────►  (issue form)
```

### User Story 2
T009, T010, T011, T012 can run in parallel (all different files). T013 depends on T002; T014 depends on T013.

```
T002 ──► T013 ──► T014
T009 ────────────►  (parser test)
T010 ────────────►  (validator test)
T011 ────────────►  (fixture extension)
T012 ────────────►  (issue form)
```

### User Story 3
T015 and T016 are fully parallel; T017 is a review-and-patch task that can overlap with US2 work.

### User Story 4
T018 and T019 are parallel; T020 must complete before T021.

### Final Phase
T022, T023, T024, and T026 are fully parallel after all prior phases complete, while T025 depends on T008.

## Implementation Strategy

**MVP scope (suggested)**: Complete US1 (T001–T008) first. This delivers primary contact capture end-to-end — the most important field — and can be reviewed and merged independently before US2–US4 are implemented.

**Incremental delivery**:
1. US1 (T001–T008): primary contact capture MVP — independently deployable
2. US2 (T009–T014): secondary contact extension — depends only on US1 modules
3. US3 (T015–T017): invalid format rejection hardening — focused on edge-case correctness
4. US4 (T018–T021): audit and step summary propagation — completes the full data lifecycle
5. Polish (T022–T026): regression gate — confirms no predecessor behaviour was altered
