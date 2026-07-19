# Quickstart: Manage Tenant Variables

1. Open the `Manage tenant variables` issue form.
2. Enter the organization and tenant exactly as they appear in `tenant-registry/`.
3. Select create, update, or delete.
4. Paste `name,value` spreadsheet rows into `variables_csv`.
5. Set dry-run to `true`, submit, and review the per-row authorization and plan.
6. Have the designated organization owner comment exactly `approved`.
7. For live execution, repeat with dry-run set to `false` and verify the final issue comment and audit artifact.

An unauthorized requester is rejected even when the CSV is valid. Variable names are always forced into the tenant namespace.
