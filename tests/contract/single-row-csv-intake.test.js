'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseSingleCsvRow } = require('../../src/workflow-support/parse-single-csv-row');
const { parseTenantCreationRequest } = require('../../src/workflow-support/parse-tenant-creation-request');
const { parseHostedRunnerRequest } = require('../../src/workflow-support/parse-hosted-runner-request');
const { parseHostedRunnerDeletionRequest } = require('../../src/workflow-support/parse-hosted-runner-deletion-request');
const { parseRunnerGroupRequest } = require('../../src/workflow-support/parse-runner-group-request');
const { parseHostedRunnerMoveRequest } = require('../../src/workflow-support/parse-hosted-runner-move-request');

const context = {
  repository: 'octo-org/issueops',
  issue: { number: 100, user: { login: 'org-owner' } },
};

test('single-row CSV parser supports headers, quoted commas, and code fences', () => {
  const parsed = parseSingleCsvRow('```csv\nname,description\nalpha,"one, two"\n```', ['name', 'description']);

  assert.equal(parsed.provided, true);
  assert.equal(parsed.row_count, 1);
  assert.deepEqual(parsed.row, { name: 'alpha', description: 'one, two' });
  assert.deepEqual(parsed.errors, []);
});

test('single-row CSV parser rejects multiple data rows', () => {
  const parsed = parseSingleCsvRow('name\nalpha\nbeta', ['name']);

  assert.equal(parsed.row_count, 2);
  assert.match(parsed.errors.join('\n'), /exactly one data row; found 2/i);
});

test('create tenant CSV overrides manual fields and captures the designated tenant admin', () => {
  const request = parseTenantCreationRequest({
    ...context,
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Manual Tenant',
      tenant_admin_login: 'manual-admin',
      tenant_csv: [
        'tenant_name,tenant_admin_login,tenant_type,cmdb_id,cost_center,business_unit,environment,primary_contact,secondary_contact,code_scanning_enabled,secret_scanning_enabled,dependabot_enabled',
        'CSV Tenant,user1,platform,CMDB-100,CC-100,engineering,prod,owner@example.com,backup@example.com,true,true,true',
      ].join('\n'),
      designated_approver: 'org-owner',
      dry_run: 'true',
    },
  });

  assert.equal(request.intake_mode, 'csv');
  assert.equal(request.csv_row_count, 1);
  assert.deepEqual(request.csv_input_errors, []);
  assert.equal(request.tenant_display_name, 'CSV Tenant');
  assert.equal(request.tenant_admin_login, 'user1');
  assert.equal(request.tenant_type, 'platform');
  assert.equal(request.external_mappings.cost_center, 'CC-100');
});

test('create tenant CSV parser ignores preface lines before header and preserves tenant admin', () => {
  const request = parseTenantCreationRequest({
    ...context,
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'Manual Tenant',
      tenant_admin_login: 'manual-admin',
      tenant_csv: [
        'Example input:',
        'tenant_name,tenant_admin_login,tenant_type,cmdb_id,cost_center,business_unit,environment,primary_contact,secondary_contact,code_scanning_enabled,secret_scanning_enabled,dependabot_enabled',
        'tenant-a,tenant-admin-user,platform,CMDB-1001,CC-1001,platform,nonprod,owner@example.com,,true,true,true',
      ].join('\n'),
      designated_approver: 'org-owner',
      dry_run: 'true',
    },
  });

  assert.equal(request.intake_mode, 'csv');
  assert.equal(request.csv_row_count, 1);
  assert.deepEqual(request.csv_input_errors, []);
  assert.equal(request.tenant_display_name, 'tenant-a');
  assert.equal(request.tenant_admin_login, 'tenant-admin-user');
});

test('runner lifecycle parsers accept spreadsheet input', () => {
  const common = {
    ...context,
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'DemoCorp',
      designated_approver: 'org-owner',
      dry_run: 'true',
    },
  };

  const create = parseHostedRunnerRequest({
    ...common,
    parsedRequest: {
      ...common.parsedRequest,
      runner_csv: 'runner_name,runner_image_id,runner_image_source,runner_size,runner_group_name,maximum_runners\nbuild-01,ubuntu-24.04,github,4-core,builders,3',
    },
  });
  const remove = parseHostedRunnerDeletionRequest({
    ...common,
    parsedRequest: { ...common.parsedRequest, runner_csv: 'runner_name\nbuild-01' },
  });
  const group = parseRunnerGroupRequest({
    ...common,
    parsedRequest: {
      ...common.parsedRequest,
      runner_groups_csv: 'runner_group_name,runner_group_visibility,allows_public_repositories\nbuilders,selected,false',
    },
  });
  const move = parseHostedRunnerMoveRequest({
    ...common,
    parsedRequest: {
      ...common.parsedRequest,
      runner_moves_csv: 'runner_name,hosted_runner_id,target_runner_group_name\nbuild-01,42,release',
    },
  });

  assert.equal(create.intake_mode, 'csv');
  assert.equal(create.runner_name_derived, 'DemoCorp_build-01');
  assert.equal(create.maximum_runners, 3);
  assert.equal(remove.intake_mode, 'csv');
  assert.equal(remove.runner_name_derived, 'DemoCorp_build-01');
  assert.equal(group.intake_mode, 'csv');
  assert.equal(group.runner_group_name_derived, 'DemoCorp_builders');
  assert.equal(move.intake_mode, 'csv');
  assert.equal(move.runner_name_derived, 'DemoCorp_build-01');
  assert.equal(move.hosted_runner_id_input, 42);
  assert.equal(move.target_runner_group_name_input, 'release');
});
