'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { deriveApprovedExecutionTerminalState } = require('../../src/scripts/run-approved-execution');

const WORKFLOWS_DIR = path.join(__dirname, '..', '..', '.github', 'workflows');

// Prefixes are spelled out rather than imported, so a wrong entry in
// terminalStateLabelPrefix cannot make this test agree with it.
const OPERATION_WORKFLOWS = [
  ['team_creation', 'create-org-teams.yml', 'issueops:create-org-teams:'],
  ['team_hierarchy', 'add-child-teams.yml', 'issueops:add-child-teams:'],
  ['team_membership', 'add-team-members.yml', 'issueops:add-team-members:'],
  ['team_repo_access', 'add-team-repo-access.yml', 'issueops:add-team-repo-access:'],
  ['team_repo_access_removal', 'remove-team-repo-access.yml', 'issueops:remove-team-repo-access:'],
  ['tenant_creation', 'create-tenant-model.yml', 'issueops:create-tenant:'],
  ['tenant_repo_creation', 'create-tenant-repos.yml', 'issueops:create-tenant-repos:'],
  ['tenant_subteam_creation', 'create-tenant-subteam.yml', 'issueops:create-tenant-subteam:'],
  ['hosted_runner_creation', 'create-tenant-hosted-runner.yml', 'issueops:create-tenant-hosted-runner:'],
  ['hosted_runner_deletion', 'delete-tenant-hosted-runner.yml', 'issueops:delete-tenant-hosted-runner:'],
  ['hosted_runner_move', 'move-tenant-hosted-runner.yml', 'issueops:move-tenant-hosted-runner:'],
  ['runner_group_creation', 'create-tenant-runner-groups.yml', 'issueops:create-tenant-runner-groups:'],
  ['tenant_variable_management', 'manage-tenant-variables.yml', 'issueops:manage-tenant-variables:'],
  ['org_variable_management', 'manage-org-variables.yml', 'issueops:manage-org-variables:'],
  ['repo_admin_membership', 'add-repo-admin-to-tenant.yml', 'issueops:add-repo-admin-to-tenant:'],
  ['cicd_admin_membership', 'add-cicd-admin-to-tenant.yml', 'issueops:add-cicd-admin-to-tenant:'],
  ['repository_ruleset_creation', 'create-repository-ruleset.yml', 'issueops:create-repository-ruleset:'],
  ['repository_ruleset_deletion', 'delete-repository-ruleset.yml', 'issueops:delete-repository-ruleset:'],
];

// run-approved-execution only applies a label the repository already has, and swallows
// the failure, so a workflow must pre-create every status its operation can reach.
function requiredStatuses(operation) {
  const statuses = ['executed', 'partially_executed', 'failed'];
  const totalFailureAfterApproval = deriveApprovedExecutionTerminalState(
    { failure_count: 1, mutation_count: 0, noop_count: 0, pending_count: 0 },
    { operation, intakeMode: 'csv_attachment', approvalStatus: 'approved' },
  );

  if (totalFailureAfterApproval === 'failed_after_approved_execution') {
    statuses.push('failed_after_approved_execution');
  }

  return statuses;
}

for (const [operation, workflow, prefix] of OPERATION_WORKFLOWS) {
  test(`${workflow} pre-creates every terminal state label it can apply`, () => {
    const workflowYaml = fs.readFileSync(path.join(WORKFLOWS_DIR, workflow), 'utf8');

    assert.ok(
      workflowYaml.includes('Ensure terminal state labels exist'),
      `${workflow} is missing the terminal state label creation step`,
    );

    for (const status of requiredStatuses(operation)) {
      assert.ok(
        workflowYaml.includes(`"${prefix}${status}"`),
        `${workflow} must create the label ${prefix}${status}`,
      );
    }
  });
}
