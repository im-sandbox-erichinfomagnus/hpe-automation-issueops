# Contracts: Business Contacts for Tenant Repository Creation

**Phase**: 1 — Design & Contracts
**Date**: 2026-06-08
**Feature**: `021-add-business-contact-to-repo-creation`

---

## Issue Form Contract

The tenant repository creation issue form (`/.github/ISSUE_TEMPLATE/create-tenant-repos.yml`) MUST include the following two new fields, inserted **after** `repository_visibility` and **before** `designated_approver`:

### `primary_contact` field

```yaml
- type: input
  id: primary_contact
  attributes:
    label: Primary contact
    description: >
      GitHub username (handle) of the primary business owner for this repository.
      A GitHub handle is preferred (e.g. octocat or @octocat) because it can be
      validated against GitHub. If the person does not have a GitHub account, a
      work email address is accepted as a fallback (e.g. alice@example.com).
    placeholder: "octocat"
  validations:
    required: true
```

### `secondary_contact` field

```yaml
- type: input
  id: secondary_contact
  attributes:
    label: Secondary contact (optional)
    description: >
      GitHub username or work email of a secondary or backup business owner.
      Leave blank if not applicable. A GitHub handle is preferred.
    placeholder: "octocat"
  validations:
    required: false
```

---

## Parser Contract

`parseTenantRepoRequest()` in `src/workflow-support/parse-tenant-repo-request.js` MUST be extended to return:

| Field | Type | Description |
|-------|------|-------------|
| `primary_contact` | `string \| null` | Normalised contact value; `null` when absent |
| `primary_contact_type` | `'handle' \| 'email' \| 'absent'` | Detected format type after normalisation |
| `secondary_contact` | `string \| null` | Normalised contact value; `null` when absent |
| `secondary_contact_type` | `'handle' \| 'email' \| 'absent'` | Detected format type after normalisation |

**Normalisation rules**:
- Read the raw field value using `readField(parsed, ['primary_contact'])` and `readField(parsed, ['secondary_contact'])`.
- Pass raw value to `normalizeContact(value)` from `normalize-contact.js`.
- `normalizeContact()` MUST return `{ normalized, type }` where:
  - If blank/absent → `{ normalized: null, type: 'absent' }`.
  - If matches GitHub handle rules (after stripping leading `@`) → `{ normalized: lowercaseHandle, type: 'handle' }`.
  - If matches email pattern → `{ normalized: trimmedEmail, type: 'email' }`.
  - Otherwise → `{ normalized: rawTrimmed, type: 'invalid' }` (parser stores it; validator rejects it).
- Parser MUST NOT reject `type: 'invalid'` values; rejection is delegated to the validator.

**Backward compatibility**: When `primary_contact` and `secondary_contact` are absent from the payload (pre-enhancement requests), both fields MUST be set to `null` with type `'absent'` without producing a parse error.

---

## `normalize-contact.js` Module Contract

New module: `src/workflow-support/normalize-contact.js`

### `normalizeContact(rawValue)`

```
Input:  rawValue  — string from issue body field (may be null, undefined, or empty)
Output: { normalized: string|null, type: 'handle'|'email'|'absent'|'invalid' }
```

- Trims whitespace from input before any other processing.
- Returns `type: 'absent'` and `normalized: null` when input is null, undefined, empty, or whitespace-only.
- Strips a single leading `@` character then validates against GitHub handle rules; if valid, returns `type: 'handle'` and `normalized` as lowercase bare login.
- If the value contains `@` beyond a leading prefix position (i.e., the full value looks like an email), validates against the email pattern; if valid, returns `type: 'email'` and `normalized` as trimmed original value.
- Returns `type: 'invalid'` and `normalized` as the trimmed raw value when neither format matches.

### GitHub Handle Rules (enforced by `normalizeContact`)

```
^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$
```

Applied after stripping a leading `@`. Maximum 39 characters inclusive.

### Email Rules (enforced by `normalizeContact`)

```
/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
```

Applied after trimming whitespace.

---

## Validation Contract

`validateTenantRepoRequest()` in `src/workflow-support/validate-tenant-repo-request.js` MUST be extended with the following contact validation behaviour:

### `primary_contact` validation

| Condition | Result |
|-----------|--------|
| `primary_contact_type === 'absent'` | Push error: `"Primary contact is required."` → `request_status: 'validation_failed'` |
| `primary_contact_type === 'invalid'` | Push error: `"Primary contact '${value}' is not a valid GitHub handle or email address."` → `validation_failed` |
| `primary_contact_type === 'handle'` | Push finding: `"Primary contact is a valid GitHub handle."` → no error |
| `primary_contact_type === 'email'` | Push finding: `"Primary contact is a valid email address."` → no error |

### `secondary_contact` validation

| Condition | Result |
|-----------|--------|
| `secondary_contact_type === 'absent'` | No error, no warning |
| `secondary_contact_type === 'invalid'` | Push error: `"Secondary contact '${value}' is not a valid GitHub handle or email address."` → `validation_failed` |
| `secondary_contact_type === 'handle'` | Push finding: `"Secondary contact is a valid GitHub handle."` → no error |
| `secondary_contact_type === 'email'` | Push finding: `"Secondary contact is a valid email address."` → no error |

### Validation response additions

The validation result object MUST include:

```json
{
  "primary_contact_validation": {
    "field": "primary_contact",
    "submitted_value": "<raw>",
    "detected_type": "handle|email|absent|invalid",
    "normalized_value": "<value or null>",
    "validation_status": "valid|missing|invalid_format",
    "validation_reason": "<human-readable finding>"
  },
  "secondary_contact_validation": {
    "field": "secondary_contact",
    "submitted_value": "<raw>",
    "detected_type": "handle|email|absent|invalid",
    "normalized_value": "<value or null>",
    "validation_status": "valid|absent|invalid_format",
    "validation_reason": "<human-readable finding>"
  }
}
```

**All existing validation behaviour from predecessor specs is unchanged.**

---

## Execution Contract

- Execution MUST carry `primary_contact`, `primary_contact_type`, `secondary_contact`, and `secondary_contact_type` from the validated request into the execution context.
- Contact fields MUST NOT gate or alter repository creation, governance-team permission grant, or any other mutation step.
- If the requested repository already exists (no-op path), contact fields from the current request MUST still be written to the audit artifact.

---

## Audit Contract

`build-audit-artifact.js` MUST include the following fields in every `tenant_repo_creation` audit record:

```json
{
  "primary_contact": "<normalised value or null>",
  "primary_contact_type": "handle|email|absent",
  "secondary_contact": "<normalised value or null>",
  "secondary_contact_type": "handle|email|absent"
}
```

Step summaries MUST display:
- Primary contact value and type (or `(not provided)` if absent)
- Secondary contact value and type (or `(not provided)` if absent)

---

## Test Fixture Contract

The following fixture variants MUST be added to `/tests/fixtures/`:

| Fixture scenario | `primary_contact` | `secondary_contact` | Expected parse result |
|------------------|-------------------|---------------------|-----------------------|
| Both contacts as handles | `"octocat"` | `"hubot"` | Both type `handle` |
| Primary as `@`-prefixed handle | `"@octocat"` | absent | Primary normalised to `octocat`, type `handle`; secondary `absent` |
| Primary as email | `"alice@example.com"` | absent | Primary type `email`; secondary `absent` |
| Both contacts as emails | `"alice@example.com"` | `"bob@example.com"` | Both type `email` |
| Missing primary | absent | absent | Primary type `absent` → validation error |
| Invalid format primary | `"not a handle or email"` | absent | Primary type `invalid` → validation error |
| Invalid format secondary | `"octocat"` | `"not valid"` | Primary valid; secondary type `invalid` → validation error |
| Secondary absent with valid primary | `"octocat"` | absent | Primary valid, secondary `absent` → no error |
| Pre-enhancement payload (no contact fields) | N/A | N/A | Both `absent`, no parse error, backward compatible |
