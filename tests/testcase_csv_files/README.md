Manual functional test cases for the tenant runner IssueOps.

One CSV per operation. Each row is a manual test case linked to its user story (the spec under specs/). Columns: test_id, user_story (spec path), scenario, preconditions, form_inputs, expected_result, case_type (happy/approval/guardrail/idempotent/live).

Run them against a repo where the runner ops are on the default branch (for the demo: im-sandbox-erichinfomagnus/hpe-runner-demo). Dry-run cases need no enterprise token; live cases need an enterprise PAT with runner permissions.
