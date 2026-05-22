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

test('buildAuditArtifact ignores empty fenced bulk CSV input when inferring intake mode', () => {
  const artifact = buildAuditArtifact({
    request: {
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requested_people_input: 'octocat',
      bulk_csv_input: '```csv\n\n```',
      csv_row_findings: [],
      bulk_csv_submission: {
        schema_status: 'not_provided',
      },
    },
  });

  assert.equal(artifact.request.intake_mode, 'manual');
});

test('buildAuditArtifact preserves an explicitly ambiguous intake mode', () => {
  const artifact = buildAuditArtifact({
    request: {
      organization: 'octo-org',
      intended_owner_login: 'octocat',
      intake_mode: null,
      bulk_csv_input: '```csv\nteam_name\nPlatform Engineering\n```',
      requested_teams: [
        {
          requested_name: 'Platform Engineering',
          normalized_slug: 'platform-engineering',
        },
      ],
    },
  });

  assert.equal(artifact.request.intake_mode, null);
});