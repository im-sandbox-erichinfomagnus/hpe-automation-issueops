# Scenario 2: Create Tenant

Open: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=create-tenant-model.yml`

- Target organization: `im-sandbox-erichinfomagnus`
- Tenant name: leave blank
- Tenant CSV: paste the complete contents of `csv/scenario-02-create-tenant.csv`
- Tenant admin GitHub login: leave blank
- Keep the tenant type and governance dropdowns at their defaults. The CSV row overrides them.
- Leave CMDB ID, cost center, business unit, environment, and contacts blank. The CSV row supplies them.
- Designated approver: `adamg-infomagnus`
- Dry-run mode: `false`
- Business justification: `Create the EricDemo tenant topology from one spreadsheet row.`

Submit, wait for approval-ready status, and comment exactly `approved`.

Record these real results:

- `ericdemo-root` exists
- `ericdemo-admin` is a child of `ericdemo-root`
- `ericdemo-repo-admin` is a child of `ericdemo-root`
- `ericdemo-cicd-admin` is a child of `ericdemo-root`
- `adamg-infomagnus` is a maintainer of all four teams
- `tenant-registry/ericdemo.json` exists in the demo repository

Team root: `https://github.com/orgs/im-sandbox-erichinfomagnus/teams/ericdemo-root`

## Rejection Clip

Submit a separate dry-run request using `csv/scenario-02-reject-nonmember-admin.csv`. Use the same organization and designated approver. Record the validation failure stating that `not-an-org-member` is not an active organization member. Do not comment `approved`.
