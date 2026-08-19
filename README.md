# HPE Tenant IssueOps

This repository provides GitHub IssueOps workflows for managing HPE tenant
resources. Operators submit requests through GitHub issue forms, and GitHub
Actions validates authorization, plans the requested changes, waits for
approval, applies the changes, and records the result.

GitHub organization state is the live system of record. The
[tenant registry](tenant-registry/) records the canonical tenant boundary,
team topology, and ownership used to authorize tenant-scoped operations.

## Run an Operation

1. Open the [new request menu](../../issues/new/choose).
2. Choose the form for the operation you need.
3. Complete the request and provide the spreadsheet data required by the form.
   Start with a file from [sample-input-csvs](sample-input-csvs/).
4. Submit the issue and wait for the validation result.
5. Keep dry-run enabled for the first pass. A dry-run validates and plans the
   request without changing GitHub organization state.
6. After validation succeeds, the designated active approver comments exactly
   `approved` on the issue.
7. Review the per-row result, Actions step summary, and JSON audit artifact.
   Submit a live request only after the dry-run output is correct.

When a form supports `csv_attachment`, submit the issue with its manual input
field empty. The requester must then add an issue comment containing exactly one
`.csv` attachment. The request remains in a waiting state until the attachment
is accepted.

## Supported Operations

| Area                | Issue form                                                                           | What it manages                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Organization teams  | [Create organization teams](.github/ISSUE_TEMPLATE/create-org-teams.yml)              | Creates one or more empty teams                                                 |
| Organization teams  | [Add team members](.github/ISSUE_TEMPLATE/add-team-members.yml)                       | Adds users to an existing team                                                  |
| Organization teams  | [Add child teams](.github/ISSUE_TEMPLATE/add-child-teams.yml)                         | Attaches existing child teams to an existing parent                             |
| Repository access   | [Add team repository access](.github/ISSUE_TEMPLATE/add-team-repo-access.yml)         | Grants a team access to one or more repositories                                |
| Repository access   | [Remove team repository access](.github/ISSUE_TEMPLATE/remove-team-repo-access.yml)   | Removes a team's access from one or more repositories                           |
| Tenant bootstrap    | [Create tenant model](.github/ISSUE_TEMPLATE/create-tenant-model.yml)                 | Creates the canonical tenant teams, hierarchy, maintainers, and registry record |
| Tenant repositories | [Create tenant repositories](.github/ISSUE_TEMPLATE/create-tenant-repos.yml)          | Creates repositories inside an authorized tenant boundary                       |
| Repository rulesets | [Create repository ruleset](.github/ISSUE_TEMPLATE/create-repository-ruleset.yml)     | Creates repository-level rulesets in spreadsheet batches                        |
| Repository rulesets | [Delete repository ruleset](.github/ISSUE_TEMPLATE/delete-repository-ruleset.yml)     | Deletes named repository-level rulesets                                         |
| Actions variables   | [Manage tenant variables](.github/ISSUE_TEMPLATE/manage-tenant-variables.yml)         | Creates, updates, or deletes tenant-prefixed organization variables             |
| Actions runners     | [Create tenant runner group](.github/ISSUE_TEMPLATE/create-tenant-runner-groups.yml)  | Creates an isolated tenant runner group                                         |
| Actions runners     | [Create tenant hosted runner](.github/ISSUE_TEMPLATE/create-tenant-hosted-runner.yml) | Creates a tenant-scoped GitHub-hosted runner                                    |
| Actions runners     | [Move tenant hosted runner](.github/ISSUE_TEMPLATE/move-tenant-hosted-runner.yml)     | Moves a hosted runner into an existing tenant runner group                      |
| Actions runners     | [Delete tenant hosted runner](.github/ISSUE_TEMPLATE/delete-tenant-hosted-runner.yml) | Deletes a tenant-scoped hosted runner                                           |

The [Tenant IssueOps runbook](docs/tenant-issueops-runbook.md) lists the
spreadsheet schema and authorization path for each operation. The
[requirements matrix](docs/tenant-issueops-requirements-matrix.md) maps the
seven acceptance scenarios to their implementation, tests, sample files, and
recording guides.

## Request and Approval Rules

- Spreadsheet input is the primary path for tenant operations. Create-tenant
  and runner lifecycle forms accept one data row. Batch operations accept the
  shape documented in the form and sample file.
- Privileged requests fail closed when the requester, approver, target
  organization, tenant, team, or repository cannot be verified.
- Authorization is checked during validation and checked again immediately
  before mutation.
- Tenant-scoped operations resolve their authorization boundary from
  [tenant-registry](tenant-registry/).
- Repository ruleset batches authorize each row independently. A rejected row
  does not prevent authorized rows from being evaluated.
- Re-running a completed request converges on current GitHub state. Operations
  that are already satisfied are reported as no-ops instead of being applied
  again.

## Results and Audit Evidence

Each request produces evidence in three places:

1. Issue comments show validation, approval, and per-row execution results.
2. The GitHub Actions step summary shows the planned and completed work.
3. A machine-readable JSON artifact records request details, authorization,
   reconciliation, retry, and execution outcomes.

Retry behavior is bounded and uses GitHub rate-limit response data. Partial
failures remain visible in the issue result and audit artifact so operators can
correct only the failed rows.

## Repository Configuration

The repository requires GitHub Issues, issue forms, and GitHub Actions. Configure
an Actions secret named `ISSUEOPS_GITHUB_TOKEN` with the target-organization
permissions required by the supported operations. Do not place tokens in an
issue form, CSV file, repository variable, or committed file.

The optional `TEAM_HIERARCHY_POLICY_JSON` organization or repository variable
can provide team hierarchy policy used by the child-team workflow.

## Repository Layout

```text
.github/
  ISSUE_TEMPLATE/   Issue forms used by operators
  workflows/        Workflow entrypoints and repository checks

sample-input-csvs/  Operator-ready spreadsheet examples
tenant-registry/    Canonical tenant topology and ownership records

src/
  actions/          Operation-specific policy helpers
  scripts/          Validation, approval, execution, and audit entrypoints
  workflow-support/ Shared parsing, authorization, API, and reconciliation code

specs/              Feature specifications, contracts, and quickstarts
tests/
  contract/         Parser, validation, policy, and audit tests
  fixtures/         Issue, CSV, registry, and GitHub API fixtures
  integration/      End-to-end workflow behavior tests with mocked APIs
```

## Local Validation

The implementation and test suite use Node's built-in test runner. From the
repository root, run:

```shell
node --test tests/contract/*.test.js tests/integration/*.test.js
```

Pull requests that change issue forms or workflows also run
[actionlint](.github/workflows/lint-workflows.yml).

## Contributing

Create a branch from the latest `origin/main`, make the change, push the branch
to this repository, and open a pull request. Do not push directly to `main`.

For a new operation:

1. Add the issue form and thin workflow entrypoint under [.github](.github/).
2. Put shared parsing, validation, authorization, reconciliation, and audit
   behavior under [src](src/).
3. Add or update the feature documents under [specs](specs/).
4. Add contract fixtures and integration coverage under [tests](tests/).
5. Add a sample spreadsheet and update this README and the
   [runbook](docs/tenant-issueops-runbook.md).
