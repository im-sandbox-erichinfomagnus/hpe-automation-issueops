# issueops-speckit

## Spec-kit Developer Onboarding

This repository is initialized for Spec-kit with the GitHub Copilot integration.
The checked-in project state lives under [`.specify/`](.specify/). Some Copilot
integration files, especially [`.github/agents/`](.github/agents/), are generated
locally and must not be committed in this repository because GitHub push rules
reject them.

### One-Time Local Setup

1. Install the official Spec Kit CLI.

	PowerShell example:

	```powershell
	uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.8.11
	```

2. Verify the installation.

	```powershell
	specify version
	```

3. From the repository root, install the Copilot integration files locally.

	```powershell
	specify integration install copilot --script ps
	```

4. Open the repository in VS Code with GitHub Copilot enabled.

After installation, the local Spec-kit slash commands should be available,
including:

- /speckit.constitution
- /speckit.specify
- /speckit.plan
- /speckit.tasks
- /speckit.implement

### Refresh After a Spec Kit Upgrade

If Spec Kit is already installed and you only need to refresh the repo-managed
Copilot files, run:

```powershell
specify integration upgrade copilot --script ps
```

### Repository Rules For Spec-kit Files

- Commit the shared project state under [`.specify/`](.specify/).
- Commit shared repo guidance such as [`.github/copilot-instructions.md`](.github/copilot-instructions.md).
- Do not commit generated files under [`.github/agents/`](.github/agents/).
- If generated agent files appear in your working tree, leave them uncommitted.

### Troubleshooting

If the slash commands do not appear:

1. Confirm GitHub Copilot is enabled in VS Code.
2. Run:

	```powershell
	specify integration list
	```

3. Confirm that `copilot` is installed for this project.
4. Re-run:

	```powershell
	specify integration upgrade copilot --script ps
	```

This repository already enables the main Spec-kit prompt files in
[`.vscode/settings.json`](.vscode/settings.json), so teammates normally only need
the local integration install step after cloning.

## Using This Repository

This repository hosts GitHub IssueOps administration workflows. Operators use
issue forms and GitHub Actions to request, validate, approve, and execute
administrative operations against GitHub organizations without treating this
repository as the source of truth.

### What You Need

- GitHub Issues with issue forms enabled in this repository.
- A repository or organization Actions secret named `ISSUEOPS_GITHUB_TOKEN`
	with the permissions required by the supported operation.
- An organization owner available to approve privileged operations when the
	workflow requires approval.

### How To Use It

1. Open a supported issue form under [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/).
2. Submit the request with the required target and justification details.
3. Let the workflow validate the request and publish an audit artifact plus a
	 GitHub Actions step summary.
4. If the request requires approval, have an organization owner comment exactly
	 `approved` on the issue.
5. Review the final workflow summary and uploaded artifact for validation,
	 approval, reconciliation, and execution results.

### Where To Look During A Run

- Workflow entrypoints: [`.github/workflows/`](.github/workflows/)
- Issue forms: [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/)
- Shared implementation code: [`src/`](src/)
- Feature specs and contracts: [`specs/`](specs/)

## Supported Administration Operations

This list should be updated as new IssueOps workflows are added.

- `add-team-members`: Request, validate, approve, and reconcile adding one or
	more GitHub users to a team in a GitHub organization.
- `create-org-teams`: Request, validate, approve, and reconcile creating one or
	more empty GitHub teams in a target organization for a shared intended owner.
- `add-child-teams`: Request, validate, approve, and reconcile attaching one or
	more existing child teams under an existing parent team in a target
	organization.
- `add-team-repo-access`: Request, validate, approve, and reconcile granting
	one existing GitHub team access to one or more existing repositories in a
	target organization.

Detailed design and operator guidance for the current operation live in:

- [`specs/001-add-team-members/quickstart.md`](specs/001-add-team-members/quickstart.md)
- [`specs/001-add-team-members/contracts/add-team-members-workflow.yaml`](specs/001-add-team-members/contracts/add-team-members-workflow.yaml)
- [`specs/003-create-org-teams/quickstart.md`](specs/003-create-org-teams/quickstart.md)
- [`specs/003-create-org-teams/contracts/create-org-teams-workflow.yaml`](specs/003-create-org-teams/contracts/create-org-teams-workflow.yaml)
- [`specs/004-add-child-teams/quickstart.md`](specs/004-add-child-teams/quickstart.md)
- [`specs/004-add-child-teams/contracts/add-child-teams-workflow.yaml`](specs/004-add-child-teams/contracts/add-child-teams-workflow.yaml)
- [`specs/005-add-team-repo-access/quickstart.md`](specs/005-add-team-repo-access/quickstart.md)
- [`specs/005-add-team-repo-access/contracts/add-team-repo-access-workflow.yaml`](specs/005-add-team-repo-access/contracts/add-team-repo-access-workflow.yaml)

## Repository Standards

This repository follows a reconciliation-first IssueOps model:

- GitHub is the system of record; workflows read current state before mutation.
- Workflow YAML under [`.github/workflows/`](.github/workflows/) stays thin and
	delegates business logic to code under [`src/`](src/).
- Requests are parsed from GitHub issue forms with `issue-ops/parser`.
- Validation, approval, reconciliation, retry handling, and audit generation
	are implemented as shared logic rather than ad hoc workflow steps.
- Re-runs should converge safely by treating already-satisfied state as no-op.

## Security Model

These workflows are designed for privileged administration and fail closed when
their preconditions are not met.

- Approval gate: privileged mutation requires explicit approval from an
	organization owner when the workflow defines an approval step.
- Least privilege: workflows use a PAT-backed Actions secret and should request
	only the GitHub permissions required by the operation.
- Dry-run support: validation and approval can complete without mutation.
- Reconciliation before mutation: workflows add or change only the missing or
	required state instead of blindly rewriting targets.
- Auditability: every run is expected to emit a GitHub Actions summary and a
	machine-readable JSON artifact.
- Rate-limit awareness: retry behavior is bounded and based on GitHub response
	headers rather than unbounded polling.
- Partial-failure handling: workflows surface rollback status and follow-up
	guidance when full success is not possible.

## Repository Layout

```text
.github/
	ISSUE_TEMPLATE/   # Issue forms used to request IssueOps operations
	workflows/        # Thin GitHub Actions entrypoints

src/
	actions/          # Shared policy and action helpers
	scripts/          # Workflow runners and summary emitters
	workflow-support/ # Parsing, validation, reconciliation, retry, and audit code

specs/
	001-add-team-members/  # Team membership workflow spec and contract
	003-create-org-teams/  # Empty team creation workflow spec and contract
	004-add-child-teams/   # Team hierarchy workflow spec and contract
	005-add-team-repo-access/ # Team repository-access workflow spec and contract

tests/
	contract/         # Contract and parsing regression tests
	fixtures/         # Test fixtures and mocked API payloads
	integration/      # Workflow behavior and execution-path tests
```

## Current Feature Status

The `add-team-members` workflow is implemented and validated for:

- request intake through GitHub issue forms
- validation of team existence and requested users
- org-owner approval by exact `approved` issue comment
- execution that adds only missing users
- no-op handling for already-satisfied memberships
- bounded retry for retryable rate-limit responses
- auditable summaries and JSON artifact output

The `create-org-teams` workflow is implemented and validated for:

- request intake for creating empty teams only
- validation of organization visibility, intended-owner membership, and
	duplicate or conflicting team names
- intended-owner approval by exact `approved` issue comment
- execution that creates only missing teams
- no-op handling for already-existing teams on rerun
- bounded retry for retryable rate-limit responses
- auditable summaries and JSON artifact output

The `add-child-teams` workflow is implemented and validated for:

- request intake for one existing parent team and one or more existing child
	teams
- validation of parent-team existence, child-team existence, designated
	approver authorization, duplicate child-team input, re-parenting rejection,
	and cycle rejection
- designated-approver approval by exact `approved` issue comment
- execution that attaches only missing child-team links under the requested
	parent team
- no-op handling for already-satisfied hierarchy links on rerun
- bounded retry for retryable rate-limit responses
- auditable summaries and JSON artifact output

The `add-team-repo-access` workflow is implemented and validated for:

- request intake for one existing team, one shared permission level, and one or
	more existing target repositories
- validation of organization visibility, team existence, designated approver
	authorization, duplicate or conflicting repository input, archived-repository
	rejection, and weaker-existing-permission rejection
- designated-approver approval by exact `approved` issue comment
- execution that grants only missing eligible repository access
- no-op handling for exact or stronger already-satisfied repository access on
	rerun
- bounded retry for retryable rate-limit responses
- auditable summaries and JSON artifact output

## Contributing New Operations

When adding a new administration workflow, keep the repository conventions the
same:

1. Add the issue form and workflow shim under [`.github/`](.github/).
2. Put reusable implementation logic under [`src/`](src/).
3. Generate and maintain the feature documents under [`specs/`](specs/).
4. Add contract and integration coverage under [`tests/`](tests/).
5. Update the supported operations list in this README.
