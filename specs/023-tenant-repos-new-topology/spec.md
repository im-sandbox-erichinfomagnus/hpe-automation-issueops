# Feature Specification: Enhance Create-Tenant-Repos Workflow for New Tenant Topology Model

**Feature Branch**: `023-tenant-repos-new-topology`  
**Created**: 2026-06-10  
**Status**: Draft  
**Input**: "The spec 022-enhance-tenant-topology implements new topology structure for tenant which gets stored in tenant-registry folder. The spec 019-create-tenant-repos which creates repositories in tenants still read old topology for tenancy rules adherence. Create specification to enhance the IssueOps create-tenant-repos so that it now works with new tenant topology."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validate Repository Requests Against New Tenant Topology (Priority: P1)

As a requester, I can submit a tenant-scoped repository-creation request and the workflow uses the new canonical tenant topology model (from spec 022) to validate tenant context, confirm governance relationships, and determine repository creation eligibility without mutating GitHub state.

**Why this priority**: The workflow must correctly interpret the enhanced topology schema to prove tenant context and governance authority before any approval or mutation occurs.

**Independent Test**: Can be fully tested by submitting valid repository requests against tenants defined in the new topology model and verifying that validation uses new schema fields (`topology.teams.structure`, `topology.accessModel`, etc.) and reports findings with clear topology-based context.

**Acceptance Scenarios**:

1. **Given** a requester with one valid tenant context (resolved from new topology model), a valid target organization, and a valid repository name, **When** validation runs, **Then** the workflow records the canonical tenant context using new topology `tenantId`, confirms requester eligibility by validating membership in topology-defined governance teams, and marks the request approval-ready.
2. **Given** a tenant-registry entry that includes the new topology model with `topology.teams.structure` and `topology.accessModel` fields, **When** validation reads the entry, **Then** the workflow uses new schema to resolve tenant admin team (`X_Tenant`), repo-admin team (`X_RepoAdmin`), and access model enforcement rules.
3. **Given** a requester who is not a member of the tenant-governance teams as defined in the new topology, **When** validation runs, **Then** the workflow rejects the request with explicit topology-based authorization findings and no approval eligibility.

---

### User Story 2 - Support Transitional Compatibility With Legacy Tenant Records (Priority: P2)

As an operator, I can continue using the workflow on existing legacy tenant records during the rollout to the new topology model without breaking repository creation or governance application, while gradually migrating to new topology semantics.

**Why this priority**: Existing in-flight requests and legacy records must remain operational while the system transitions to the new canonical model.

**Independent Test**: Can be fully tested by running validation and execution against both legacy (old topology) and new topology tenant records and confirming that validation logic applies appropriate schema mapping, governance lookups succeed using correct fields, and repository creation outcomes are deterministic for both cases.

**Acceptance Scenarios**:

1. **Given** a legacy tenant-registry entry that lacks new topology fields but contains sufficient legacy fields to determine tenant context, **When** validation runs, **Then** the workflow applies canonical mapping to derive equivalent tenant identity, governance team slugs, and access control semantics without data loss or operational failure.
2. **Given** a tenant-registry entry with new topology fields present, **When** validation prioritizes schema interpretation, **Then** the workflow reads and validates against new topology structure first, falling back to legacy-compatible interpretation only if new fields are absent.
3. **Given** a repository-creation request that was validated against legacy schema and now must be approved/executed after new topology is deployed, **When** execution revalidates context, **Then** the workflow correctly maps and confirms tenant governance state using appropriate schema variant and does not reject based on schema version mismatch.

---

### User Story 3 - Apply Tenant Governance Using New Topology Access Model (Priority: P3)

After valid approval and execution-time revalidation, the workflow creates the repository within the tenant scope and applies governance access controls using the new topology's `accessModel` and `organizationRoleSpecifications` without breaking existing repository admin permission grant behavior.

**Why this priority**: Repository governance must be applied using the enhanced access model to ensure consistent permission assignment and audit trail consistency with new topology records.

**Independent Test**: Can be fully tested by creating repositories for tenants with new topology records and verifying that repository admin permission is granted to the correct governance team and that execution outcomes reference new topology governance identifiers.

**Acceptance Scenarios**:

1. **Given** an approved request with a tenant defined in new topology model and tenant governance checks passing at execution time, **When** execution runs, **Then** the workflow creates the repository, grants admin permission to the `X_RepoAdmin` team identified from `topology.teams.structure`, and records execution outcome with reference to new topology `tenantId` and team identifiers.
2. **Given** repository admin permission grant using a team identified from the new topology model, **When** execution records the outcome, **Then** the audit artifact includes both the new topology identifiers (`tenantId`, governance team names from `accessModel.roles`) and legacy-compatible context for backward compatibility.
3. **Given** execution-time scenario where topology validation or governance team lookup fails, **When** execution finishes, **Then** the workflow reports a boundary-blocked outcome with clear indication that the new topology schema was consulted and specific topology validation failure(s).

---

### User Story 4 - Persist Repository Metadata Into Tenant Topology Owned List (Priority: P1)

As an operator, I can rely on each successful repository-creation request to append a new repository entry into the tenant topology `topology.repositories.owned` array, with deterministic defaults for fields not supplied by the issue form.

**Why this priority**: Without reliably updating `topology.repositories.owned`, tenant topology becomes stale, duplicate-name checks are incomplete, and downstream workflows lose authoritative repository ownership context.

**Independent Test**: Can be fully tested by creating multiple repositories for the same tenant and verifying each successful creation appends exactly one object to `topology.repositories.owned`, applies defaults for missing issue-form fields, and rejects duplicate repository names already present in the owned list.

**Acceptance Scenarios**:

1. **Given** a successful repository creation for a tenant with an existing `topology.repositories.owned` array, **When** execution persists tenant topology, **Then** exactly one new object is appended to the array with `repoName`, `tenantId`, `visibility`, `repoType`, `lifecycle`, `migrationWave`, `source`, and `adminTeam` fields populated.
2. **Given** issue-form inputs do not provide all repository-owned metadata fields except visibility, **When** the object is built for `topology.repositories.owned`, **Then** missing non-visibility fields are populated with deterministic defaults.
3. **Given** a request whose repository name already exists in the tenant's `topology.repositories.owned` array (case-insensitive and normalized), **When** validation runs, **Then** the request is rejected with a clear validation error indicating the repository name is already taken for that tenant.
4. **Given** multiple successful repository requests for the same tenant over time, **When** topology is persisted, **Then** each request appends a separate object and previous owned entries remain intact.

---

### Edge Cases

- Tenant-registry entry is present but new topology fields are empty/null while legacy fields are populated.
- New topology model is present but `topology.teams.structure` or `topology.accessModel` is malformed or incomplete.
- Tenant `tenantId` in new topology exists but does not match any legacy tenant identifier.
- Requester is maintainer under legacy governance but not present in new topology access model membership lists.
- Repository admin team (`X_RepoAdmin`) exists in new topology but is not a child of tenant root team.
- Approver identity changed after initial validation; revalidation must use new topology to confirm approver authority.
- Mixed legacy and new topology entries exist in tenant-registry during transition; validation must handle both consistently.
- Execution occurs after tenant topology was modified; revalidation must detect changes and adjust governance accordingly.
- Requested repository is created by new workflow but legacy tooling tries to manage its governance; audit trail must remain traceable.
- `topology.repositories.owned` is missing, null, or malformed in an otherwise valid tenant topology record.
- Requested repository name differs only by case, separator, or normalization from an existing `topology.repositories.owned[*].repoName` value.
- Issue form omits repository-owned metadata fields (`repoType`, `lifecycle`, `migrationWave`, `source`) and defaults must be applied deterministically.
- Concurrent approved executions attempt to add the same repository name to one tenant and topology persistence must fail closed on duplicate detection.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST read tenant-registry entries that include the new tenant topology model (from spec 022) with top-level fields `tenantId`, `tenantName`, `tenantType`, `topology`, `externalMappings`, and `metadata`.
- **FR-002**: The system MUST interpret `topology.teams.structure` to identify tenant governance teams including tenant root team slug, `X_RepoAdmin` child team slug, and team hierarchy relationships required for repository governance.
- **FR-003**: The system MUST interpret `topology.accessModel.enforcement` and `topology.accessModel.roles` to determine required access control semantics and repository permission assignments for the tenant context.
- **FR-004**: The system MUST resolve the canonical tenant context for a repository-creation request using the new topology model by deriving `tenantId`, tenant root team slug, and `X_RepoAdmin` team slug from topology fields.
- **FR-005**: The system MUST validate requester eligibility for repository creation by confirming requester membership in governance teams as defined in new topology's `topology.accessModel.roles` membership semantics.
- **FR-006**: The system MUST confirm that `X_RepoAdmin` identified from new topology exists as a child of the tenant root team and is valid for the current request context.
- **FR-007**: The system MUST support compatibility with legacy tenant-registry entries by applying canonical field mapping to derive equivalent tenant identity and governance team references when new topology fields are absent.
- **FR-008**: When reading a tenant-registry entry, the system MUST prioritize new topology fields if present, and apply legacy-compatible interpretation only when new topology fields are incomplete or absent.
- **FR-009**: The system MUST preserve backward compatibility such that repositories created before topology model migration and governance teams created by legacy workflows are not invalidated or require re-provisioning.
- **FR-010**: During execution, the system MUST revalidate tenant context against live tenant-registry state (including new topology fields) immediately before any mutation.
- **FR-011**: The system MUST fail closed and block repository creation if execution-time revalidation detects inconsistency between approved context and current tenant-registry state.
- **FR-012**: The system MUST grant repository admin permission on created repositories to the `X_RepoAdmin` team identified from new topology `topology.teams.structure`.
- **FR-013**: The system MUST record execution outcomes in audit artifacts using new topology identifiers (`tenantId`, governance team names from `topology.teams`) while maintaining legacy-compatible context for cross-reference.
- **FR-014**: The system MUST emit validation, approval, and execution summaries that clearly distinguish whether new or legacy topology schema was used for each evaluation step.
- **FR-015**: The system MUST report clear, actionable topology validation failures that reference specific schema fields or topology interpretation issues if validation fails.
- **FR-016**: For successful repository creation, the system MUST append a new object to `topology.repositories.owned` in the tenant topology record and MUST preserve existing objects in that array.
- **FR-017**: Each appended `topology.repositories.owned` object MUST include the fields `repoName`, `tenantId`, `visibility`, `repoType`, `lifecycle`, `migrationWave`, `source`, and `adminTeam`.
- **FR-018**: `repoName` in the appended object MUST use the normalized repository name validated for creation; `tenantId` MUST come from resolved tenant context; and `adminTeam` MUST be the resolved `X_RepoAdmin` team slug or canonical name used for permission grant.
- **FR-019**: Visibility MUST be provided by the repository-creation issue form and MUST NOT be defaulted by this workflow; when issue-form values are unavailable for other repository-owned metadata fields, the system MUST apply defaults: `repoType=service`, `lifecycle=active`, `migrationWave=wave-1`, `source=ghec`.
- **FR-020**: The system MUST initialize `topology.repositories.owned` to an empty array when absent and then append the new repository object.
- **FR-021**: The system MUST reject validation when the requested repository name already exists in `topology.repositories.owned` for the resolved tenant, using case-insensitive normalized comparison.
- **FR-022**: Duplicate-name validation errors MUST explicitly identify that the repository name is already present in tenant topology owned repositories and include the conflicting normalized name.
- **FR-023**: On reruns, if the repository already exists in `topology.repositories.owned` with matching normalized name and tenant context, execution MUST be treated as idempotent no-op for topology append.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requesters MUST be authenticated GitHub users with identity derived from issue-author context.
- **AR-002**: Requesters MUST be confirmed as maintainers of the tenant root team and members of the `X_RepoAdmin` team as defined in the tenant's new topology model.
- **AR-003**: Approvers MUST be confirmed as currently authorized for the validated tenant context immediately before approval is evaluated.
- **AR-004**: Execution identity MUST be a PAT-backed token with sufficient permissions to confirm tenant context, create repositories, and grant team permissions.

### Validation Requirements *(mandatory)*

- **VA-001**: Tenant-registry lookup MUST succeed and must return an entry with sufficient fields (new or legacy) to resolve tenant context deterministically.
- **VA-002**: Resolved tenant context MUST include valid tenant identity (`tenantId` from new topology or legacy equivalent) and valid governance team slugs (`X_Tenant`, `X_RepoAdmin`).
- **VA-003**: Tenant governance teams MUST exist and MUST be related correctly (`X_RepoAdmin` must be child of `X_Tenant`).
- **VA-004**: Requested repository name MUST normalize to a valid, non-reserved, non-conflicting slug.
- **VA-005**: Target organization MUST match the organization context recorded in the resolved tenant-registry entry.
- **VA-006**: Requester identity MUST be resolvable and MUST pass authorization checks for the validated tenant context.
- **VA-007**: Validation failures MUST be reported with clear, topology-aware language that references new schema fields when new topology is used.
- **VA-008**: Validation MUST check requested repository name availability against `topology.repositories.owned` for the resolved tenant before approval eligibility is granted.
- **VA-009**: Validation MUST fail if `topology.repositories.owned` cannot be interpreted as an array in new topology mode and canonical recovery cannot be applied.
- **VA-010**: For duplicate checks and idempotency, repository-name normalization MUST be deterministic: trim leading/trailing whitespace, lowercase the value, collapse internal whitespace runs to a single hyphen, collapse repeated hyphens to a single hyphen, and remove leading/trailing hyphens.

### Reconciliation & Idempotency Requirements *(mandatory)*

- **RC-001**: If the requested repository already exists and governance state is already satisfied (admin permission already granted to `X_RepoAdmin`), execution MUST record a deterministic no-op outcome.
- **RC-002**: Reruns of approved requests MUST be idempotent and MUST not recreate already-satisfied repository state.
- **RC-003**: If execution context changes between approval and execution (e.g., `X_RepoAdmin` is modified or removed), execution MUST revalidate and report the changed context before proceeding.
- **RC-004**: Topology persistence MUST append at most one new `topology.repositories.owned` object per successful request, and reruns MUST NOT append duplicates for the same normalized repository name and tenant.

### Observability & Audit Requirements *(mandatory)*

- **OB-001**: Audit artifacts MUST record which tenant topology model variant (new or legacy) was consulted for each validation step.
- **OB-002**: Audit artifacts MUST include `tenantId` and governance team identifiers from new topology fields when available.
- **OB-003**: Summaries MUST clearly indicate whether new topology model was used and MUST reference specific new topology fields consulted during validation/execution.
- **OB-004**: Execution results MUST record per-step outcomes (repository creation, permission grant, audit persistence) with clear indication of success, no-op, or failure.
- **OB-005**: Audit artifacts MUST include the repository-owned object that was appended (or matched in no-op) and indicate whether defaults were applied for each defaultable field.

## Success Criteria *(mandatory)*

- Create-tenant-repos workflow correctly reads and interprets new tenant topology model from spec 022 without breaking existing repository creation behavior.
- Validation and execution use new topology schema to resolve tenant context, governance relationships, and authorization checks.
- Legacy tenant records remain operable during transition with transparent schema mapping and no operational failure.
- Repositories created under new topology model are recorded in audit with clear reference to new topology `tenantId` and governance team identifiers.
- Repositories created under new topology model are appended to `topology.repositories.owned` with complete required fields; visibility comes from issue-form input and deterministic defaults are applied for other missing metadata fields.
- Repository-name availability checks prevent duplicates within tenant topology owned repositories and return clear validation errors when name collisions are detected.
- Rerun behavior is idempotent and does not duplicate repository state or governance assignments.
- All validation, approval, and execution outcomes are reported with clear, actionable language that distinguishes new vs. legacy topology schema usage.

## Assumptions *(mandatory)*

- Tenant-registry entries may contain either new topology fields (from spec 022) or legacy fields or both during transition.
- Legacy tenant governance teams (e.g., `X_Tenant`, `X_RepoAdmin`) will continue to exist and be referenced correctly when mapped from legacy schema.
- New topology model's `topology.teams.structure` provides authoritative governance team relationships for new tenants.
- New topology model uses `topology.repositories.owned` as the authoritative per-tenant repository ownership list for this workflow.
- Approver identity validation can use existing approval-gate mechanisms with topology-aware context binding.
- Repository creation and permission-grant operations use existing GitHub API calls without requiring new endpoints.
- Dry-run mode is supported and must emit full validation/reconciliation evidence without mutating state.

## Out of Scope

- Changes to the tenant-registry data format itself (defined in spec 022).
- Changes to the new tenant topology model schema (defined in spec 022).
- Migration tooling to convert existing legacy tenant records to new topology format (may be separate feature).
- Changes to existing tenant creation workflow (spec 014).
- Changes to tenant-boundary hardening workflows (specs 015-018).
- Changes to GitHub repository configuration behavior beyond the current repository creation + admin-team permission flow; this feature only requires persisting visibility/repository metadata in tenant topology.
- Organization role provisioning beyond recording in audit (spec 022 handles org-role creation).
