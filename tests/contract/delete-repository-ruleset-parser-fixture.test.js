'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  parseRulesetsCsv,
  parseRepositoryRulesetRequest,
} = require('../../src/workflow-support/parse-repository-ruleset-request');

test('delete-repository-ruleset parser fixture scaffold is present', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'delete-repository-ruleset-issue.md');
  const fixture = fs.readFileSync(fixturePath, 'utf8');

  assert.match(fixture, /Target organization/i);
  assert.match(fixture, /Rulesets CSV/i);
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
  assert.match(form, /id:\s+rulesets_csv/i);
  assert.match(form, /id:\s+repository/i);
  assert.match(form, /id:\s+ruleset_name/i);
  assert.match(form, /id:\s+designated_approver/i);
  assert.match(form, /id:\s+dry_run/i);
  assert.match(form, /id:\s+justification/i);

  assert.match(form, /labels:\s*\n\s+- issueops\s*\n\s+- delete-repository-ruleset/);
});

test('parser normalizes a single-item delete request into one entry with no rule toggles', () => {
  const request = parseRepositoryRulesetRequest({
    rulesetOperation: 'delete',
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
  assert.equal(request.dry_run, true);
  assert.equal(request.designated_approver_login, 'org-owner-user');
  assert.equal(request.ruleset_entries.length, 1);
  const entry = request.ruleset_entries[0];
  assert.equal(entry.repository, 'acme-service-api');
  assert.equal(entry.ruleset_name, 'Acme Default Branch Protection');
  assert.equal(entry.target, undefined);
  assert.equal(entry.enforcement, undefined);
});

test('parser reads a spreadsheet CSV batch of delete rows across repos', () => {
  const request = parseRepositoryRulesetRequest({
    rulesetOperation: 'delete',
    parsedRequest: {
      organization: 'octo-org',
      rulesets_csv: [
        'repository,ruleset_name',
        'acme-service-api,acme-main-protection',
        'acme-web,acme-tag-protection',
      ].join('\n'),
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Retire stale rulesets.',
    },
    issue: { number: 513, user: { login: 'repo-admin' } },
  });

  assert.equal(request.ruleset_entries.length, 2);
  assert.deepEqual(
    request.ruleset_entries.map((entry) => `${entry.repository}/${entry.ruleset_name}`),
    ['acme-service-api/acme-main-protection', 'acme-web/acme-tag-protection']
  );
  assert.equal(request.ruleset_entries[0].source, 'csv');
});

test('parseRulesetsCsv for delete reads only repository and ruleset_name', () => {
  const rows = parseRulesetsCsv('acme-web,acme-baseline,ignored,extra', 'delete');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].repository, 'acme-web');
  assert.equal(rows[0].ruleset_name, 'acme-baseline');
  assert.equal(rows[0].target, undefined);
});
