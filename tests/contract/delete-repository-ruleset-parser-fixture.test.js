'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseRepositoryRulesetRequest } = require('../../src/workflow-support/parse-repository-ruleset-request');

test('delete-repository-ruleset parser fixture scaffold is present', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'delete-repository-ruleset-issue.md');
  const fixture = fs.readFileSync(fixturePath, 'utf8');

  assert.match(fixture, /Target organization/i);
  assert.match(fixture, /Tenant name/i);
  assert.match(fixture, /Target repository/i);
  assert.match(fixture, /Ruleset name/i);
  assert.match(fixture, /Designated approver/i);
  assert.match(fixture, /Dry-run mode/i);
  assert.match(fixture, /Business justification/i);
});

test('delete-repository-ruleset issue form scaffold includes required fields', () => {
  const formPath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'delete-repository-ruleset.yml');
  const form = fs.readFileSync(formPath, 'utf8');

  assert.match(form, /id:\s+organization/i);
  assert.match(form, /id:\s+tenant_name/i);
  assert.match(form, /id:\s+repository/i);
  assert.match(form, /id:\s+ruleset_name/i);
  assert.match(form, /id:\s+designated_approver/i);
  assert.match(form, /id:\s+dry_run/i);
  assert.match(form, /id:\s+justification/i);

  assert.match(form, /labels:\s*\n\s+- issueops\s*\n\s+- delete-repository-ruleset/);
});

test('parser normalizes a delete request and infers the delete operation with no rule toggles', () => {
  const request = parseRepositoryRulesetRequest({
    parsedRequest: {
      organization: 'Octo-Org',
      tenant_name: 'Acme Platform',
      repository: 'Acme Service API',
      ruleset_name: 'Acme Default Branch Protection',
      designated_approver: 'Org-Owner-User',
      dry_run: 'true',
      justification: 'Retire stale ruleset.',
    },
    issue: {
      number: 512,
      user: { login: 'Tenant-Repo-Admin' },
    },
  });

  assert.equal(request.ruleset_operation, 'delete');
  assert.equal(request.organization, 'octo-org');
  assert.equal(request.repository_target_normalized, 'acme-service-api');
  assert.equal(request.ruleset_name_input, 'Acme Default Branch Protection');
  assert.equal(request.ruleset_target, '');
  assert.equal(request.enforcement, '');
  assert.equal(request.ref_name_pattern, '');
  assert.equal(request.require_pull_request, false);
  assert.equal(request.block_force_pushes, false);
  assert.equal(request.dry_run, true);
  assert.equal(request.designated_approver_login, 'org-owner-user');
  assert.equal(request.request_status, 'submitted');
});

test('explicit delete operation overrides create-field inference', () => {
  const request = parseRepositoryRulesetRequest({
    rulesetOperation: 'delete',
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Acme Platform',
      repository: 'acme-web',
      ruleset_name: 'acme-baseline',
      enforcement: 'active',
    },
    issue: { number: 513, user: { login: 'tenant-repo-admin' } },
  });

  assert.equal(request.ruleset_operation, 'delete');
  assert.equal(request.enforcement, '');
});
