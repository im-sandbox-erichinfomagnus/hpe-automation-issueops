# Scenario 1: Organization Owner Operations

This recording uses four real IssueOps requests. Keep each issue open until its final executed label appears.

## 1A. Create Teams

Open: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=create-org-teams.yml`

- Target organization: `im-sandbox-erichinfomagnus`
- Intended owner: `adamg-infomagnus`
- Intake mode: `csv_attachment`
- Requested team names: leave blank
- Business justification: `Create the owner-operated team structure for Eric's tenant IssueOps demo.`
- Dry-run mode: `false`

Submit the issue. In a new issue comment, attach `csv/scenario-01a-create-teams.csv`. Wait for the request to become approval-ready, then comment exactly `approved`.

Record the issue result, Actions run, and these team pages:

- `https://github.com/orgs/im-sandbox-erichinfomagnus/teams/recording-owner-root`
- `https://github.com/orgs/im-sandbox-erichinfomagnus/teams/recording-owner-developers`
- `https://github.com/orgs/im-sandbox-erichinfomagnus/teams/recording-owner-release`

## 1B. Add Members

Open: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=add-team-members.yml`

- Target organization: `im-sandbox-erichinfomagnus`
- Team slug: `recording-owner-developers`
- Intake mode: `csv_attachment`
- Requested people: leave blank
- Business justification: `Add the demo developers from the submitted spreadsheet.`
- Dry-run mode: `false`

Submit, attach `csv/scenario-01b-add-members.csv` in a requester-authored comment, wait for approval-ready status, and comment `approved`. Record the final members list on the team page.

## 1C. Add Child Teams

Open: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=add-child-teams.yml`

- Target organization: `im-sandbox-erichinfomagnus`
- Parent team: `recording-owner-root`
- Designated hierarchy approver: `adamg-infomagnus`
- Intake mode: `csv_attachment`
- Requested child teams: leave blank
- Business justification: `Attach the developer and release teams below the owner root team.`
- Dry-run mode: `false`

Submit, attach `csv/scenario-01c-add-child-teams.csv`, wait for approval-ready status, and comment `approved`. Record both child teams under the root team.

## 1D. Grant Team Repository Access

Open: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=add-team-repo-access.yml`

- Target organization: `im-sandbox-erichinfomagnus`
- Target team: `recording-owner-developers`
- Designated repository-access approver: `adamg-infomagnus`
- Requested repositories: leave blank
- Intake mode: `csv_attachment`
- Requested permission level: `write`
- Business justification: `Grant the demo developer team write access through IssueOps.`
- Dry-run mode: `false`

Submit, attach `csv/scenario-01d-team-repo-access.csv`, wait for approval-ready status, and comment `approved`. Record the repository under the team's Repositories tab with write access.

## Rejection Clip

Create a second Create organization teams issue using `csv/scenario-01-rejected-approval.csv`, but set Intended owner to `aeruvakalpanaa`. After the CSV is accepted, comment `approved` from `adamg-infomagnus`. Record that the approval is rejected because the commenter is not the designated intended owner. Do not ask the designated owner to approve this rejection issue.
