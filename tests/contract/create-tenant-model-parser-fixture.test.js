'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTenantCreationRequest } = require('../../src/workflow-support/parse-tenant-creation-request');

test('create-tenant-model parser fixture scaffold is present', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-tenant-model-issue.md');
  const fixture = fs.readFileSync(fixturePath, 'utf8');

  assert.match(fixture, /Target organization/i);
  assert.match(fixture, /Tenant name/i);
  assert.match(fixture, /Designated approver/i);
  assert.match(fixture, /Dry-run mode/i);
  assert.match(fixture, /Business justification/i);
});

test('parseTenantCreationRequest parses required fields and derives deterministic team names', () => {
  const parsed = parseTenantCreationRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Acme Platform',
      designated_approver: 'Org-Owner-User',
      dry_run: 'true',
      justification: 'Bootstrap tenant for platform team',
    },
    issue: {
      number: 810,
      user: { login: 'requester-user' },
    },
    repository: 'octo-org/issueops-speckit',
    runContext: {
      run_id: '12345',
      run_attempt: '1',
    },
  });

  assert.equal(parsed.organization, 'octo-org');
  assert.equal(parsed.tenant_display_name, 'Acme Platform');
  assert.equal(parsed.designated_approver_login, 'org-owner-user');
  assert.equal(parsed.dry_run, true);
  assert.equal(parsed.business_justification, 'Bootstrap tenant for platform team');
  assert.equal(parsed.tenant_team_name, 'acme-platform-root');
  assert.equal(parsed.repo_admin_team_name, 'acme-platform-repo-admin');
  assert.equal(parsed.cicd_admin_team_name, 'acme-platform-cicd-admin');
  assert.equal(parsed.tenant_team_slug, 'acme-platform-root');
  assert.equal(parsed.repo_admin_team_slug, 'acme-platform-repo-admin');
  assert.equal(parsed.cicd_admin_team_slug, 'acme-platform-cicd-admin');
  assert.equal(parsed.requested_teams.length, 4);
  assert.equal(parsed.requested_child_links.length, 3);
});

test('parseTenantCreationRequest normalizes boolean dry_run and approver login casing', () => {
  const parsed = parseTenantCreationRequest({
    parsedRequest: {
      organization: 'OCTO-ORG',
      tenant_name: 'Acme',
      designated_approver: 'OWNER-USER',
      dry_run: 'false',
      justification: 'Need tenant',
    },
    issue: {
      number: 811,
      user: { login: 'Requester' },
    },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(parsed.organization, 'octo-org');
  assert.equal(parsed.designated_approver_login, 'owner-user');
  assert.equal(parsed.requester_login, 'requester');
  assert.equal(parsed.dry_run, false);
});
