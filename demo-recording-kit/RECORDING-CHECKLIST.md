# Seven-Video Recording Checklist

Record against `im-sandbox-erichinfomagnus/tenant-issueops-demo` while signed in as `adamg-infomagnus`. Scenario 2 must run before scenarios 3 through 7. For IssueOps requests, wait for the validation comment to say approval-ready before commenting exactly `approved`.

## Video 1: Organization Owner Operations

Detailed guide: `scenario-01-org-owner-ops.md`

1. Create the three `recording-owner-*` teams. Submit the Create organization teams form, attach `csv/scenario-01a-create-teams.csv` in a new issue comment, approve, and show all three live team pages.
2. Add the two members. Submit Add team members, attach `csv/scenario-01b-add-members.csv`, approve, and show the Developers members page.
3. Build the hierarchy. Submit Add child teams, attach `csv/scenario-01c-add-child-teams.csv`, approve, and show both children under the root team.
4. Grant repository access. Submit Add team repository access, attach `csv/scenario-01d-team-repo-access.csv`, approve, and show write access to `tenant-issueops-demo`.
5. Record rejection. Submit a second create-teams request with `csv/scenario-01-rejected-approval.csv`, designate `aeruvakalpanaa`, and show Adam's `approved` comment being rejected.

Say: "This is the organization-owner path. The spreadsheet is attached by the requester, validated before approval, and each change is visible in GitHub. Approval from anyone except the designated owner fails closed."

## Video 2: Create Tenant

Detailed guide: `scenario-02-create-tenant.md`

1. Open Create tenant model and paste `csv/scenario-02-create-tenant.csv` into Tenant CSV.
2. Use Adam as designated approver, select live mode, submit, wait for approval-ready, and approve.
3. Show `ericdemo-root`, `ericdemo-admin`, `ericdemo-repo-admin`, and `ericdemo-cicd-admin` with Adam as maintainer.
4. Show `tenant-registry/ericdemo.json` in the demo repository.
5. Record rejection with `csv/scenario-02-reject-nonmember-admin.csv` in dry-run mode. Stop after validation rejects the nonexistent tenant admin.

Say: "One tenant row creates the canonical four-team topology, assigns the requested tenant admin as maintainer, and writes the tenant registry. A tenant admin who is not an active organization member is rejected before approval."

## Video 3: Native Team Membership

Detailed guide: `scenario-03-native-team-membership.md`

1. Open the `ericdemo-repo-admin` members page and show Adam as maintainer.
2. Use GitHub's Add a member control to add `aeruvakalpanaa`.
3. Refresh and show the active member.
4. Open `ericdemo-cicd-admin` and show Adam can manage that child team too.
5. For the rejection, sign in as `aeruvakalpanaa` and show that a non-maintainer does not receive team membership administration controls.

Say: "Team membership remains native GitHub administration. The tenant bootstrap grants maintainer authority, and GitHub itself blocks non-maintainers."

## Video 4: Create Tenant Repositories

Detailed guide: `scenario-04-create-tenant-repos.md`

1. Open Create tenant repositories, select `bulk_csv`, and paste `csv/scenario-04-create-repositories.csv`.
2. Submit live, wait for approval-ready, and approve.
3. Show all three per-row results and open `ericdemo-api`, `ericdemo-web`, and `ericdemo-infra`.
4. Show `ericdemo-repo-admin` with Admin access and the three owned repositories in `tenant-registry/ericdemo.json`.
5. Record the requester authorization rejection from `aeruvakalpanaa`. If that login is unavailable, use the nonexistent-tenant fallback identified in the detailed guide and say that it is the fallback.

Say: "The RepoAdmin path creates a spreadsheet batch independently, grants the tenant RepoAdmin team Admin access, and records ownership. A requester outside the tenant boundary cannot create repositories."

## Video 5: Repository Rulesets

Detailed guide: `scenario-05-repository-rulesets.md`

1. Paste `csv/scenario-05-create-rulesets.csv` into Create repository ruleset, submit live, approve, and show both rulesets in repository settings.
2. Paste `csv/scenario-05-delete-rulesets.csv` into Delete repository ruleset, submit live, approve, and show both rulesets removed.
3. Replay the delete request and show no-op convergence.
4. Submit a dry-run create request with `csv/scenario-05-mixed-result.csv` and show one valid row plus one rejected nonexistent-repository row.
5. If the second account is available, record the exact unauthorized-row case described in the detailed guide.

Say: "Ruleset authorization and results are evaluated per repository row. One rejected row does not erase the valid row, and repeated deletes converge as no-ops."

## Video 6: Tenant Variables

Detailed guide: `scenario-06-tenant-variables.md`

1. Create variables from `csv/scenario-06-create-variables.csv` and show `ERICDEMO_API_BASE_URL` and `ERICDEMO_DEPLOY_ENV`.
2. Update them from `csv/scenario-06-update-variables.csv` and show the changed values.
3. Submit the dry-run rejection with `csv/scenario-06-reject-cross-tenant.csv` and show the DemoCorp namespace guardrail.
4. Delete the variables from `csv/scenario-06-delete-variables.csv` and show both absent.
5. Replay delete and show no-op convergence.

Say: "Variable names are forced into the tenant namespace. Create, update, and delete are spreadsheet-driven, and an EricDemo request cannot target the existing DemoCorp namespace."

## Video 7: Tenant Runner Lifecycle

Detailed guide: `scenario-07-tenant-runners.md`

1. Create `EricDemo_Builders` from `csv/scenario-07a-create-builders-group.csv`.
2. Create `EricDemo_Release` from `csv/scenario-07b-create-release-group.csv`.
3. Create `EricDemo_linux-build` from `csv/scenario-07c-create-runner.csv` and show it in Builders. The CSV uses live Ubuntu 24.04 image ID `2295` and size `4-core`.
4. Submit the dry-run cross-tenant move from `csv/scenario-07-reject-cross-tenant-move.csv` and show rejection.
5. Move the runner to Release with `csv/scenario-07d-move-runner.csv` and show the new group.
6. Delete it with `csv/scenario-07e-delete-runner.csv`, show it absent, and replay delete for the no-op.

Say: "Runner groups and the hosted runner keep the tenant prefix through create, move, and delete. A move to another tenant namespace is rejected before mutation."

Do not say the hosted-runner lifecycle succeeded unless the runner appears on the organization runners page. If GitHub reports that larger hosted runners are unavailable for the organization plan, record that exact entitlement response and keep the group lifecycle as the completed result.

## CSV Submission Map

| Video | CSV | How to submit |
|---|---|---|
| 1 | `scenario-01a-create-teams.csv` | Attach in requester issue comment |
| 1 | `scenario-01b-add-members.csv` | Attach in requester issue comment |
| 1 | `scenario-01c-add-child-teams.csv` | Attach in requester issue comment |
| 1 | `scenario-01d-team-repo-access.csv` | Attach in requester issue comment |
| 1 | `scenario-01-rejected-approval.csv` | Attach in requester issue comment |
| 2 | `scenario-02-create-tenant.csv` | Paste into Tenant CSV |
| 2 | `scenario-02-reject-nonmember-admin.csv` | Paste into Tenant CSV |
| 4 | `scenario-04-create-repositories.csv` | Paste into Repositories CSV |
| 5 | `scenario-05-create-rulesets.csv` | Paste into Rulesets CSV |
| 5 | `scenario-05-delete-rulesets.csv` | Paste into Rulesets CSV |
| 5 | `scenario-05-mixed-result.csv` | Paste into Rulesets CSV |
| 6 | `scenario-06-create-variables.csv` | Paste into Variables CSV, no header |
| 6 | `scenario-06-update-variables.csv` | Paste into Variables CSV, no header |
| 6 | `scenario-06-delete-variables.csv` | Paste into Variables CSV, no header |
| 6 | `scenario-06-reject-cross-tenant.csv` | Paste into Variables CSV, no header |
| 7 | `scenario-07a-create-builders-group.csv` | Paste into Runner groups CSV |
| 7 | `scenario-07b-create-release-group.csv` | Paste into Runner groups CSV |
| 7 | `scenario-07c-create-runner.csv` | Paste into Hosted runner CSV |
| 7 | `scenario-07d-move-runner.csv` | Paste into Runner moves CSV |
| 7 | `scenario-07e-delete-runner.csv` | Paste into Hosted runner CSV |
| 7 | `scenario-07-reject-cross-tenant-move.csv` | Paste into Runner moves CSV |
