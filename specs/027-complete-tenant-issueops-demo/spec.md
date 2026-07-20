# Complete Tenant IssueOps Demo Acceptance

## Purpose

Provide traceable acceptance evidence for every scenario in Eric Hill's tenant IssueOps demo outline.

## Requirements

- Every administrative call shown in the demo accepts spreadsheet input.
- Create tenant accepts exactly one tenant row and a designated tenant-admin login.
- The create-tenant requester is an active organization owner.
- The designated tenant admin is an active organization member and becomes maintainer of the root, admin, RepoAdmin, and CICDAdmin teams.
- Repository, ruleset, variable, and runner operations preserve tenant-boundary authorization and fail closed when the actor is unauthorized.
- Native GitHub team membership management is shown separately from IssueOps automation.
- Seven separate live GitHub recordings are made, one per scenario.
- Every video shows a successful path and a quick unauthorized rejection.
- The matrix in `docs/tenant-issueops-requirements-matrix.md` maps each scenario to its implementation, automated tests, CSV files, and recording guide.
