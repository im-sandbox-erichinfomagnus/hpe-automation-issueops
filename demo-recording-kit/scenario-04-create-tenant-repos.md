# Scenario 4: Create Tenant Repositories

Run this only after scenario 2 has created the `EricDemo` tenant.

Open: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=create-tenant-repos.yml`

- Target organization: `im-sandbox-erichinfomagnus`
- Tenant name: `EricDemo`
- Intake mode: `bulk_csv`
- Repositories CSV: paste the complete contents of `csv/scenario-04-create-repositories.csv`
- Leave all single-item repository fields blank
- Designated approver: `adamg-infomagnus`
- Dry-run mode: `false`
- Business justification: `Create the EricDemo repositories from one spreadsheet batch.`

Submit, wait for approval-ready status, and comment exactly `approved`.

Record the per-row execution result, then open each repository:

- `https://github.com/im-sandbox-erichinfomagnus/ericdemo-api`
- `https://github.com/im-sandbox-erichinfomagnus/ericdemo-web`
- `https://github.com/im-sandbox-erichinfomagnus/ericdemo-infra`

On one repository, open Settings, Collaborators and teams and show `ericdemo-repo-admin` with Admin access. Also show the three owned repositories in `tenant-registry/ericdemo.json`.

## Rejection Clip

For the exact actor rejection, submit the same request from `aeruvakalpanaa`, who is not a maintainer of `ericdemo-root` and is not a member of `ericdemo-repo-admin`. Keep dry-run enabled and record the tenant authorization failure. Do not approve it.

If the second account is unavailable, use tenant name `TenantThatDoesNotExist` with dry-run enabled and record that the workflow fails closed because no authorized tenant context resolves. Say clearly that this is the fail-closed fallback, not the actor-authorization demonstration.
