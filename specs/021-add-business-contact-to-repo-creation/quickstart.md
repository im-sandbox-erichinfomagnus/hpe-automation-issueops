# Quickstart: Add Business Contacts to Tenant Repository Creation

**Phase**: 1 — Design
**Date**: 2026-06-08
**Feature**: `021-add-business-contact-to-repo-creation`
**Branch**: `regression-fixes-cross-issueops-20260605`

This guide gives an implementer everything needed to deliver the feature end-to-end. Follow the steps in order; each step references the contract or data-model section that drives it.

---

## Prerequisites

- Access to the repository: `hpe-automation-issueops`
- Node.js available locally for running unit tests
- Familiarity with the existing `parse-tenant-repo-request.js` and `validate-tenant-repo-request.js` modules

---

## Step 1 — Create `normalize-contact.js`

**File**: `src/workflow-support/normalize-contact.js`

Create a new module that exports a single function `normalizeContact(rawValue)`. This function is the sole source of truth for GitHub handle and email format rules.

Behaviour (from `contracts/business-contacts.md` — `normalize-contact.js` Module Contract):
- Trim input whitespace.
- Return `{ normalized: null, type: 'absent' }` for blank/null/undefined input.
- Strip a leading `@`, then test against the GitHub handle regex `^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$`. If matches, return `{ normalized: lowercaseValue, type: 'handle' }`.
- Test against the email regex `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`. If matches, return `{ normalized: trimmedValue, type: 'email' }`.
- Otherwise return `{ normalized: trimmedRaw, type: 'invalid' }`.

---

## Step 2 — Update the Issue Form

**File**: `.github/ISSUE_TEMPLATE/create-tenant-repos.yml`

Insert two new `input` fields after the `repository_visibility` dropdown and before the `designated_approver` input, exactly as specified in `contracts/business-contacts.md` — Issue Form Contract.

- `primary_contact`: required, label "Primary contact", descriptive placeholder `octocat`.
- `secondary_contact`: optional, label "Secondary contact (optional)", placeholder `octocat`.

Verify the form still renders the full field sequence: organization → tenant_name → repository_name → repository_visibility → **primary_contact** → **secondary_contact** → designated_approver → dry_run → justification.

---

## Step 3 — Extend the Parser

**File**: `src/workflow-support/parse-tenant-repo-request.js`

1. `require` the new `normalizeContact` from `./normalize-contact`.
2. After the `repositoryVisibility` extraction block, add:

```js
const primaryContactRaw = normalizeText(
  readField(parsed, ['primary_contact']) || input.primaryContact || ''
);
const { normalized: primaryContact, type: primaryContactType } = normalizeContact(primaryContactRaw);

const secondaryContactRaw = normalizeText(
  readField(parsed, ['secondary_contact']) || input.secondaryContact || ''
);
const { normalized: secondaryContact, type: secondaryContactType } = normalizeContact(secondaryContactRaw);
```

3. Add `primary_contact`, `primary_contact_type`, `secondary_contact`, `secondary_contact_type` to the returned object.

The full expected return shape is in `data-model.md` — Extended Entity: Tenant Repository Creation Request.

---

## Step 4 — Extend the Validator

**File**: `src/workflow-support/validate-tenant-repo-request.js`

After the existing visibility validation block, add contact validation logic following `contracts/business-contacts.md` — Validation Contract:

- If `request.primary_contact_type === 'absent'` → push error `"Primary contact is required."`.
- If `request.primary_contact_type === 'invalid'` → push error with value and instructions.
- If `request.secondary_contact_type === 'invalid'` → push error with value and instructions.
- Absent secondary contact → no error.

Build and include `primary_contact_validation` and `secondary_contact_validation` objects in the returned validation result, using the shape in `contracts/business-contacts.md`.

---

## Step 5 — Extend the Audit Artifact Builder

**File**: `src/workflow-support/build-audit-artifact.js`

In the `tenant_repo_creation` section (the branch that already handles `repository_visibility`), add:

```js
primary_contact: request.primary_contact ?? null,
primary_contact_type: request.primary_contact_type ?? 'absent',
secondary_contact: request.secondary_contact ?? null,
secondary_contact_type: request.secondary_contact_type ?? 'absent',
```

Update the step summary emitter to display:
- `Primary contact: octocat (handle)` or `Primary contact: alice@example.com (email)` or `Primary contact: (not provided)`
- Same pattern for secondary contact.

---

## Step 6 — Add Contract Tests and Fixtures

**New fixture file**: `tests/fixtures/create-tenant-repos-with-contacts.json`

Cover all scenarios from `contracts/business-contacts.md` — Test Fixture Contract:
- Both as handles, both as emails, `@`-prefixed handle, missing primary, invalid primary, invalid secondary, secondary absent, pre-enhancement payload.

**Extend parser contract tests**: `tests/contract/parse-tenant-repo-request.test.js`
- Add test cases for each fixture scenario verifying `primary_contact`, `primary_contact_type`, `secondary_contact`, `secondary_contact_type` in the returned object.

**Extend validation contract tests**: `tests/contract/validate-tenant-repo-request.test.js`
- Add test cases for: missing primary (rejected), invalid primary (rejected), invalid secondary (rejected), absent secondary (accepted), both valid (accepted).

---

## Step 7 — Add Regression Tests

**Extend integration tests**: `tests/integration/create-tenant-repos.test.js`

- Add a full happy-path scenario with both contacts provided (verify audit artifact contains both fields).
- Add a no-op scenario (repository already exists) verifying contacts still appear in the new audit artifact.
- Add a backward-compatibility scenario using a pre-enhancement fixture (no contact fields) verifying no validation error.

---

## Step 8 — Verify No Regression

Run the full contract and integration test suite:

```bash
npm test
```

Confirm:
1. All pre-existing `create-tenant-repos` test scenarios pass without modification.
2. All new contact test scenarios pass.
3. No changes to tenant-boundary enforcement, approval binding, or visibility validation behaviour.

---

## Acceptance Checklist

- [ ] `normalize-contact.js` created and unit-tested independently
- [ ] Issue form updated with correct field positions and validation markers
- [ ] Parser returns all four contact fields on every invocation
- [ ] Validator rejects missing/blank `primary_contact` and invalid-format values for either field
- [ ] Audit artifact and step summary include contact fields on executed, no-op, and partial-failure paths
- [ ] All existing create-tenant-repos tests pass (no regression)
- [ ] Backward-compatible with payloads that have no contact fields
