# Research: Create Organization Teams Workflow

## Decision 1: Parse issue-form requests with `issue-ops/parser` and keep team membership out of the request model

- **Decision**: Use `issue-ops/parser@v5` with a central issue form that captures
  the target organization, a single intended owner login for the batch, the
  requested team names, business justification, and dry-run preference. Do not
  collect team member names or membership instructions in this feature.
- **Rationale**: The specification explicitly constrains the workflow to empty
  team creation. A small issue-form surface keeps validation deterministic,
  prevents the data model from expanding into member-management concerns, and
  matches the repository's parser-first IssueOps pattern.
- **Alternatives considered**:
  - Capture per-team member lists now: rejected because team population belongs
    to a separate workflow and would blur both the feature boundary and the
    approval model.
  - Parse raw Markdown manually: rejected because it duplicates parser behavior
    already standardized in the repository.

## Decision 2: Enforce a single shared intended owner for the full request batch

- **Decision**: Accept approval only when every requested team in the batch uses
  the same intended owner, and reject mixed-owner requests during validation.
- **Rationale**: Approval occurs in the central repository and must remain
  unambiguous. A single shared intended owner avoids partial approvals, complex
  approval aggregation, and ambiguous authorization state before mutation.
- **Alternatives considered**:
  - Allow one approver per team in the same batch: rejected because it expands
    the workflow into multi-principal approval orchestration.
  - Allow any designated central operator to approve: rejected because the
    feature requires approval authority to remain tied to the target-side owner.

## Decision 3: Create teams via `POST /orgs/{org}/teams` using empty-team inputs only

- **Decision**: Use the GitHub Teams REST API create-team endpoint with only the
  minimum team-definition fields needed for this feature, omitting
  `maintainers`, `repo_names`, and `parent_team_id`.
- **Rationale**: GitHub documents that team creation is supported through the
  organization teams endpoint and that fine-grained equivalents require
  `Members` organization write permission. Omitting maintainers, repository
  grants, and parent team relationships keeps the workflow aligned with the
  empty-team-only scope and minimizes privileged side effects.
- **Alternatives considered**:
  - Create the team and attach repositories or maintainers immediately: rejected
    because repository grants and membership setup are separate workflows.
  - Support nested parent teams in v1: rejected because the spec keeps parent
    teams out of scope to simplify validation and approval.

## Decision 4: Treat the creator-becomes-maintainer API behavior as an operational constraint, not a request-surface feature

- **Decision**: Record in the plan that GitHub's create-team API automatically
  makes the authenticated creator a team maintainer, and do not add compensating
  maintainer-removal logic in this feature.
- **Rationale**: GitHub documents that the authenticated user becomes a team
  maintainer when creating a new team. Removing that maintainer immediately
  would introduce team-membership mutation into a feature that is explicitly
  scoped to empty-team creation and would complicate rollback behavior.
- **Alternatives considered**:
  - Add the intended owner as a maintainer during creation: rejected because the
    workflow is not responsible for member population.
  - Remove the creator after creation: rejected because it adds a second,
    membership-mutating concern to the workflow and may leave teams unmanaged if
    the cleanup fails.

## Decision 5: Validate intended-owner eligibility through organization membership checks, not repo access

- **Decision**: Verify the intended owner and approving commenter through target
  organization membership lookups such as `GET /orgs/{org}/memberships/{username}`
  or membership-presence checks, and require active membership in the target
  organization for approval validity.
- **Rationale**: Team creation occurs at the organization scope, not the target
  repository scope. The approver in this feature is the intended owner of the
  requested teams, so organization membership is the relevant GitHub authority
  boundary to validate.
- **Alternatives considered**:
  - Validate repo-level permission for the approver: rejected because no target
    repository is part of this feature.
  - Accept central-repo visibility as approval authority: rejected because
    central issue assignment is only operational routing.

## Decision 6: Use a PAT-backed credential now, but anchor permissions to GitHub's fine-grained equivalents

- **Decision**: Implement the workflow using the `ISSUEOPS_GITHUB_TOKEN` PAT,
  while documenting the minimum capability set in terms of the GitHub API
  operations it must perform: read organization membership state, read existing
  team state, create teams, and update central-repository issues. Treat the
  fine-grained equivalent as `Members` organization read/write plus central repo
  issue-write capability.
- **Rationale**: The feature explicitly uses a PAT as its initial credential
  model and defers GitHub App migration. Describing minimum required capability
  avoids over-committing to one PAT scope string while still preserving the
  least-privilege design intent.
- **Alternatives considered**:
  - Design for GitHub App first: rejected because the feature explicitly defers
    that migration.
  - Leave required permissions unspecified: rejected because the constitution
    requires explicit credential and privilege boundaries.

## Decision 7: Reconcile by checking existing team state before creation and use header-aware bounded retries

- **Decision**: Read organization team state before mutation, classify requested
  teams as create or no-op, and inspect `x-ratelimit-*` and `retry-after`
  headers to drive bounded retries.
- **Rationale**: GitHub documents that authenticated REST requests have a
  primary limit of 5,000 requests per hour for a PAT-backed user and recommends
  using response headers instead of calling `GET /rate_limit` during the normal
  path. Read-before-create preserves idempotency and reduces write volume.
- **Alternatives considered**:
  - Blindly attempt to create every team on each run: rejected because it hides
    no-op outcomes and increases the chance of `422` validation failures.
  - Retry all failures uniformly: rejected because rate-limit and validation
    failures need different treatment.