'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { resolveCsvAttachmentComment } = require('../../src/workflow-support/resolve-csv-attachment-comment');

function parseFixtureMarkdown(markdown) {
  const fields = {};
  const sections = markdown.split(/^###\s+/m).filter(Boolean);

  for (const section of sections) {
    const [rawHeading, ...rest] = section.split('\n');
    const value = rest.join('\n').trim();
    const heading = rawHeading.trim().toLowerCase();

    if (heading === 'target organization') {
      fields.organization = value;
    } else if (heading === 'intended owner') {
      fields.intended_owner = value;
    } else if (heading === 'intake mode') {
      fields.intake_mode = value;
    } else if (heading === 'requested team names') {
      fields.requested_team_names = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

function loadAttachmentIssueFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-org-teams-csv-attachment-issue.md');
  return parseFixtureMarkdown(fs.readFileSync(fixturePath, 'utf8'));
}

function loadAttachmentCommentsFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'create-org-teams-csv-attachment-comments.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('attachment parser fixture scaffolding preserves the phase-1 issue form shape', () => {
  const parsedRequest = loadAttachmentIssueFixture();

  assert.equal(parsedRequest.organization, 'octo-org');
  assert.equal(parsedRequest.intended_owner, 'platform-owner');
  assert.equal(parsedRequest.intake_mode, 'csv_attachment');
  assert.equal(parsedRequest.requested_team_names, '');
  assert.equal(
    parsedRequest.business_justification,
    'Create the requested teams to support the platform rollout.'
  );
  assert.equal(parsedRequest.dry_run, 'true');
});

test('attachment parser fixture scaffolding keeps the request comment-driven rather than textarea-csv-driven', () => {
  const markdown = fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'create-org-teams-csv-attachment-issue.md'),
    'utf8'
  );

  assert.match(markdown, /### Intake mode\s+csv_attachment/i);
  assert.match(markdown, /### Requested team names\s*$/im);
  assert.doesNotMatch(markdown, /bulk csv requested team names/i);
});

test('attachment fixture discovery selects the newest requester-authored attachment comment after a failed validation boundary', () => {
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: loadAttachmentCommentsFixture(),
    latestFailedValidationAt: '2026-05-22T09:06:00Z',
  });

  assert.equal(resolution.resolution_status, 'attachment_candidate_selected');
  assert.equal(resolution.candidate.comment_id, 6103);
  assert.equal(resolution.candidate.filename, 'team-creation-corrected.csv');
});

test('attachment discovery skips non-requester comments and selects only requester-authored attachments', () => {
  const comments = loadAttachmentCommentsFixture();
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: comments,
  });

  assert.equal(resolution.resolution_status, 'attachment_candidate_selected');
  assert.notEqual(resolution.candidate.comment_id, 6102);
  assert.equal(resolution.candidate.uploader_login, 'requester');
});

test('attachment discovery returns waiting_for_attachment when no requester comments contain attachments', () => {
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: [
      { id: 9001, created_at: '2026-05-22T10:00:00Z', body: 'Just a plain text comment.', user: { login: 'requester' } },
    ],
  });

  assert.equal(resolution.resolution_status, 'waiting_for_attachment');
  assert.equal(resolution.candidate, null);
});

test('attachment discovery captures linked-URL discovery-source evidence in findings', () => {
  const comments = loadAttachmentCommentsFixture();
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: comments,
  });

  assert.ok(resolution.findings.length > 0);
  const requesterFinding = resolution.findings.find((f) => f.comment_id === 6101);
  assert.ok(requesterFinding);
  assert.ok(requesterFinding.attachment_links.length > 0);
  assert.ok(requesterFinding.attachment_links[0].url);
});