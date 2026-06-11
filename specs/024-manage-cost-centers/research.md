# Research: Manage Cost Centers IssueOps Workflow

## Decision 0: Build a standalone workflow rather than extend the cost-center allocation operation

- Decision: Ship cost-center-management as its own issue form, workflow shim, scripts, and workflow-support modules instead of adding cost-center CRUD into the existing cost-center allocation operation that manages user and resource membership.
- Rationale: The allocation operation owns membership of users and resources inside cost centers; this feature owns the cost-center entities themselves. The two have different desired-state models, different per-row semantics, and a different terminal label namespace. Keeping a separate parse, validate, reconcile, approver, artifact, and summary surface keeps the enterprise-billing concern isolated and avoids modifying the org/team operation dispatcher.
- Alternatives considered:
  - Add create/rename/delete actions to the allocation op's row schema: rejected because it would overload one spreadsheet with two different desired-state models and entangle entity lifecycle with membership reconciliation.
  - Build a generic cost-center operation covering both entities and membership: rejected as premature; the two ship and evolve independently and only share the underlying REST surface.

## Decision 1: Full CRUD including rename, identifying targets by name with an optional id

- Decision: Support create, rename, and delete in one spreadsheet, with each row resolving its target by cost_center_id when supplied and by cost-center name otherwise. A rename carries new_name; a name that matches more than one active cost center with no id is rejected and the candidate ids are listed.
- Rationale: The user asked for full CRUD including rename based on a spreadsheet. Name is the natural human key in a spreadsheet, but cost-center names are not guaranteed unique, so an optional cost_center_id disambiguator is required to make rename and delete deterministic.
- Alternatives considered:
  - Require cost_center_id on every row: rejected because operators edit by name in a spreadsheet and ids are opaque UUIDs.
  - Resolve only by name and silently pick the first match on ambiguity: rejected because it can mutate the wrong cost center; ambiguity must fail closed with candidate ids.

## Decision 2: Delete safety blocks a non-empty cost center unless force is set

- Decision: A delete of a cost center that still has attached resources is rejected as delete_blocked, listing the attached resources, unless the row sets force=true.
- Rationale: Deleting a cost center that still owns resources is destructive and easy to do by accident from a bulk sheet. Blocking by default with an explicit force escape hatch keeps the common case safe while still allowing a deliberate forced delete.
- Alternatives considered:
  - Always delete regardless of attached resources: rejected as unsafe for billing rollups.
  - Never allow deleting a non-empty cost center: rejected because there are legitimate forced-cleanup cases; force makes the intent explicit and auditable.

## Decision 3: Approver authority rests on the designated-approver comment plus a PAT, and the enterprise-role limitation is documented honestly

- Decision: The designated approver named in the request must be the exact login that comments `approved`. There is no cheap REST check for a user's enterprise billing role, so the hard mutation gate is the enterprise-billing-scoped classic PAT enforced by assertCostCenterMutationAllowed, which requires approval approved, approver role designated_approver, dry-run off, and a PAT-backed token.
- Rationale: Cost-center endpoints are enterprise-scoped and require manage_billing:enterprise. GitHub does not expose a low-cost REST endpoint to confirm that an arbitrary commenter holds an enterprise billing role, so the workflow cannot prove approver enterprise authority. The honest control is that mutation only succeeds when an enterprise-billing PAT is configured, which by definition is held by an enterprise owner or billing manager. The designated-approver comment is the human approval signal layered on top.
- Alternatives considered:
  - Verify the approver's enterprise billing role over REST before mutation: rejected because no cheap endpoint exists; attempting it would add latency and still not be authoritative.
  - Treat any `approved` comment as sufficient: rejected because the named approver is the only login that should unlock execution.
  - Document the PAT as the sole control and drop the approver comment: rejected because an explicit human approval signal is still required by the constitution's approval-gate principle.

## Decision 4: Fail-soft dry-run until an enterprise token and slug are provided

- Decision: When no enterprise token or slug is available, validation cannot list live cost centers, so it warns, marks each actionable row unverified, produces an approval-ready plan computed from the spreadsheet, and runs dry-run only. Execution re-resolves against live cost centers when the token lands.
- Rationale: This matches the operating posture of the prior cost-center allocation operation and lets the workflow be exercised, reviewed, and approved before an enterprise billing PAT is configured. It is the current expected operating mode until an enterprise billing token and slug are provided.
- Alternatives considered:
  - Hard-fail validation when no live access is available: rejected because it would block all dry-run review and rehearsal before credentials exist.
  - Treat the unverified plan as executable: rejected because unverified rows have not been resolved against live state; execution always re-validates with live access first.

## Decision 5: Cost-center REST API surface

- Decision: Use the enterprise-scoped GitHub billing cost-center endpoints through a thin, dependency-free fetch client: GET and POST /enterprises/{enterprise}/settings/billing/cost-centers, and GET, PATCH (name), and DELETE /enterprises/{enterprise}/settings/billing/cost-centers/{id}. The cost-center object carries id, name, state (active or deleted), and resources[] of {type, name}.
- Rationale: These endpoints require a classic PAT with manage_billing:enterprise held by an enterprise owner or billing manager; GitHub App and fine-grained tokens are not supported. A small fetch wrapper mirrors the conventions of the existing github-team-api.js client and keeps the feature dependency-free.
- Alternatives considered:
  - Use the GraphQL billing API: rejected to keep the client thin and consistent with the existing REST helpers.
  - Use a GitHub App or fine-grained token: rejected because the cost-center endpoints require a classic PAT; the policy guard explicitly rejects non-PAT tokens.
