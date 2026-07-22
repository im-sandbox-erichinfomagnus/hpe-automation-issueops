# Quickstart: Move Tenant GitHub-Hosted Runner

## Prerequisites

- The tenant exists in `tenant-registry/`.
- The requester is an active member of the tenant topology admin team.
- The hosted runner already exists in the target organization.
- The tenant-prefixed target runner group already exists.
- `ISSUEOPS_GITHUB_TOKEN` is PAT-backed and can administer organization hosted runners.
- The designated approver is an active owner of the target organization.

## Workflow

1. Open `Move tenant GitHub-hosted runner`.
2. Enter the organization, tenant, runner name, optional runner id, and target runner group.
3. Leave dry-run set to `true` for the first pass unless execution is intended.
4. Submit the issue and review the validation comment.
5. The designated approver comments exactly `approved`.
6. Review the final issue comment, terminal label, and artifact.

## Expected Outcomes

- `move_hosted_runner`: The runner exists, the target group exists, and placement differs.
- `noop`: The runner is already in the target group.
- `validation_failed`: Runner, group, tenant context, requester authorization, or approver validation failed.
- `failed`: Execution-time revalidation failed or the PATCH failed.

## Common Failures

| Symptom | Cause | Action |
|---|---|---|
| Runner name matched multiple runners | Duplicate exact names and no id | Add the numeric hosted runner id |
| Runner id does not match | The supplied id belongs to another runner | Correct or remove the id |
| Target runner group not found | Group has not been provisioned | Use the runner-group creation IssueOps first |
| Target group prefix rejected | Group belongs to another tenant or is unprefixed | Select the resolved tenant's group |
| Boundary mismatch | Tenant membership or live target state changed after approval | Edit or replay the issue and obtain fresh approval |
| 403 from PATCH | Token lacks hosted-runner administration permission | Correct `ISSUEOPS_GITHUB_TOKEN` |

## Verification

The final issue comment should show:

- resolved runner id
- current runner group id
- resolved target runner group id
- planned move action
- boundary revalidation result
- final move result
