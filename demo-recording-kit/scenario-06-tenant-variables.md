# Scenario 6: Tenant Variables

Use the Manage tenant variables form for all three operations:

`https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=manage-tenant-variables.yml`

For every request use:

- Target organization: `im-sandbox-erichinfomagnus`
- Tenant name: `EricDemo`
- Leave the single variable name and value blank
- Designated approver: `adamg-infomagnus`
- Dry-run mode: `false`

The variables field accepts `name,value` rows with an optional header. Paste each prepared file exactly as provided.

## Create

- Variable operation: `create`
- Variables CSV: paste `csv/scenario-06-create-variables.csv`
- Business justification: `Create EricDemo Actions variables from spreadsheet rows.`

Approve and record `ERICDEMO_API_BASE_URL` and `ERICDEMO_DEPLOY_ENV` on the organization Actions variables page.

## Update

- Variable operation: `update`
- Variables CSV: paste `csv/scenario-06-update-variables.csv`
- Business justification: `Update EricDemo Actions variables from spreadsheet rows.`

Approve and record the changed values.

## Delete

- Variable operation: `delete`
- Variables CSV: paste `csv/scenario-06-delete-variables.csv`
- Business justification: `Delete EricDemo Actions variables from spreadsheet rows.`

Approve and record that both variables are absent. Replay the delete request to show no-op convergence.

Organization variables: `https://github.com/organizations/im-sandbox-erichinfomagnus/settings/variables/actions`

## Required Actor-Rejection Clip

Sign in as `aeruvakalpanaa` and submit a dry-run create request using `csv/scenario-06-create-variables.csv`. Use Adam as designated approver. Record that the requester is rejected because the account is not in the EricDemo CI/CD admin team and is not a maintainer of the EricDemo top team. Do not approve the failed request.

## Cross-Tenant Namespace Clip

Submit a dry-run create request using `csv/scenario-06-reject-cross-tenant.csv`. `DEMOCORP_` is the namespace of the existing DemoCorp tenant. Record that the EricDemo request is rejected for targeting DemoCorp's namespace and that no organization variable is changed.
