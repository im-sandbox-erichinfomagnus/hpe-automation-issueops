# Research: Tenant Creation IssueOps Workflow

## Decision 1: Keep tenant creation as a dedicated workflow entrypoint

- Decision: Add a dedicated create-tenant-model issue form and workflow entrypoint rather than extending existing team creation or hierarchy workflows.
- Rationale: Tenant creation composes multiple reconciled operations (two-team bootstrap, hierarchy link, requester maintainer bootstrap, and durable registry persistence) with one approval and one audit lifecycle.
- Alternatives considered:
  - Reuse existing create-org-teams + add-child-teams + add-team-members as chained manual operations: rejected due to weak atomicity and fragmented audit outcomes.
  - Add tenant mode toggles inside existing operations: rejected due to policy complexity and regression risk in stable workflows.

## Decision 2: Use deterministic tenant name normalization and slug derivation

- Decision: Normalize tenant input once, derive deterministic team names (`TenantName_Tenant`, `TenantName_RepoAdmins`), then derive slugs using existing slugification rules and reject collisions/invalid outcomes.
- Rationale: Deterministic derivation is required for idempotency and for safe no-op reruns.
- Alternatives considered:
  - Allow free-form team names from request payload: rejected because it weakens guardrails and makes registry drift harder to detect.
  - Auto-resolve collisions by suffixing random values: rejected because non-deterministic names break replay safety and operator expectations.

## Decision 3: Preserve explicit active-org-owner approval model

- Decision: Require central comment approval from a designated actor who is currently an active owner in the target organization.
- Rationale: Tenant creation mutates organization team structure and must use the same explicit privileged-approval model used by existing high-privilege workflows.
- Alternatives considered:
  - Approve by intended tenant admin/requester only: rejected due to insufficient authority for org-level team hierarchy mutation.
  - Treat central issue assignment as approval: rejected because assignment is routing metadata only.

## Decision 4: Model durable tenant registry persistence as converged-success requirement

- Decision: Persist one per-tenant record under `tenant-registry/` as a durable repository write (automated commit/PR preferred), and treat inability to persist durably as blocked/partial completion with fallback artifact evidence.
- Rationale: Registry is required for policy traceability and future tenant-boundary controls; ephemeral artifacts alone are insufficient for long-lived governance.
- Alternatives considered:
  - Artifact-only registry: rejected due to retention windows and weak discoverability.
  - External database/service: rejected for v1 due to additional infrastructure and secret management complexity.

## Decision 5: Reuse existing policy modules and approval-gate framework

- Decision: Reuse existing policy/action patterns (`team-creation-policy`, `team-hierarchy-policy`, `team-membership-policy`) and approval-gate script wiring, with tenant-specific request parser/validator/reconciler.
- Rationale: Reuse aligns with constitution requirements and lowers regression risk.
- Alternatives considered:
  - Build an isolated one-off workflow implementation: rejected due to duplicated policy logic and maintenance overhead.

## Decision 6: Treat requester maintainer bootstrap as scoped and non-expansive

- Decision: Only the requester is bootstrapped as maintainer on `TenantName_Tenant`; no other user/team membership changes are allowed in this version.
- Rationale: Keeps tenant bootstrap minimal and auditable while avoiding scope creep into broader identity governance.
- Alternatives considered:
  - Bootstrap requester on both tenant teams: rejected because spec only requires parent-team maintainer bootstrap.
  - Accept arbitrary admin member lists in request: rejected because it expands scope and authorization complexity.

## Decision 7: Preserve fail-closed behavior for partial failure and retryable API disruptions

- Decision: Use bounded retry for retryable API failures and report partial outcomes with explicit remediation when some reconciliation steps succeed before failure.
- Rationale: Existing repository standards require safe execution and auditable compensating guidance.
- Alternatives considered:
  - Best-effort continue after non-retryable failure: rejected because it risks inconsistent state and unclear recovery.
  - Hard fail with no partial detail: rejected because operators need per-step outcome evidence for remediation.
