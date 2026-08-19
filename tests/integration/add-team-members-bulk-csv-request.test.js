'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { formatAuditSummary } = require('../../src/scripts/emit-audit-summary');
const { buildAuditArtifact } = require('../../src/workflow-support/build-audit-artifact');
const { parseTeamMembershipRequest } = require('../../src/workflow-support/parse-team-membership-request');
const { runApprovedExecution } = require('../../src/scripts/run-approved-execution');
const { validateTeamMembershipRequest } = require('../../src/workflow-support/validate-team-membership-request');

function loadFixtureMarkdown() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-members-bulk-csv-issue.md');
  return fs.readFileSync(fixturePath, 'utf8');
}

function writeArtifact(artifact) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issueops-bulk-csv-'));
  const artifactPath = path.join(tempDir, 'artifact.json');
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  return artifactPath;
}

test('bulk CSV integration scaffold stays aligned to the single-team dry-run scenario', () => {
  const markdown = loadFixtureMarkdown();

  assert.match(markdown, /### Team slug\s+platform-engineering/i);
  assert.match(markdown, /### Bulk CSV requested people/i);
  assert.match(markdown, /```csv\s+username\s+octocat\s+hubot\s+```/i);
  assert.match(markdown, /### Dry-run mode\s+true/i);
});

test('approved bulk CSV requests execute through the existing membership flow and keep CSV metadata visible', async () => {
  const artifactPath = writeArtifact({
    request: {
      request_id: 'octo-org/issueops-speckit#401/1',
      issue_number: 401,
      repository: 'octo-org/issueops-speckit',
      requester_login: 'requester',
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      intake_mode: 'bulk_csv',
      requested_people: ['octocat', 'hubot'],
      bulk_csv_submission: {
        valid_row_count: 2,
        duplicate_row_count: 1,
        invalid_row_count: 0,
      },
      csv_row_findings: [
        { row_number: 1, username: 'octocat', validation_status: 'valid', failure_reason: null },
        { row_number: 2, username: 'hubot', validation_status: 'valid', failure_reason: null },
        { row_number: 3, username: 'octocat', validation_status: 'duplicate', failure_reason: 'duplicate_username' },
      ],
      csv_row_numbering_convention: '1-based data-row numbers that exclude the header row',
      request_status: 'approved',
      dry_run: false,
      submitted_at: '2026-05-19T10:00:00Z',
    },
    validation: {
      is_valid: true,
      errors: [],
      warnings: ['CSV row 3 duplicates username octocat and was deduplicated.'],
      team_exists: true,
      team_sync_blocked: false,
      csv_row_findings: [
        { row_number: 1, username: 'octocat', validation_status: 'valid', failure_reason: null },
        { row_number: 2, username: 'hubot', validation_status: 'valid', failure_reason: null },
        { row_number: 3, username: 'octocat', validation_status: 'duplicate', failure_reason: 'duplicate_username' },
      ],
      requested_people: [
        {
          username: 'octocat',
          source_row_number: 1,
          resolution_status: 'resolved',
          current_membership_state: 'unknown',
          desired_action: 'add_member',
          execution_result: 'not_started',
          failure_reason: null,
        },
        {
          username: 'hubot',
          source_row_number: 2,
          resolution_status: 'resolved',
          current_membership_state: 'unknown',
          desired_action: 'add_member',
          execution_result: 'not_started',
          failure_reason: null,
        },
      ],
    },
    approval: {
      approval_status: 'approved',
      approver_login: 'org-owner-user',
      approver_role: 'org_owner',
      approved_at: '2026-05-19T10:15:00Z',
      decision_source: 'comment',
      decision_note: 'The approval comment approved was added by an active organization member.',
    },
    reconciliation: {
      current_members: [],
      people_to_add: [],
      people_already_present: [],
      people_rejected: [],
      dry_run: false,
      rate_limit_snapshot: null,
    },
    execution: {
      mutation_count: 0,
      noop_count: 0,
      pending_count: 0,
      failure_count: 0,
      rollback_status: 'not_needed',
      summary: 'Request approval was granted by an active organization member. No membership mutation was attempted in this phase.',
    },
    metadata: {
      operation: 'team_membership',
      run_id: '900',
      run_attempt: '1',
      generated_at: '2026-05-19T10:15:00Z',
    },
  });

  const result = await runApprovedExecution({
    env: { AUDIT_ARTIFACT_PATH: artifactPath },
    tokenInfo: { token: 'test-token' },
    createApi: () => ({
      listTeamMembers: async () => [{ login: 'octocat', state: 'active' }],
      addOrUpdateTeamMembership: async ({ username }) => ({ username, state: 'active', role: 'member' }),
    }),
  });

  const persisted = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const summary = formatAuditSummary(persisted);

  assert.equal(result.request.request_status, 'executed');
  assert.equal(persisted.request.intake_mode, 'bulk_csv');
  assert.equal(persisted.execution.duplicate_row_count, 1);
  assert.equal(persisted.execution.invalid_row_count, 0);
  assert.match(summary, /Intake mode: bulk_csv/i);
  assert.match(summary, /CSV duplicate rows: 1/i);
  assert.match(summary, /Added: 1/i);
  assert.match(summary, /No-op: 1/i);
  assert.deepEqual(
    persisted.reconciliation.people_to_add.map((entry) => entry.source_row_number),
    [2]
  );
  assert.deepEqual(
    persisted.reconciliation.people_already_present.map((entry) => entry.source_row_number),
    [1]
  );
});

test('bulk CSV textarea requests are rejected before reconciliation begins', async () => {
  const parsedRequest = parseTeamMembershipRequest({
    parsedRequest: {
      organization: 'octo-org',
      team_slug: 'platform-engineering',
      requested_people: '',
      bulk_csv_requested_people: '```csv\nusername\noctocat\nhubot\n```',
      business_justification: 'Need support access',
      dry_run: 'false',
    },
    issue: { number: 402, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  const validation = await validateTeamMembershipRequest(parsedRequest, {
    getTeam: async () => ({ exists: true, team_sync_blocked: false }),
    resolveUser: async () => ({ exists: true }),
  });

  assert.equal(validation.is_valid, false);
  assert.equal(validation.request_status, 'validation_failed');
  assert.deepEqual(validation.requested_people, []);
  assert.match(validation.errors.join('\n'), /bulk csv textarea intake is no longer supported/i);
});