'use strict';

// End-to-end stamping coverage for the four runner validators. These drive the real validator
// (no injected findings), which is the seam that let the canonical-context omission ship.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateHostedRunnerRequest } = require('../../src/workflow-support/validate-hosted-runner-request');
const { validateHostedRunnerDeletionRequest } = require('../../src/workflow-support/validate-hosted-runner-deletion-request');
const { validateHostedRunnerMoveRequest } = require('../../src/workflow-support/validate-hosted-runner-move-request');
const { validateRunnerGroupRequest } = require('../../src/workflow-support/validate-runner-group-request');

function buildRegistry() {
  const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-auth-path-'));
  fs.writeFileSync(path.join(registryDir, 'contosouk.json'), JSON.stringify({
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
      runnerTopology: { runnerGroups: [] },
      accessModel: { enforcement: 'tenant-boundary', roles: ['tenant-admin', 'repo-admin', 'developer', 'viewer'] },
    },
  }, null, 2), 'utf8');
  return registryDir;
}

// CAM: active in the tenant cicd-admin team and nothing else.
function camMembership({ teamSlug, username }) {
  if (teamSlug === 'contosouk-cicd-admin' && username === 'tenant-cicd-admin') {
    return Promise.resolve({ state: 'active', membership: { role: 'member' } });
  }
  return Promise.resolve({ state: 'absent', membership: null });
}

function noMembership() {
  return Promise.resolve({ state: 'absent', membership: null });
}

function buildOptions(registryDir, membershipReader) {
  return {
    registryDirectory: registryDir,
    registryRef: 'main',
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { slug: 'contosouk-root', parent: null },
      { slug: 'contosouk-admin', parent: { slug: 'contosouk-root' } },
      { slug: 'contosouk-repo-admin', parent: { slug: 'contosouk-root' } },
      { slug: 'contosouk-cicd-admin', parent: { slug: 'contosouk-root' } },
    ]),
    getMembershipForUser: membershipReader,
    getOrganizationMembership: async ({ username }) => ({
      exists: true,
      membership: { role: username === 'org-owner-user' ? 'admin' : 'member', state: 'active' },
    }),
    listHostedRunners: async () => ([
      { id: 55, name: 'ContosoUK_ubuntu-build', runner_group_id: 1 },
    ]),
    listRunnerGroups: async () => ([
      { id: 1, name: 'Default', default: true, visibility: 'all' },
      { id: 7, name: 'ContosoUK_Builders', default: false, visibility: 'selected' },
    ]),
  };
}

function issueFor(login) {
  return { number: 320, user: { login } };
}

const BASE = {
  organization: 'octo-org',
  tenant_name: 'ContosoUK',
  designated_approver: 'org-owner-user',
  dry_run: 'true',
  justification: 'CI capacity for the tenant.',
};

const OPERATIONS = [
  {
    name: 'create-tenant-hosted-runner',
    run: (login, options) => validateHostedRunnerRequest({
      parsedRequest: {
        ...BASE,
        runner_name: 'ubuntu-build',
        runner_image_id: 'ubuntu-24.04',
        runner_image_source: 'github',
        runner_size: '4-core',
      },
      issue: issueFor(login),
    }, options),
  },
  {
    name: 'delete-tenant-hosted-runner',
    run: (login, options) => validateHostedRunnerDeletionRequest({
      parsedRequest: { ...BASE, runner_name: 'ubuntu-build' },
      issue: issueFor(login),
    }, options),
  },
  {
    name: 'move-tenant-hosted-runner',
    run: (login, options) => validateHostedRunnerMoveRequest({
      parsedRequest: {
        ...BASE,
        runner_name: 'ubuntu-build',
        hosted_runner_id: '',
        target_runner_group_name: 'ContosoUK_Builders',
      },
      issue: issueFor(login),
    }, options),
  },
  {
    name: 'create-tenant-runner-groups',
    run: (login, options) => validateRunnerGroupRequest({
      parsedRequest: { ...BASE, runner_group_name: 'Builders' },
      issue: issueFor(login),
    }, options),
  },
];

for (const operation of OPERATIONS) {
  test(`${operation.name} stamps tenant_cicd_admin_team for a CI/CD admin team member`, async () => {
    const registryDir = buildRegistry();
    const result = await operation.run('tenant-cicd-admin', buildOptions(registryDir, camMembership));

    assert.equal(
      result.validation_findings.requester_authorization_path,
      'tenant_cicd_admin_team',
      JSON.stringify(result.validation_findings)
    );
  });

  test(`${operation.name} stamps none when the requester holds no tenant CI/CD role`, async () => {
    const registryDir = buildRegistry();
    const result = await operation.run('unrelated-user', buildOptions(registryDir, noMembership));

    assert.equal(
      result.validation_findings.requester_authorization_path,
      'none',
      JSON.stringify(result.validation_findings)
    );
  });
}
