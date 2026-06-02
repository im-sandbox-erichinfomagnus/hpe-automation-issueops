'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAuditArtifact,
  determineOperation,
  inferRequestIntakeMode,
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

test('inferRequestIntakeMode classifies team_repo_access bulk CSV when only normalized grants are present', () => {
  const intakeMode = inferRequestIntakeMode({
    organization: 'octo-org',
    requested_team_slug: 'platform-engineering',
    requested_repositories_input: '',
    requested_permission_api_value: 'push',
    requested_repository_grants: [
      {
        repository_name: 'service-catalog',
        permission: 'push',
      },
    ],
    bulk_csv_submission: {
      schema_status: 'valid',
    },
  }, 'team_repo_access');

  assert.equal(intakeMode, 'bulk_csv');
});