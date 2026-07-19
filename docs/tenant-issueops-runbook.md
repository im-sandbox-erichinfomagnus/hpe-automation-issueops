# Tenant IssueOps Runbook

Use the issue form for the operation, paste the spreadsheet data, keep dry-run enabled for the first pass, and have the designated active organization owner comment exactly `approved`. Review the per-row issue result and JSON audit artifact before running live.

## Spreadsheet Schemas

| Operation | Issue form | Spreadsheet columns |
|---|---|---|
| Create org teams | `create-org-teams.yml` | See `sample-input-csvs/create-org-teams-request.csv` |
| Add team members | `add-team-members.yml` | See `sample-input-csvs/add-team-members-request.csv` |
| Add child teams | `add-child-teams.yml` | See `sample-input-csvs/child-team-request.csv` |
| Add team repository access | `add-team-repo-access.yml` | See `sample-input-csvs/team-repo-access-request.csv` |
| Create tenant | `create-tenant-model.yml` | `tenant_name,tenant_admin_login,tenant_type,cmdb_id,cost_center,business_unit,environment,primary_contact,secondary_contact,code_scanning_enabled,secret_scanning_enabled,dependabot_enabled` |
| Create tenant repositories | `create-tenant-repos.yml` | See `sample-input-csvs/create-tenant-repos-request.csv` |
| Create rulesets | `create-repository-ruleset.yml` | See `sample-input-csvs/repository-ruleset-request.csv` |
| Delete rulesets | `delete-repository-ruleset.yml` | See `sample-input-csvs/delete-ruleset-request.csv` |
| Manage variables | `manage-tenant-variables.yml` | `name,value` |
| Create hosted runner | `create-tenant-hosted-runner.yml` | `runner_name,runner_image_id,runner_image_source,runner_size,runner_group_name,maximum_runners` |
| Delete hosted runner | `delete-tenant-hosted-runner.yml` | `runner_name` |
| Create runner group | `create-tenant-runner-groups.yml` | `runner_group_name,runner_group_visibility,allows_public_repositories` |
| Move hosted runner | `move-tenant-hosted-runner.yml` | `runner_name,hosted_runner_id,target_runner_group_name` |

Create tenant and each runner lifecycle form accept exactly one data row. The other spreadsheet forms accept their documented batch shape. A header is optional unless the sample or form says otherwise.

## Authorization Checks

- Create tenant requires the requester and designated approver to be active organization owners. The CSV tenant admin must be an active organization member.
- Tenant repositories require the requester to satisfy the tenant RepoAdmin or tenant-admin authorization path.
- Rulesets authorize every row by direct repository admin permission or the matching tenant RepoAdmin or tenant-admin path.
- Variables require tenant-admin authorization.
- Runner operations require the tenant CICDAdmin or tenant-admin authorization path.
- Every privileged execution revalidates authorization after approval and before mutation.

An unauthorized request or row is rejected and recorded. Dry-run never mutates GitHub state.
