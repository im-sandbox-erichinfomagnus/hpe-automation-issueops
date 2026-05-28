# Research: Cost Center Reallocation Workflow

## Decision 1: Parse issue-form requests with `issue-ops/parser` and carry the assignments as a pasted CSV

- **Decision**: Use `issue-ops/parser@v5` with a central issue form that captures
  the enterprise slug, the named intended approver, the assignments CSV
  textarea, a business justification, and a dry-run preference. Parse the CSV
  into normalized assignment rows downstream rather than collecting per-row form
  fields.
- **Rationale**: A pasted CSV keeps the issue form small while supporting many
  cost center and user pairs in one request. It matches the repository's
  parser-first IssueOps pattern and reuses the existing CSV parsing approach used
  by the bulk workflows.
- **Alternatives considered**:
  - Collect one assignment per form field: rejected because it cannot express
    variable-length batches and breaks the bulk request ergonomics.
  - Parse raw Markdown manually: rejected because it duplicates parser behavior
    already standardized in the repository.

## Decision 2: Enforce a single named intended approver and the exact `approved` comment convention

- **Decision**: Accept approval only when the approving commenter login matches
  the single intended approver named on the request and the comment body is
  exactly `approved`.
- **Rationale**: Approval occurs in the central repository and must remain
  unambiguous. A single named approver and the established exact-comment
  convention avoid partial approvals and reuse the approval signal already used
  by the existing team workflows.
- **Alternatives considered**:
  - Allow any enterprise owner to approve: rejected because the feature ties
    approval authority to the named approver on the request.
  - Accept fuzzy approval phrases: rejected because it weakens the auditable
    approval signal the repository depends on.

## Decision 3: Call the enterprise cost center REST API for creation and user-resource changes

- **Decision**: Use the enterprise billing cost center endpoints under
  `/enterprises/{enterprise}/settings/billing/cost-centers`. Create a cost center
  with `POST` and a `name`, add resources with `POST .../{id}/resource`, and
  remove resources with `DELETE .../{id}/resource`, using the body keys `users`,
  `organizations`, and `repositories`. This version sends `users` only.
- **Rationale**: GitHub documents these endpoints as the way to manage enterprise
  cost centers and their resources. Sending only the `users` key keeps the
  workflow aligned with the user-resource-only scope and avoids organization and
  repository side effects.
- **Alternatives considered**:
  - Manage organization and repository resources now: rejected because those
    resource types are deferred to a later enhancement.
  - Support cost center deletion in v1: rejected because the spec keeps the
    workflow to creation and user-resource add or remove only.

## Decision 4: Treat the enterprise billing token as the known blocker and default to dry-run

- **Decision**: Default every request to dry-run and require an enterprise
  billing or admin token to be present before any live mutation is attempted.
  Record this token requirement as the known blocker in the plan.
- **Rationale**: Enterprise billing access is the gating constraint for this
  workflow. Defaulting to dry-run lets operators validate and plan changes
  safely before the privileged token is in place and avoids accidental billing
  changes.
- **Alternatives considered**:
  - Default to live execution: rejected because the privileged token is not
    guaranteed and accidental billing mutation is high-impact.
  - Block all runs until the token exists: rejected because dry-run validation
    has value before the token is provisioned.

## Decision 5: Degrade gracefully when live cost center state cannot be read

- **Decision**: Run structural CSV checks unconditionally, and when no enterprise
  billing token is available, skip live cost center existence and membership
  lookups and mark live state as unverified instead of failing the request.
- **Rationale**: The structural checks deliver value without privileged access,
  and marking live state unverified keeps the dry-run path usable while making
  the audit record honest about what was and was not confirmed.
- **Alternatives considered**:
  - Fail closed whenever live state cannot be read: rejected because it blocks
    useful dry-run validation before the token exists.
  - Assume cost centers exist when unverified: rejected because it would produce
    misleading reconciliation plans.

## Decision 6: Reuse existing building blocks as standalone modules without editing the team workflows

- **Decision**: Implement standalone modules under `src/` that reuse the
  repository's token loader, bounded-retry rate-limit handler, the `approved`
  comment convention, and the CSV parsing approach, while leaving the four
  existing team workflows untouched.
- **Rationale**: Reuse keeps the new workflow consistent with repository
  conventions and minimizes duplicated policy logic, while standalone modules
  avoid regressions in the shipped team workflows.
- **Alternatives considered**:
  - Extend the existing team modules in place: rejected because it risks
    regressions in already-validated workflows.
  - Copy logic without reuse: rejected because it would drift from the shared
    conventions over time.

## Decision 7: Reconcile by checking existing cost center state before mutation and use header-aware bounded retries

- **Decision**: When live state is available, read enterprise cost center and
  membership state before mutation, classify each row as create, add, remove, or
  no-op, and inspect `x-ratelimit-*` and `retry-after` headers to drive bounded
  retries.
- **Rationale**: GitHub documents that authenticated REST requests are rate
  limited and recommends using response headers instead of polling the rate
  limit endpoint during the normal path. Read-before-mutate preserves
  idempotency and reduces write volume against billing endpoints.
- **Alternatives considered**:
  - Blindly attempt every change on each run: rejected because it hides no-op
    outcomes and increases the chance of redundant or failing calls.
  - Retry all failures uniformly: rejected because rate-limit and validation
    failures need different treatment.
