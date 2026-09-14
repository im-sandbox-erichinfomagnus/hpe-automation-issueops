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

// 1.0.8: a requester holding no tenant CI/CD role is no longer rejected at intake. The
// authority they lack is exactly what an approval supplies, so the request routes instead.
// What must not change is that plain root-team membership is still not authority on its own.
test('a requester who is only a root-team member is routed to approval rather than authorized', async () => {
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

  assert.equal(result.is_valid, true);
  assert.equal(result.validation_findings.requester_authorization_path, 'none');
  assert.equal(result.validation_findings.requires_approval_routing, true);
  assert.equal(
    result.errors.some((error) => /not an active maintainer of the tenant top team/i.test(error)),
    false,
    JSON.stringify(result.errors)
  );
  assert.equal(
    result.warnings.some((warning) => /not an active maintainer of the tenant top team/i.test(warning)),
    true,
    JSON.stringify(result.warnings)
  );
});

// 1.0.6 approver model: the gate was deliberately root-maintainer-only until Eric
// approved widening it, so this assertion is an intentional flip of the old policy.
test('a cicd-admin team member who is not a root-team maintainer is authorized (1.0.6 widening)', async () => {
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

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(
    result.errors.some((error) => /not an active maintainer of the tenant top team/i.test(error)),
    false,
    JSON.stringify(result.errors)
  );
});

test('a cicd-admin team maintainer who is not a root-team maintainer is authorized', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput({ requesterLogin: 'cicd-team-maintainer' }),
    buildOptions(registryDir, {
      getMembershipForUser: async ({ teamSlug, username }) => {
        if (teamSlug === 'contosouk-cicd-admin' && username === 'cicd-team-maintainer') {
          return { state: 'active', membership: { role: 'maintainer' } };
        }
        return { state: 'absent', membership: null };
      },
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
});

test('a root-team maintainer with no cicd-admin membership is still authorized after the widening', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      getMembershipForUser: async ({ teamSlug, username }) => {
        if (teamSlug === 'contosouk-root' && username === 'tenant-root-maintainer') {
          return { state: 'active', membership: { role: 'maintainer' } };
        }
        return { state: 'absent', membership: null };
      },
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.validation_findings.requester_membership_state, 'active_maintainer');
});

test('the widened gate still withholds authority from a requester in neither team', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput({ requesterLogin: 'unrelated-user' }),
    buildOptions(registryDir, {
      getMembershipForUser: async () => ({ state: 'absent', membership: null }),
    })
  );

  // 1.0.8 routes this requester instead of rejecting them, but it must never mistake them
  // for a role holder: the path stays 'none' and the request waits for an approver.
  assert.equal(result.validation_findings.requester_authorization_path, 'none');
  assert.equal(result.validation_findings.requires_approval_routing, true);
  assert.equal(
    result.warnings.some((warning) => /is not an active member of the tenant CI\/CD admin team/i.test(warning)),
    true,
    JSON.stringify(result.warnings)
  );
});

test('a root-team maintainer can still bootstrap when the cicd-admin team does not exist yet', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      getTeamBySlug: async ({ teamSlug }) => (teamSlug === 'contosouk-root'
        ? { exists: true, team: { id: 101, slug: 'contosouk-root' } }
        : { exists: false, team: null }),
    })
  );

  assert.equal(result.cicd_admin_team_exists, false);
  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.plan.team_action, 'create_team');
});

// The widened gate probes the cicd-admin team even for a requester the pre-1.0.6 gate already
// allowed, so a probe failure must not take that pre-existing authorization away.
function membershipReaderThatFailsOnCicdAdminTeam(rootMaintainerLogin) {
  return async ({ teamSlug, username }) => {
    if (teamSlug === 'contosouk-cicd-admin') {
      throw Object.assign(new Error('Failed to inspect team membership'), { status: 403 });
    }
    if (teamSlug === 'contosouk-root' && username === rootMaintainerLogin) {
      return { state: 'active', membership: { role: 'maintainer' } };
    }
    return { state: 'absent', membership: null };
  };
}

test('a successful cicd-admin probe records no probe error', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput({ requesterLogin: 'cicd-team-member' }),
    buildOptions(registryDir, {
      getMembershipForUser: async ({ teamSlug, username }) => (teamSlug === 'contosouk-cicd-admin' && username === 'cicd-team-member'
        ? { state: 'active', membership: { role: 'member' } }
        : { state: 'absent', membership: null }),
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.validation_findings.requester_authorization_path, 'tenant_cicd_admin_team');
  assert.equal(result.validation_findings.cicd_admin_probe_error, null);
});

test('a root-team maintainer stays authorized when the cicd-admin probe fails', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput(),
    buildOptions(registryDir, {
      getMembershipForUser: membershipReaderThatFailsOnCicdAdminTeam('tenant-root-maintainer'),
    })
  );

  assert.equal(result.is_valid, true, JSON.stringify(result.errors));
  assert.equal(result.validation_findings.requester_authorization_path, 'tenant_admin_maintainer');
  assert.match(result.validation_findings.cicd_admin_probe_error, /Failed to inspect team membership/);
  assert.equal(
    result.warnings.some((warning) => /authorization fell back to tenant top-team maintainership/i.test(warning)),
    true,
    JSON.stringify(result.warnings)
  );
});

test('a requester with no other tenant role is still not authorized when the cicd-admin probe fails', async () => {
  const registryDir = buildRegistry();
  const result = await validateCicdAdminMembershipRequest(
    buildRequestInput({ requesterLogin: 'unrelated-user' }),
    buildOptions(registryDir, {
      getMembershipForUser: membershipReaderThatFailsOnCicdAdminTeam('tenant-root-maintainer'),
    })
  );

  // A probe failure must never be read as authority. 1.0.8 routes the request rather than
  // rejecting it, but the unresolved probe still leaves the requester with no role.
  assert.equal(result.validation_findings.requester_authorization_path, 'none');
  assert.equal(result.validation_findings.requires_approval_routing, true);
  assert.equal(
    result.warnings.some((warning) => /is not an active maintainer of the tenant top team/i.test(warning)),
    true,
    JSON.stringify(result.warnings)
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
