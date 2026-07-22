# Implementation Plan: Add Business Contacts to Tenant Repository Creation

**Branch**: `regression-fixes-cross-issueops-20260605` | **Date**: 2026-06-08 | **Spec**: `spec.md`
**Input**: Feature specification from `specs/021-add-business-contact-to-repo-creation/spec.md` — adds one required field (`primary_contact`) and one optional field (`secondary_contact`) to the tenant repository creation Issue Form.

## Summary

Extend the tenant repository creation IssueOps workflow with two new contact fields — `primary_contact` (required) and `secondary_contact` (optional) — that capture the business owners for the repository being created. Each field accepts either a GitHub handle (preferred) or a work email address (fallback). The fields are added to the issue form, parsed into the existing request data model, validated for format, carried through the approval and execution stages, recorded in all audit artifacts and step summaries, and persisted to repository custom properties `primary_business_contact` and `secondary_business_contact`. Before setting repository values, execution now validates organization custom-property schema and creates missing required definitions automatically. No tenant-boundary enforcement, approval binding, or governance-grant authorization model behaviour is altered.

## Technical Context

**Workflow Runtime**: GitHub Actions reusable workflows on `ubuntu-latest`.
**Primary Dependencies**: `issue-ops/parser`, existing `parse-tenant-repo-request.js`, `validate-tenant-repo-request.js`, `reconcile-tenant-repo-creation.js`, and `build-audit-artifact.js` in `/src/workflow-support`; GitHub REST API via existing modules; Node.js.
**Authentication Model**: `ISSUEOPS_GITHUB_TOKEN` and `GITHUB_TOKEN` with least-privilege access — unchanged from predecessor workflow.
**Configuration Surface**: GitHub issue form in `/.github/ISSUE_TEMPLATE/create-tenant-repos.yml`; parser and validator modules in `/src/workflow-support`; execution/reconciliation modules in `/src/scripts/run-approved-execution.js` and `/src/workflow-support/reconcile-tenant-repo-creation.js`; audit and summary emitters in `/src/workflow-support/build-audit-artifact.js` and `/src/scripts/emit-audit-summary.js`.
**Testing**: Contract tests under `/tests/contract`, fixture updates under `/tests/fixtures`, regression integration tests under `/tests/integration`.
**Target Platform**: GitHub-hosted runners.
**Project Type**: IssueOps automation repository with reusable workflows and issue templates.
**Observability**: Structured audit artifacts, GitHub step summaries, and workflow outputs — extended to include `primary_contact` and `secondary_contact`.
**Constraints**: Least privilege (unchanged); fail-closed on missing primary contact; repository custom-property writes must not change authorization semantics or team-governance mutation logic.
**Scale/Scope**: Additive enhancement to the tenant-scoped repository creation workflow; no cross-tenant or cross-workflow side effects.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Authorization requirements are defined for every privileged action, including requester, approver, and executing identity boundaries.
  *Contact fields carry no authorization weight. The predecessor workflow authorization model is fully preserved (spec AR-001 to AR-005).*
- [x] Validation strategy covers issue form parsing, schema/input checks, actor eligibility, and target-state preconditions.
  *VS-001 to VS-008 define parsing, format checks, required-field enforcement, and integration with all predecessor validations.*
- [x] Reconciliation logic defines current-state reads, drift detection, idempotent no-op behavior, and safe re-run semantics.
  *RL-001 to RL-006 require contact propagation to audit outputs and repository custom properties while keeping repository creation and permission reconciliation unchanged, including schema preflight/create before value mutation.*
- [x] Dry-run behavior, rollback or compensating actions, and partial failure handling are specified before implementation.
  *Dry-run includes contact values in planned output (VS-007). Rollback blocks on invalid contacts (RH-001). Partial failure on audit persistence failure (RH-002).*
- [x] Structured logging and audit artifacts identify the issue, actor, approvers, API operations, reconciliation outcome, and final state.
  *OR-001 to OR-005 extend existing audit artifacts and summaries with primary_contact and secondary_contact.*
- [x] GitHub API rate-limit and retry strategy is defined, including handling for secondary rate limits or abuse protection.
  *GH-001: contact parsing/validation is local. Custom-property writes reuse existing retry/backoff policy in execution mutation paths.*
- [x] Reusable workflow boundaries and shared policy components are identified; one-off logic is justified in Complexity Tracking if retained.
  *All changes are to existing workflow-support modules (parse, validate, build-audit-artifact). No new workflow boundaries are introduced.*

## Project Structure

### Documentation (this feature)

```text
specs/021-add-business-contact-to-repo-creation/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── spec.md
├── contracts/
│   └── business-contacts.md   ← Phase 1 output
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    create-tenant-repos.yml          ← add primary_contact and secondary_contact input fields

src/
  workflow-support/
    parse-tenant-repo-request.js     ← extend to parse primary_contact and secondary_contact
    validate-tenant-repo-request.js  ← extend to validate contact format (handle or email)
    reconcile-tenant-repo-creation.js ← extend tenant desired-state with custom property mutation intent
    github-team-repo-api.js          ← add helpers for repository custom-property value mutation and org schema read/create
    build-audit-artifact.js          ← extend to include contact fields in audit output
    build-execution-outcome.js       ← extend to include repository custom property mutation result
    normalize-contact.js             ← NEW: GitHub handle and email normalisation/validation helper

  scripts/
    run-approved-execution.js        ← apply repository custom properties in approved execution
    emit-audit-summary.js            ← include custom property plan/result lines in workflow summary

tests/
  contract/
    parse-tenant-repo-request.test.js    ← add contact field fixture cases
    validate-tenant-repo-request.test.js ← add contact validation cases
  fixtures/
    create-tenant-repos-with-contacts.json  ← new fixture covering contact field permutations
  integration/
    create-tenant-repos.test.js            ← extend with contact field end-to-end scenarios
    create-tenant-repos-workflow.test.js   ← assert custom-property mutation payloads and results
```

**Structure Decision**: Validation and normalization logic remains in `/src/workflow-support` and execution mutation wiring remains in existing scripts. A new `normalize-contact.js` module isolates the GitHub handle and email format rules so they can be unit-tested independently and reused by future features. Repository custom-property writes are implemented as an additive API helper and execution action without introducing new workflow entrypoints.

## Complexity Tracking

No constitution violations are required for this feature. The enhancement is fully additive and fits the existing IssueOps workflow architecture without introducing new workflow boundaries or repository-level structures.

## Next Plan Steps

1. Add `primary_contact` and `secondary_contact` input fields to `.github/ISSUE_TEMPLATE/create-tenant-repos.yml` after `repository_visibility` and before `designated_approver`.
2. Create `src/workflow-support/normalize-contact.js` with GitHub handle normalisation, handle format validation, and email format validation functions.
3. Extend `parse-tenant-repo-request.js` to read and normalise both contact fields from parsed issue payload.
4. Extend `validate-tenant-repo-request.js` to reject missing/blank `primary_contact`, and to reject either contact if present and in invalid format.
5. Extend `build-audit-artifact.js` to include `primary_contact`, `primary_contact_type`, `secondary_contact`, and `secondary_contact_type` in every audit record.
6. Add contract test fixtures covering: valid handle, valid email, missing primary, invalid format, secondary absent, both contacts present.
7. Add regression test fixtures confirming existing create-tenant-repos payloads (no contact fields) continue to parse and validate correctly.
8. Extend approved execution to set repository custom properties `primary_business_contact` and `secondary_business_contact` on create and no-op paths.
9. Add organization schema preflight in approved execution: check required property definitions and create missing ones before repository value mutation.
10. Add integration test scenarios for the full happy-path (both contacts) and the no-op path (repository already exists), including custom-property schema-create and value-mutation assertions.

