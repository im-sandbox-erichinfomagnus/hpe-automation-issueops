# Data Model: Add Business Contacts to Tenant Repository Creation

**Phase**: 1 — Design & Contracts
**Date**: 2026-06-08
**Feature**: `021-add-business-contact-to-repo-creation`
**Predecessor data models**: `specs/019-create-tenant-repos/data-model.md`, `specs/019-create-tenant-repos-repo-visibility-dropdown/data-model.md`

---

## Overview

This feature adds two string fields to the **Tenant Repository Creation Request** entity. All other entities from the predecessor data models remain unchanged.

---

## Extended Entity: Tenant Repository Creation Request

The following two fields are added to the existing request record. No existing fields are removed or renamed.

### `primary_contact`

| Attribute | Value |
|-----------|-------|
| **Type** | `string` |
| **Required** | Yes |
| **Source** | Issue Form field `primary_contact` |
| **Parser field** | `primary_contact` |
| **Normalised field** | `primary_contact` (stored as normalised value; see below) |
| **Type tag field** | `primary_contact_type` |
| **Allowed formats** | GitHub handle (bare login or `@`-prefixed) **or** well-formed email address |
| **Preferred format** | GitHub username handle |
| **Fallback format** | Work email address |
| **Absence handling** | Treated as a validation error; request is rejected before approval gate |
| **Normalisation** | If handle: strip leading `@`, lowercase. If email: store as-is (case-preserved). |

#### `primary_contact_type`

| Value | Meaning |
|-------|---------|
| `handle` | Value was recognised and validated as a GitHub username handle |
| `email` | Value was recognised and validated as an email address |
| `absent` | Field was not provided or was blank (only allowed for `secondary_contact`) |
| `invalid` | Value was provided but matched neither format (causes validation rejection) |

---

### `secondary_contact`

| Attribute | Value |
|-----------|-------|
| **Type** | `string` or `null` |
| **Required** | No |
| **Source** | Issue Form field `secondary_contact` |
| **Parser field** | `secondary_contact` |
| **Normalised field** | `secondary_contact` |
| **Type tag field** | `secondary_contact_type` |
| **Allowed formats** | GitHub handle or well-formed email address, same rules as `primary_contact` |
| **Absence handling** | Treated as intentionally absent (`secondary_contact: null`, `secondary_contact_type: 'absent'`); request proceeds normally |
| **Normalisation** | Same as `primary_contact` when a value is provided |

---

## New Helper Entity: Contact Value

Produced by `normalize-contact.js` for each contact field.

| Field | Type | Description |
|-------|------|-------------|
| `raw` | `string` | Original unmodified input from the issue payload |
| `normalized` | `string \| null` | Normalised value (lowercase handle, or email as-is); `null` when absent |
| `type` | `'handle' \| 'email' \| 'absent' \| 'invalid'` | Detected format type after parsing |
| `validation_status` | `'valid' \| 'invalid_format' \| 'absent'` | Result of format validation |
| `validation_reason` | `string` | Human-readable reason for rejection, or empty string when valid |

---

## New Helper Entity: Contact Validation Result

Produced by `validate-tenant-repo-request.js` for each contact field.

| Field | Type | Description |
|-------|------|-------------|
| `field` | `string` | Field name (`primary_contact` or `secondary_contact`) |
| `submitted_value` | `string` | Raw value from the parsed request |
| `detected_type` | `'handle' \| 'email' \| 'absent' \| 'invalid'` | Type detected by the normaliser |
| `normalized_value` | `string \| null` | Normalised canonical value |
| `validation_status` | `'valid' \| 'missing' \| 'invalid_format'` | Outcome |
| `validation_reason` | `string` | Actionable finding for the requester |

---

## Data Flow

```
Issue Form
  │  primary_contact  (input, required)
  │  secondary_contact (input, optional)
  ▼
issue-ops/parser
  │  raw field values extracted by field ID
  ▼
parse-tenant-repo-request.js
  │  readField() → normalizeContact()
  │  → { primary_contact, primary_contact_type,
  │       secondary_contact, secondary_contact_type }
  ▼
validate-tenant-repo-request.js
  │  contact format rules from normalize-contact.js
  │  → ContactValidationResult × 2
  │  → errors[] if primary_contact absent or either invalid
  ▼
Validation Artifact + Step Summary
  │  includes contact values, types, and validation status
  ▼
Approval Gate
  │  contact fields do not affect approval binding
  ▼
Execution / Reconciliation
  │  contact values carried through; no GitHub API calls for contacts
  ▼
build-audit-artifact.js
  │  primary_contact, primary_contact_type,
  │  secondary_contact, secondary_contact_type
  ▼
Audit Artifact (JSON) + Step Summary
```

---

## GitHub Handle Validation Rules

Defined in `normalize-contact.js` (new module).

| Rule | Constraint |
|------|-----------|
| Leading `@` | Stripped before validation; presence of `@` is allowed and normalised away |
| Character set | Alphanumeric (`a-z`, `A-Z`, `0-9`) and hyphens only |
| Start/end character | Must start and end with alphanumeric (not hyphen) |
| Length | 1 to 39 characters (after stripping `@`) |
| Case | Normalised to lowercase |

Regex applied after stripping leading `@`: `^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$`

---

## Email Validation Rules

Defined in `normalize-contact.js`.

| Rule | Constraint |
|------|-----------|
| Must contain `@` | Exactly one `@` separating local part and domain |
| No whitespace | Leading/trailing whitespace is stripped; internal whitespace is invalid |
| Domain | Must contain at least one `.`; final label at least 2 characters |
| `+` aliases | Accepted in local part (e.g., `alice+repo@example.com`) |
| Subdomains | Accepted (e.g., `alice@mail.example.com`) |

Pattern: `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`

---

## Audit Artifact Schema Extension

The following fields are added to the `tenant_repo_creation` section of every audit artifact produced by `build-audit-artifact.js`.

```json
{
  "primary_contact": "octocat",
  "primary_contact_type": "handle",
  "secondary_contact": "alice@example.com",
  "secondary_contact_type": "email"
}
```

When absent:
```json
{
  "primary_contact": null,
  "primary_contact_type": "absent",
  "secondary_contact": null,
  "secondary_contact_type": "absent"
}
```

---

## Unchanged Entities

The following entities from the predecessor data models are **not modified** by this feature:

- Canonical Tenant Context
- Tenant Governance Validation Result
- Repository Creation Reconciliation Outcome
- Requested Repository Visibility
- Repository Visibility Validation Result
