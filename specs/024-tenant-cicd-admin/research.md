# Research: Tenant CI/CD Admin Bootstrap

## Decision 1: Keep baseline tenant bootstrap workflow and extend with third team

- Decision: Extend the existing tenant bootstrap model from spec 014 by adding a deterministic third team `<TenantName>_Tenant_CICDAdmin` while preserving existing baseline team and hierarchy behavior unchanged.
- Rationale: This provides incremental capability expansion without destabilizing known-good tenant creation controls.
- Alternatives considered:
  - Build a separate CI/CD admin workflow independent of tenant bootstrap: rejected due to split governance and fragmented audit trail.
  - Replace baseline team model entirely: rejected due to unnecessary regression risk.

## Decision 2: Represent CI/CD admin as capability intent, not unconditional org-wide grant

- Decision: Model tenant CI/CD admin as an intent that must pass organization capability and policy checks before any privileged assignment is performed.
- Rationale: GitHub CI/CD administration controls are often organization-scoped; safe automation requires explicit guardrails against broad privilege expansion.
- Alternatives considered:
  - Always grant an org-wide admin-equivalent role to CICDAdmin team: rejected because it violates least-privilege and tenant boundary expectations.
  - Ignore CI/CD capability assignment and only create the team: rejected because it does not satisfy requested business intent.

## Decision 3: Primary path uses approved org capability only when safely scoped

- Decision: Use a primary assignment path only when the target organization exposes and allows a policy-approved capability mechanism that can be mapped to tenant-scoped operation semantics.
- Rationale: This allows capability automation in organizations with the required platform support while preserving safety guarantees.
- Alternatives considered:
  - Depend on one fixed API path for all orgs: rejected because capability availability differs by org plan/enablement.
  - Allow per-request manual override to force assignment: rejected because it can bypass policy constraints.

## Decision 4: Fallback path is repository-scoped to tenant-owned repositories only

- Decision: When primary path is unavailable, fallback is limited to repository-scoped CI/CD administration permissions on repositories proven to be tenant-owned.
- Rationale: Repository-scoped fallback preserves least-privilege and avoids unsafe org-wide grants.
- Alternatives considered:
  - Fallback to no checks and broad org privilege assignment: rejected as unsafe.
  - No fallback at all: rejected because repository-scoped path can still provide useful constrained capability where allowed.

## Decision 5: Fail closed when tenant-scoped guarantee is not possible

- Decision: If neither primary nor fallback path can guarantee policy-compliant tenant-scoped CI/CD administration, execution reports blocked/unavailable/failed capability outcome rather than silently over-granting.
- Rationale: Fail-closed behavior aligns with constitution requirements for privileged automation.
- Alternatives considered:
  - Best-effort proceed with warning and broad role grant: rejected due to governance risk.
  - Mark success without assignment: rejected because it hides unmet intent.

## Decision 6: Extend registry and audit schema with capability outcome taxonomy

- Decision: Persist CICDAdmin team identity and capability status (`requested`, `applied`, `skipped`, `blocked`, `unavailable`, `failed`) with reason codes and supporting evidence.
- Rationale: Operators need deterministic run outcomes and remediation context without reading raw logs.
- Alternatives considered:
  - Record only binary success/failure: rejected because it obscures capability-availability and policy-block distinctions.
  - Keep outcomes only in ephemeral summaries: rejected because durable evidence is required.

## Decision 7: Preserve approval and idempotent reconciliation semantics from spec 014

- Decision: Keep designated active target-org-owner approval model unchanged and reconcile current state at execution to avoid duplicate team creation or duplicate capability assignment.
- Rationale: Non-regression is a hard requirement and consistent approval semantics reduce operator risk.
- Alternatives considered:
  - Introduce a second approval actor for capability only: rejected for unnecessary complexity in this version.
  - Apply capability without revalidation at execution: rejected due to drift risk.
