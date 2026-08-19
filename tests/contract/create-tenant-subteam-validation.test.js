'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateTenantSubteamRequest } = require('../../src/workflow-support/validate-tenant-subteam-request');
const { normalizeBulkCsvRequestedSubteams } = require('../../src/workflow-support/normalize-bulk-csv-requested-subteams');

function canonicalTopologyRecord({ tenantId, tenantName, organization }) {
  const slug = tenantId;
  return {
    tenantId,
    tenantName,
    tenantType: 'application',
    organization,
    topology: {
      organization: { orgName: organization },
      teams: {
        tenantRootTeam: `${slug}-root`,
        structure: [
          { team: `${slug}-root`, parent: null, type: 'root' },
          { team: `${slug}-admin`, parent: `${slug}-root`, type: 'admin' },
          { team: `${slug}-repo-admin`, parent: `${slug}-root`, type: 'repo-admin' },
        ],
      },
    },
  };
}

function buildRegistry(records) {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-subteam-registry-'));
  const registryRecords = records || [
    canonicalTopologyRecord({ tenantId: 'contosouk', tenantName: 'ContosoUK', organization: 'octo-org' }),
  ];
  for (const record of registryRecords) {
    fs.writeFileSync(path.join(registryDir, `${record.tenantId}.json`), JSON.stringify(record, null, 2), 'utf8');
  }
  return registryDir;
}

function buildRequestInput(overrides = {}) {
  return {
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      subteam_operation: 'create',
      intake_mode: 'manual',
      requested_subteams: 'Payments\nPortal Web',
      dry_run: 'false',
      business_justification: 'Split the tenant delivery group.',
      ...overrides.parsedRequest,
    },
    issue: {
      number: 450,
      user: { login: overrides.requesterLogin || 'tenant-root-maintainer' },
    },
  };
}

function buildOptions(registryDir, overrides = {}) {
  return {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    getTeamBySlug: async ({ teamSlug }) => {
      if (teamSlug === 'contosouk-root') {
        return { exists: true, team: { id: 101, slug: 'contosouk-root' } };
      }
      if (teamSlug === 'contosouk-platform') {
        return { exists: true, team: { id: 404, slug: 'contosouk-platform' } };
      }
      return { exists: false, team: null };
    },
    getMembershipForUser: async ({ teamSlug, username }) => {
      if (teamSlug === 'contosouk-root' && username === 'tenant-root-maintainer') {
        return { state: 'active', membership: { role: 'maintainer' } };
      }
      return { state: 'absent', membership: null };
    },
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: {
        role: username === 'org-owner-user' || username === 'org-admin-user' ? 'admin' : 'member',
        state: 'active',
      },
    }),
    ...overrides,
  };
}

test('valid create request by a tenant root-team maintainer becomes approval-ready with prefixed slugs', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantSubteamRequest(buildRequestInput(), buildOptions(registryDir));

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request_status, 'awaiting_approval');
  assert.deepEqual(
    result.requested_teams.map((team) => team.normalized_slug),
    ['contosouk-payments', 'contosouk-portal-web']
  );
  assert.equal(result.requested_teams[0].desired_action, 'create_team');
  assert.equal(result.plan.parent_team_slug, 'contosouk-root');
  assert.equal(result.plan.parent_team_id, 101);
  assert.match(result.request.context_marker, /^tenant-subteam-context:/);
});

test('an org owner who is NOT a root-team maintainer is authorized (wider gate)', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantSubteamRequest(
    buildRequestInput({ requesterLogin: 'org-admin-user' }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.validation_findings.requester_org_role, 'admin');
  assert.equal(result.validation_findings.requester_membership_state, 'absent');
});

test('a requester who is neither org owner nor root-team maintainer is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantSubteamRequest(
    buildRequestInput({ requesterLogin: 'regular-member' }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /cannot create subteams for tenant/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('a tenant-prefixed requested name is not double-prefixed', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantSubteamRequest(
    buildRequestInput({ parsedRequest: { requested_subteams: 'contosouk-payments' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.requested_teams[0].normalized_slug, 'contosouk-payments');
});

test('an already-existing subteam converges as a noop', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantSubteamRequest(
    buildRequestInput({ parsedRequest: { requested_subteams: 'Payments' } }),
    buildOptions(registryDir, {
      getTeamBySlug: async ({ teamSlug }) => {
        if (teamSlug === 'contosouk-root') {
          return { exists: true, team: { id: 101, slug: 'contosouk-root' } };
        }
        if (teamSlug === 'contosouk-payments') {
          return { exists: true, team: { id: 505, slug: 'contosouk-payments' } };
        }
        return { exists: false, team: null };
      },
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.requested_teams[0].desired_action, 'noop');
  assert.equal(result.plan.subteams_already_present, 1);
});

test('an explicit tenant child team is accepted as parent', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantSubteamRequest(
    buildRequestInput({ parsedRequest: { parent_team: 'contosouk-platform' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.plan.parent_team_slug, 'contosouk-platform');
  assert.equal(result.plan.parent_team_id, 404);
});

test('a parent team outside the tenant namespace is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantSubteamRequest(
    buildRequestInput({ parsedRequest: { parent_team: 'other-org-team' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /does not belong to tenant/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('a missing explicit parent team is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantSubteamRequest(
    buildRequestInput({ parsedRequest: { parent_team: 'contosouk-ghost' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /Parent team 'contosouk-ghost' does not exist/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('an invalid subteam operation is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantSubteamRequest(
    buildRequestInput({ parsedRequest: { subteam_operation: 'delete' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /operation 'delete' is invalid/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('csv_attachment intake without an attachment waits instead of failing', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantSubteamRequest(
    buildRequestInput({ parsedRequest: { intake_mode: 'csv_attachment', requested_subteams: '' } }),
    buildOptions(registryDir, { issueComments: [] })
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.request_status, 'waiting_for_attachment');
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
});

test('dry-run keeps the request approval-ready with a no-mutation warning', async () => {
  const registryDir = buildRegistry();
  const result = await validateTenantSubteamRequest(
    buildRequestInput({ parsedRequest: { dry_run: 'true' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request.dry_run, true);
  assert.equal(
    result.warnings.some((warning) => /Dry-run is enabled/i.test(warning)),
    true,
    JSON.stringify(result.warnings)
  );
});

test('the subteam CSV normalizer tolerates and ignores a members column', () => {
  const result = normalizeBulkCsvRequestedSubteams('team_name,members\nPayments,octocat;hubot\nPortal Web,\n');

  assert.equal(result.schema_status, 'valid', JSON.stringify(result.schema_errors));
  assert.deepEqual(result.ignored_columns, ['members']);
  assert.deepEqual(result.unsupported_columns, []);
  assert.deepEqual(
    result.normalizedTeams.map((team) => team.normalized_slug),
    ['payments', 'portal-web']
  );
});

test('the subteam CSV normalizer still rejects genuinely unsupported columns', () => {
  const result = normalizeBulkCsvRequestedSubteams('team_name,budget\nPayments,100\n');

  assert.equal(result.schema_status, 'invalid');
  assert.equal(
    result.schema_errors.some((error) => /unsupported columns: budget/i.test(error)),
    true,
    JSON.stringify(result.schema_errors)
  );
});
