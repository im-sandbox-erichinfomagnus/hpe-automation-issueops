'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  deriveRunnerName,
  normalizeMaximumRunners,
  parseHostedRunnerRequest,
} = require('../../src/workflow-support/parse-hosted-runner-request');
const { deriveCicdAdminTeam } = require('../../src/workflow-support/resolve-tenant-cicd-context-from-registry');

test('create-tenant-hosted-runner parser fixture scaffold is present', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-tenant-hosted-runner-issue.md');
  const fixture = fs.readFileSync(fixturePath, 'utf8');

  assert.match(fixture, /Target organization/i);
  assert.match(fixture, /Tenant name/i);
  assert.match(fixture, /Runner name/i);
  assert.match(fixture, /Runner image id/i);
  assert.match(fixture, /Runner machine size/i);
  assert.match(fixture, /Designated approver/i);
  assert.match(fixture, /Dry-run mode/i);
  assert.match(fixture, /Business justification/i);
});

test('create-tenant-hosted-runner issue form scaffold includes required fields', () => {
  const formPath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'create-tenant-hosted-runner.yml');
  const form = fs.readFileSync(formPath, 'utf8');

  assert.match(form, /id:\s+organization/i);
  assert.match(form, /id:\s+tenant_name/i);
  assert.match(form, /id:\s+runner_name/i);
  assert.match(form, /id:\s+runner_image_id/i);
  assert.match(form, /id:\s+runner_image_source/i);
  assert.match(form, /id:\s+runner_size/i);
  assert.match(form, /id:\s+runner_group_name/i);
  assert.match(form, /id:\s+maximum_runners/i);
  assert.match(form, /id:\s+designated_approver/i);
  assert.match(form, /id:\s+dry_run/i);
  assert.match(form, /id:\s+justification/i);
});

test('parser derives the tenant-prefixed runner name deterministically', () => {
  const request = parseHostedRunnerRequest({
    parsedRequest: {
      organization: 'Octo-Org',
      tenant_name: 'ContosoUK',
      runner_name: 'ubuntu build',
      runner_image_id: 'ubuntu-24.04',
      runner_image_source: 'github',
      runner_size: '4-core',
      designated_approver: 'Org-Owner-User',
      dry_run: 'false',
      justification: 'CI capacity for the tenant.',
    },
    issue: {
      number: 310,
      user: { login: 'tenant-cicd-admin' },
    },
  });

  assert.equal(request.organization, 'octo-org');
  assert.equal(request.tenant_name_input, 'ContosoUK');
  assert.equal(request.runner_name_derived, 'ContosoUK_ubuntu_build');
  assert.equal(request.runner_name_derivation.derivation_status, 'valid');
  assert.equal(request.runner_image_id, 'ubuntu-24.04');
  assert.equal(request.runner_image_source, 'github');
  assert.equal(request.runner_size, '4-core');
  assert.equal(request.designated_approver_login, 'org-owner-user');
  assert.equal(request.dry_run, false);
  assert.equal(request.intake_mode, 'manual');
  assert.equal(request.request_status, 'submitted');
});

test('parser keeps base names that already carry the exact tenant prefix', () => {
  const derivation = deriveRunnerName('ContosoUK', 'ContosoUK_ubuntu-build');
  assert.equal(derivation.derived_name, 'ContosoUK_ubuntu-build');
  assert.equal(derivation.derivation_status, 'valid');
});

test('parser rejects derived runner names that exceed 64 characters', () => {
  const derivation = deriveRunnerName('ContosoUK', 'a'.repeat(64));
  assert.equal(derivation.derivation_status, 'invalid');
  assert.equal(derivation.constraint_findings.length > 0, true);
  assert.match(derivation.constraint_findings[0], /exceeds 64 characters/i);
});

test('parser rejects empty runner base names after normalization', () => {
  const derivation = deriveRunnerName('ContosoUK', '!!!');
  assert.equal(derivation.derivation_status, 'empty');
});

test('parser strips disallowed characters from the runner base name', () => {
  const derivation = deriveRunnerName('ContosoUK', 'build/agent#1');
  assert.equal(derivation.derived_name, 'ContosoUK_buildagent1');
  assert.equal(derivation.derivation_status, 'valid');
});

test('parser normalizes maximum runners input', () => {
  assert.deepEqual(normalizeMaximumRunners(''), { value: null, valid: true });
  assert.deepEqual(normalizeMaximumRunners('10'), { value: 10, valid: true });
  assert.deepEqual(normalizeMaximumRunners('0'), { value: null, valid: false });
  assert.deepEqual(normalizeMaximumRunners('ten'), { value: null, valid: false });
});

test('parser normalizes dropdown-style image source values', () => {
  const request = parseHostedRunnerRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      runner_name: 'build',
      runner_image_id: 'ubuntu-24.04',
      runner_image_source: '[github]',
      runner_size: '4-core',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'CI capacity.',
    },
    issue: { number: 311, user: { login: 'tenant-cicd-admin' } },
  });

  assert.equal(request.runner_image_source, 'github');
});

test('tenant admin team derivation follows the 022 canonical topology naming', () => {
  // The CI/CD administration authority is the tenant topology admin team (type "admin",
  // <tenant-slug>-admin) per specs/022-enhance-tenant-topology, not a separate CICDAdmins team.
  const derived = deriveCicdAdminTeam('ContosoUK');
  assert.equal(derived.cicd_admin_team_name, 'contosouk-admin');
  assert.equal(derived.cicd_admin_team_slug, 'contosouk-admin');

  const derivedWithSpace = deriveCicdAdminTeam('Contoso UK');
  assert.equal(derivedWithSpace.cicd_admin_team_name, 'contoso-uk-admin');
  assert.equal(derivedWithSpace.cicd_admin_team_slug, 'contoso-uk-admin');
});
