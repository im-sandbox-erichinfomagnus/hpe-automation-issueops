'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseParsedRequestJson,
  readParsedRequestFromEnv,
  runRequestValidation,
} = require('../../src/scripts/run-request-validation');

test('readParsedRequestFromEnv prefers the parser JSON payload for multi-user requests', () => {
  const parsedRequest = readParsedRequestFromEnv({
    PARSED_REQUEST_JSON: JSON.stringify({
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requested_people: ['existing-user', 'new-user'],
      business_justification: 'Need access',
      dry_run: false,
    }),
    PARSED_REQUESTED_PEOPLE: 'existing-user',
  });

  assert.deepEqual(parsedRequest.requested_people, ['existing-user', 'new-user']);
  assert.equal(parsedRequest.organization, 'octo-org');
  assert.equal(parsedRequest.team_slug, 'platform-engineering');
});

test('readParsedRequestFromEnv fills missing parser JSON fields from workflow env outputs', () => {
  const parsedRequest = readParsedRequestFromEnv({
    PARSED_REQUEST_JSON: JSON.stringify({
      organization: 'octo-org',
      requested_people: 'octocat\nhubot',
      business_justification: 'Need access',
    }),
    PARSED_TEAM_SLUG: 'platform-engineering',
    PARSED_INTAKE_MODE: 'manual',
    PARSED_DRY_RUN: 'true',
  });

  assert.equal(parsedRequest.organization, 'octo-org');
  assert.equal(parsedRequest.team_slug, 'platform-engineering');
  assert.equal(parsedRequest.intake_mode, 'manual');
  assert.equal(parsedRequest.requested_people, 'octocat\nhubot');
  assert.equal(parsedRequest.dry_run, 'true');
});

test('parseParsedRequestJson returns null for invalid parser JSON values', () => {
  assert.equal(parseParsedRequestJson('{not valid json'), null);
});

test('readParsedRequestFromEnv falls back to hierarchy-specific env fields when parser JSON is absent', () => {
  const parsedRequest = readParsedRequestFromEnv({
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_PARENT_TEAM: 'Platform Engineering',
    PARSED_DESIGNATED_APPROVER: 'octocat',
    PARSED_REQUESTED_CHILD_TEAMS: 'Application Platform\nRelease Engineering',
    PARSED_BUSINESS_JUSTIFICATION: 'Need hierarchy changes',
    PARSED_DRY_RUN: 'false',
  });

  assert.equal(parsedRequest.organization, 'octo-org');
  assert.equal(parsedRequest.parent_team, 'Platform Engineering');
  assert.equal(parsedRequest.designated_approver, 'octocat');
  assert.equal(parsedRequest.requested_child_teams, 'Application Platform\nRelease Engineering');
  assert.equal(parsedRequest.dry_run, 'false');
});

test('runRequestValidation records hierarchy audit metadata and missing-token failures when no workflow token is available', async () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-child-teams-missing-token-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '611',
      REQUESTER_LOGIN: 'requester',
      PARSED_PARENT_TEAM: 'Platform Engineering',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_DESIGNATED_APPROVER: 'octocat',
      PARSED_REQUESTED_CHILD_TEAMS: 'Application Platform',
      PARSED_BUSINESS_JUSTIFICATION: 'Need hierarchy updates',
      PARSED_DRY_RUN: 'true',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.match(
    result.validation.errors.join('\n'),
    /workflow token secret is missing|requires ISSUEOPS_GITHUB_TOKEN/i
  );
  assert.equal(persisted.metadata.operation, 'team_hierarchy');
  assert.equal(persisted.request.parent_team_slug, 'platform-engineering');
  assert.equal(persisted.execution.failure_count, 0);
  assert.match(persisted.execution.summary, /No child-team mutation was attempted/i);
});
test('runRequestValidation classifies remove-team-repo-access when only team and requested repositories are provided', async () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-team-repo-access-classification-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '613',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TEAM: 'Platform Engineering',
      PARSED_DESIGNATED_APPROVER: 'octocat',
      PARSED_REQUESTED_REPOSITORIES: 'service-catalog',
      PARSED_INTAKE_MODE: 'manual',
      PARSED_BUSINESS_JUSTIFICATION: 'Remove access for team cleanup',
      PARSED_DRY_RUN: 'true',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.match(result.validation.errors.join('\n'), /workflow token secret is missing/i);
  assert.equal(persisted.metadata.operation, 'team_repo_access_removal');
  assert.equal(persisted.request.team_slug, 'platform-engineering');
  assert.match(persisted.execution.summary, /No repository-access mutation was attempted/i);
});
test('runRequestValidation classifies repository-ruleset creation when tenant name is blank and an approver is set', async () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-repository-ruleset-classification-'));
  const artifactPath = path.join(workspace, 'audit.json');

  // A blank tenant name plus a designated approver also satisfies the
  // team-repo-access-removal predicate, so this pins the dispatch to the
  // operation value rather than predicate evaluation order. A token and a
  // stub api are supplied so validation reaches the validator dispatch chain
  // instead of short-circuiting on the missing-token branch.
  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '614',
      REQUESTER_LOGIN: 'requester',
      ISSUEOPS_GITHUB_TOKEN: 'test-token',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TENANT_NAME: '',
      PARSED_REPOSITORY: 'service-catalog',
      PARSED_RULESET_NAME: 'main-protection',
      PARSED_TARGET: 'branch',
      PARSED_REF_NAME_PATTERN: '~DEFAULT_BRANCH',
      PARSED_ENFORCEMENT: 'evaluate',
      PARSED_REQUIRE_PULL_REQUEST: 'false',
      PARSED_BLOCK_FORCE_PUSHES: 'true',
      PARSED_REQUIRE_LINEAR_HISTORY: 'false',
      PARSED_RESTRICT_DELETIONS: 'false',
      PARSED_DESIGNATED_APPROVER: 'octocat',
      PARSED_BUSINESS_JUSTIFICATION: 'Protect the default branch',
      PARSED_DRY_RUN: 'true',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
      getRepositoryCollaboratorPermission: async () => ({ permission: 'admin' }),
      getMembershipForUser: async () => ({ state: 'absent', membership: null }),
      getTeam: async () => ({ exists: false, team: null }),
      listOrgTeams: async () => [],
      listIssueComments: async () => [],
      listRepositoryRulesets: async () => [],
      getRepository: async () => ({ exists: true }),
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(persisted.metadata.operation, 'repository_ruleset_creation');

  const errorText = result.validation.errors.join('\n');
  assert.doesNotMatch(errorText, /An existing target team is required/i);
  assert.doesNotMatch(errorText, /Exactly one intake source must be populated for manual mode/i);
  assert.doesNotMatch(errorText, /At least one valid requested repository is required/i);
});

test('runRequestValidation classifies a CSV-only tenant request as tenant creation when the tenant name is blank', async () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'create-tenant-model-csv-classification-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });

  // The form marks tenant name optional and prefers the CSV row, so a blank name
  // with a populated CSV must still classify as tenant creation.
  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '615',
      REQUESTER_LOGIN: 'requester',
      ISSUEOPS_GITHUB_TOKEN: 'test-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      TENANT_REGISTRY_DIR: registryDir,
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TENANT_NAME: '',
      PARSED_TENANT_CSV: 'tenant_name,tenant_admin_login,tenant_type,cmdb_id,cost_center,business_unit,environment,primary_contact,secondary_contact,code_scanning_enabled,secret_scanning_enabled,dependabot_enabled\nAcmeCsv,octocat,platform,CMDB-1001,CC-1001,Compute,nonprod,owner@example.com,backup@example.com,true,true,true',
      PARSED_DRY_RUN: 'true',
      PARSED_JUSTIFICATION: 'Bootstrap the tenant from the CSV row',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(persisted.metadata.operation, 'tenant_creation');
  assert.equal(result.validation.is_valid, true);

  const errorText = result.validation.errors.join('\n');
  assert.doesNotMatch(errorText, /Target team slug is required/i);
  assert.doesNotMatch(errorText, /Exactly one supported intake mode must be selected/i);
});

test('runRequestValidation does not classify a request without any tenant signal as tenant creation', async () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-classification-negative-'));
  const artifactPath = path.join(workspace, 'audit.json');

  // Negative control for the CSV widening: a blank tenant name and a blank tenant
  // CSV must leave classification to the other predicates.
  await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '616',
      REQUESTER_LOGIN: 'requester',
      ISSUEOPS_GITHUB_TOKEN: 'test-token',
      AUDIT_ARTIFACT_PATH: artifactPath,
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TEAM: 'platform-engineering',
      PARSED_TENANT_NAME: '',
      PARSED_TENANT_CSV: '',
      PARSED_DRY_RUN: 'true',
    },
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
      listOrgTeams: async () => [],
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.notEqual(persisted.metadata.operation, 'tenant_creation');
});
test('runRequestValidation records repo-access audit metadata and missing-token failures when no workflow token is available', async () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'add-team-repo-access-missing-token-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '612',
      REQUESTER_LOGIN: 'requester',
      PARSED_ORGANIZATION: 'octo-org',
      PARSED_TARGET_TEAM: 'Platform Engineering',
      PARSED_DESIGNATED_APPROVER: 'octocat',
      PARSED_REQUESTED_REPOSITORIES: 'service-catalog',
      PARSED_PERMISSION_LEVEL: 'write',
      PARSED_BUSINESS_JUSTIFICATION: 'Need repository access',
      PARSED_DRY_RUN: 'true',
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.match(result.validation.errors.join('\n'), /workflow token secret is missing/i);
  assert.equal(persisted.metadata.operation, 'team_repo_access');
  assert.equal(persisted.request.team_slug, 'platform-engineering');
  assert.equal(persisted.execution.failure_count, 0);
  assert.match(persisted.execution.summary, /No repository-access mutation was attempted/i);
});

test('deriveTerminalStatusFromIssueLabels accepts both normalized and legacy tenant label prefixes', () => {
  const { deriveTerminalStatusFromIssueLabels } = require('../../src/scripts/run-request-validation');

  assert.equal(
    deriveTerminalStatusFromIssueLabels(['issueops:create-tenant:executed'], 'tenant_creation'),
    'executed'
  );
  assert.equal(
    deriveTerminalStatusFromIssueLabels(['issueops:create-tenant-model:executed'], 'tenant_creation'),
    'executed'
  );
});

test('runRequestValidation keeps tenant creation classification when parser JSON includes stray requested_repositories', async () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-create-classification-'));
  const artifactPath = path.join(workspace, 'audit.json');

  const result = await runRequestValidation({
    env: {
      GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
      ISSUE_NUMBER: '614',
      REQUESTER_LOGIN: 'requester',
      PARSED_REQUEST_JSON: JSON.stringify({
        organization: 'octo-org',
        parsed_tenant_name: 'Acme Platform',
        tenant_name: 'Acme Platform',
        designated_approver: 'octocat',
        requested_repositories: 'service-catalog',
        dry_run: 'true',
      }),
      AUDIT_ARTIFACT_PATH: artifactPath,
    },
    setProcessExitCode: false,
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  assert.equal(result.validation.is_valid, false);
  assert.equal(result.validation.request_status, 'validation_failed');
  assert.equal(persisted.metadata.operation, 'tenant_creation');
  assert.match(persisted.execution.summary, /No tenant bootstrap mutation was attempted/i);
});

// ---------------------------------------------------------------------------
// Bug 1 (#113): CSV-only runner requests must classify by operation, not fall
// through to tenant_creation. Creation and deletion share PARSED_RUNNER_CSV, so
// the form label is what separates them.
// ---------------------------------------------------------------------------

// Valid for BOTH the creation and deletion CSV contracts, so the cross-guards can
// send byte-identical text and vary only the label.
const SHARED_RUNNER_CSV = 'runner_name\nubuntu-build';

async function classifyRunnerRequest(parsedOverrides = {}, issueLabels = null) {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-csv-classification-'));
  const artifactPath = path.join(workspace, 'audit.json');
  const registryDir = path.join(workspace, 'tenant-registry');
  fs.mkdirSync(registryDir, { recursive: true });

  const env = {
    GITHUB_REPOSITORY: 'octo-org/issueops-speckit',
    ISSUE_NUMBER: '731',
    REQUESTER_LOGIN: 'requester',
    ISSUEOPS_GITHUB_TOKEN: 'test-token',
    AUDIT_ARTIFACT_PATH: artifactPath,
    TENANT_REGISTRY_DIR: registryDir,
    PARSED_ORGANIZATION: 'octo-org',
    PARSED_TENANT_NAME: 'ContosoUK',
    PARSED_DESIGNATED_APPROVER: 'org-owner-user',
    PARSED_DRY_RUN: 'true',
    PARSED_JUSTIFICATION: 'Runner capacity for the tenant.',
    ...parsedOverrides,
  };
  if (issueLabels) {
    env.ISSUE_LABELS_JSON = JSON.stringify(issueLabels.map((name) => ({ name })));
  }

  await runRequestValidation({
    env,
    api: {
      getOrganization: async () => ({ exists: true }),
      getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'active' } }),
      listOrgTeams: async () => [],
      getMembershipForUser: async () => ({ state: 'absent', membership: null }),
      listHostedRunners: async () => ([]),
      listRunnerGroups: async () => ([]),
    },
    setProcessExitCode: false,
  });

  return JSON.parse(fs.readFileSync(artifactPath, 'utf8')).metadata.operation;
}

test('runRequestValidation classifies a CSV-only hosted runner creation request by its form label', async () => {
  const operation = await classifyRunnerRequest(
    { PARSED_RUNNER_NAME: '', PARSED_RUNNER_CSV: 'runner_name,runner_image_id,runner_image_source,runner_size,runner_group_name,maximum_runners\nubuntu-build,2295,github,4-core,ContosoUK_Builders,1' },
    ['issueops', 'create-tenant-hosted-runner']
  );

  assert.equal(operation, 'hosted_runner_creation');
});

test('runRequestValidation classifies a CSV-only hosted runner deletion request by its form label', async () => {
  const operation = await classifyRunnerRequest(
    { PARSED_RUNNER_NAME: '', PARSED_RUNNER_CSV: SHARED_RUNNER_CSV },
    ['issueops', 'delete-tenant-hosted-runner']
  );

  assert.equal(operation, 'hosted_runner_deletion');
});

test('runRequestValidation classifies a CSV-only hosted runner move request', async () => {
  const operation = await classifyRunnerRequest(
    { PARSED_RUNNER_NAME: '', PARSED_RUNNER_MOVES_CSV: 'runner_name,target_runner_group_name\nubuntu-build,ContosoUK_Builders' },
    ['issueops', 'move-tenant-hosted-runner']
  );

  assert.equal(operation, 'hosted_runner_move');
});

test('runRequestValidation classifies a CSV-only runner group request', async () => {
  const operation = await classifyRunnerRequest(
    { PARSED_RUNNER_GROUP_NAME: '', PARSED_RUNNER_GROUPS_CSV: 'runner_group_name,runner_group_visibility,allows_public_repositories\nBuilders,selected,false' },
    ['issueops', 'create-tenant-runner-groups']
  );

  assert.equal(operation, 'runner_group_creation');
});

test('CROSS-GUARD: identical runner CSV text with the create label classifies as creation, not deletion', async () => {
  const operation = await classifyRunnerRequest(
    { PARSED_RUNNER_NAME: '', PARSED_RUNNER_CSV: SHARED_RUNNER_CSV },
    ['issueops', 'create-tenant-hosted-runner']
  );

  assert.equal(operation, 'hosted_runner_creation');
  assert.notEqual(operation, 'hosted_runner_deletion');
});

test('CROSS-GUARD: identical runner CSV text with the delete label classifies as deletion, not creation', async () => {
  const operation = await classifyRunnerRequest(
    { PARSED_RUNNER_NAME: '', PARSED_RUNNER_CSV: SHARED_RUNNER_CSV },
    ['issueops', 'delete-tenant-hosted-runner']
  );

  assert.equal(operation, 'hosted_runner_deletion');
  assert.notEqual(operation, 'hosted_runner_creation');
});

test('a CSV-only runner request with no form label falls back to the scalar-only classification', async () => {
  const operation = await classifyRunnerRequest(
    { PARSED_RUNNER_NAME: '', PARSED_RUNNER_CSV: SHARED_RUNNER_CSV },
    null
  );

  // Fail closed: without a label the CSV paths stay off and the tenant name wins.
  assert.equal(operation, 'tenant_creation');
});

test('scalar hosted runner creation and deletion requests still classify as they did before', async () => {
  const creation = await classifyRunnerRequest(
    { PARSED_RUNNER_NAME: 'ubuntu-build', PARSED_RUNNER_IMAGE_ID: '2295', PARSED_RUNNER_SIZE: '4-core' },
    ['issueops', 'create-tenant-hosted-runner']
  );
  assert.equal(creation, 'hosted_runner_creation');

  const deletion = await classifyRunnerRequest(
    { PARSED_RUNNER_NAME: 'ubuntu-build' },
    ['issueops', 'delete-tenant-hosted-runner']
  );
  assert.equal(deletion, 'hosted_runner_deletion');
});

test('scalar runner move and runner group requests still classify as they did before', async () => {
  const move = await classifyRunnerRequest(
    { PARSED_RUNNER_NAME: 'ubuntu-build', PARSED_TARGET_RUNNER_GROUP_NAME: 'ContosoUK_Builders' },
    ['issueops', 'move-tenant-hosted-runner']
  );
  assert.equal(move, 'hosted_runner_move');

  const groups = await classifyRunnerRequest(
    { PARSED_RUNNER_GROUP_NAME: 'Builders' },
    ['issueops', 'create-tenant-runner-groups']
  );
  assert.equal(groups, 'runner_group_creation');
});

test('a tenant request carrying no runner signal is unaffected by the runner CSV paths', async () => {
  const operation = await classifyRunnerRequest({}, ['issueops', 'create-tenant-model']);

  assert.equal(operation, 'tenant_creation');
});
