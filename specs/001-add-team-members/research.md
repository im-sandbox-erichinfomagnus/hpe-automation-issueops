# Research: Add Team Members Workflow

## Decision 1: Parse issue-form requests with `issue-ops/parser` using the explicit template file

- **Decision**: Use `issue-ops/parser@v5` with the issue body and the matching
  issue form template path so workflow steps receive typed JSON outputs and
  individual `parsed_<key>` values.
- **Rationale**: The action is designed for GitHub issue forms, preserves
  structured field behavior such as dropdown arrays and checkbox selections, and
  keeps request validation deterministic across dry-run and mutating paths.
- **Alternatives considered**:
  - Parse raw Markdown manually in shell or script steps: rejected because it is
    brittle and duplicates existing parser logic.
  - Parse the issue body without the template file: rejected because flat,
    slugified outputs weaken validation and type awareness.

## Decision 2: Use a reusable multi-stage workflow with separate validate, approve, and reconcile phases

- **Decision**: Split the feature into a request entry workflow plus reusable
  validation and reconciliation workflows or composite actions.
- **Rationale**: The constitution requires explicit separation of validation,
  approval, and mutation. Reuse also makes future IssueOps workflows adopt the
  same policy gates, logging, and retry controls.
- **Alternatives considered**:
  - A single monolithic workflow file: rejected because it makes privilege
    boundaries, review, and reuse weaker.
  - One-off scripts outside GitHub Actions reuse boundaries: rejected because
    they do not scale across additional admin workflows.

## Decision 3: Use a single PAT-backed workflow credential for privileged API access in the PoC

- **Decision**: Use one PAT-backed workflow credential, supplied to the PoC
  workflow as `GITHUB_TOKEN`, for both repository-local workflow operations and
  org team membership API calls.
- **Rationale**: The PoC explicitly prefers a simpler single-token credential
  model over external identity exchanges or multi-token setups. This reduces setup complexity while
  still allowing the workflow to exercise the required GitHub team membership
  APIs end to end.
- **Alternatives considered**:
  - External identity or multi-stage credential exchange: rejected because the
    PoC does not want extra identity setup or token minting steps.
  - Separate tokens for repo-local and org-level actions: rejected because the
    PoC wants one credential path for all operations.

## Decision 4: Reconcile by reading team state first, then mutate only missing users

- **Decision**: Read the target team and current team memberships before any
  write, normalize the requested usernames, and call the membership mutation
  endpoint only for users not already present.
- **Rationale**: The GitHub team membership endpoints support read-before-write
  membership checks and writes that can return active or pending states. A
  reconciliation-first path enforces idempotency and avoids duplicate writes.
- **Alternatives considered**:
  - Blindly call add/update for every requested user: rejected because it hides
    no-op results and increases write volume.
  - Treat repeated requests as errors: rejected because the constitution requires
    convergent re-run behavior.

## Decision 5: Treat IdP-synchronized teams and pending invitations as explicit state branches

- **Decision**: Validate and surface `403` responses for IdP-synchronized teams
  as non-retryable governance failures, and treat `pending` membership states as
  auditable partial-completion outcomes rather than silent success.
- **Rationale**: GitHub documents that team synchronization can block API-driven
  membership changes. The add/update endpoint can also create pending
  invitations, which must be represented distinctly in audit outputs.
- **Alternatives considered**:
  - Retry synchronization failures automatically: rejected because they are
    policy or system-state failures, not transient errors.
  - Collapse pending invitations into generic success: rejected because it loses
    critical state detail for requesters and approvers.

## Decision 6: Use header-aware rate-limit handling with bounded retries

- **Decision**: Inspect response headers for `x-ratelimit-remaining`,
  `x-ratelimit-reset`, and `retry-after`, avoid explicit polling of
  `GET /rate_limit` during the main path, and retry only with bounded exponential
  backoff where GitHub indicates a safe retry window.
- **Rationale**: GitHub recommends using response headers instead of extra rate
  limit calls and distinguishes primary-limit exhaustion from secondary rate
  limits. Bounded retries reduce the risk of extended throttling or bans.
- **Alternatives considered**:
  - Fixed sleep and retry for all failures: rejected because it ignores rate
    limit semantics and wastes run time.
  - No retries: rejected because transient secondary limits can clear safely.

## Decision 7: Prefer JSON audit artifacts plus human-readable issue summaries

- **Decision**: Emit a machine-readable audit artifact per run and a concise
  requester-facing summary comment or step summary containing validation,
  approval, reconciliation, and outcome results.
- **Rationale**: JSON artifacts preserve detailed audit evidence, while summary
  text keeps the workflow understandable to requesters and approvers without
  inspecting raw logs.
- **Alternatives considered**:
  - Logs only: rejected because logs are noisy and harder to use as durable
    evidence.
  - Issue comments only: rejected because they are insufficient for complete
    structured auditing.