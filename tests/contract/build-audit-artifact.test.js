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