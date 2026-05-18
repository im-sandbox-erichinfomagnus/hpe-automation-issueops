# Research: Add Team Repository Access Workflow

## Decision 1: Keep the request surface focused on one existing team, one target organization, one shared permission level, and one or more repositories

- **Decision**: Use `issue-ops/parser@v5` with a central issue form that captures the target organization, one existing team slug or name, one designated access approver login, one requested repository permission level for the full batch, one or more repository identifiers, business justification, and dry-run preference.
- **Rationale**: A narrow request surface keeps parsing and validation deterministic, matches the repository's existing IssueOps patterns, and avoids turning this workflow into general repository administration.
- **Alternatives considered**:
  - Allow multiple teams in the same request: rejected because approval, reconciliation, and audit outputs would become ambiguous across team boundaries.
  - Allow per-repository permission levels in one batch: rejected because it complicates approval scope and weakens batch-level audit clarity.

## Decision 2: Normalize user-facing repository roles to the GitHub team-permission API values and limit v1 to the built-in repository roles

- **Decision**: Accept the standard repository roles `read`, `triage`, `write`, `maintain`, and `admin` in the request surface, then normalize them to the REST API permission values `pull`, `triage`, `push`, `maintain`, and `admin` before reconciliation and mutation. Treat custom repository roles as out of scope for this feature version.
- **Rationale**: GitHub documents the organization repository role ladder from least access to most access as Read, Triage, Write, Maintain, and Admin, while the team repository endpoint accepts `pull`, `triage`, `push`, `maintain`, and `admin`. Normalizing once preserves readable issue-form input and deterministic permission comparison logic.
- **Alternatives considered**:
  - Expose raw API values such as `pull` and `push` directly to requesters: rejected because the existing repository guidance is written in user-facing repository-role language.
  - Support custom repository role names in v1: rejected because stronger-or-weaker comparison becomes organization-specific and less predictable.

## Decision 3: Resolve the valid approver for v1 as the single designated target organization owner for the full request batch

- **Decision**: Accept approval only when the designated access approver for the full request batch is the same GitHub user who comments `approved` in the central repository and that user is currently an active organization owner in the target organization.
- **Rationale**: GitHub's repository-role model grants organization owners admin access to every organization repository, including managing team access. Using one designated organization owner keeps approval unambiguous across one team and many repositories, aligns with the repository's existing approval-gate pattern, and avoids building a more complex proof that one non-owner has admin access to every repository while also being able to see the target team.
- **Alternatives considered**:
  - Allow any user with admin access on every requested repository: rejected for v1 because verifying that permission set across the full batch plus team visibility expands the authorization surface and complicates reviewer-facing explanations.
  - Allow central repository owners to approve: rejected because central assignment is routing only and must not substitute for target-side authorization.

## Decision 4: Use the modern team repository endpoints to read current access and grant only missing permissions

- **Decision**: Use the modern named team endpoints `GET /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}` and `PUT /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}` to inspect and grant team repository permissions, and avoid the legacy team-id routes.
- **Rationale**: GitHub documents the named team endpoints as the current API surface. The check endpoint returns repository details plus the team's effective permissions, and the add-or-update endpoint grants the requested permission with a simple per-repository mutation path.
- **Alternatives considered**:
  - Use the legacy team-id endpoints: rejected because GitHub marks them for migration away from the legacy routes.
  - Reconstruct access only from listing all team repositories: rejected because per-repository checks provide direct permission classification and clearer not-found handling.

## Decision 5: Classify repository access using a fixed permission-strength ladder and reject weaker existing permissions that would require an in-place permission change

- **Decision**: Compare repository access using the ordered ladder `pull < triage < push < maintain < admin`. Classify each repository as `missing_access`, `exact_match`, `stronger_existing_access`, `weaker_existing_access`, `archived_blocked`, or `missing_repository`. Grant only `missing_access`, treat `exact_match` and `stronger_existing_access` as no-op, and reject `weaker_existing_access` in v1 instead of silently updating it.
- **Rationale**: The feature scope is additive access grants only. This classification makes reconciliation explicit, preserves idempotency, and honors the spec requirement to reject cases that would require modifying weaker existing team access.
- **Alternatives considered**:
  - Update weaker existing permissions automatically: rejected because it turns an additive grant into a broader permission-management workflow.
  - Treat stronger access as an error: rejected because stronger existing access already satisfies the desired effective state without increasing privilege.

## Decision 6: Reject archived repositories and non-organization-owned targets before approval rather than deferring them to mutation-time failures

- **Decision**: Fail validation when a requested repository is archived, not owned by the target organization, or otherwise ineligible for team-access mutation through the organization team endpoints.
- **Rationale**: The GitHub endpoint requires the repository to be owned by the organization or a direct fork of an organization-owned repository, and archived repositories are explicitly called out in the spec as ineligible for this feature version. Early rejection keeps the approval surface clean and avoids approving requests that cannot safely execute.
- **Alternatives considered**:
  - Let the mutation step surface these failures ad hoc: rejected because the workflow should fail closed before approval for known ineligible targets.
  - Quietly skip archived repositories: rejected because that would hide an important policy decision from requesters and approvers.

## Decision 7: Use the PAT-backed `ISSUEOPS_GITHUB_TOKEN` with explicit repository-administration and organization-read capability boundaries

- **Decision**: Implement the workflow using the `ISSUEOPS_GITHUB_TOKEN` PAT and describe the minimum required capability set in terms of GitHub API operations: read target organization and team state, verify organization-owner approval eligibility, inspect per-repository team permissions, add team access to repositories, and update central repository issue state. The fine-grained equivalent is `Administration` repository permissions (write), `Members` organization permissions (read), `Metadata` repository permissions (read), and central repository issue-write capability.
- **Rationale**: The feature explicitly uses a PAT-backed credential model and defers GitHub App migration. GitHub documents those fine-grained permissions for checking and adding team repository permissions.
- **Alternatives considered**:
  - Leave required permissions implicit: rejected because the constitution requires explicit least-privilege boundaries.
  - Design around GitHub App tokens first: rejected because that migration remains out of scope for this feature version.

## Decision 8: Reuse the repository's shared rate-limit handling and node-based workflow stages with header-aware bounded retry only for retryable failures

- **Decision**: Reuse the existing `run-request-validation.js`, `run-approval-gate.js`, `run-approved-execution.js`, audit-artifact, and rate-limit helper patterns. Retry only when GitHub responses indicate transient throttling through `retry-after` or `x-ratelimit-*` headers, and do not retry semantic failures such as missing repositories, invalid approvals, archived repositories, or weaker-permission conflicts.
- **Rationale**: The repository already standardizes parser-first validation, approval gating, bounded retry, and artifact-first observability in Node-based workflow support modules. Staying within that pattern reduces implementation sprawl and keeps operations auditable.
- **Alternatives considered**:
  - Introduce a separate workflow runner stack for this feature: rejected because the constitution requires reusable workflow architecture.
  - Retry all failures uniformly: rejected because many of the feature's failure modes require requester correction, not repeated API calls.
