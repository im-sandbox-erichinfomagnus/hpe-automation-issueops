# Feature Specification: Enhance Tenant Topology Model

**Feature Branch**: `[022-enhance-tenant-topology]`  
**Created**: 2026-06-09  
**Status**: Draft  
**Input**: User description: "Enhance spec 014-create-tenant-model to a topology-first tenant schema with governance, external mappings, metadata, and migration compatibility"

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Tenant With New Topology Schema (Priority: P1)

As an IssueOps operator, I can submit a tenant creation request that captures tenant type, governance controls, contact data, and external mapping fields, and the workflow persists a topology-first tenant record in the canonical structure.

**Why this priority**: This is the core functional outcome; without canonical creation in the new shape, downstream operations cannot rely on the enhanced tenant model.

**Independent Test**: Can be fully tested by submitting a tenant creation request with all required new fields and confirming the persisted tenant record matches the target schema, includes required defaults, and is audit-visible.

**Acceptance Scenarios**:

1. **Given** a valid tenant creation request with all required enhancement inputs, **When** validation and approved execution complete, **Then** a tenant record is persisted with `tenantId`, `tenantName`, `tenantType`, `topology`, `externalMappings`, and `metadata` in the required structure.
2. **Given** a valid request, **When** the record is created, **Then** `topology.repositories.owned` and `topology.runnerTopology.runnerGroups` are initialized as empty arrays.
3. **Given** a valid request, **When** team topology is derived, **Then** root/admin/repo-admin team names and parent relationships follow the required naming and hierarchy rules.

---

### User Story 2 - Enforce Tenant Boundary Governance And Access Policy (Priority: P2)

As an approver, I can trust that tenant governance selections and tenant-boundary access role definitions are captured consistently and enforced in pre-mutation checks and execution decisions.

**Why this priority**: Governance and access boundary correctness are core security controls for privileged administration workflows.

**Independent Test**: Can be tested by submitting requests with different governance and environment values, then confirming validation, stored policy fields, and approval/execution readiness outcomes reflect policy requirements.

**Acceptance Scenarios**:

1. **Given** governance selections in the request, **When** validation succeeds, **Then** `codeScanning`, `secretScanning`, and `dependabot` enabled values are persisted as explicit booleans, with mandatory set to true for code and secret scanning.
2. **Given** role model requirements, **When** the topology record is persisted, **Then** `accessModel.enforcement` is `tenant-boundary` and roles include `tenant-admin`, `repo-admin`, `developer`, and `viewer`.
3. **Given** policy or authorization preconditions are not met, **When** execution is attempted, **Then** the workflow fails closed with actionable findings and no unauthorized mutation.

---

### User Story 3 - Maintain Compatibility With Existing Tenant Records (Priority: P3)

As an operator, I can process old and new tenant records during rollout without breaking validation, approval, reconciliation, reruns, or audit reporting.

**Why this priority**: Existing records and in-flight workflows must remain operable while transitioning to the canonical enhanced model.

**Independent Test**: Can be tested by running validation/reconciliation on legacy-formatted tenant records and confirming dual-read compatibility, canonical-write behavior, and stable request status outcomes.

**Acceptance Scenarios**:

1. **Given** a legacy tenant record, **When** it is read by enhanced workflow steps, **Then** canonical mapping is applied consistently without data loss for required fields.
2. **Given** rerun conditions on partially or fully satisfied topology, **When** execution repeats, **Then** already-satisfied state remains no-op and no duplicate team hierarchy is created.
3. **Given** mixed old/new records during transition, **When** summaries and artifacts are emitted, **Then** operators receive clear, deterministic outcomes and provenance.

---

### Edge Cases

- Request omits optional external mapping values while required tenant topology values are present.
- Governance dropdown values are malformed or omitted in the issue payload.
- Derived team names collide with existing teams that do not match expected tenant ownership.
- Root team exists but one child team is missing or attached to a wrong parent.
- Legacy record lacks fields required by new schema but includes enough source data for canonical mapping.
- Contact fields are provided with invalid email format.
- Request is approved, but policy/authorization revalidation fails at execution time.
- Rerun occurs after partial mutation and must reconcile without creating duplicate hierarchy links.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist tenant records in the enhanced canonical model with top-level fields `tenantId`, `tenantName`, `tenantType`, `topology`, `externalMappings`, and `metadata`.
- **FR-002**: System MUST capture `tenantType` from a tenant creation issue-form dropdown with values `application`, `platform`, or `shared-services`.
- **FR-003**: System MUST set `topology.organization.orgName` from the organization value provided in the request.
- **FR-004**: System MUST derive topology team names as `<tenant name>-root`, `<tenant name>-admin`, and `<tenant name>-repo-admin`.
- **FR-005**: System MUST persist `topology.teams.tenantRootTeam` and `topology.teams.structure` entries with required parent/type semantics (`root` parent null; `admin` and `repo-admin` parent root team slug).
- **FR-006**: System MUST initialize `topology.repositories.owned` as an empty array at tenant creation.
- **FR-007**: System MUST initialize `topology.runnerTopology.runnerGroups` as an empty array at tenant creation.
- **FR-008**: System MUST persist `topology.accessModel.enforcement` as `tenant-boundary`.
- **FR-009**: System MUST persist `topology.accessModel.roles` with `tenant-admin`, `repo-admin`, `developer`, and `viewer`.
- **FR-009A**: System MUST persist `topology.accessModel.organizationRoleSpecifications` with deterministic tenant-scoped role names and permission-intent text for `tenant-admin`, `repo-admin`, `developer`, and `viewer`.
- **FR-010**: System MUST capture governance booleans from issue-form dropdowns for `codeScanning.enabled`, `secretScanning.enabled`, and `dependabot.enabled`.
- **FR-011**: System MUST persist `codeScanning.mandatory` and `secretScanning.mandatory` as true.
- **FR-012**: System MUST capture `externalMappings.cmdbId`, `externalMappings.costCenter`, and `externalMappings.businessUnit` from request text inputs.
- **FR-013**: System MUST capture `externalMappings.environment` from dropdown values `prod` or `nonprod`, defaulting to `nonprod`.
- **FR-014**: System MUST require `metadata.primaryContact`, allow optional `metadata.secondaryContact`, and validate provided contact values as email values.
- **FR-015**: System MUST system-populate `metadata.createdBy` and `metadata.createdDate` at creation time.
- **FR-016**: System MUST preserve lifecycle behavior equivalent to current active-tenant semantics.
- **FR-017**: System MUST preserve source traceability (issue/run provenance) in a compatible representation during and after migration.
- **FR-018**: System MUST support compatibility for legacy tenant records by applying canonical field mapping and canonical-write behavior.
- **FR-019**: System MUST ensure reruns are idempotent and do not recreate already-satisfied team topology.
- **FR-020**: System MUST emit deterministic summaries and audit artifacts that clearly represent validation, approval, reconciliation, execution, and compatibility context.
- **FR-021**: During approved tenant bootstrap execution, system MUST reconcile organization roles by creating any missing roles from `topology.accessModel.organizationRoleSpecifications` when the organization-roles API is available, and MUST record per-role outcomes in execution artifacts.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requesters MUST be authenticated GitHub users, and requester identity MUST be derived from the issue author context.
- **AR-002**: Tenant model mutation MUST require authorized approval consistent with current create-tenant-model approval policy.
- **AR-003**: Executing credentials MUST remain least-privilege and PAT-backed under existing repository security standards.
- **AR-004**: Authorization checks MUST enforce tenant-boundary policy assumptions before mutation and during approved execution revalidation.

### Validation Strategy *(mandatory)*

- **VS-001**: Issue-form parsing MUST validate required enhanced fields, enum selections, booleans, and email formats before mutation planning.
- **VS-002**: Validation MUST verify team naming and root/child slug derivation for topology structure.
- **VS-003**: Validation MUST detect topology collisions and conflicting ownership state in the target organization.
- **VS-004**: Validation output MUST include actionable findings and fail-closed status when preconditions are not satisfied.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Reconciliation MUST read current organization/team state needed to determine already-satisfied, missing, and conflicting topology elements.
- **RL-002**: Desired state MUST be derived from canonical enhanced model fields and deterministic naming rules.
- **RL-003**: Reconciliation MUST classify no-op versus mutation actions to ensure idempotent reruns.
- **RL-004**: Reconciliation MUST support mixed legacy/new record reads while writing canonical enhanced representation.

### Rollback Handling *(mandatory)*

- **RH-001**: Workflow MUST preserve existing rollback strategy boundaries and explicitly report when rollback is not required, partial, or requires manual remediation.
- **RH-002**: Failure artifacts MUST capture per-step outcomes and tenant topology state so operators can safely retry.
- **RH-003**: Mutation flow MUST fail closed on authorization, policy, or state-consistency failures.

### Observability Requirements *(mandatory)*

- **OR-001**: Step summaries and audit artifacts MUST include enhanced tenant fields, governance selections, and compatibility context.
- **OR-002**: Audit outputs MUST include correlation fields for issue number, run id, requester, approver, organization, tenantId, and reconciliation outcome.
- **OR-003**: Outputs MUST clearly distinguish dry-run, approval-ready, executed, partially executed, and failed outcomes during migration period.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Enhanced topology checks MUST remain within bounded API usage assumptions used by existing tenant workflows.
- **GH-002**: Retry/backoff behavior MUST remain bounded and deterministic for retryable API failures.
- **GH-003**: Workflow MUST stop and surface retry guidance when rate-limit handling cannot safely continue.

### Testing Expectations *(mandatory)*

- **TE-001**: Add contract tests for enhanced tenant schema shape, enum/boolean validation, contact validation, and canonical mapping.
- **TE-002**: Add issue-form parser tests for new dropdown/text inputs and defaults.
- **TE-003**: Add reconciliation/execution tests for root/admin/repo-admin topology creation and rerun idempotency.
- **TE-004**: Add backward-compatibility tests for legacy tenant record reads and canonical-write behavior.
- **TE-005**: Add summary/artifact regression tests for deterministic reporting during mixed old/new data periods.

### Key Entities *(include if feature involves data)*

- **Tenant Model Record**: Canonical tenant document containing identity (`tenantId`, `tenantName`, `tenantType`), topology, governance, mappings, metadata, lifecycle, and provenance.
- **Tenant Team Topology**: Root/admin/repo-admin team relationship model with deterministic naming and parent linkage.
- **Governance Policy Set**: Tenant-scoped policy booleans and mandatory flags used in validation and enforcement decisions.
- **External Mapping Set**: Business and operational mapping values (`cmdbId`, `costCenter`, `businessUnit`, `environment`).
- **Tenant Metadata Set**: Contact and creation metadata used for accountability and support routing.
- **Compatibility Projection**: Canonical mapping layer that normalizes legacy records for mixed-period reads and writes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of newly created tenants via the enhanced form are persisted in canonical enhanced schema with required default arrays and mandatory policy flags.
- **SC-002**: 100% of valid enhanced requests produce deterministic team topology derivation that matches naming and parent-link rules.
- **SC-003**: 100% of invalid enum/boolean/email/topology-collision requests fail before mutation with actionable validation findings.
- **SC-004**: 100% of rerun scenarios with already-satisfied topology complete without duplicate topology mutations.
- **SC-005**: 100% of tested legacy tenant records are readable through compatibility mapping and rewritten in canonical form on qualifying writes.
- **SC-006**: 100% of workflow runs continue to emit auditable summary/artifact outputs with request status transitions that remain deterministic during migration.

## Assumptions

- Legacy records remain readable throughout rollout and are normalized through a dual-read, canonical-write transition strategy.
- Access roles (`tenant-admin`, `repo-admin`, `developer`, `viewer`) are represented as tenant-scoped organization roles with deterministic names and permission-intent metadata; role assignments can be layered by follow-up workflows.
- Existing approval model for create-tenant-model remains the governance gate for this enhancement unless revised by a separate feature.
- Tenant lifecycle behavior remains equivalent to active semantics currently used in tenant workflows.
- Repository creation and runner-group provisioning remain out of scope; only empty topology containers are initialized in this feature.
