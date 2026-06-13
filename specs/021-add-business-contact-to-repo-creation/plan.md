# Implementation Plan: Add Business Contacts to Tenant Repository Creation

**Branch**: `regression-fixes-cross-issueops-20260605` | **Date**: 2026-06-08 | **Spec**: `spec.md`
**Input**: Feature specification from `specs/021-add-business-contact-to-repo-creation/spec.md` — adds one required field (`primary_contact`) and one optional field (`secondary_contact`) to the tenant repository creation Issue Form.

## Summary

Extend the tenant repository creation IssueOps workflow with two new contact fields — `primary_contact` (required) and `secondary_contact` (optional) — that capture the business owners for the repository being created. Each field accepts either a GitHub handle (preferred) or a work email address (fallback). The fields are added to the issue form, parsed into the existing request data model, validated for format, carried through the approval and execution stages, and recorded in all audit artifacts and step summaries. No repository creation logic, tenant-boundary enforcement, approval binding, or governance-grant behaviour is altered.

## Technical Context

**Workflow Runtime**: GitHub Actions reusable workflows on `ubuntu-latest`.
**Primary Dependencies**: `issue-ops/parser`, existing `parse-tenant-repo-request.js`, `validate-tenant-repo-request.js`, `reconcile-tenant-repo-creation.js`, and `build-audit-artifact.js` in `/src/workflow-support`; GitHub REST API via existing modules; Node.js.
**Authentication Model**: `ISSUEOPS_GITHUB_TOKEN` and `GITHUB_TOKEN` with least-privilege access — unchanged from predecessor workflow.
**Configuration Surface**: GitHub issue form in `/.github/ISSUE_TEMPLATE/create-tenant-repos.yml`; parser and validator modules in `/src/workflow-support`; audit artifact builder in `/src/workflow-support/build-audit-artifact.js`.
**Testing**: Contract tests under `/tests/contract`, fixture updates under `/tests/fixtures`, regression integration tests under `/tests/integration`.
**Target Platform**: GitHub-hosted runners.
**Project Type**: IssueOps automation repository with reusable workflows and issue templates.
**Observability**: Structured audit artifacts, GitHub step summaries, and workflow outputs — extended to include `primary_contact` and `secondary_contact`.
**Constraints**: Least privilege (unchanged); fail-closed on missing primary contact; contact fields are request-time metadata only — no reconciliation against live GitHub state.
**Scale/Scope**: Additive enhancement to the tenant-scoped repository creation workflow; no cross-tenant or cross-workflow side effects.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Authorization requirements are defined for every privileged action, including requester, approver, and executing identity boundaries.
  *Contact fields carry no authorization weight. The predecessor workflow authorization model is fully preserved (spec AR-001 to AR-005).*
- [x] Validation strategy covers issue form parsing, schema/input checks, actor eligibility, and target-state preconditions.
  *VS-001 to VS-008 define parsing, format checks, required-field enforcement, and integration with all predecessor validations.*
- [x] Reconciliation logic defines current-state reads, drift detection, idempotent no-op behavior, and safe re-run semantics.
  *RL-001 to RL-005 clarify that contacts are metadata only; no GitHub state is reconciled on their behalf. Re-runs record current contacts and remain idempotent.*
- [x] Dry-run behavior, rollback or compensating actions, and partial failure handling are specified before implementation.
  *Dry-run includes contact values in planned output (VS-007). Rollback blocks on invalid contacts (RH-001). Partial failure on audit persistence failure (RH-002).*
- [x] Structured logging and audit artifacts identify the issue, actor, approvers, API operations, reconciliation outcome, and final state.
  *OR-001 to OR-005 extend existing audit artifacts and summaries with primary_contact and secondary_contact.*
- [x] GitHub API rate-limit and retry strategy is defined, including handling for secondary rate limits or abuse protection.
  *GH-001: contact validation is a local format check with no API calls. GH-002 defers Users API validation to a future enhancement.*
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
    build-audit-artifact.js          ← extend to include contact fields in audit output
    normalize-contact.js             ← NEW: GitHub handle and email normalisation/validation helper

tests/
  contract/
    parse-tenant-repo-request.test.js    ← add contact field fixture cases
    validate-tenant-repo-request.test.js ← add contact validation cases
  fixtures/
    create-tenant-repos-with-contacts.json  ← new fixture covering contact field permutations
  integration/
    create-tenant-repos.test.js            ← extend with contact field end-to-end scenarios
```

**Structure Decision**: All substantive logic lives in `/src/workflow-support`. A new `normalize-contact.js` module isolates the GitHub handle and email format rules so they can be unit-tested independently and reused by future features. The issue form template is updated in-place. No new workflow entrypoints or `.github/workflows` files are required for this enhancement.

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
8. Add integration test scenarios for the full happy-path (both contacts) and the no-op path (repository already exists).

