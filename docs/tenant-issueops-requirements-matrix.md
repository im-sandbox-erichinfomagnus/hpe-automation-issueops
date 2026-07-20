# Tenant IssueOps Requirements Matrix

This matrix tracks Eric Hill's seven demo scenarios and the V2.2.1 requirement that all IssueOps calls shown in the exercise take spreadsheet input.

| Scenario | Required successful path | Required rejection | Implementation and tests | Recording guide |
|---|---|---|---|---|
| 1. Organization owner operations | Create teams, add members, add child teams, and grant team repository access from spreadsheet input | Non-owner or unapproved actor is rejected | Existing four CSV workflows, `sample-input-csvs/`, contract and integration suites | `demo-recording-kit/scenario-01-org-owner-ops.md` |
| 2. Create tenant | Owner creates root, admin, RepoAdmin, and CICDAdmin teams and assigns `user1` as maintainer from one tenant row | Non-owner requester or non-member tenant admin is rejected | `parse-tenant-creation-request.js`, `validate-tenant-creation-request.js`, `run-approved-execution.js`, `single-row-csv-intake.test.js`, `create-tenant-model-validation.test.js`, `create-tenant-model-workflow.test.js` | `demo-recording-kit/scenario-02-create-tenant.md` |
| 3. Native team membership | Tenant admin manages child-team membership in GitHub's native team UI | User without team maintainer access is rejected by GitHub | Native GitHub team permissions plus the maintainer assignments established by scenario 2 | `demo-recording-kit/scenario-03-native-team-membership.md` |
| 4. Create tenant repositories | RepoAdmin creates repositories from spreadsheet rows | Actor outside RepoAdmin and tenant-admin paths is rejected | `create-tenant-repos.yml`, repository parser, validator, integration tests, and `create-tenant-repos.testcases.csv` | `demo-recording-kit/scenario-04-create-tenant-repos.md` |
| 5. Repository rulesets | Authorized rows create and delete rulesets across repositories | Unauthorized row is rejected without aborting authorized rows | Ruleset issue forms, per-row validators, integration tests, `specs/026-manage-repository-rulesets/`, ruleset testcase CSVs | `demo-recording-kit/scenario-05-repository-rulesets.md` |
| 6. Tenant variables | CICD or tenant admin creates, updates, and deletes tenant-prefixed variables from spreadsheet rows | Actor outside the tenant boundary is rejected | `manage-tenant-variables.yml`, variable parser, validator, integration tests, `specs/025-manage-tenant-variables/` | `demo-recording-kit/scenario-06-tenant-variables.md` |
| 7. Tenant runners | CICD or tenant admin creates a runner group, creates a runner, moves it, and deletes it from spreadsheet rows | Actor outside CICDAdmin and tenant-admin paths is rejected | Runner issue forms and workflows, four CSV parsers and validators, `single-row-csv-intake.test.js`, runner testcase CSVs | `demo-recording-kit/scenario-07-tenant-runners.md` |

The operator records each scenario from the live GitHub issue, Actions run, and resulting organization state. Submission-ready CSV files are under `demo-recording-kit/csv/`.
