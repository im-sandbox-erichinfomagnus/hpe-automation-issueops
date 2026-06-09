# Data Model: Enhance Tenant Topology Model

## CanonicalTenantTopologyRecord

Purpose:
Canonical tenant registry representation for create-tenant-model operations.

Fields:
- tenantId: string
- tenantName: string
- tenantType: application | platform | shared-services
- topology: object
- externalMappings: object
- metadata: object
- lifecycleStatus: active | blocked | partial_failure | decommissioned
- sourceIssueNumber: number
- sourceRunId: string
- createdAt: timestamp
- updatedAt: timestamp

Validation rules:
- tenantId must be deterministic and safe for per-tenant registry file keying.
- tenantType must be one of application, platform, shared-services.
- lifecycleStatus remains semantically equivalent to existing active-first behavior.

## Topology

### OrganizationTopology

Fields:
- orgName: string

Rules:
- orgName derives from request organization input.

### TeamsTopology

Fields:
- tenantRootTeam: string
- structure: TeamNode[]

TeamNode fields:
- team: string
- parent: string | null
- type: root | admin | repo-admin

Rules:
- tenantRootTeam name is <tenantName>-root.
- structure includes exactly three nodes for root/admin/repo-admin.
- root parent is null.
- admin and repo-admin parent values are root team slug.

State transitions:
- requested -> derived -> validated -> reconciled -> persisted

### RepositoriesTopology

Fields:
- owned: RepositoryOwnership[]

RepositoryOwnership fields (future-populated, initialized empty in this feature):
- repoName: string
- tenantId: string
- visibility: private | internal | public
- repoType: app | service | infra
- lifecycle: active | deprecated | migrating
- migrationWave: string
- source: ghes | ghec
- adminTeam: string

Rules:
- owned must be initialized to [] at tenant creation.

### RunnerTopology

Fields:
- runnerGroups: RunnerGroup[]

RunnerGroup fields (future-populated, initialized empty in this feature):
- name: string
- scope: tenant | org
- runners: RunnerNode[]

RunnerNode fields:
- name: string
- type: github-hosted | self-hosted

Rules:
- runnerGroups must be initialized to [] at tenant creation.

### AccessModel

Fields:
- enforcement: tenant-boundary
- roles: [tenant-admin, repo-admin, developer, viewer]
- organizationRoleSpecifications: OrganizationRoleSpecification[]

OrganizationRoleSpecification fields:
- role_key: tenant-admin | repo-admin | developer | viewer
- role_name: string
- permission_intent: string

Rules:
- enforcement value is fixed to tenant-boundary.
- roles list is fixed and ordered deterministically.
- organizationRoleSpecifications must define all canonical roles with deterministic tenant-scoped names.

### GovernancePolicies

Fields:
- codeScanning.enabled: boolean
- codeScanning.mandatory: true
- secretScanning.enabled: boolean
- secretScanning.mandatory: true
- dependabot.enabled: boolean

Rules:
- enabled values parse from issue-form true/false dropdowns.
- mandatory remains true for codeScanning and secretScanning.

## ExternalMappings

Fields:
- cmdbId: string | null
- costCenter: string | null
- businessUnit: string | null
- environment: prod | nonprod

Rules:
- environment defaults to nonprod when omitted.

## Metadata

Fields:
- primaryContact: string
- secondaryContact: string | null
- createdBy: string
- createdDate: timestamp

Rules:
- primaryContact is required for request validity and must pass email validation.
- secondaryContact is optional and must pass email validation when present.
- createdBy and createdDate are system-populated.

## LegacyTenantRecordProjection

Purpose:
Compatibility adapter for existing flat records.

Source legacy fields:
- tenant_key
- tenant_display_name
- organization
- tenant_team_name
- tenant_team_slug
- repo_admin_team_name
- repo_admin_team_slug
- requester_login
- approver_login
- lifecycle_status
- source_issue_number
- source_run_id
- created_at
- updated_at

Projection mapping:
- tenant_key -> tenantId
- tenant_display_name -> tenantName
- organization -> topology.organization.orgName
- tenant_team_name/slug and repo_admin_team_name/slug -> topology.teams
- lifecycle_status -> lifecycleStatus
- source_issue_number/source_run_id -> sourceIssueNumber/sourceRunId
- requester_login -> metadata.createdBy fallback when explicit creator metadata absent

Rules:
- Dual-read supports both legacy and canonical shapes.
- Canonical-write persists only canonical shape after any successful write path.

## ExecutionStatusModel

Fields:
- requestStatus: submitted | awaiting_approval | approved | executed | partially_executed | failed | failed_after_approved_execution
- reconciliationState: approved_for_execution | noop_already_satisfied | blocked
- rollbackStatus: not_needed | attempted | manual_remediation_required

Rules:
- Status transitions remain deterministic and auditable across legacy/canonical paths.
