# Data Model: Tenant Repos on New Topology

## TenantRepoCreationRequest

Purpose:
Normalized request object parsed from create-tenant-repos issue form.

Fields:
- requestId: string
- organization: string
- tenantNameInput: string
- repositoryNameInput: string
- repositoryNameNormalized: string
- visibility: private | internal | public
- designatedApproverLogin: string
- dryRun: boolean
- justification: string

Validation rules:
- visibility is required from issue form and must be one of private/internal/public.
- repositoryNameNormalized is deterministic and used in duplicate checks and idempotency.

Normalization algorithm (repositoryNameNormalized):
- Trim leading/trailing whitespace.
- Convert to lowercase.
- Replace one-or-more internal whitespace characters with a single hyphen.
- Collapse repeated hyphens to a single hyphen.
- Remove leading/trailing hyphens.

## CanonicalTenantTopologyRecord

Purpose:
Tenant registry record consumed by create-tenant-repos validation and execution.

Fields:
- tenantId: string
- tenantName: string
- tenantType: application | platform | shared-services
- topology: object
- externalMappings: object
- metadata: object

Required topology paths for this feature:
- topology.organization.orgName: string
- topology.teams.tenantRootTeam: string
- topology.teams.structure: TeamNode[]
- topology.accessModel.enforcement: tenant-boundary
- topology.accessModel.roles: string[]
- topology.repositories.owned: RepositoryOwnership[]

## RepositoryOwnership

Purpose:
Per-tenant repository ownership entry persisted in `topology.repositories.owned`.

Fields:
- repoName: string
- tenantId: string
- visibility: private | internal | public
- repoType: app | service | infra
- lifecycle: active | deprecated | migrating
- migrationWave: string
- source: ghes | ghec
- adminTeam: string

Defaulting rules:
- visibility: no default; must come from issue form.
- repoType: default service when absent.
- lifecycle: default active when absent.
- migrationWave: default wave-1 when absent.
- source: default ghec when absent.

Idempotency rules:
- Matching normalized repoName + tenantId implies no additional append on rerun.
- Only one object may be appended per successful request execution.

## TeamNode

Fields:
- team: string
- parent: string | null
- type: root | admin | repo-admin

Rules:
- repo-admin team must remain child of tenant root for valid governance state.

## TopologyValidationContext

Purpose:
Computed context during validation and execution revalidation.

Fields:
- topologyMode: canonical | legacy_projection
- tenantId: string
- tenantRootTeamSlug: string
- repoAdminTeamSlug: string
- ownedRepositories: RepositoryOwnership[]
- duplicateOwnedRepoMatch: string | null

Rules:
- duplicateOwnedRepoMatch stores conflicting normalized repo name when collision exists.
- Validation fails closed when ownedRepositories cannot be interpreted as an array in canonical mode.

## LegacyTenantProjection

Purpose:
Compatibility representation when canonical topology fields are missing.

Derived outputs for this feature:
- tenantId equivalent
- tenantRootTeamSlug equivalent
- repoAdminTeamSlug equivalent
- ownedRepositories defaults to [] when unavailable

Rules:
- Canonical fields take precedence when present.
- Legacy projection is fallback only.

## ExecutionOutcomeModel

Fields:
- requestStatus: awaiting_approval | approved | executed | partially_executed | failed
- creationAction: create_repository | noop
- permissionAction: grant_admin | noop
- ownedTopologyAction: append_owned_entry | noop_already_owned | blocked_duplicate
- rollbackStatus: not_needed | attempted | manual_remediation_required

Rules:
- ownedTopologyAction=noop_already_owned for rerun-safe idempotency.
- blocked_duplicate must include conflict reason and normalized repo name.
