# Research: Tenant GitHub-Hosted Runner Deletion IssueOps Workflow

## Decision 0: Read tenant context from the canonical tenant topology (supersedes the CICDAdmins derivation)

- Decision: Resolve tenant context from the canonical tenant topology that `specs/022-enhance-tenant-topology` stores in `tenant-registry/` (record carries `tenantName`, `tenantId`, and `topology.teams.structure[]` with team types root/admin/repo-admin; legacy flat records are projected to the same `<tenant-slug>-root`/`-admin`/`-repo-admin` naming). Authorize the requester against the topology **admin** team (structure type "admin", the `tenant-admin` role), which is the tenant topology administration authority in the new model.
- Rationale: The new topology has no dedicated `CICDAdmins` team or role; the `admin` team (tenant-admin: create repos, create teams, manage repository access) is the tenant governance authority that runner administration sits under. Reading the topology directly keeps these ops consistent with create-tenant-model and removes the invented `CICDAdmins` naming.
- Alternatives considered: a dedicated cicd-admin team/role (does not exist in the topology, would require a 022 schema change); the repo-admin team (too narrow - repo-scoped, not org Actions administration).


## Decision 1: Reuse the 021 tenant CI/CD authorization foundation

- Decision: Authorize deletion requests through the same shared resolver (`resolve-tenant-cicd-context-from-registry.js`) and approver model introduced by feature 021, with the operation marker `hosted_runner_deletion` in the context-marker payload.
- Rationale: Creation and deletion share an identical authorization boundary (active membership in the canonical tenant topology admin team (`<tenant-slug>-admin`) plus designated active-org-owner approval); duplicating the resolver would fork the security model.
- Alternatives considered:
  - A deletion-specific resolver: rejected as pure duplication with drift risk.
  - Requiring maintainer role for deletion (stricter than creation): rejected because the tenant design treats topology admin membership as the capability grant for both directions of runner lifecycle.

## Decision 2: Accept full or base runner names with deterministic derivation

- Decision: The runner-name input accepts either the tenant-prefixed full name (`ContosoUK_ubuntu-build`) or the base name (`ubuntu-build`); both derive to the same full name via the 021 derivation rules.
- Rationale: Operators copy runner names from org settings (full name) or from their own requests (base name); accepting both removes a footgun while derivation still confines targeting to the resolved tenant's prefix.
- Alternatives considered:
  - Full-name-only input with prefix validation: rejected as operator-hostile and no safer than derivation.
  - Runner-id input: rejected because ids are not tenant-meaningful and would bypass naming-boundary verification.

## Decision 3: Absent runner converges as no-op

- Decision: When no hosted runner with the derived name exists (at validation or execution time, including a 404 on the DELETE call), the request converges as no-op rather than failing.
- Rationale: Constitution principle I requires reruns to converge; the desired state of a deletion request is "runner absent", which an already-absent runner satisfies.
- Alternatives considered:
  - Failing on absent runner: rejected because it breaks rerun semantics and forces operators to distinguish "already deleted" from genuine errors.

## Decision 4: Deletion by resolved identifier, not by name

- Decision: Validation resolves the runner's numeric identifier via the hosted-runner listing; execution deletes via `DELETE /orgs/{org}/actions/hosted-runners/{hosted_runner_id}` (202 response).
- Rationale: The deletion endpoint is id-addressed; resolving the id during validation gives the approver a precise, auditable target and allows execution-time re-resolution to detect drift.
- Alternatives considered:
  - Re-listing and deleting in one execution step without validation-time resolution: rejected because the approver would approve a name, not a confirmed live target.

## Decision 5: Re-creation guidance instead of rollback

- Decision: Hosted-runner deletion has no platform-level undo; the audit artifact records the deleted runner's identifier and name, and remediation guidance points to the 021 creation workflow for re-creation.
- Rationale: Constitution principle IV requires defined compensating actions when rollback is impossible; re-creation through the approval-gated creation workflow is the compensating path.
- Alternatives considered:
  - Capturing full runner configuration for automated restore: deferred; the creation workflow requires explicit image/size choices and approval, which is the governance-correct path.
