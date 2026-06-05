# Research: Tenant Runner Group Creation IssueOps Workflow

## Decision 1: Isolation-preserving defaults for visibility and public repositories

- Decision: Default the runner-group visibility to `selected` (no repositories attached at creation) and `allows_public_repositories` to false; accept only `selected`, `all`, or `private` visibility values.
- Rationale: Tenant isolation is the purpose of tenant runner groups. The platform default (`all`) would expose the group to every repository in the organization, crossing tenant boundaries by default. `selected` with an empty repository list creates the boundary first; repository attachment is a separate governed action.
- Alternatives considered:
  - Platform default `all`: rejected as isolation-breaking by default.
  - Requiring a repository list at creation: rejected because repository attachment has its own governance semantics (and the set-repos endpoint exists for a future operation).

## Decision 2: Reuse the 021 tenant CI/CD authorization foundation

- Decision: Authorize group requests through the shared resolver (`resolve-tenant-cicd-context-from-registry.js`) with operation marker `runner_group_creation`, plus the repository-standard designated active-org-owner approval gate, enforced by a dedicated `runner-group-policy` guard.
- Rationale: Group creation shares the runner-administration authorization boundary; the per-operation policy module keeps execution-time enforcement explicit per the repository's policy-guard convention.
- Alternatives considered:
  - Sharing the hosted-runner policy module: rejected to keep policy guards one-per-operation-family as with repo-creation/repo-permission policies.

## Decision 3: Deterministic tenant-prefixed group naming

- Decision: Derive the full group name as `TenantName_GroupBaseName` (whitespace to underscores, disallowed characters stripped, 100-character cap), with base names already carrying the exact tenant prefix used as-is.
- Rationale: Mirrors the 021 runner-name derivation so all tenant CI resources share one discoverable naming rule, making cross-tenant creation structurally impossible (CTSI-001). GitHub does not document a strict charset for group names; constraining to the runner-name charset keeps names portable across runner tooling.
- Alternatives considered:
  - Free-form names with pattern validation: rejected for the same reasons as in 021 Decision 4.

## Decision 4: Existing-group convergence semantics

- Decision: An existing runner group with the derived name is a no-op for creation regardless of its visibility or public-repository configuration; drift is reported as a warning finding, not mutated.
- Rationale: Creation semantics converge on existence. Visibility updates flow through PATCH and have blast-radius implications (repositories losing runner access) that deserve their own operation and approval.
- Alternatives considered:
  - Updating an existing group's visibility to match the request: rejected as out of scope for creation and disruptive.

## Decision 5: Runner-group API surface

- Decision: Use `POST /orgs/{org}/actions/runner-groups` with `name`, `visibility`, and `allows_public_repositories` only; omit `selected_repository_ids`, `runners`, `restricted_to_workflows`, and `network_configuration_id` in this version. List via `GET /orgs/{org}/actions/runner-groups` for existence checks and default-group resolution (shared with 021).
- Rationale: The omitted parameters belong to repository-attachment, runner-placement, and workflow-restriction operations that the tenant design tracks as separate issueops ("move Runner(s) to Tenant Runner Groups", ruleset operations).
- Alternatives considered:
  - Accepting selected_repository_ids at creation: deferred to the repository-attachment operation where per-repo tenant-boundary checks belong.
