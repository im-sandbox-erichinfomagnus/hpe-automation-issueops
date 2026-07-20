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

## Required Mixed-Authorization Clip

This clip needs the `aeruvakalpanaa` login.

1. As Adam, grant `aeruvakalpanaa` direct Admin access to `ericdemo-api` only. Do not add that account to `ericdemo-repo-admin` and do not grant access to `ericdemo-web`.
2. Sign in as `aeruvakalpanaa` and submit a dry-run create request using `csv/scenario-05-mixed-authorization.csv`. Use Adam as the designated approver.
3. After the request becomes approval-ready, have Adam comment `approved`.
4. Record that the `ericdemo-api` row is authorized while the `ericdemo-web` row is rejected as unauthorized. The valid dry-run row remains independently evaluated.
5. After recording, remove the temporary direct Admin access from `ericdemo-api`.

## Missing-Repository Fallback

Submit a dry-run create request using `csv/scenario-05-mixed-result.csv`. Record that the valid `ericdemo-api` row remains independently evaluated while the nonexistent repository row is rejected.

Use this only when the second account is unavailable. Say clearly that it demonstrates per-row resource validation, not the required actor-authorization rejection.
