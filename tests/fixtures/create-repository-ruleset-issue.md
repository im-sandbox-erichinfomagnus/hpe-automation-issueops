### Target organization

octo-org

### Tenant name (optional)

Acme Platform

### Rulesets CSV (spreadsheet batch)

repository,ruleset_name,target,ref_name_pattern,enforcement,require_pull_request,block_force_pushes,require_linear_history,restrict_deletions
acme-service-api,acme-main-protection,branch,~DEFAULT_BRANCH,active,true,true,false,true
acme-web,acme-main-protection,branch,~DEFAULT_BRANCH,active,true,false,false,false

### Target repository (optional, single-item path)

_No response_

### Ruleset name (optional, single-item path)

_No response_

### Ruleset target

branch

### Ref name pattern (optional)

~DEFAULT_BRANCH

### Enforcement

active

### Require pull request

false

### Block force pushes

false

### Require linear history

false

### Restrict deletions

false

### Designated approver

org-owner-user

### Dry-run mode

false

### Business justification

Enforce branch protection across the tenant service repositories.
