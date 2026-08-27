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
