# Research: Add Business Contacts to Tenant Repository Creation

**Phase**: 0 — Outline & Research
**Date**: 2026-06-08
**Feature**: `021-add-business-contact-to-repo-creation`
**NEEDS CLARIFICATION items resolved**: All (no open unknowns)

---

## Research Item 1 — GitHub Handle Format Validation

**Question**: What rules define a valid GitHub username so we can validate `primary_contact` / `secondary_contact` when a handle is provided?

**Decision**: Validate GitHub handles with the following rules, derived from GitHub's enforced username constraints:
- Strip a leading `@` character if present and treat the remainder as the bare username.
- Must contain only alphanumeric characters (`a-z`, `A-Z`, `0-9`) and hyphens (`-`).
- Must not start or end with a hyphen.
- Must be between 1 and 39 characters inclusive.
- Comparison is case-insensitive; normalise to lowercase in the stored value.

Regex (applied after stripping leading `@`): `^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$`

**Rationale**: These constraints match GitHub's own documented username policy and the pattern already used by `normalizeLogin()` in `parse-tenant-repo-request.js`. Using the same rules keeps the new module consistent with existing login normalisation in the codebase.

**Alternatives considered**:
- Calling the GitHub Users API (`GET /users/{username}`) at validation time to confirm the handle resolves to a real account. **Rejected for this version** because it adds an API call to the validation budget, introduces a rate-limit risk for batch scenarios, and is out of scope per spec FR-017 and GH-002. Deferred to a future enhancement.
- Allowing any non-empty string as a "best effort" handle. **Rejected** because the spec requires format validation (spec FR-009).

---

## Research Item 2 — Email Address Format Validation

**Question**: What email validation approach should be used for the fallback email case?

**Decision**: Apply a simplified RFC 5322 format check using a regex pattern that accepts the common patterns in enterprise environments:
- Local part: alphanumeric, dots, hyphens, underscores, plus signs (`+`) for aliases.
- `@` separator.
- Domain part: one or more domain labels separated by dots; final label is 2–24 characters.

Pattern (simplified): `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`

This is the same liberal approach used by many enterprise form validators: it catches clear non-emails (no `@`, no domain, whitespace) without rejecting valid edge cases like `+` aliases or subdomains.

**Rationale**: RFC 5322 in full is extremely permissive (quoted strings, comments, IP literals) and adding a strict validator would create false rejections for legitimate work email formats. The simplified check is consistent with existing field validation patterns in the codebase (e.g., `isSafeRepositoryName` in `validate-tenant-repo-request.js` uses a focused regex rather than a full spec parser).

**Alternatives considered**:
- Using the Node.js `validator` package's `isEmail()`. **Rejected** because the codebase uses no external validation library and adding a dependency for a single format check is not justified.
- Full RFC 5322 regex. **Rejected** because it is extremely complex, hard to maintain, and more permissive than a simplified check in ways that do not add practical value.

---

## Research Item 3 — Field Type for Contact Input in GitHub Issue Forms

**Question**: Does GitHub Issue Forms support a native searchable user-picker or typeahead dropdown for GitHub usernames?

**Decision**: No native user-picker or typeahead field type exists in GitHub Issue Forms as of 2026-06-08. The supported field types are `input`, `textarea`, `dropdown`, `checkboxes`, and `markdown`. Use plain `input` fields for both contact fields.

**Rationale**: A plain `input` field with a descriptive label and placeholder is the only option available natively. Spec FR-017 documents this limitation and defers an IssueOps-bot-based typeahead to a future enhancement.

**Alternatives considered**:
- Implementing a GitHub App or Actions bot that listens to issue creation events and validates handles via the GitHub Users API, then comments with validation feedback. **Out of scope for this version** per spec FR-017 — noted as a future enhancement path in the spec Assumptions.

---

## Research Item 4 — Integration with Existing `parse-tenant-repo-request.js`

**Question**: How should the two new fields be integrated into the existing parser without breaking the current return shape?

**Decision**: Follow the same pattern used for `repository_visibility` in the existing parser:
1. Read raw values using the `readField()` helper with the field IDs (`primary_contact`, `secondary_contact`) as lookup keys.
2. Pass raw values through a new `normalizeContact()` function (from the new `normalize-contact.js` module) that returns `{ value, type, normalized }` where `type` is `'handle'`, `'email'`, or `'absent'`.
3. Add `primary_contact`, `primary_contact_type`, `secondary_contact`, and `secondary_contact_type` to the returned request object.

This preserves the existing return shape (no fields are removed or renamed) and follows the additive pattern established by the visibility dropdown enhancement.

**Rationale**: The `readField()` helper and `normalizeText()` / `normalizeLogin()` utilities are already proven patterns in the codebase. Extracting contact normalisation to a separate `normalize-contact.js` module keeps the parser focused on field extraction and makes the contact rules independently testable.

---

## Research Item 5 — Audit Artifact Extension Pattern

**Question**: How should `build-audit-artifact.js` be extended to include contact fields without breaking existing callers?

**Decision**: Add `primary_contact`, `primary_contact_type`, `secondary_contact`, and `secondary_contact_type` to the section of the audit artifact builder that handles tenant repository creation (determined by the `determineOperation()` function that already returns `'tenant_repo_creation'` for this workflow). Use `null` as the value for absent or inapplicable fields so the JSON schema remains consistent.

**Rationale**: The `build-audit-artifact.js` module uses `determineOperation()` to branch between operation types. Adding the new fields in the `tenant_repo_creation` branch ensures they appear in all audit records for this workflow without affecting other operation types. Setting absent fields to `null` (rather than omitting them) allows downstream consumers to detect intentional absence vs field not yet populated.

---

## Research Item 6 — Backward Compatibility

**Question**: How do we ensure requests submitted before this enhancement (which have no contact fields) continue to be processed without errors?

**Decision**: In `parse-tenant-repo-request.js`, `readField()` returns an empty string when the key is absent. The `normalizeContact()` function must treat an empty / blank / null input as `type: 'absent'` and `normalized: null` without raising an error. Validation then only errors if `primary_contact` has `type: 'absent'` — but existing pre-enhancement requests arriving through a new issue submission would be required to fill in the field because `required: true` is set on the form. Requests arriving via fixtures or reprocessing of old issues will have no contact fields and must parse cleanly to `absent` without causing validation failures in contract or integration tests that pre-date this enhancement.

**Rationale**: Spec FR-018 mandates backward compatibility. The `readField()` + `normalizeContact()` chain naturally handles absence as `'absent'` type. Regression test coverage (TE-012, TE-013) locks this behaviour.
