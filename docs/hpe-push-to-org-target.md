# Distributing IssueOps to Your Orgs (`hpe-push-to-org-target`)

This workflow publishes the tenant IssueOps runtime (forms, workflows, validators, scripts, docs)
from this landing repository into one of your organization repositories, and opens a pull request
for your team to review before anything merges. Use it to roll the IssueOps out to each of your
internal orgs from a single, repeatable process.

It never pushes to your target branch directly. Every run creates a new delivery branch and opens
a PR against the base branch you choose, so your normal review and scanning gates always apply.

## What it does

On each run the workflow:

1. Checks out the code from this repo at the ref you specify (a tag, branch, or SHA).
2. Validates that the destination token can reach your target repo.
3. Clones your target repo's base branch and syncs the curated IssueOps payload onto a fresh
   delivery branch named `<delivery_branch_prefix>-<run_id>-<run_attempt>`.
4. Shows the diff. In a dry run it stops here and changes nothing.
5. On a real run, commits, pushes the delivery branch, opens a PR against your base branch, and
   syncs the IssueOps labels.

The payload is curated: it delivers the op workflows and forms, `src/`, `scripts/`, `docs/`,
sample CSVs, the README, and dotfiles. It intentionally excludes the internal sync workflows
(`hpe-repo-sync.yml`, `hpe-push-labels.yml`) and `tenant-registry/*.json`, since those are
landing-repo machinery and tenant data that do not belong in a receiving org.

## Before you start: create the two tokens

The workflow uses two secrets. You create both on your side and set them on the repository that
runs this workflow (Settings → Secrets and variables → Actions → Repository secrets). Fine-grained
PATs are recommended; a GitHub App installation works too.

### `SYNC_DESTINATION_PAT` — write access to the target org repo

This token does the real work on the destination: it probes access, clones, pushes the delivery
branch, opens the PR, and writes labels. It must be issued from an account (or app) your org
accepts, and scoped to the target repository with:

- Metadata: Read
- Contents: Read and write
- Pull requests: Read and write
- Issues: Read and write (label create and update)

### `SYNC_SOURCE_PAT` — read access to the source (landing) repo

This token only reads the label list from the source repo so the same labels can be recreated on
the target. Scope it to the source repository with:

- Metadata: Read
- Issues: Read

A note on expiry: set a sensible expiry and rotate before it lapses. An expired source token
surfaces as a `401 Bad credentials` at the label step; an expired or wrong-scoped destination
token surfaces as a `403` at the first access check. Neither failure mutates the target.

## How to run it

Trigger the workflow manually (Actions → this workflow → Run workflow) and fill in the inputs.

| Input | Meaning | Default |
|---|---|---|
| `target_org` | Destination org (owner) that receives the delivery | required |
| `target_repo` | Destination repository name in that org | required |
| `target_base_branch` | PR base branch on the target (never pushed to directly) | `main` |
| `source_ref` | Tag, branch, or SHA of this landing repo to publish | `main` |
| `delivery_branch_prefix` | Root name for the delivery branch (a run id is appended) | `infomagnus_delivery` |
| `push_code` | Push code to the delivery branch and open the PR | `true` |
| `push_labels` | Copy labels from this repo to the target | `true` |
| `dry_run` | Preview only: build the branch and show the diff, do not push, PR, or change labels | `true` |

`dry_run` defaults to `true` on purpose. A dry run validates both tokens, clones the base branch,
and prints the full diff (and the labels it would sync) without changing anything on the target.

## Recommended sequence

1. **Dry run first.** Run with `dry_run: true` and your target details. Confirm the access checks
   pass, the clone succeeds, and the diff is what you expect.
2. **Review the diff.** It should be only the IssueOps payload against your base branch, nothing
   unexpected.
3. **Real run.** Re-run with `dry_run: false` (keep `push_code: true` and `push_labels: true`).
   It pushes the delivery branch and opens the PR.
4. **Review and merge the PR** on your side, through your normal scans and approvals.

## Things worth knowing

- The base branch is never written to directly — only via the PR you review and merge.
- Runs against the same `target_org`/`target_repo` queue rather than cancel each other, so
  concurrent deliveries to one repo are serialized.
- The delivery branch name includes the run attempt, so re-running after a failure won't collide
  with the previous branch.
- The source code checkout uses the workflow's built-in token; `SYNC_SOURCE_PAT` is used solely
  for reading labels.
