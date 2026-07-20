# Eric Hill Tenant IssueOps Recording Kit

Record these seven scenarios in order against `im-sandbox-erichinfomagnus/tenant-issueops-demo`. Scenario 2 creates the `EricDemo` tenant used by scenarios 3 through 7. Do not submit the recording requests before recording unless you intentionally want the video to show idempotent no-op behavior.

Use `adamg-infomagnus` as the requester, tenant admin, and designated organization-owner approver for the successful paths. Comment exactly `approved` only after the validation result says the request is approval-ready.

Use `RECORDING-CHECKLIST.md` as the single page to read while recording. The seven detailed guides below contain every form value, URL, and fallback.

1. `scenario-01-org-owner-ops.md`
2. `scenario-02-create-tenant.md`
3. `scenario-03-native-team-membership.md`
4. `scenario-04-create-tenant-repos.md`
5. `scenario-05-repository-rulesets.md`
6. `scenario-06-tenant-variables.md`
7. `scenario-07-tenant-runners.md`

For every IssueOps recording, keep these browser tabs available:

- The submitted issue
- The workflow run linked from the issue
- The target team, repository, variable, ruleset, or runner settings page

The rejection paths that require a second actor are marked clearly. Use `aeruvakalpanaa`, an active organization member who is not in the `EricDemo` tenant-admin teams, if that account is available during recording.
