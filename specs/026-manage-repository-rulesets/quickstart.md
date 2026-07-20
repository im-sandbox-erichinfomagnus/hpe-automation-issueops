# Quickstart: Manage Repository Rulesets

1. Open either the create or delete repository ruleset issue form.
2. Enter the target organization.
3. Paste the spreadsheet rows into `rulesets_csv`.
4. Set dry-run to `true`, submit, and review each row's authorization and planned action.
5. Have the designated organization owner comment exactly `approved`.
6. For live execution, repeat with dry-run set to `false` and verify each repository independently.

Use the samples under `sample-input-csvs/`. One unauthorized row does not prevent an authorized row from completing.
