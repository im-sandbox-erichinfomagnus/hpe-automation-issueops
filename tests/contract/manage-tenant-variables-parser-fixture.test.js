'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  applyTenantVariablePrefix,
  deriveTenantVariablePrefix,
  parseTenantVariablesRequest,
} = require('../../src/workflow-support/parse-tenant-variables-request');

test('manage-tenant-variables parser fixture scaffold is present', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'manage-tenant-variables-issue.md');
  const fixture = fs.readFileSync(fixturePath, 'utf8');

  assert.match(fixture, /Target organization/i);
  assert.match(fixture, /Tenant name/i);
  assert.match(fixture, /Variable operation/i);
  assert.match(fixture, /Variable name/i);
  assert.match(fixture, /Variable value/i);
  assert.match(fixture, /Variables CSV/i);
  assert.match(fixture, /Designated approver/i);
  assert.match(fixture, /Dry-run mode/i);
  assert.match(fixture, /Business justification/i);
});

test('manage-tenant-variables issue form scaffold includes required fields', () => {
  const formPath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'manage-tenant-variables.yml');
  const form = fs.readFileSync(formPath, 'utf8');

  assert.match(form, /id:\s+organization/i);
  assert.match(form, /id:\s+tenant_name/i);
  assert.match(form, /id:\s+variable_operation/i);
  assert.match(form, /id:\s+variable_name/i);
  assert.match(form, /id:\s+variable_value/i);
  assert.match(form, /id:\s+variables_csv/i);
  assert.match(form, /id:\s+designated_approver/i);
  assert.match(form, /id:\s+dry_run/i);
  assert.match(form, /id:\s+justification/i);

  assert.match(form, /labels:\s*\n\s+- issueops\s*\n\s+- manage-tenant-variables/);
});

test('parser normalizes a single-variable create request', () => {
  const request = parseTenantVariablesRequest({
    parsedRequest: {
      organization: 'Octo-Org',
      tenant_name: 'ContosoUK',
      variable_operation: 'create',
      variable_name: 'api_base_url',
      variable_value: 'https://api.contoso.example.com',
      designated_approver: 'Org-Owner-User',
      dry_run: 'false',
      justification: 'Shared endpoint for tenant CI.',
    },
    issue: {
      number: 410,
      user: { login: 'tenant-cicd-admin' },
    },
  });

  assert.equal(request.organization, 'octo-org');
  assert.equal(request.tenant_name_input, 'ContosoUK');
  assert.equal(request.variable_operation, 'create');
  assert.deepEqual(request.variable_entries, [
    { name: 'API_BASE_URL', value: 'https://api.contoso.example.com' },
  ]);
  assert.equal(request.designated_approver_login, 'org-owner-user');
  assert.equal(request.dry_run, false);
  assert.equal(request.requester_login, 'tenant-cicd-admin');
  assert.equal(request.intake_mode, 'manual');
  assert.equal(request.request_status, 'submitted');
});

test('parser merges single-field and CSV entries and drops delete values by omission', () => {
  const request = parseTenantVariablesRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      variable_operation: 'delete',
      variable_name: 'legacy_flag',
      variables_csv: 'OLD_TOKEN\nRETIRED_URL',
      designated_approver: 'org-owner-user',
      dry_run: 'true',
      justification: 'Retire stale variables.',
    },
    issue: { number: 411, user: { login: 'tenant-cicd-admin' } },
  });

  assert.equal(request.variable_operation, 'delete');
  assert.equal(request.dry_run, true);
  assert.deepEqual(request.variable_entries, [
    { name: 'LEGACY_FLAG', value: null },
    { name: 'OLD_TOKEN', value: null },
    { name: 'RETIRED_URL', value: null },
  ]);
});

test('parser reads name,value pairs from the CSV textarea', () => {
  const request = parseTenantVariablesRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      variable_operation: 'create',
      variables_csv: 'API_BASE_URL,https://api.example.com\nFEATURE_FLAG,enabled',
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      justification: 'Batch create.',
    },
    issue: { number: 412, user: { login: 'tenant-cicd-admin' } },
  });

  assert.deepEqual(request.variable_entries, [
    { name: 'API_BASE_URL', value: 'https://api.example.com' },
    { name: 'FEATURE_FLAG', value: 'enabled' },
  ]);
});

test('tenant variable prefix derivation namespaces base names by tenant key', () => {
  assert.equal(deriveTenantVariablePrefix('contosouk'), 'CONTOSOUK_');
  assert.equal(deriveTenantVariablePrefix('Contoso UK'), 'CONTOSO_UK_');
  assert.equal(deriveTenantVariablePrefix(''), '');

  assert.equal(applyTenantVariablePrefix('CONTOSOUK_', 'api_url'), 'CONTOSOUK_API_URL');
  assert.equal(applyTenantVariablePrefix('CONTOSOUK_', 'CONTOSOUK_API_URL'), 'CONTOSOUK_API_URL');
});
