# Manage Cost Centers - Design

Date: 2026-06-11
Feature branch: cost-center-management
Spec: ../../../specs/024-manage-cost-centers/spec.md

## What this is

A standalone IssueOps workflow that bulk creates, renames, and deletes GitHub Enterprise billing cost centers from a CSV spreadsheet submitted in one issue. It owns the cost-center entities themselves. It is a sibling to the separate cost-center allocation operation, which manages user and resource membership inside cost centers. The two share only the underlying enterprise billing REST surface.

## The four answered design questions

1. Scope of operations. Full CRUD on cost-center entities: create, rename, delete in one spreadsheet. The user asked for add and remove plus rename for the cost centers themselves, so the row action enum is create, rename, delete.

2. How to identify a target. By cost-center name as the human key, with an optional cost_center_id UUID to disambiguate. Names are not unique, so a row resolves its target by cost_center_id when supplied and by name otherwise. A name that matches more than one active cost center with no id is rejected and the candidate ids are listed.

3. Delete safety. A delete of a cost center that still has attached resources is blocked by default (delete_blocked, listing the resources) and only proceeds when the row sets force=true. This keeps the common bulk-delete safe while allowing a deliberate forced cleanup.

4. Where it lives. A separate workflow, not an extension of the allocation operation. The entity lifecycle and the membership reconciliation have different desired-state models, different per-row semantics, and different terminal-label namespaces, so the cost-center-management feature ships its own parse, validate, reconcile, approver, artifact, and summary surface and does not touch the org/team operation dispatcher.

## CSV contract

Header must include at least cost_center and action. Columns: cost_center (required, the name), action (required: create/rename/delete), new_name (required for rename), cost_center_id (optional UUID disambiguator), force (optional, true to delete a non-empty cost center). A row only fills the columns its action uses. Fields may be double-quoted to contain commas, and the whole block may be wrapped in a ```csv code fence. Rows are deduped. Data rows are numbered 1-based excluding the header, and that number is cited on every per-row finding.

## Validate, reconcile, execute flow

Intake. The issue form fields enterprise, designated_approver, cost_centers, dry_run (default true), and justification are parsed by issue-ops/parser@v5 into PARSED_ENTERPRISE, PARSED_DESIGNATED_APPROVER, PARSED_COST_CENTERS, PARSED_DRY_RUN, and PARSED_JUSTIFICATION. parse-manage-cost-centers-request unwraps any code fence, parses the CSV, dedupes rows, and builds the request envelope.

Validation. validate-manage-cost-centers-request checks the structural request (enterprise, approver, CSV header and data rows) and then evaluates each row. With live access it resolves the target and classifies the row:

- create: noop if the name already exists, else create_cost_center.
- rename: requires new_name; resolves by id then name; ambiguous-with-no-id is rejected with candidate ids; not_found is rejected; rename to the current name is a noop; rename to a name used by another cost center is name_taken.
- delete: resolves by id then name; missing target is a noop; ambiguous-with-no-id is rejected; a non-empty cost center is delete_blocked unless force=true.

Cross-row conflicts (same cost center, different actions) reject all involved rows. Per-row rejections do not sink the sheet; the valid subset proceeds. Structural failures (no enterprise, no approver, empty or invalid-header CSV, no data rows) fail the whole request as validation_failed.

Reconciliation. reconcile-manage-cost-centers-changes buckets the actionable rows (valid or unverified) into creates, renames, and deletes and orders them deterministically as creates, then renames, then deletes. An empty plan is blocked with reason no_rows. A dry-run plan is state validated and applies nothing.

Execution. run-manage-cost-centers-execution runs only when approval-status is approved. The policy guard runs first, then execution re-validates against live cost centers so the executed plan reflects current state, then applies creates, then renames, then deletes through the REST client with bounded retry. Each row records created, renamed, deleted, noop, or failed. request_status is executed when nothing failed, partially_executed when some rows applied or no-op'd while others failed, and failed when nothing applied. On any failure rollback_status is manual_follow_up_required; recovery is an idempotent re-run, not an automated compensating mutation. A terminal label issueops:manage-cost-centers:<status> is applied to the issue.

## Usability decisions

- dry_run defaults to true so the first submission always previews the plan and the per-row outcome table before anyone can mutate.
- Failure reasons are explicit per row (invalid_action, missing_cost_center, missing_new_name, name_too_long, ambiguous_cost_center, not_found, name_taken, delete_blocked, conflicting_rows) and the detail tells the operator how to fix it, including listing candidate ids for ambiguity and listing attached resources for a blocked delete.
- Unknown CSV columns are ignored with a warning rather than failing the row, so an operator can keep extra notes columns in their spreadsheet.
- The summary renders a single per-row table with the target, action, outcome, and detail so a reviewer never has to read raw API payloads.

## Authorization

The designated approver named in the request must be the exact login that comments `approved`. resolve-manage-cost-centers-approver maps commenter==designated to approver_role designated_approver, everything else to other. The hard mutation gate is assertCostCenterMutationAllowed, which blocks unless approval is approved, approver role is designated_approver, dry-run is off, and the token is a PAT-backed enterprise billing credential. The cost-center REST endpoints require a classic PAT with manage_billing:enterprise held by an enterprise owner or billing manager; GitHub App and fine-grained tokens are rejected.

## Open items and limitations

- Enterprise token and slug. The current expected operating mode is fail-soft dry-run until an enterprise billing token and slug are provided. Without live access, validation warns, marks actionable rows unverified, produces an approval-ready plan from the spreadsheet, and runs dry-run only; execution re-resolves each row against live cost centers once the token lands. This matches the posture of the prior cost-center allocation operation.
- Approver-authority verification limitation. There is no cheap REST check for a user's enterprise billing role, so the workflow cannot prove that the designated approver actually holds an enterprise billing role. The designated-approver `approved` comment is the human approval signal, and the enterprise-billing-scoped classic PAT is the hard control. This is documented honestly rather than papered over with a verification call that would not be authoritative.
