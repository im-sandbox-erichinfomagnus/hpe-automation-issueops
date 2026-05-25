# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Workflow Runtime**: [e.g., GitHub Actions reusable workflows on ubuntu-latest or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., issue-ops/parser, gh CLI, GitHub REST API client action, jq or NEEDS CLARIFICATION]  
**Authentication Model**: [e.g., GITHUB_TOKEN with scoped permissions, OIDC to cloud secret broker, GitHub App token or NEEDS CLARIFICATION]  
**Configuration Surface**: [e.g., YAML issue forms, reusable workflow inputs, policy files or NEEDS CLARIFICATION]  
**Testing**: [e.g., actionlint, workflow unit tests, parser fixture tests, integration dry-run tests or NEEDS CLARIFICATION]  
**Target Platform**: [GitHub-hosted runners, self-hosted runners, or NEEDS CLARIFICATION]
**Project Type**: [IssueOps automation repository with reusable workflows and issue templates]  
**Observability**: [e.g., structured step summaries, JSON log artifacts, audit outputs or NEEDS CLARIFICATION]  
**Constraints**: [e.g., least privilege, approval gates, rate limits, no repo-hosted source of truth or NEEDS CLARIFICATION]  
**Scale/Scope**: [e.g., org-wide team management, repository access workflows, enterprise admin automation or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [ ] Authorization requirements are defined for every privileged action, including requester,
  approver, and executing identity boundaries.
- [ ] Validation strategy covers issue form parsing, schema/input checks, actor eligibility,
  and target-state preconditions.
- [ ] Reconciliation logic defines current-state reads, drift detection, idempotent no-op
  behavior, and safe re-run semantics.
- [ ] Dry-run behavior, rollback or compensating actions, and partial failure handling are
  specified before implementation.
- [ ] Structured logging and audit artifacts identify the issue, actor, approvers, API
  operations, reconciliation outcome, and final state.
- [ ] GitHub API rate-limit and retry strategy is defined, including handling for secondary
  rate limits or abuse protection.
- [ ] Reusable workflow boundaries and shared policy components are identified; one-off logic
  is justified in Complexity Tracking if retained.

## Project Structure

Use the constitution section `Repository Structure Conventions` to keep the feature layout and repository paths aligned with the repository-standard structure.

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    [feature-form].yml
  workflows/
    [feature-entrypoint].yml

src/
  actions/
    [shared-action]/
  workflow-support/
    [validation-or-reconciliation-module]
  scripts/
    [supporting-script-if-needed]

docs/
  [feature].md

tests/
  contract/
  fixtures/
  integration/
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above. Keep `.github/ISSUE_TEMPLATE` for issue intake,
limit `.github/workflows` to GitHub-required entrypoint shims, place
substantive implementation code under `src`, and call out any justified
exception to the constitution section `Repository Structure Conventions`.]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
