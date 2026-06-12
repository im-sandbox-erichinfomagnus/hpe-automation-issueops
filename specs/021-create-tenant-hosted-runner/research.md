# Research: Tenant GitHub-Hosted Runner Creation IssueOps Workflow

## Decision 0: Read tenant context from the canonical tenant topology (supersedes the CICDAdmins derivation)

- Decision: Resolve tenant context from the canonical tenant topology that `specs/022-enhance-tenant-topology` stores in `tenant-registry/` (record carries `tenantName`, `tenantId`, and `topology.teams.structure[]` with team types root/admin/repo-admin; legacy flat records are projected to the same `<tenant-slug>-root`/`-admin`/`-repo-admin` naming). Authorize the requester against the topology **admin** team (structure type "admin", the `tenant-admin` role), which is the tenant topology administration authority in the new model.
- Rationale: The new topology has no dedicated `CICDAdmins` team or role; the `admin` team (tenant-admin: create repos, create teams, manage repository access) is the tenant governance authority that runner administration sits under. Reading the topology directly keeps these ops consistent with create-tenant-model and removes the invented `<tenant-slug>-admin` naming.
- Alternatives considered: a dedicated cicd-admin team/role (does not exist in the topology, would require a 022 schema change); the repo-admin team (too narrow - repo-scoped, not org Actions administration).


## Decision 1: Tenant topology admin team naming derivation

- Decision: Derive the tenant topology admin team as `<tenant-slug>-admin` (tenant display name with whitespace converted to underscores, suffixed with `_CICDAdmins`), with the slug computed by the same `normalizeSlug` rules used by 014 tenant bootstrap derivation.
- Rationale: The 014 tenant model derives `TenantName_Tenant` and `TenantName_RepoAdmins` by suffixing the normalized tenant display name. Following the identical pattern keeps every tenant governance team discoverable from one derivation rule and keeps registry records free of redundant team fields.
- Alternatives considered:
  - `TenantName_Tenant_CICDAdmin` (literal scratch-pad naming `<tenant-slug>-admin`): rejected because it deviates from the implemented 014 suffix-on-display-name convention (`X_RepoAdmin` became `TenantName_RepoAdmins`) and produces longer, redundant team names.
  - Storing the topology admin team in the tenant registry record: rejected for this version because it requires amending the 014 registry schema and migration of existing records; deterministic derivation needs no schema change. Revisit if team naming ever becomes configurable per tenant.

## Decision 2: Requester authorization via live team membership, not registry data

- Decision: Authorize the requester by reading live active membership in the derived topology admin team via the team-membership API at validation time, and again at execution-time boundary revalidation.
- Rationale: GitHub is the source of truth (constitution principle I); registry records prove tenant existence but not current membership. Live reads close the gap where membership changed after registry persistence.
- Alternatives considered:
  - Trusting registry-recorded bootstrap admin logins: rejected because membership is dynamic and the registry does not track topology admin membership.
  - Requiring maintainer (not just member) role on the topology admin team: rejected because the tenant model treats topology admin membership itself as the capability grant; maintainer role on that team governs team curation, not runner rights.

## Decision 3: Fail closed when the topology admin team is missing

- Decision: If the canonical tenant topology admin team (`<tenant-slug>-admin`) does not exist, validation fails with explicit remediation guidance; this workflow never creates the team.
- Rationale: The source requirement states "Verify if user member team <tenant-slug>-admin. If not error." Team provisioning is a separate governance action (the "Add CICD Admin to Tenant" operation in the tenant design scratch pad) with its own approval semantics.
- Alternatives considered:
  - Auto-creating the missing team with topology admin role: rejected because it silently expands the blast radius of a runner request into team-structure mutation and bypasses the team-creation approval model.

## Decision 4: Deterministic tenant-prefixed runner naming

- Decision: Derive the full runner name as `TenantName_RunnerBaseName` where `TenantName` is the registry tenant display name with whitespace converted to underscores and the base name is normalized to the GitHub hosted-runner character set; reject derived names longer than 64 characters. If the submitted base name already carries the exact tenant prefix, use it as-is rather than double-prefixing.
- Rationale: The tenant design requires runner names to reflect tenant naming conventions ("Create X_Tenant_Name runner"). Deriving the prefix from resolved tenant context makes it impossible to create a runner outside the tenant naming boundary (CTSI-001), and idempotent reruns resolve to the same name.
- Alternatives considered:
  - Free-form runner name with pattern validation only: rejected because validation-only approaches allow a requester to submit another tenant's prefix and rely on string comparison subtleties; derivation is structurally safe.
  - Rejecting inputs that include the prefix: rejected as operator-hostile for re-submissions copied from runner lists.

## Decision 5: Runner group targeting with default-group fallback

- Decision: Accept an optional runner group name. When provided, require the `TenantName_` prefix and existence in the organization, resolving to `runner_group_id`. When omitted, resolve the organization default runner group (`default: true` in the runner-groups listing) and target it.
- Rationale: The hosted-runner creation API requires `runner_group_id`. Tenant runner groups are created by the sibling 023 feature and may not exist yet when the first tenant runner is requested; the default group keeps the create path usable while the move-runners operation (future feature) relocates runners later.
- Alternatives considered:
  - Requiring a tenant runner group to exist before any runner creation: rejected because it imposes a hard ordering between 021 and 023 that the tenant design does not require.
  - Hard-coding runner group id 1: rejected because the default group id is not contractually 1 across organizations.

## Decision 6: GitHub-hosted runner API surface

- Decision: Implement a new shared `github-runner-api.js` module exposing hosted-runner and runner-group operations over the documented org endpoints: `GET/POST /orgs/{org}/actions/hosted-runners`, `DELETE /orgs/{org}/actions/hosted-runners/{hosted_runner_id}`, `GET /orgs/{org}/actions/runner-groups`, `POST /orgs/{org}/actions/runner-groups`, plus reference reads (`.../hosted-runners/images/github-owned`, `.../images/partner`, `.../machine-sizes`, `.../platforms`, `.../limits`). Requests use the same fetch wrapper conventions as `github-team-api.js` (Accept `application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, Bearer token, `User-Agent: issueops-speckit`).
- Rationale: Hosted-runner creation requires `name` (1-64 chars, `[A-Za-z0-9._-]`), `image {id, source}` (source: `github` | `partner` | `custom`), `size`, and `runner_group_id`, with optional `maximum_runners` (default 50) and `enable_static_ip`. Create returns 201 with the runner object; delete returns 202. Keeping these in one shared module serves features 021, 022, and 023 without duplication.
- Alternatives considered:
  - Extending `github-team-api.js` with runner methods: rejected to keep API helpers cohesive per resource family, matching the existing team-api / team-repo-api split.
  - Octokit dependency: rejected because the repository deliberately uses dependency-free fetch wrappers.

## Decision 7: Dual authorization (tenant membership plus org-owner approval)

- Decision: Keep the repository-standard designated-approver gate (explicit `approved` comment by a designated active target-org owner) in addition to the requester's topology admin membership check.
- Rationale: Constitution principle II requires an explicit approval gate for privileged mutation, and hosted runners are billable infrastructure. The tenant-level membership check authorizes the requester; the org-owner approval authorizes the spend and org-level mutation.
- Alternatives considered:
  - Treating topology admin membership as sufficient authorization without an approval comment: rejected because it would make this the only mutating operation in the repository without an approval gate and would let tenant members create billable infrastructure unilaterally.

## Decision 8: Existing-runner convergence semantics

- Decision: An existing hosted runner with the derived name is a no-op for creation regardless of its image/size configuration; configuration drift is reported as a warning finding, not mutated.
- Rationale: Reconciliation-first convergence (constitution principle I) for this feature is defined on runner existence. PATCH-based drift correction has separate billing and disruption implications that deserve their own operation.
- Alternatives considered:
  - Updating image/size of an existing runner to match the request: rejected as out of scope for creation semantics and disruptive to in-flight workloads.
