'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildRepositoryRulesetPayload,
  parseRulesetsCsv,
  parseRepositoryRulesetRequest,
} = require('../../src/workflow-support/parse-repository-ruleset-request');

test('create-repository-ruleset parser fixture scaffold is present', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-repository-ruleset-issue.md');
  const fixture = fs.readFileSync(fixturePath, 'utf8');

  assert.match(fixture, /Target organization/i);
  assert.match(fixture, /Rulesets CSV/i);
  assert.match(fixture, /Target repository/i);
  assert.match(fixture, /Ruleset name/i);
  assert.match(fixture, /Enforcement/i);
  assert.match(fixture, /Designated approver/i);
  assert.match(fixture, /Dry-run mode/i);
  assert.match(fixture, /Business justification/i);
});

test('create-repository-ruleset issue form scaffold includes required fields', () => {
  const formPath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'create-repository-ruleset.yml');
  const form = fs.readFileSync(formPath, 'utf8');

  assert.match(form, /id:\s+organization/i);
  assert.match(form, /id:\s+rulesets_csv/i);
  assert.match(form, /id:\s+repository/i);
  assert.match(form, /id:\s+ruleset_name/i);
  assert.match(form, /id:\s+target/i);
  assert.match(form, /id:\s+enforcement/i);
  assert.match(form, /id:\s+require_pull_request/i);
  assert.match(form, /id:\s+block_force_pushes/i);
  assert.match(form, /id:\s+designated_approver/i);
  assert.match(form, /id:\s+dry_run/i);
  assert.match(form, /id:\s+justification/i);

  assert.match(form, /labels:\s*\n\s+- issueops\s*\n\s+- create-repository-ruleset/);
});

test('parser normalizes a single-item create request into one ruleset entry', () => {
  const request = parseRepositoryRulesetRequest({
    rulesetOperation: 'create',
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
  assert.equal(request.designated_approver_login, 'org-owner-user');
  assert.equal(request.dry_run, false);
  assert.equal(request.ruleset_entries.length, 1);
  const entry = request.ruleset_entries[0];
  assert.equal(entry.repository, 'acme-service-api');
  assert.equal(entry.ruleset_name, 'Acme Default Branch Protection');
  assert.equal(entry.target, 'branch');
  assert.equal(entry.enforcement, 'active');
  assert.equal(entry.ref_name_pattern, '~DEFAULT_BRANCH');
  assert.equal(entry.require_pull_request, true);
  assert.equal(entry.restrict_deletions, true);
  assert.equal(entry.source, 'form');
});

test('parser reads a spreadsheet CSV batch of create rows across repos and merges the single item', () => {
  const request = parseRepositoryRulesetRequest({
    rulesetOperation: 'create',
    parsedRequest: {
      organization: 'octo-org',
      repository: 'acme-service-api',
      ruleset_name: 'acme-main-protection',
      target: 'branch',
      enforcement: 'active',
      rulesets_csv: [
        'repository,ruleset_name,target,ref_name_pattern,enforcement,require_pull_request,block_force_pushes,require_linear_history,restrict_deletions',
        'acme-web,acme-main-protection,branch,~DEFAULT_BRANCH,active,true,false,false,false',
        'acme-web,acme-tag-protection,tag,~ALL,evaluate,false,true,false,true',
      ].join('\n'),
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Batch protection.',
    },
    issue: { number: 511, user: { login: 'repo-admin' } },
  });

  // single-item form entry + two CSV rows, header skipped, deduped by (repo, ruleset_name)
  assert.equal(request.ruleset_entries.length, 3);
  assert.deepEqual(
    request.ruleset_entries.map((entry) => `${entry.repository}/${entry.ruleset_name}`),
    ['acme-service-api/acme-main-protection', 'acme-web/acme-main-protection', 'acme-web/acme-tag-protection']
  );
  const tagRow = request.ruleset_entries.find((entry) => entry.ruleset_name === 'acme-tag-protection');
  assert.equal(tagRow.target, 'tag');
  assert.equal(tagRow.enforcement, 'evaluate');
  assert.equal(tagRow.block_force_pushes, true);
  assert.equal(tagRow.source, 'csv');
});

test('parseRulesetsCsv defaults optional create columns per row', () => {
  const rows = parseRulesetsCsv('acme-web,only-name', 'create');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].repository, 'acme-web');
  assert.equal(rows[0].ruleset_name, 'only-name');
  assert.equal(rows[0].target, 'branch');
  assert.equal(rows[0].enforcement, 'active');
  assert.equal(rows[0].ref_name_pattern, '~DEFAULT_BRANCH');
  assert.equal(rows[0].require_pull_request, false);
});

test('ruleset payload is built from a single enriched entry', () => {
  const payload = buildRepositoryRulesetPayload({
    ruleset_name: 'acme-baseline',
    target: 'branch',
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
