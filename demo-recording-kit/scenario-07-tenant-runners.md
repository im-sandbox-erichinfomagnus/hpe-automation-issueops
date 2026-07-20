# Scenario 7: Tenant Runner Lifecycle

Run this after scenario 2. Use `im-sandbox-erichinfomagnus`, tenant `EricDemo`, designated approver `adamg-infomagnus`, live mode, and a short business justification on every form.

## 7A. Create Builders Runner Group

Open the Create tenant runner group form and paste `csv/scenario-07a-create-builders-group.csv` into Runner groups CSV. Leave the single-item runner group fields blank. Submit and comment `approved` after validation.

Form: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=create-tenant-runner-groups.yml`

## 7B. Create Release Runner Group

Repeat the same form with `csv/scenario-07b-create-release-group.csv`.

## 7C. Create Hosted Runner

Open the Create tenant GitHub-hosted runner form and paste `csv/scenario-07c-create-runner.csv` into Hosted runner CSV. Leave the individual runner fields blank. Submit and approve.

The CSV uses GitHub-owned image ID `2295`, which is Ubuntu 24.04 in the live sandbox catalog, and machine size `4-core`.

Form: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=create-tenant-hosted-runner.yml`

Record `EricDemo_linux-build` in the `EricDemo_Builders` group on the organization runners page.

## 7D. Move Hosted Runner

Open the Move tenant GitHub-hosted runner form and paste `csv/scenario-07d-move-runner.csv`. Leave the individual runner fields blank. Submit and approve. Record the runner in `EricDemo_Release`.

Form: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=move-tenant-hosted-runner.yml`

## 7E. Delete Hosted Runner

Open the Delete tenant GitHub-hosted runner form and paste `csv/scenario-07e-delete-runner.csv`. Leave the individual runner field blank. Submit and approve. Record that the runner is absent. Replay the issue to show no-op convergence.

Form: `https://github.com/im-sandbox-erichinfomagnus/tenant-issueops-demo/issues/new?template=delete-tenant-hosted-runner.yml`

Organization runners: `https://github.com/organizations/im-sandbox-erichinfomagnus/settings/actions/runners`

## Required Actor-Rejection Clip

Sign in as `aeruvakalpanaa` and submit a dry-run Create tenant runner group request using `csv/scenario-07a-create-builders-group.csv`. Use Adam as designated approver. Record that the requester is rejected because the account is outside the EricDemo CI/CD admin and tenant-admin authorization paths. Do not approve the failed request.

## Cross-Tenant Move Clip

Before deleting the runner, submit a dry-run move request using `csv/scenario-07-reject-cross-tenant-move.csv`. Record that the cross-tenant runner group target is rejected and the runner remains in its current EricDemo group.

GitHub-hosted larger runners must be enabled for the organization. If GitHub reports that hosted-runner creation is unavailable for the plan, record the group creation and the exact platform entitlement message. Do not claim the runner lifecycle succeeded until the runner appears on the organization runners page.
