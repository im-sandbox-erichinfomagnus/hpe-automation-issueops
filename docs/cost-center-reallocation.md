# Cost center reallocation

This feature lets an operator create enterprise cost centers and add or remove user assignments from a spreadsheet, through the same IssueOps pattern the team-management workflows use. A request comes in as a GitHub issue, a workflow validates it and posts the plan back as a comment, a named approver comments approved, and on approval the plan is applied against the GitHub enterprise billing cost center API. Until an enterprise billing token is configured it runs in dry-run and shows the plan without applying it.

## How a request flows

1. Someone opens an issue from the Cost center reallocation form. The form collects the enterprise slug, the GitHub login of the approver, and the assignment list as CSV (typed into the form or attached as a .csv file).
2. The workflow validates the request, computes the plan (which cost centers need creating, which users to add, which to remove), and posts a summary comment on the issue.
3. The named approver comments approved on the issue. The approval gate checks that the comment came from that exact person.
4. On approval, and only when dry-run is off, the execution step applies the plan through the cost center API. The result is posted back as an updated comment.

The same audit summary is posted at each stage so the issue thread is a full record of what was requested, who approved, and what was applied.

## The spreadsheet

The assignment list is CSV with a three column header:

```
cost_center,login,action
Platform Engineering,alice,add
Platform Engineering,bob,add
AI Model Routing,dave,add
Platform Engineering,bob,remove
```

cost_center is the cost center name. login is the GitHub username. action is add or remove. Each row is one change. Moving a person from one cost center to another is a remove row plus an add row. A cost center named in the sheet that does not exist yet is created before users are added to it.

## Providing the CSV

There are two ways to supply the sheet, and the file path takes precedence when both are present.

File attachment. Drag a .csv file into an issue comment (or into the issue body). The workflow finds the attachment link, downloads the file with the workflow token, and uses its contents. On a private repository the download needs a token that can read the attachment, so either the repository has Advanced Security style access configured or a user PAT is set as the workflow token.

Typed fallback. Paste the CSV text directly into the Cost center assignments field on the form. This always works and needs no file handling. It is the path used when no attachment is present.

## Approval

The form names a single approver. Execution only happens after that person comments approved on the issue. A comment from anyone else does not authorize the run, and removing the approval comment after the fact blocks execution again. This mirrors the approval model the team-creation workflow uses.

## Dry-run and live execution

Dry-run is a field on the form and defaults to on. In dry-run the workflow does everything except call the cost center API: it validates, computes the plan, and posts it. To run for real, two things are needed and then dry-run is set to false:

- An enterprise billing token. The cost center API is enterprise scoped and the caller must hold an enterprise billing or owner role. A classic PAT with manage_billing:enterprise is the conventional choice. It is set as the workflow token secret.
- The enterprise slug, entered on the form.

No code change is needed to go live. When the token and slug are in place and dry-run is off, the same flow applies the plan.

## The cost center API

The wrapper in src/workflow-support/github-cost-center-api.js covers the enterprise billing cost center endpoints under /enterprises/{enterprise}/settings/billing/cost-centers:

- list cost centers
- get a single cost center with its members
- create a cost center
- add resources (users, organizations, repositories) with POST to the /resource endpoint
- remove resources with DELETE to the same /resource endpoint

Add and remove share one endpoint, distinguished by the HTTP verb. The resource body keys are users, organizations, and repositories. v1 of this feature uses the users key.

## Files

Wired into the workflow:

- .github/ISSUE_TEMPLATE/cost-center-reallocation.yml, the request form
- .github/workflows/cost-center-reallocation.yml, the orchestration on issue and comment events
- src/scripts/run-cost-center-validation.js, validates and computes the plan
- src/scripts/run-cost-center-approval.js, evaluates the approval comment
- src/scripts/run-cost-center-execution.js, applies the plan when approved and not dry-run

Supporting modules in src/workflow-support:

- parse-cost-center-request.js, turns the parsed form fields into a request object
- normalize-cost-center-assignments.js, the CSV parser
- resolve-cost-center-csv-attachment.js and download-csv-attachment.js, find and fetch an attached .csv
- validate-cost-center-request.js, request validation
- reconcile-cost-center.js, turns the requested assignments into a create or add or remove plan against current state
- github-cost-center-api.js, the API wrapper
- cost-center-artifact.js, the audit artifact shape
- build-cost-center-outcome.js and format-cost-center-summary.js, the execution outcome and the posted summary
- src/actions/cost-center-policy/index.js, the guard that decides whether a mutation is allowed

## Tests

Run the cost center tests with the built in node runner:

```
node --test tests/contract/cost-center-*.test.js tests/integration/cost-center-*.test.js
```

The suite covers the CSV parser, the API wrapper request shapes, the reconcile and plan logic, the approval gate states, the summary footer for every state, and the attachment resolver including the precedence of an attached file over typed text.
