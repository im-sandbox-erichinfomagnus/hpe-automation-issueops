'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateCicdAdminMembershipRequest } = require('../../src/workflow-support/validate-cicd-admin-membership-request');

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
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cicd-admin-registry-'));
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
      cicd_admin_operation: 'add',
      intake_mode: 'manual',
      requested_people: 'octocat\nhubot',
      designated_approver: 'org-owner-user',
      dry_run: 'false',
      business_justification: 'These engineers manage the tenant runner fleet.',
      ...overrides.parsedRequest,
    },
    issue: {
      number: 430,
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
        role: username === 'org-owner-user' ? 'admin' : 'member',
        state: 'active',
      },
    }),
    ...overrides,
  };
}

test('valid add request by a tenant root-team maintainer becomes approval-ready', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(buildRequestInput(), buildOptions(registryDir));

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.request_status, 'awaiting_approval');
  assert.equal(result.request.cicd_admin_team_slug, 'contosouk-cicd-admin');
  assert.equal(result.request.tenant_team_slug, 'contosouk-root');
  assert.equal(result.cicd_admin_team_exists, false);
  assert.equal(result.plan.team_action, 'create_team');
  assert.equal(result.requested_people.length, 2);
  assert.equal(result.requested_people[0].desired_action, 'add_member');
  assert.match(result.request.context_marker, /^cicd-admin-membership-context:/);
});

test('an existing cicd-admin team is planned as a noop team action', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      getTeamBySlug: async ({ teamSlug }) => {
        if (teamSlug === 'contosouk-root') {
          return { exists: true, team: { id: 101, slug: 'contosouk-root' } };
        }
        if (teamSlug === 'contosouk-cicd-admin') {
          return { exists: true, team: { id: 202, slug: 'contosouk-cicd-admin' } };
        }
        return { exists: false, team: null };
      },
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.cicd_admin_team_exists, true);
  assert.equal(result.plan.team_action, 'noop');
});

test('a requester who is only a root-team member is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      getMembershipForUser: async ({ teamSlug, username }) => {
        if (teamSlug === 'contosouk-root' && username === 'tenant-root-maintainer') {
          return { state: 'active', membership: { role: 'member' } };
        }
        return { state: 'absent', membership: null };
      },
    })
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /not an active maintainer of the tenant top team/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('a cicd-admin team member who is not a root-team maintainer is rejected (stricter than the variables OR-gate)', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput({ requesterLogin: 'cicd-team-member' }),
    buildOptions(registryDir, {
      getMembershipForUser: async ({ teamSlug, username }) => {
        if (teamSlug === 'contosouk-cicd-admin' && username === 'cicd-team-member') {
          return { state: 'active', membership: { role: 'member' } };
        }
        return { state: 'absent', membership: null };
      },
    })
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /not an active maintainer of the tenant top team/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('an unknown tenant is rejected with available tenant names', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput({ parsedRequest: { tenant_name: 'DoesNotExist' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /No tenant record was found for tenant name 'DoesNotExist'/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('a designated approver who is not an org owner is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput({ parsedRequest: { designated_approver: 'regular-member' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /Designated approver must be an active target organization owner/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('an invalid cicd admin operation is rejected', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput({ parsedRequest: { cicd_admin_operation: 'remove' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /operation 'remove' is invalid/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('invalid usernames are rejected in manual intake', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput({ parsedRequest: { requested_people: 'octocat\n-bad-login-' } }),
    buildOptions(registryDir)
  );

  assert.equal(result.is_valid, false);
  assert.equal(
    result.errors.some((error) => /Invalid GitHub usernames/i.test(error)),
    true,
    JSON.stringify(result.errors)
  );
});

test('csv_attachment intake without an attachment waits instead of failing', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput({ parsedRequest: { intake_mode: 'csv_attachment', requested_people: '' } }),
    buildOptions(registryDir, { issueComments: [] })
  );

  assert.equal(result.is_valid, false);
  assert.equal(result.request_status, 'waiting_for_attachment');
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
});

test('dry-run keeps the request approval-ready with a no-mutation warning', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
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
