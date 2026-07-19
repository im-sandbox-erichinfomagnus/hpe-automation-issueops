# Tenant IssueOps Requirements Matrix

This matrix tracks Eric Hill's seven demo scenarios and the V2.2.1 requirement that all IssueOps calls shown in the exercise take spreadsheet input.

| Scenario | Required successful path | Required rejection | Implementation and tests | Delivered video |
|---|---|---|---|---|
| 1. Organization owner operations | Create teams, add members, add child teams, and grant team repository access from spreadsheet input | Non-owner or unapproved actor is rejected | Existing four CSV workflows, `sample-input-csvs/`, contract and integration suites | `01-org-owner-ops.mp4` |
| 2. Create tenant | Owner creates root, admin, RepoAdmin, and CICDAdmin teams and assigns `user1` as maintainer from one tenant row | Non-owner requester or non-member tenant admin is rejected | `parse-tenant-creation-request.js`, `validate-tenant-creation-request.js`, `run-approved-execution.js`, `single-row-csv-intake.test.js`, `create-tenant-model-validation.test.js`, `create-tenant-model-workflow.test.js` | `02-create-tenant.mp4` |
| 3. Native team membership | Tenant admin manages child-team membership in GitHub's native team UI | User without team maintainer access is rejected by GitHub | Native GitHub team permissions plus the maintainer assignments established by scenario 2 | `03-native-team-membership.mp4` |
| 4. Create tenant repositories | RepoAdmin creates repositories from spreadsheet rows | Actor outside RepoAdmin and tenant-admin paths is rejected | `create-tenant-repos.yml`, repository parser, validator, integration tests, and `create-tenant-repos.testcases.csv` | `04-create-tenant-repos.mp4` |
| 5. Repository rulesets | Authorized rows create and delete rulesets across repositories | Unauthorized row is rejected without aborting authorized rows | Ruleset issue forms, per-row validators, integration tests, `specs/026-manage-repository-rulesets/`, ruleset testcase CSVs | `05-repository-rulesets.mp4` |
| 6. Tenant variables | CICD or tenant admin creates, updates, and deletes tenant-prefixed variables from spreadsheet rows | Actor outside the tenant boundary is rejected | `manage-tenant-variables.yml`, variable parser, validator, integration tests, `specs/025-manage-tenant-variables/` | `06-tenant-variables.mp4` |
| 7. Tenant runners | CICD or tenant admin creates a runner group, creates a runner, moves it, and deletes it from spreadsheet rows | Actor outside CICDAdmin and tenant-admin paths is rejected | Runner issue forms and workflows, four CSV parsers and validators, `single-row-csv-intake.test.js`, runner testcase CSVs | `07-tenant-runners.mp4` |

The seven MP4 files are generated into the sibling `demo-videos/` delivery folder and are intentionally not committed. The recording source is `scripts/demo/record-tenant-issueops-scenarios.js`.
