'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  cicdAuthorizationPath,
  resolveTenantCicdContextFromRegistry,
} = require('../../src/workflow-support/resolve-tenant-cicd-context-from-registry');
const { validateCicdAdminMembershipRequest } = require('../../src/workflow-support/validate-cicd-admin-membership-request');
const { validateRepoAdminMembershipRequest } = require('../../src/workflow-support/validate-repo-admin-membership-request');

function membership(state, role) {
  return { state, membership: role ? { role } : null };
}

function buildRegistry(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(directory, 'contosouk.json'), JSON.stringify({
    tenantId: 'contosouk',
    tenantName: 'ContosoUK',
    tenantType: 'application',
    organization: 'octo-org',
    topology: {
      organization: { orgName: 'octo-org' },
      teams: {
        tenantRootTeam: 'contosouk-root',
        structure: [
          { team: 'contosouk-root', parent: null, type: 'root' },
          { team: 'contosouk-admin', parent: 'contosouk-root', type: 'admin' },
          { team: 'contosouk-repo-admin', parent: 'contosouk-root', type: 'repo-admin' },
          { team: 'contosouk-cicd-admin', parent: 'contosouk-root', type: 'cicd-admin' },
        ],
      },
    },
  }, null, 2), 'utf8');
  return directory;
}

// ---------------------------------------------------------------- helper mapping

test('cicdAuthorizationPath maps the cicd-admin match to the tenant cicd-admin team path', () => {
  assert.equal(cicdAuthorizationPath('cicd-admin'), 'tenant_cicd_admin_team');
});

test('cicdAuthorizationPath maps the admin-team match to the tenant admin maintainer path', () => {
  assert.equal(cicdAuthorizationPath('admin'), 'tenant_admin_maintainer');
});

test('cicdAuthorizationPath maps anything else to none', () => {
  assert.equal(cicdAuthorizationPath(null), 'none');
  assert.equal(cicdAuthorizationPath(undefined), 'none');
  assert.equal(cicdAuthorizationPath(''), 'none');
  assert.equal(cicdAuthorizationPath('repo-admin'), 'none');
});

// ------------------------------------------- resolver (source for the 4 runner ops)

async function resolveContext(map) {
  const registryDirectory = buildRegistry('auth-path-resolver-');
  return resolveTenantCicdContextFromRegistry({
    organization: 'octo-org',
    tenant_name_input: 'ContosoUK',
    requester_login: 'req-user',
  }, {
    registryDirectory,
    registryRef: 'main',
    listTeams: async () => [
      { slug: 'contosouk-root' },
      { slug: 'contosouk-admin' },
      { slug: 'contosouk-cicd-admin' },
    ],
    getMembershipForUser: async ({ teamSlug }) => map[teamSlug] || { state: 'absent', membership: null },
  });
}

test('the tenant cicd context stamps the cicd-admin authorization path for a CI/CD admin team member', async () => {
  const resolved = await resolveContext({ 'contosouk-cicd-admin': membership('active', 'member') });

  assert.equal(resolved.resolved_context.requester_authorization_path, 'tenant_cicd_admin_team');
});

test('the tenant cicd context stamps the admin-maintainer path when only the admin team matches', async () => {
  const resolved = await resolveContext({ 'contosouk-admin': membership('active', 'member') });

  assert.equal(resolved.resolved_context.requester_authorization_path, 'tenant_admin_maintainer');
});

// ---------------------------------------------------------------- add-cicd-admin

async function cicdFindings(map, login) {
  const registryDirectory = buildRegistry('auth-path-cicd-');
  const result = await validateCicdAdminMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      cicd_admin_operation: 'add',
      intake_mode: 'manual',
      requested_people: 'octocat',
      dry_run: 'false',
      business_justification: 'These engineers manage the tenant runner fleet.',
    },
    issue: { number: 430, user: { login: login || 'req-user' } },
  }, {
    registryDirectory,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    getTeamBySlug: async ({ teamSlug }) => (teamSlug === 'contosouk-root'
      ? { exists: true, team: { id: 101, slug: teamSlug } }
      : { exists: false, team: null }),
    getMembershipForUser: async ({ teamSlug }) => map[teamSlug] || { state: 'absent', membership: null },
    getOrganizationMembership: async () => ({ exists: true, membership: { role: 'member', state: 'active' } }),
  });
  return result.validation_findings;
}

test('add-cicd-admin stamps the cicd-admin team path for a CI/CD admin team member', async () => {
  const findings = await cicdFindings({ 'contosouk-cicd-admin': membership('active', 'member') });

  assert.equal(findings.requester_authorization_path, 'tenant_cicd_admin_team');
  assert.equal(findings.requester_cicd_membership_state, 'active_member');
});

test('add-cicd-admin stamps the admin maintainer path for a root-team maintainer', async () => {
  const findings = await cicdFindings({ 'contosouk-root': membership('active', 'maintainer') });

  assert.equal(findings.requester_authorization_path, 'tenant_admin_maintainer');
});

test('add-cicd-admin stamps none when the requester holds no tenant role', async () => {
  const findings = await cicdFindings({});

  assert.equal(findings.requester_authorization_path, 'none');
});

// ---------------------------------------------------------------- add-repo-admin

async function repoFindings(map, login) {
  const registryDirectory = buildRegistry('auth-path-repo-');
  const result = await validateRepoAdminMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      tenant_name: 'ContosoUK',
      repo_admin_operation: 'add',
      intake_mode: 'manual',
      requested_people: 'octocat',
      dry_run: 'false',
      business_justification: 'These engineers manage repository creation for the tenant.',
    },
    issue: { number: 440, user: { login: login || 'req-user' } },
  }, {
    registryDirectory,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    getTeamBySlug: async ({ teamSlug }) => (teamSlug === 'contosouk-root' || teamSlug === 'contosouk-repo-admin'
      ? { exists: true, team: { id: 101, slug: teamSlug } }
      : { exists: false, team: null }),
    getMembershipForUser: async ({ teamSlug }) => map[teamSlug] || { state: 'absent', membership: null },
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: { role: username === 'org-owner-user' ? 'admin' : 'member', state: 'active' },
    }),
  });
  return result.validation_findings;
}

test('add-repo-admin stamps the repo-admin team path for a repo admin team member', async () => {
  const findings = await repoFindings({ 'contosouk-repo-admin': membership('active', 'member') });

  assert.equal(findings.requester_authorization_path, 'tenant_repo_admin_team');
  assert.equal(findings.requester_repo_admin_membership_state, 'active_member');
});

test('add-repo-admin stamps the admin maintainer path for a root-team maintainer', async () => {
  const findings = await repoFindings({ 'contosouk-root': membership('active', 'maintainer') });

  assert.equal(findings.requester_authorization_path, 'tenant_admin_maintainer');
});

test('add-repo-admin stamps the org owner path for an organization owner with no tenant team role', async () => {
  const findings = await repoFindings({}, 'org-owner-user');

  assert.equal(findings.requester_authorization_path, 'org_owner');
});

test('add-repo-admin stamps none when the requester holds no role at all', async () => {
  const findings = await repoFindings({});

  assert.equal(findings.requester_authorization_path, 'none');
});
