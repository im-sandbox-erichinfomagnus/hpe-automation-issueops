# Specification Quality Checklist: Move Tenant GitHub-Hosted Runner

**Created**: 2026-06-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] User value and authorization boundaries are explicit.
- [x] Scope is one runner and one existing target group.
- [x] No unresolved clarification markers remain.
- [x] Out-of-scope creation behavior is explicit.

## Requirement Completeness

- [x] Required and optional form fields are defined.
- [x] Name and id resolution behavior is testable.
- [x] Missing and cross-tenant target behavior is testable.
- [x] Approval, dry-run, retry, and revalidation behavior is defined.
- [x] Audit and issue-comment output is defined.
- [x] Success criteria are measurable.

## Feature Readiness

- [x] Acceptance scenarios cover move, no-op, rejection, and blocked execution.
- [x] API mutation is limited to `runner_group_id`.
- [x] Idempotent rerun behavior is defined.
- [x] Test coverage maps to all primary paths.
