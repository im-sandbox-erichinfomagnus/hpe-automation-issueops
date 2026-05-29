'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTenantRepoRequest } = require('../../src/workflow-support/parse-tenant-repo-request');

test('create-tenant-repos parser fixture scaffold is present', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-tenant-repos-issue.md');
  const fixture = fs.readFileSync(fixturePath, 'utf8');

  assert.match(fixture, /Target organization/i);
  assert.match(fixture, /Tenant name/i);
  assert.match(fixture, /Repository name/i);
  assert.match(fixture, /Designated approver/i);
  assert.match(fixture, /Dry-run mode/i);
  assert.match(fixture, /Business justification/i);
});

test('create-tenant-repos issue form scaffold includes required fields', () => {
  const formPath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'create-tenant-repos.yml');
  const form = fs.readFileSync(formPath, 'utf8');

  assert.match(form, /id:\s+organization/i);
  assert.match(form, /id:\s+tenant_name/i);
  assert.match(form, /id:\s+repository_name/i);
  assert.match(form, /id:\s+designated_approver/i);
  assert.match(form, /id:\s+dry_run/i);
  assert.match(form, /id:\s+justification/i);
});

test('create-tenant-repos parser module normalizes repository request fields', () => {
  const parsed = parseTenantRepoRequest({
    parsedRequest: {
      organization: 'Octo-Org',
      tenant_name: 'ContosoUK',
      repository_name: 'Acme Platform Service',
      designated_approver: 'Org-Owner-User',
      dry_run: 'false',
      justification: 'Needed for tenant service operations.',
    },
    issue: {
      number: 101,
      user: {
        login: 'tenant-admin-user',
      },
    },
    repository: 'owner/repo',
    runContext: {
      run_id: '1001',
      run_attempt: '1',
    },
  });

  assert.equal(parsed.organization, 'octo-org');
  assert.equal(parsed.tenant_name_input, 'ContosoUK');
  assert.equal(parsed.tenant_name_normalized, 'contosouk');
  assert.equal(parsed.repository_name_input, 'Acme Platform Service');
  assert.equal(parsed.repository_name_normalized, 'acme-platform-service');
  assert.equal(parsed.designated_approver_login, 'org-owner-user');
  assert.equal(parsed.dry_run, false);
  assert.equal(parsed.business_justification, 'Needed for tenant service operations.');
});
