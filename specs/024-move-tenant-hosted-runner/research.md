# Research: Move Tenant GitHub-Hosted Runner

## Decision 1: Use the hosted-runner update endpoint

- Decision: Move a GitHub-hosted runner by calling `PATCH /orgs/{org}/actions/hosted-runners/{hosted_runner_id}` with `runner_group_id`.
- Rationale: GitHub's hosted-runner REST contract exposes runner group placement as an update field on the hosted runner.
- Source: https://docs.github.com/en/rest/actions/hosted-runners#update-a-github-hosted-runner-for-an-organization
- Alternative: Self-hosted runner-group membership endpoints were rejected because this operation manages GitHub-hosted runners.

## Decision 2: Require the target group to exist

- Decision: Reject a missing target group.
- Rationale: Group creation has its own IssueOps workflow and approval scope. Combining creation with placement would increase blast radius and weaken audit clarity.

## Decision 3: Identify by name with optional id

- Decision: Derive the tenant-prefixed runner name and allow an optional numeric hosted runner id.
- Rationale: The name matches sibling runner workflows and remains readable to operators. The id resolves duplicate-name ambiguity and must match the named runner.
- Alternative: Requiring only the id was rejected because issue submitters normally know the runner name, not its numeric API id.

## Decision 4: Fail closed on tenant boundaries

- Decision: Authorize the requester through the canonical tenant topology admin team and require both runner and target group to remain in that tenant namespace.
- Rationale: Runner placement changes repository access to compute capacity. A cross-tenant move is an authorization boundary violation.

## Decision 5: Treat already-in-group as no-op

- Decision: If `current_runner_group_id` equals the resolved target group id, record no-op and skip PATCH.
- Rationale: This keeps reruns idempotent and avoids unnecessary writes.

## Decision 6: Post the result to the issue

- Decision: Use `actions/github-script` to post the same formatted audit summary stored in the step summary.
- Rationale: Reviewers asked for visible IssueOps results without opening workflow artifacts or logs.
