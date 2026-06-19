Manual functional test cases for the tenant runner IssueOps.

One CSV per operation. Each row is a manual test case linked to its user story (the spec under specs/). Columns: test_id, user_story (spec path), scenario, preconditions, form_inputs, expected_result, case_type (happy/approval/guardrail/idempotent/live).

Run them against a repo where the runner ops are on the default branch (for the demo: im-sandbox-erichinfomagnus/hpe-runner-demo). Dry-run cases need no enterprise token; live cases need an enterprise PAT with runner permissions.

## CSV-attachment intake test cases

csv-attachment-intake.testcases.csv covers the alternative intake where a CSV-driven op (add-team-members, create-org-teams, add-child-teams, add-team-repo-access) is driven by attaching a .csv file in an issue comment instead of pasting into the form field. The sample .csv files to attach are in attachment_samples/. The runner ops are single-field forms and do not use CSV attachments, so they are not covered here.
