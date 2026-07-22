Manual functional test cases for the tenant and runner IssueOps.

One CSV per operation. Each row is a manual test case linked to its user story (the spec under specs/). Columns: test_id, user_story (spec path), scenario, preconditions, form_inputs, expected_result, case_type (happy/approval/guardrail/idempotent/live).

Run them against a repo where the IssueOps are on the default branch. Dry-run cases need no enterprise token. Live cases need a PAT with the operation's organization permissions.

## CSV-attachment intake test cases

csv-attachment-intake.testcases.csv covers the alternative intake where a bulk CSV operation is driven by attaching a .csv file in an issue comment instead of pasting it into the form field. Create tenant and runner lifecycle operations accept exactly one pasted spreadsheet row. Their samples are under sample-input-csvs/.
