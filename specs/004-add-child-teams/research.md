# Research: Add Child Teams Workflow

## Decision 1: Parse issue-form requests with `issue-ops/parser` and keep the request surface focused on one parent team and many child teams

- **Decision**: Use `issue-ops/parser@v5` with a central issue form that captures
  the target organization, one parent team identifier, one designated hierarchy
  approver login for the full batch, one or more requested child-team
  identifiers, business justification, and dry-run preference. Do not collect
  member-management, repository-permission, team-creation, or deletion input in
  this feature.
- **Rationale**: A small hierarchy-only request surface keeps validation
  deterministic, matches the repository's parser-first IssueOps pattern, and
  prevents this feature from expanding into broader team-administration concerns.
- **Alternatives considered**:
  - Capture per-child-team approvers in the same batch: rejected because it
    expands the workflow into multi-principal approval orchestration.
  - Parse raw Markdown manually: rejected because it duplicates parser behavior
    already standardized in the repository.

## Decision 2: Require one shared hierarchy approver who is currently authorized on the parent team and every requested child team

- **Decision**: Accept approval only when every requested parent-child link in
  the batch can be approved by one single designated hierarchy approver, and
  verify that approver through current GitHub organization and team-maintainer
  state on the requested parent team and every requested child team.
- **Rationale**: Approval occurs in the central repository and must remain
  unambiguous. GitHub requires organization-owner or team-maintainer authority to
  edit a team, so using one designated hierarchy approver with current authority
  across the full request batch preserves a clear approval boundary.
- **Alternatives considered**:
  - Allow central operators to approve without target-team authority: rejected
    because central assignment is routing only and should not stand in for target
    authorization.
  - Allow mixed approvers in the same request: rejected because it creates
    ambiguous batch approval state and complicates audit interpretation.

## Decision 3: Apply parent-child links by updating each child team with the requested `parent_team_id`

- **Decision**: Use GitHub's team update endpoint to set `parent_team_id` on each
  requested child team that is not already attached to the requested parent.
  Read team details and current child-team relationships through the non-legacy
  team endpoints that expose each team's `parent` field and child-team listings.
- **Rationale**: The GitHub REST team endpoints support nested teams through
  `parent_team_id` on update, and they expose current parent linkage in team
  responses. Updating only child teams that are not already attached keeps the
  mutation path narrow and matches the additive-scope requirement.
- **Alternatives considered**:
  - Rebuild hierarchy state by deleting and recreating teams: rejected because
    team creation and deletion are out of scope.
  - Use legacy team-id endpoints as the primary interface: rejected because the
    current named team endpoints are the preferred API surface.

## Decision 4: Reject re-parenting and cycle-creating requests in v1 instead of auto-healing hierarchy state

- **Decision**: Reject any request where a child team already has a different
  current parent or where attaching the requested child under the requested
  parent would create a cycle, including the case where the requested child is
  already an ancestor of the requested parent.
- **Rationale**: Re-parenting and cycle-prevention logic expand the mutation and
  rollback surface well beyond additive linking. Rejecting those cases in v1
  keeps the workflow safe, auditable, and easy to reason about.
- **Alternatives considered**:
  - Automatically detach a child from its current parent and move it: rejected
    because that is a destructive hierarchy change with a more complex approval
    model.
  - Rely on GitHub API validation alone for cycle handling: rejected because the
    workflow should fail earlier with a clear requester-facing explanation.

## Decision 5: Use the PAT-backed `ISSUEOPS_GITHUB_TOKEN` now and describe least privilege in terms of GitHub team endpoints

- **Decision**: Implement the workflow using the `ISSUEOPS_GITHUB_TOKEN` PAT,
  while documenting the minimum capability set in terms of GitHub API operations
  it must perform: read organization and team state, read child-team state,
  inspect approver eligibility, update team hierarchy, and update central issue
  records. Treat the fine-grained equivalent as `Members` organization read/write
  plus central repository issue-write capability.
- **Rationale**: The feature explicitly uses a PAT as its initial credential
  model and defers GitHub App migration. The GitHub team endpoints require
  `Members` organization read for state inspection and `Members` organization
  write for team updates.
- **Alternatives considered**:
  - Design for GitHub App first: rejected because the feature explicitly defers
    that migration.
  - Leave required permissions unspecified: rejected because the constitution
    requires explicit privilege boundaries.

## Decision 6: Reconcile by reading current parent pointers and child-team state before mutation

- **Decision**: Read current team state before mutation, classify each requested
  child as already linked, linkable, re-parent-blocked, cycle-blocked, or
  missing, and emit a reconciliation plan before execution.
- **Rationale**: GitHub is the source of truth. Read-before-write preserves
  idempotency, exposes no-op outcomes clearly, and allows the workflow to reject
  invalid hierarchy changes before mutation.
- **Alternatives considered**:
  - Blindly patch every child team's `parent_team_id` on each run: rejected
    because it hides no-op outcomes and can convert validation errors into
    mutation-time failures.
  - Use only parent-side child listings without child-side parent inspection:
    rejected because re-parenting and cycle checks require both perspectives.

## Decision 7: Use header-aware bounded retries only for retryable hierarchy mutations and stop on semantic validation failures

- **Decision**: Inspect `x-ratelimit-*` and `retry-after` headers to drive bounded
  retries for transient throttling during hierarchy mutation, and treat semantic
  failures such as missing teams, re-parenting conflicts, and cycle-creating
  requests as non-retryable.
- **Rationale**: GitHub recommends using response headers rather than dedicated
  rate-limit calls in the normal path. Hierarchy writes should retry only when
  the remote failure is plausibly transient.
- **Alternatives considered**:
  - Retry all failures uniformly: rejected because semantic validation failures
    need requester correction, not repeated mutation attempts.
  - Do not retry at all: rejected because transient throttling should not force
    avoidable operator intervention.