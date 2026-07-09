'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildRepositoryRulesetPayload,
  parseRepositoryRulesetRequest,
} = require('../../src/workflow-support/parse-repository-ruleset-request');

test('create-repository-ruleset parser fixture scaffold is present', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-repository-ruleset-issue.md');
  const fixture = fs.readFileSync(fixturePath, 'utf8');

  assert.match(fixture, /Target organization/i);
  assert.match(fixture, /Tenant name/i);
  assert.match(fixture, /Target repository/i);
  assert.match(fixture, /Ruleset name/i);
  assert.match(fixture, /Ruleset target/i);
  assert.match(fixture, /Enforcement/i);
  assert.match(fixture, /Require pull request/i);
  assert.match(fixture, /Block force pushes/i);
  assert.match(fixture, /Designated approver/i);
  assert.match(fixture, /Dry-run mode/i);
  assert.match(fixture, /Business justification/i);
});

test('create-repository-ruleset issue form scaffold includes required fields', () => {
  const formPath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'create-repository-ruleset.yml');
  const form = fs.readFileSync(formPath, 'utf8');

  assert.match(form, /id:\s+organization/i);
  assert.match(form, /id:\s+tenant_name/i);
  assert.match(form, /id:\s+repository/i);
  assert.match(form, /id:\s+ruleset_name/i);
  assert.match(form, /id:\s+target/i);
  assert.match(form, /id:\s+ref_name_pattern/i);
  assert.match(form, /id:\s+enforcement/i);
  assert.match(form, /id:\s+require_pull_request/i);
  assert.match(form, /id:\s+block_force_pushes/i);
  assert.match(form, /id:\s+require_linear_history/i);
  assert.match(form, /id:\s+restrict_deletions/i);
  assert.match(form, /id:\s+designated_approver/i);
  assert.match(form, /id:\s+dry_run/i);
  assert.match(form, /id:\s+justification/i);

  assert.match(form, /labels:\s*\n\s+- issueops\s*\n\s+- create-repository-ruleset/);
});

test('parser normalizes a create request and derives the operation from create-only fields', () => {
  const request = parseRepositoryRulesetRequest({
    parsedRequest: {
      organization: 'Octo-Org',
      tenant_name: 'Acme Platform',
      repository: 'Acme Service API',
      ruleset_name: 'Acme Default Branch Protection',
      target: 'branch',
      enforcement: 'active',
      require_pull_request: 'true',
      block_force_pushes: 'true',
      require_linear_history: 'false',
      restrict_deletions: 'true',
      designated_approver: 'Org-Owner-User',
      dry_run: 'false',
      justification: 'Enforce branch protection.',
    },
    issue: {
      number: 510,
      user: { login: 'Tenant-Repo-Admin' },
    },
  });

  assert.equal(request.ruleset_operation, 'create');
  assert.equal(request.organization, 'octo-org');
  assert.equal(request.tenant_name_input, 'Acme Platform');
  assert.equal(request.repository_target_input, 'Acme Service API');
  assert.equal(request.repository_target_normalized, 'acme-service-api');
  assert.equal(request.ruleset_name_input, 'Acme Default Branch Protection');
  assert.equal(request.ruleset_target, 'branch');
  assert.equal(request.enforcement, 'active');
  assert.equal(request.ref_name_pattern, '~DEFAULT_BRANCH');
  assert.equal(request.require_pull_request, true);
  assert.equal(request.block_force_pushes, true);
  assert.equal(request.require_linear_history, false);
  assert.equal(request.restrict_deletions, true);
  assert.equal(request.designated_approver_login, 'org-owner-user');
  assert.equal(request.dry_run, false);
  assert.equal(request.requester_login, 'tenant-repo-admin');
  assert.equal(request.intake_mode, 'manual');
  assert.equal(request.request_status, 'submitted');
});

test('parser applies default target, enforcement, and ref name pattern for create', () => {
  const request = parseRepositoryRulesetRequest({
    rulesetOperation: 'create',
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Acme Platform',
      repository: 'acme-web',
      ruleset_name: 'acme-baseline',
      require_pull_request: 'true',
    },
    issue: { number: 511, user: { login: 'tenant-repo-admin' } },
  });

  assert.equal(request.ruleset_target, 'branch');
  assert.equal(request.enforcement, 'active');
  assert.equal(request.ref_name_pattern, '~DEFAULT_BRANCH');
});

test('ruleset payload is built from the enabled toggles only', () => {
  const payload = buildRepositoryRulesetPayload({
    ruleset_name_input: 'acme-baseline',
    ruleset_target: 'branch',
    enforcement: 'evaluate',
    ref_name_pattern: 'refs/heads/main',
    require_pull_request: true,
    block_force_pushes: false,
    require_linear_history: true,
    restrict_deletions: false,
  });

  assert.equal(payload.name, 'acme-baseline');
  assert.equal(payload.target, 'branch');
  assert.equal(payload.enforcement, 'evaluate');
  assert.deepEqual(payload.conditions.ref_name.include, ['refs/heads/main']);
  const ruleTypes = payload.rules.map((rule) => rule.type).sort();
  assert.deepEqual(ruleTypes, ['pull_request', 'required_linear_history']);
});
