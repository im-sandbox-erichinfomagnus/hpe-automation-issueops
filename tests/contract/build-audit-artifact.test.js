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

test('buildAuditArtifact infers bulk CSV mode for legacy artifacts from raw CSV signals only', () => {
  const artifact = buildAuditArtifact({
    request: {
      organization: 'octo-org',
      intended_owner_login: 'octocat',
      requested_team_names_input: '',
      bulk_csv_input: '```csv\nteam_name\nPlatform Engineering\n```',
      requested_teams: [
        {
          requested_name: 'Platform Engineering',
          normalized_slug: 'platform-engineering',
          source_row_number: 1,
        },
      ],
      csv_row_findings: [
        {
          row_number: 1,
          validation_status: 'valid',
        },
      ],
    },
    runContext: {
      operation: 'team_creation',
    },
  });

  assert.equal(artifact.request.intake_mode, 'bulk_csv');
});

test('buildAuditArtifact infers manual mode from normalized request data when legacy raw inputs are empty', () => {
  const cases = [
    {
      name: 'team creation',
      runContext: { operation: 'team_creation' },
      request: {
        requested_team_names_input: '',
        requested_teams: [{ requested_name: 'Platform Engineering' }],
      },
    },
    {
      name: 'team membership',
      runContext: { operation: 'team_membership' },
      request: {
        requested_people_input: '',
        requested_people: ['octocat'],
      },
    },
    {
      name: 'team hierarchy',
      runContext: { operation: 'team_hierarchy' },
      request: {
        requested_child_teams_input: '',
        requested_child_links: [{ child_team_slug: 'application-platform' }],
      },
    },
    {
      name: 'team repo access',
      runContext: { operation: 'team_repo_access' },
      request: {
        requested_repositories_input: '',
        requested_permission_api_value: 'push',
        requested_repository_grants: [],
      },
    },
  ];

  for (const testCase of cases) {
    const artifact = buildAuditArtifact({
      request: {
        organization: 'octo-org',
        ...testCase.request,
      },
      runContext: testCase.runContext,
    });

    assert.equal(artifact.request.intake_mode, 'manual', testCase.name);
  }
});