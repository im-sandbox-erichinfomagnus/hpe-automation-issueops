# Scenario 5: Repository Rulesets

Run this only after scenario 4 has created the repositories.

## Create

Open: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=create-repository-ruleset.yml`

- Target organization: `im-sandbox-erichinfomagnus`
- Tenant name: `EricDemo`
- Rulesets CSV: paste `csv/scenario-05-create-rulesets.csv`
- Leave the single-item repository and ruleset fields blank
- Keep the single-item rule dropdowns at their defaults. CSV rows override them.
- Designated approver: `adamg-infomagnus`
- Dry-run mode: `false`
- Business justification: `Apply repository rulesets from a spreadsheet batch.`

Submit, wait for approval-ready status, and comment `approved`. Record each applied row and the ruleset under each repository's Settings, Rules, Rulesets page.

## Delete

Open the Delete repository ruleset form and paste `csv/scenario-05-delete-rulesets.csv`. Use the same organization, tenant, approver, and live mode. Approve it and record that each ruleset is removed. A replay should show no-op because the rulesets are already absent.

Delete form: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=delete-repository-ruleset.yml`

## Mixed Result Clip

Submit a dry-run create request using `csv/scenario-05-mixed-result.csv`. Record that the valid `ericdemo-api` row remains independently evaluated while the nonexistent repository row is rejected.

The exact unauthorized-row demonstration requires the issue to be authored by `aeruvakalpanaa`. Replace the nonexistent repository row with `ericdemo-web` when using that account. The actor must not have direct repository admin and must not be in `ericdemo-repo-admin`.
