# Research: Enhance Tenant Topology Model

## Phase
Phase 0 - Outline and Research

## Feature
022-enhance-tenant-topology

## Research Item 1: Canonical transition strategy for legacy tenant records

Decision:
Adopt dual-read and canonical-write migration.

Rationale:
Legacy records already exist under tenant-registry and must remain readable during rollout. Dual-read avoids disruptive batch migration while canonical-write ensures every new write converges to the enhanced shape.

Alternatives considered:
- In-place full migration before rollout: rejected due to operational risk and larger blast radius.
- Keep parallel schemas indefinitely: rejected because it prolongs complexity and increases regression risk.

## Research Item 2: Topology team naming and parent linkage representation

Decision:
Use deterministic derived names based on tenantName:
- root team name: <tenantName>-root
- admin team name: <tenantName>-admin
- repo-admin team name: <tenantName>-repo-admin
Store parent for admin and repo-admin as the root team slug.

Rationale:
Deterministic naming improves idempotency and reconciliation. Parent by slug aligns with existing team-hierarchy validation behavior.

Alternatives considered:
- Parent by team id: rejected because ids are not available at pre-mutation planning time.
- Keep existing _Tenant/_RepoAdmins naming: rejected because enhancement explicitly requires topology-first names.

## Research Item 3: Governance field modeling from issue form dropdowns

Decision:
Parse governance inputs as booleans and persist under topology.governance.policies with:
- codeScanning: enabled from form, mandatory always true
- secretScanning: enabled from form, mandatory always true
- dependabot: enabled from form

Rationale:
Boolean normalization prevents ambiguity across parser, validator, and audit outputs while preserving explicit mandatory semantics.

Alternatives considered:
- Persist raw strings true/false: rejected due to downstream type ambiguity.
- Make mandatory configurable in form: rejected because enhancement fixes mandatory true for code/secret scanning.

## Research Item 4: Tenant role semantics in access model

Decision:
Persist canonical roles in the tenant topology record with deterministic tenant-scoped organization role specifications, then reconcile missing organization roles during approved tenant bootstrap execution.

Rationale:
Provisioning deterministic org roles addresses operator expectations that access-model roles are concrete resources while retaining fail-closed behavior when role APIs are unavailable.

Alternatives considered:
- Keep roles as logical metadata only: rejected because operators need concrete role creation outcomes in execution artifacts.
- Omit role provisioning until a future feature: rejected by updated requirement to create canonical org roles in tenant bootstrap.

## Research Item 5: External mappings and metadata validation

Decision:
Add issue-form fields for cmdbId, costCenter, businessUnit, environment, primaryContact, secondaryContact with parser/validator checks:
- environment enum: prod|nonprod with default nonprod
- contact format validation for email fields

Rationale:
These values are required for governance and support routing but do not affect mutation eligibility except validation correctness.

Alternatives considered:
- Treat all fields as optional free text: rejected due to explicit enum/email requirements.

## Research Item 6: Compatibility and observability during mixed old/new data

Decision:
Audit artifact and step-summary emit both canonical topology status and compatibility projection details during read/upgrade paths.

Rationale:
Operators need deterministic status and provenance while old and new records coexist.

Alternatives considered:
- Hide compatibility details from summaries: rejected because troubleshooting becomes opaque.

## Research Item 7: Rate limit impact of enhanced validation

Decision:
Reuse existing read paths and avoid extra API calls for fields that are form-only metadata. Keep bounded retry strategy unchanged.

Rationale:
Most new fields are local validation only. Team/topology reconciliation reads remain the same class of API usage as existing tenant model workflow.

Alternatives considered:
- Additional API verification for contacts/mappings: rejected as unnecessary and rate-limit costly.

## Clarification Resolution Summary

All technical-context unknowns are resolved for planning:
- Runtime, auth model, dependencies, platform, observability, constraints, and migration strategy are all defined.
