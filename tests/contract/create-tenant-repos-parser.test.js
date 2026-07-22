'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseTenantRepoRequest } = require('../../src/workflow-support/parse-tenant-repo-request');

test('tenant repo parser marks visibility as not provided when issue form visibility is absent', () => {
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
      number: 501,
      user: { login: 'tenant-admin-user' },
    },
  });

  assert.equal(parsed.repository_visibility, '');
  assert.equal(parsed.repository_visibility_source, 'not_provided');
});

test('tenant repo parser preserves explicitly provided visibility and source', () => {
  const parsed = parseTenantRepoRequest({
    parsedRequest: {
      organization: 'Octo-Org',
      tenant_name: 'ContosoUK',
      repository_name: 'Acme Platform Service',
      repository_visibility: 'public',
      designated_approver: 'Org-Owner-User',
      dry_run: 'false',
      justification: 'Needed for tenant service operations.',
    },
    issue: {
      number: 502,
      user: { login: 'tenant-admin-user' },
    },
  });

  assert.equal(parsed.repository_visibility, 'public');
  assert.equal(parsed.repository_visibility_source, 'user_selected');
});
