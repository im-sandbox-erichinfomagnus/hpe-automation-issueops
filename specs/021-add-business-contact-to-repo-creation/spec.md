# Feature Specification: Add Business Contacts to Tenant Repository Creation

**Feature Branch**: `021-add-business-contact-to-repo-creation`
**Created**: 2026-06-08
**Status**: Draft
**Input**: User description: "Add one required field (`primary_contact`) and one optional field (`secondary_contact`) — Primary Contact and Secondary Contact — to the existing tenant repository creation Issue Form. The fields capture business owners or points of contact for the repository. Values should be discoverable through GitHub (handle preferred, email as fallback). Position after repository_visibility dropdown and before designated_approver."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

**Predecessor Specs** (must not be regressed):
- `specs/019-create-tenant-repos/spec.md` — core tenant-scoped repository creation workflow
- `specs/019-create-tenant-repos-repo-visibility-dropdown/spec.md` — repository visibility dropdown enhancement

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture Primary Contact When Submitting a Repository Creation Request (Priority: P1)

A requester opens the tenant repository creation issue form, enters a valid GitHub handle or work email as the primary contact, and submits the request. The workflow parses the primary contact, validates it, and carries the value through to the audit artifact and execution summary.

**Why this priority**: Primary contact is a required field and is the single most important business metadata addition. Every downstream consumer of the audit artifact needs at least one human owner associated with the repository.

**Independent Test**: Can be fully tested by submitting a valid create-repo request with a valid GitHub handle in the `primary_contact` field and verifying that the parsed request records the handle, validation passes, and the audit artifact contains the primary contact.

**Acceptance Scenarios**:

1. **Given** a requester submits a create-repo request with `primary_contact` set to a valid GitHub handle (e.g., `@octocat` or `octocat`), **When** the request is parsed and validated, **Then** the parsed request records the primary contact value, validation passes for the contact field, and the primary contact appears in all audit and summary outputs.
2. **Given** a requester submits a create-repo request with `primary_contact` set to a valid work email address (e.g., `alice@example.com`), **When** the request is parsed and validated, **Then** the parsed request records the email as the primary contact, validation passes for the contact field, and the primary contact appears in all audit and summary outputs.
3. **Given** a requester submits a create-repo request with `primary_contact` left empty or omitted, **When** validation runs, **Then** the request is rejected before approval readiness is granted with an explicit finding that primary contact is required.

---

### User Story 2 - Capture Optional Secondary Contact (Priority: P2)

A requester optionally provides a secondary contact (backup owner) in the tenant repository creation form. The workflow accepts the request with or without a secondary contact, validates the format when a value is provided, and carries it through to audit outputs.

**Why this priority**: Secondary contact is optional metadata. Its absence must not block any valid request, but when present it must be validated and recorded with the same fidelity as the primary contact.

**Independent Test**: Can be fully tested by submitting valid requests with and without the secondary contact field and verifying that both variations pass validation, and that the secondary contact value is present in audit outputs only when provided.

**Acceptance Scenarios**:

1. **Given** a requester submits a create-repo request without a secondary contact, **When** validation runs, **Then** the request proceeds normally and the audit artifact records the secondary contact as absent or empty without blocking the workflow.
2. **Given** a requester submits a create-repo request with `secondary_contact` set to a valid GitHub handle, **When** validation runs, **Then** the value is recorded and appears in audit and summary outputs.
3. **Given** a requester submits a create-repo request with `secondary_contact` set to a valid work email, **When** validation runs, **Then** the value is recorded and appears in audit and summary outputs.

*Note: Rejection of an invalid-format secondary contact is covered by User Story 3, which owns all invalid-format rejection behaviour for both contact fields.*

---

### User Story 3 - Reject Contacts With Invalid Format Early (Priority: P3)

A requester submits a repository creation request whose primary or secondary contact contains a value that is neither a recognisable GitHub handle nor a well-formed email address. The workflow rejects the request during validation before any approval or repository mutation can occur.

**Why this priority**: Contact values that cannot be traced to a real person defeat the purpose of the fields. Rejecting them early, before approval, prevents audit artifacts from carrying unresolvable contact data.

**Independent Test**: Can be fully tested by submitting requests with invalid contact values and verifying that validation fails with an explicit finding before the request becomes approval-ready.

**Acceptance Scenarios**:

1. **Given** `primary_contact` contains a string that is not a GitHub handle and not a well-formed email (e.g., a freeform name or a URL), **When** validation runs, **Then** the request is rejected with an explicit finding that the primary contact format is invalid, and the approval gate is not reached.
2. **Given** `secondary_contact` is provided and contains a string that is not a GitHub handle and not a well-formed email, **When** validation runs, **Then** the request is rejected with an explicit finding that the secondary contact format is invalid, even if the primary contact is valid.

---

### User Story 4 - Carry Contact Metadata Through Execution and Audit (Priority: P4)

After approval and execution, both contact values from the original validated request appear in the execution summary and retained audit artifact. Repository creation and governance-team assignment behaviour are unchanged from the predecessor workflow.

**Why this priority**: Business contact fields are request-time metadata. They must survive the full workflow lifecycle and be present in every output record so downstream systems and operators can consume them without re-reading the issue.

**Independent Test**: Can be fully tested by running a full approved happy-path request with both contacts provided and verifying the audit artifact and step summary each contain `primary_contact` and `secondary_contact` values matching the submitted request.

**Acceptance Scenarios**:

1. **Given** a fully approved and executed request that provided both contacts, **When** execution completes, **Then** the audit artifact and workflow step summary each contain both `primary_contact` and `secondary_contact` values exactly as submitted in the validated request.
2. **Given** a fully approved and executed request that provided only the primary contact, **When** execution completes, **Then** the audit artifact contains the primary contact value and explicitly records the secondary contact as absent.
3. **Given** an approved request whose repository already exists and all governance state is already satisfied (no-op path), **When** execution records the no-op outcome, **Then** the audit artifact still captures both contact values from the current request for traceability.

---

### Edge Cases

- `primary_contact` is submitted as only whitespace; must be treated as absent and rejected.
- GitHub handle is provided with or without a leading `@` symbol; both forms must be accepted and normalised.
- GitHub handle contains characters that are not valid in a GitHub username; must be rejected.
- Work email contains an `+` alias or subdomain (e.g., `alice+repo@mail.example.com`); must be accepted as a valid email.
- Both contacts are set to the same GitHub handle or email; this must not be rejected as a duplicate.
- The `secondary_contact` field is included in the issue form but left blank; must be treated as absent (not invalid).
- The repository already exists and the contacts in the new request differ from the contacts stored in the previous audit artifact; contacts are request-time metadata only and must not trigger repository mutation.
- GitHub Issue Forms do not natively support a searchable user-picker typeahead for GitHub usernames; a plain `input` field is used and a future enhancement could integrate an IssueOps bot that validates the handle via the GitHub Users API after submission.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The issue form MUST include a `primary_contact` input field that is marked required.
- **FR-002**: The issue form MUST include a `secondary_contact` input field that is marked optional.
- **FR-003**: Both fields MUST appear after the `repository_visibility` dropdown and before the `designated_approver` field in the rendered form so the form reads: repository identity → visibility → contacts → approver → dry-run → justification.
- **FR-004**: The label and description for each contact field MUST state that a GitHub username (handle) is the preferred identifier, and that a work email address is accepted as a fallback when a GitHub handle is unavailable.
- **FR-005**: The system MUST parse `primary_contact` and `secondary_contact` from the issue body and include both in the structured parsed request data model.
- **FR-006**: The system MUST validate that `primary_contact` is present and non-empty; a missing or blank primary contact MUST cause the request to be rejected before the approval gate is reached.
- **FR-007**: When `primary_contact` is provided, the system MUST validate that the value conforms to either a GitHub handle format or a well-formed email address format.
- **FR-008**: A GitHub handle MUST be accepted with or without a leading `@` character; both forms MUST be normalised to a canonical representation.
- **FR-009**: A valid GitHub handle MUST consist only of alphanumeric characters and hyphens, not start or end with a hyphen, and be between 1 and 39 characters (consistent with GitHub username constraints).
- **FR-010**: A valid email fallback MUST conform to standard email address format (RFC 5322 simplified).
- **FR-011**: When `secondary_contact` is absent or blank, the system MUST treat it as not provided and MUST NOT reject the request on that basis.
- **FR-012**: When `secondary_contact` is present and non-blank, the system MUST apply the same GitHub handle or email format validation defined for `primary_contact`.
- **FR-013**: Both contact values MUST be carried through the full workflow lifecycle: parsed request → validation output → approval artifact → execution → audit artifact and step summary.
- **FR-014**: Repository creation, governance-team permission grant, tenant boundary enforcement, approval binding, and dry-run behaviour defined in predecessor specs MUST remain unchanged by this enhancement.
- **FR-015**: Contact fields MUST appear in all machine-readable audit artifacts and human-readable step summaries for every run that processes a request.
- **FR-016**: If a repository already exists and the contact values in the current request differ from those in a prior audit artifact, the workflow MUST record the current request contacts in the new audit artifact and MUST NOT mutate the repository or any governance state on the basis of a contact change.
- **FR-017**: The issue form description for each contact field MUST note that a future enhancement may integrate automatic GitHub handle validation via the GitHub Users API; the current implementation uses a plain input field.
- **FR-018**: The feature MUST be backward compatible; existing create-tenant-repos requests that were submitted before this enhancement was deployed MUST continue to be processed using the existing field set with contact fields treated as absent.

### Authorization Requirements *(mandatory)*

- **AR-001**: The existing authorization model for tenant repository creation MUST remain unchanged by this enhancement.
- **AR-002**: Contact field values MUST NOT affect requester or approver authorization decisions.
- **AR-003**: The workflow MUST continue to require the same tenant-boundary approvals and governance checks defined in the predecessor specs before repository creation.
- **AR-004**: Contact fields MUST NOT grant, extend, or restrict any GitHub permissions automatically.
- **AR-005**: The executing credential MUST continue to use least privilege as defined in the core workflow; no additional permissions are required to parse, validate, or record contact values.

### Validation Strategy *(mandatory)*

- **VS-001**: The issue form payload MUST be parsed into normalized `primary_contact` and `secondary_contact` fields before any approval or mutation eligibility is evaluated.
- **VS-002**: Validation MUST reject a request where `primary_contact` is absent, blank, or contains only whitespace, and MUST produce an actionable finding naming the missing field.
- **VS-003**: Validation MUST determine whether each provided contact value is a GitHub handle or an email address using format rules, and MUST reject values that match neither format.
- **VS-004**: GitHub handle validation MUST normalize the value (strip leading `@` if present) and verify character set, length, and hyphen-position rules consistent with GitHub username constraints.
- **VS-005**: Email validation MUST apply a simplified RFC 5322 check that accepts common patterns including `+` aliases and subdomains.
- **VS-006**: Validation MUST produce explicit findings for: missing primary contact, invalid primary contact format, and invalid secondary contact format.
- **VS-007**: Validation MUST include both contact values (or their absence) in the validation result artifact and in the dry-run mutation plan.
- **VS-008**: All existing validation rules from the predecessor specs (tenant resolution, governance checks, repository name, visibility, approver authority) MUST continue to apply without modification.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state for this enhancement is defined solely as the contact values being present in the audit artifact; contacts are request-time metadata and do not represent a GitHub resource state that must be reconciled.
- **RL-002**: Repository creation and governance-team admin grant desired state remain unchanged from the predecessor specs.
- **RL-003**: If a repository already exists and contacts in the current request differ from a prior audit record, execution MUST record the new contacts in the current audit artifact without triggering any repository mutation.
- **RL-004**: Re-runs MUST remain idempotent with respect to contacts: the contacts from the current request are recorded regardless of what prior audit artifacts contain.
- **RL-005**: Audit record persistence for contact fields MUST be treated as part of the execution outcome and reported if it fails.

### Rollback Handling *(mandatory)*

- **RH-001**: If validation of contact fields fails before the approval gate, the workflow MUST report a zero-change blocked result; no repository or governance mutation may occur.
- **RH-002**: If execution completes repository creation and governance grants but audit persistence of contact fields fails, the workflow MUST report partial failure rather than silent success.
- **RH-003**: Contact field parsing or validation failures MUST NOT alter rollback or compensation behaviour for any other workflow step.
- **RH-004**: The workflow MUST fail closed when primary contact is missing, consistent with fail-closed behaviour defined in the predecessor specs for missing required fields.

### Observability Requirements *(mandatory)*

- **OR-001**: The workflow MUST emit both `primary_contact` and `secondary_contact` values (or explicit absent markers) in structured audit artifacts and human-readable step summaries for every run.
- **OR-002**: Validation findings for contact fields MUST include the field name, the submitted value (or indication of absence), and the reason for rejection.
- **OR-003**: The dry-run output MUST include the parsed contact values as part of the intended request summary, alongside the existing tenant-resolution, governance, visibility, and repository mutation plan outputs.
- **OR-004**: Audit artifacts MUST record both the submitted contact format type (handle vs email) and the normalized value where applicable.
- **OR-005**: All existing observability requirements from predecessor specs MUST continue to be satisfied.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Contact field parsing and format validation are local operations requiring no GitHub API calls; they MUST NOT increase the API call budget defined by the predecessor workflow.
- **GH-002**: If a future enhancement adds GitHub Users API validation for handles, that additional API call MUST be included in the rate-limit budget analysis and must apply standard retry and backoff behaviour; this is out of scope for the current version.
- **GH-003**: If API limits prevent completion of other boundary-critical reads, the workflow MUST fail closed as defined in the predecessor specs; contact field validation does not alter this behaviour.

### Testing Expectations *(mandatory)*

- **TE-001**: Parser tests MUST cover: `primary_contact` as a bare GitHub handle, as a `@`-prefixed handle, as an email address, and as an absent/blank value.
- **TE-002**: Parser tests MUST cover: `secondary_contact` as a GitHub handle, as an email, and as absent.
- **TE-003**: Validation tests MUST cover rejection of a missing or blank `primary_contact`.
- **TE-004**: Validation tests MUST cover rejection of `primary_contact` in an invalid format (neither handle nor email).
- **TE-005**: Validation tests MUST cover rejection of `secondary_contact` in an invalid format when provided.
- **TE-006**: Validation tests MUST cover acceptance of `secondary_contact` being absent without error.
- **TE-007**: Validation tests MUST cover handle normalisation: `@octocat` and `octocat` normalise to the same canonical value.
- **TE-008**: Execution tests MUST verify that both contact values appear in audit artifacts and step summaries on a full happy-path run with both contacts.
- **TE-009**: Execution tests MUST verify that a no-op run (repository already exists) still captures contact values in the current audit artifact.
- **TE-010**: Contract tests MUST include updated issue-form payload fixtures with `primary_contact` and `secondary_contact` fields covering valid handle, valid email, missing primary, and invalid format scenarios.
- **TE-011**: Contract tests for the parse step MUST include schema expectations for the two new fields in the parsed request data model.
- **TE-012**: Regression tests MUST confirm that all existing create-tenant-repos test scenarios continue to pass when `primary_contact` and `secondary_contact` are absent from the payload (backward compatibility).
- **TE-013**: Regression tests MUST confirm that existing tenant-boundary enforcement, approval binding, visibility handling, and governance-grant behaviour are unaffected by the addition of contact fields.

### Key Entities *(include if feature involves data)*

- **Tenant Repository Creation Request** *(extended)*: The request record now additionally contains `primary_contact` (required string) and `secondary_contact` (optional string), each validated as a GitHub handle or email address, and carried through the full workflow lifecycle.
- **Contact Value**: A string field representing one point of contact for the repository. Its canonical form is either a normalised GitHub username (alphanumeric and hyphen, 1–39 characters, no leading `@`) or a well-formed email address. The preferred form is a GitHub username.
- **Contact Validation Result**: The per-field outcome of format validation, recording: field name, submitted raw value, detected type (handle / email / absent / invalid), normalised value (if applicable), and rejection reason (if applicable).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests with a missing or blank `primary_contact` are rejected before the approval gate is reached.
- **SC-002**: 100% of requests with an invalid-format contact value (for either field when provided) are rejected before the approval gate is reached.
- **SC-003**: 100% of audit artifacts for completed runs (executed, no-op, or partial-failure) include both `primary_contact` and `secondary_contact` entries.
- **SC-004**: 100% of existing create-tenant-repos test scenarios continue to pass without modification after this enhancement is deployed (no regression).
- **SC-005**: GitHub handle values submitted with or without a leading `@` are recorded in audit artifacts in the same normalised form 100% of the time.
- **SC-006**: Requesters who supply an invalid contact format receive an actionable validation finding before the request is routed for approval.

---

## Assumptions

- GitHub Issue Forms do not currently provide a native searchable user-picker or typeahead dropdown that queries GitHub users in real time; plain `input` fields are used for both contact fields in this version.
- A future enhancement may integrate an IssueOps bot or GitHub App that validates submitted GitHub handles against the GitHub Users API after issue submission; this is explicitly out of scope for the current version.
- Contact fields are request-time metadata only and do not represent a GitHub resource property (such as a team membership or repository collaborator) that the workflow must reconcile against live GitHub state.
- The GitHub username format constraints used for validation (alphanumeric and hyphens, 1–39 characters, no leading or trailing hyphen) match the rules enforced by GitHub as of this specification date.
- Work email addresses supplied as a fallback are not validated against any corporate directory or identity provider; only format validation (RFC 5322 simplified) is applied.
- Both contact fields accept any combination of handle and email (e.g., primary as handle and secondary as email, or both as emails) without restriction beyond individual field format validation.
- The tenant repository creation workflow deployment pipeline can update the issue form template and the parser/validator modules in the same release without requiring a phased rollout.
- Existing tenant-registry data, team hierarchy, approval model, execution logic, and audit artifact schema from the predecessor specs remain unchanged except for the addition of the two new contact fields.
