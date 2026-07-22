# Research: Tenant Repository Creation IssueOps Workflow

## Decision 1: Use tenant-registry on main branch as the authoritative tenant-association source

- Decision: Resolve canonical tenant context from the `tenant-registry/` directory on the repository main branch, then confirm it against live organization team hierarchy and membership state.
- Rationale: The tenant bootstrap model introduced durable tenant records specifically to support later tenant-boundary enforcement. Treating registry data as authoritative avoids per-request inference drift while still requiring live-state confirmation before mutation.
- Alternatives considered:
  - Infer tenant solely from live team naming and requester memberships: rejected because multiple matches or stale naming patterns can create ambiguity without a durable tenant record.
  - Store tenant association only in issue metadata: rejected because requester-supplied metadata is not authoritative enough for privileged repository creation.

## Decision 2: Require exactly one maintainer-qualified `X_Tenant` match for the request context

- Decision: Accept a request only when the requester can be proven maintainer of exactly one tenant-pattern team valid for the requested organization and registry record.
- Rationale: The feature must fail closed on ambiguous tenancy. Exact-one matching provides a deterministic safety boundary and aligns with the user’s policy rules.
- Alternatives considered:
  - Allow requester selection among multiple tenant matches in a single request: rejected because the workflow would still need authoritative disambiguation and would increase approval and audit complexity.
  - Allow any tenant member, not maintainer, to request repository creation: rejected because the requested governance model requires stronger tenant-admin authority.

## Decision 3: Bind approval to the latest validated tenant context

- Decision: Generate a context marker from the latest successful validation and require approval logic to verify both approver authority and unchanged tenant context before execution is unlocked.
- Rationale: The repo-access tenancy hardening specs establish stale-approval invalidation as a core control. Repository creation is equally sensitive and must not allow approval replay across corrected or drifted request state.
- Alternatives considered:
  - Treat any valid approval comment from the designated approver as sufficient: rejected because it would authorize execution even after tenant context changes.
  - Bind approval only to issue number: rejected because issue identity alone does not capture request revisions or boundary changes.

## Decision 4: Create one repository per request in v1

- Decision: Scope the first version to exactly one repository per request.
- Rationale: One-repository scope keeps tenant resolution, approval review, reconciliation, and partial-failure reporting narrow and auditable while the new governance pattern is introduced.
- Alternatives considered:
  - Batch repository creation in one request: rejected because it expands ambiguity, increases partial-failure surface area, and complicates approval review for a new privileged workflow.

## Decision 5: Grant admin via `X_RepoAdmin` team only and avoid direct individual admin by default

- Decision: After repository creation, grant admin permission to the validated `X_RepoAdmin` team and do not add direct individual admins by default.
- Rationale: Tenant governance in this repository is team-based. Team-scoped admin preserves least privilege, keeps governance consistent with the tenant model, and avoids embedding per-user exceptions in the base workflow.
- Alternatives considered:
  - Grant direct admin to requester as part of repository creation: rejected because it weakens the team-governed tenant model and expands privilege outside the intended control path.
  - Grant both requester admin and team admin: rejected because it creates dual authority paths with no stated need in v1.

## Decision 6: Reuse existing validation, approval, audit, and summary framework with tenant-specific modules

- Decision: Implement repository-creation-specific parsing, tenant resolution, validation, and reconciliation modules under existing workflow-runner and audit patterns already used by the repository.
- Rationale: This matches the constitution’s reusable workflow architecture rule and reduces regression risk by keeping entrypoint shims thin and policy logic centralized.
- Alternatives considered:
  - Build a one-off workflow with inline YAML scripting: rejected because it duplicates policy logic and weakens maintainability.

## Decision 7: Treat permission-grant and audit persistence failures as explicit partial-failure states

- Decision: If repository creation succeeds but the `X_RepoAdmin` admin grant fails, or if audit persistence fails after successful mutation, record partial-failure rather than full success.
- Rationale: Repository existence alone is not the full desired state. The tenant-governance model and durable evidence are part of converged completion.
- Alternatives considered:
  - Report success after repository creation even if governance or audit persistence fails: rejected because it hides incomplete control-state convergence.
  - Automatically delete the repository on grant failure: rejected because destructive compensation increases risk and is not guaranteed safe under ambiguous runtime conditions.