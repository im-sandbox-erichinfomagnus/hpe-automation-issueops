'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAuditArtifact,
  determineOperation,
} = require('../../src/workflow-support/build-audit-artifact');

test('determineOperation keeps team creation classification when normalized empty arrays are present', () => {
  const operation = determineOperation({
    organization: 'octo-org',
    intended_owner_login: 'octocat',
    requested_teams: [
      {
        requested_name: 'Platform Engineering',
        normalized_slug: 'platform-engineering',
      },
    ],
    requested_repository_grants: [],
    requested_child_links: [],
    duplicate_repositories: [],
    conflicting_repositories: [],
    invalid_repositories: [],
  });

  assert.equal(operation, 'team_creation');
});

test('buildAuditArtifact preserves an explicit prior operation during artifact rewrites', () => {
  const artifact = buildAuditArtifact({
    request: {
      organization: 'octo-org',
      intended_owner_login: 'octocat',
      requested_teams: [
        {
          requested_name: 'Platform Engineering',
          normalized_slug: 'platform-engineering',
        },
      ],
      requested_repository_grants: [],
      requested_child_links: [],
    },
    runContext: {
      operation: 'team_creation',
      run_id: '123',
      run_attempt: '1',
    },
  });

  assert.equal(artifact.metadata.operation, 'team_creation');
});

test('buildAuditArtifact preserves tenant repo visibility intent and actual visibility', () => {
  const artifact = buildAuditArtifact({
    request: {
      organization: 'octo-org',
      repository: 'octo-org/issueops-speckit',
      repository_name_input: 'acme-platform-service',
      repository_name_normalized: 'acme-platform-service',
      repository_visibility: 'internal',
      repository_visibility_source: 'user_selected',
    },
    reconciliationPlan: {
      repository_full_name: 'octo-org/acme-platform-service',
      requested_visibility: 'internal',
      existing_visibility: null,
      actual_visibility: 'internal',
      desired_repository_visibility: 'internal',
      visibility_conflict: false,
      creation_action: 'create_repository',
      permission_action: 'grant_admin',
      state: 'approved_for_execution',
    },
    runContext: {
      operation: 'tenant_repo_creation',
      run_id: '123',
      run_attempt: '1',
    },
  });

  assert.equal(artifact.metadata.operation, 'tenant_repo_creation');
  assert.equal(artifact.reconciliation.requested_visibility, 'internal');
  assert.equal(artifact.reconciliation.actual_visibility, 'internal');
  assert.equal(artifact.reconciliation.visibility_conflict, false);
});