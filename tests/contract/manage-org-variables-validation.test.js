'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { validateOrgVariablesRequest } = require('../../src/workflow-support/validate-org-variables-request');

function buildRequestInput(overrides = {}) {
  const parsedOverrides = overrides.parsedRequest || {};
  return {
    repository: 'octo-org/issueops-speckit',
    issueNumber: 525,
    requesterLogin: overrides.requesterLogin || 'org-owner-caller',
    runContext: { run_id: '26670000001', run_attempt: '1' },
    parsedRequest: {
      organization: 'octo-org',
      org_variable_operation: 'create',
      org_variable_name: 'PLATFORM_API_BASE_URL',
      org_variable_value: 'https://api.platform.example.com',
      dry_run: 'false',
      justification: 'Shared platform endpoint metadata.',
      ...parsedOverrides,
    },
  };
}

function buildOptions(overrides = {}) {
  const existingVariables = new Map(overrides.existingVariables || []);
  return {
    getOrganization: async () => ({ exists: true }),
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-caller' ? 'admin' : 'member',
        state: 'active',
      },
    }),
    getOrganizationVariable: async ({ name }) => (
      existingVariables.has(name)
        ? { exists: true, variable: { name, value: existingVariables.get(name), visibility: 'all' } }
        : { exists: false, variable: null }
    ),
    ...overrides.options,
  };
}

test('org owner single create request validates with a create plan entry', async () => {
  const validation = await validateOrgVariablesRequest(buildRequestInput(), buildOptions());

  assert.equal(validation.is_valid, true);
  assert.equal(validation.request_status, 'awaiting_approval');
  assert.equal(validation.requester_authorization.state, 'authorized');
  assert.equal(validation.plan.entries.length, 1);
  assert.deepEqual(
    { name: validation.plan.entries[0].name, operation: validation.plan.entries[0].operation, visibility: validation.plan.entries[0].visibility, action: validation.plan.entries[0].action },
    { name: 'PLATFORM_API_BASE_URL', operation: 'create', visibility: 'all', action: 'create' }
  );
  assert.match(validation.request.context_marker, /^org-variable-context:/);
});

test('rejects a requester who is not an active org owner', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput({ requesterLogin: 'plain-member' }),
    buildOptions()
  );

  assert.equal(validation.is_valid, false);
  assert.ok(validation.errors.some((error) => error.includes("Requester 'plain-member' is not an active owner of the target organization 'octo-org'")));
  assert.equal(validation.requester_authorization.state, 'unauthorized');
});

test('rejects a requester whose org membership is not active', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput(),
    buildOptions({
      options: {
        getOrganizationMembership: async () => ({ exists: true, membership: { role: 'admin', state: 'pending' } }),
      },
    })
  );

  assert.equal(validation.is_valid, false);
  assert.equal(validation.requester_authorization.membership_state, 'pending');
});

test('rejects when the target organization is not visible', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput(),
    buildOptions({ options: { getOrganization: async () => ({ exists: false }) } })
  );

  assert.equal(validation.is_valid, false);
  assert.ok(validation.errors.some((error) => error.includes('does not exist or is not visible')));
});

test('rejects an invalid default operation', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput({ parsedRequest: { org_variable_operation: 'rename' } }),
    buildOptions()
  );

  assert.equal(validation.is_valid, false);
  assert.ok(validation.errors.some((error) => error.includes("Org variable operation 'rename' is invalid")));
});

test('rejects when no variable entries are provided', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput({ parsedRequest: { org_variable_name: '', org_variable_value: '' } }),
    buildOptions()
  );

  assert.equal(validation.is_valid, false);
  assert.ok(validation.errors.some((error) => error.includes('Provide at least one variable')));
});

test('per-row operation column overrides the form default', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput({
      parsedRequest: {
        org_variable_name: '',
        org_variable_value: '',
        org_variables_csv: [
          'name,value,operation,visibility',
          'NEW_FLAG,enabled,create,private',
          'DEPLOY_CHANNEL,stable,update,',
          'RETIRED_FLAG,,delete,',
        ].join('\n'),
      },
    }),
    buildOptions({
      existingVariables: [
        ['DEPLOY_CHANNEL', 'canary'],
        ['RETIRED_FLAG', 'true'],
      ],
    })
  );

  assert.equal(validation.is_valid, true);
  const byName = new Map(validation.plan.entries.map((entry) => [entry.name, entry]));
  assert.equal(byName.get('NEW_FLAG').operation, 'create');
  assert.equal(byName.get('NEW_FLAG').visibility, 'private');
  assert.equal(byName.get('NEW_FLAG').action, 'create');
  assert.equal(byName.get('DEPLOY_CHANNEL').operation, 'update');
  assert.equal(byName.get('DEPLOY_CHANNEL').action, 'update');
  assert.equal(byName.get('RETIRED_FLAG').operation, 'delete');
  assert.equal(byName.get('RETIRED_FLAG').action, 'delete');
});

test('rejects a row with an unsupported per-row operation', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput({
      parsedRequest: {
        org_variable_name: '',
        org_variable_value: '',
        org_variables_csv: 'SOME_FLAG,enabled,upsert,',
      },
    }),
    buildOptions()
  );

  assert.equal(validation.is_valid, false);
  assert.ok(validation.errors.some((error) => error.includes("requests operation 'upsert' which is invalid")));
});

test('rejects unsupported visibility and accepts private', async () => {
  const rejected = await validateOrgVariablesRequest(
    buildRequestInput({
      parsedRequest: {
        org_variable_name: '',
        org_variable_value: '',
        org_variables_csv: 'SOME_FLAG,enabled,create,selected',
      },
    }),
    buildOptions()
  );
  assert.equal(rejected.is_valid, false);
  assert.ok(rejected.errors.some((error) => error.includes("visibility 'selected' which is not supported")));

  const accepted = await validateOrgVariablesRequest(
    buildRequestInput({
      parsedRequest: {
        org_variable_name: '',
        org_variable_value: '',
        org_variables_csv: 'SOME_FLAG,enabled,create,private',
      },
    }),
    buildOptions()
  );
  assert.equal(accepted.is_valid, true);
  assert.equal(accepted.plan.entries[0].visibility, 'private');
});

test('warns and ignores visibility on non-create rows', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput({
      parsedRequest: {
        org_variable_name: '',
        org_variable_value: '',
        org_variables_csv: 'DEPLOY_CHANNEL,stable,update,private',
      },
    }),
    buildOptions({ existingVariables: [['DEPLOY_CHANNEL', 'canary']] })
  );

  assert.equal(validation.is_valid, true);
  assert.ok(validation.warnings.some((warning) => warning.includes('visibility only applies when a variable is created')));
  assert.equal(validation.plan.entries[0].visibility, '');
});

test('requires a value for create and update, and forbids one for delete', async () => {
  const missingValue = await validateOrgVariablesRequest(
    buildRequestInput({ parsedRequest: { org_variable_value: '' } }),
    buildOptions()
  );
  assert.equal(missingValue.is_valid, false);
  assert.ok(missingValue.errors.some((error) => error.includes('requires a value for the create operation')));

  const deleteWithValue = await validateOrgVariablesRequest(
    buildRequestInput({ parsedRequest: { org_variable_operation: 'delete' } }),
    buildOptions()
  );
  assert.equal(deleteWithValue.is_valid, false);
  assert.ok(deleteWithValue.errors.some((error) => error.includes('must not include a value for the delete operation')));
});

test('rejects GITHUB_-prefixed and malformed variable names', async () => {
  const githubPrefixed = await validateOrgVariablesRequest(
    buildRequestInput({ parsedRequest: { org_variable_name: 'GITHUB_THING' } }),
    buildOptions()
  );
  assert.equal(githubPrefixed.is_valid, false);
  assert.ok(githubPrefixed.errors.some((error) => error.includes('must not start with GITHUB_')));

  const malformed = await validateOrgVariablesRequest(
    buildRequestInput({ parsedRequest: { org_variable_name: '9BAD-NAME' } }),
    buildOptions()
  );
  assert.equal(malformed.is_valid, false);
  assert.ok(malformed.errors.some((error) => error.includes('is invalid. Organization Actions variable names must match')));
});

test('rejects CSV rows with too many columns', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput({
      parsedRequest: {
        org_variable_name: '',
        org_variable_value: '',
        org_variables_csv: 'SOME_FLAG,a,b,c,d',
      },
    }),
    buildOptions()
  );

  assert.equal(validation.is_valid, false);
  assert.ok(validation.errors.some((error) => error.includes('has too many columns')));
});

test('deduplicates repeated names keeping the first occurrence', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput({
      parsedRequest: {
        org_variable_name: '',
        org_variable_value: '',
        org_variables_csv: 'SOME_FLAG,first,create,\nSOME_FLAG,second,create,',
      },
    }),
    buildOptions()
  );

  // Duplicates are merged at parse time (first occurrence wins); no prefixing
  // exists in this op so post-normalization collisions cannot reach validation.
  assert.equal(validation.is_valid, true);
  assert.equal(validation.plan.entries.length, 1);
  assert.equal(validation.plan.entries[0].value, 'first');
});

test('derives noop actions when the desired state already holds', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput({
      parsedRequest: {
        org_variable_name: '',
        org_variable_value: '',
        org_variables_csv: 'SATISFIED_FLAG,enabled,create,\nABSENT_FLAG,,delete,',
      },
    }),
    buildOptions({ existingVariables: [['SATISFIED_FLAG', 'enabled']] })
  );

  assert.equal(validation.is_valid, true);
  const byName = new Map(validation.plan.entries.map((entry) => [entry.name, entry]));
  assert.equal(byName.get('SATISFIED_FLAG').action, 'noop');
  assert.equal(byName.get('ABSENT_FLAG').action, 'noop');
});

test('dry-run requests validate with a warning and no mutation intent', async () => {
  const validation = await validateOrgVariablesRequest(
    buildRequestInput({ parsedRequest: { dry_run: 'true' } }),
    buildOptions()
  );

  assert.equal(validation.is_valid, true);
  assert.equal(validation.plan.dry_run, true);
  assert.ok(validation.warnings.some((warning) => warning.includes('Dry-run is enabled')));
  assert.equal(validation.no_mutation_planned, true);
});
