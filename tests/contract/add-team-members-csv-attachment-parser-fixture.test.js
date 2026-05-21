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
    } else if (heading === 'team slug') {
      fields.team_slug = value;
    } else if (heading === 'intake mode') {
      fields.intake_mode = value;
    } else if (heading === 'requested people') {
      fields.requested_people = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

function loadAttachmentIssueFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-members-csv-attachment-issue.md');
  return parseFixtureMarkdown(fs.readFileSync(fixturePath, 'utf8'));
}

function loadAttachmentCommentsFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-members-csv-attachment-comments.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('attachment parser fixture scaffolding preserves the phase-1 issue form shape', () => {
  const parsedRequest = loadAttachmentIssueFixture();

  assert.equal(parsedRequest.organization, 'octo-org');
  assert.equal(parsedRequest.team_slug, 'platform-engineering');
  assert.equal(parsedRequest.intake_mode, 'csv_attachment');
  assert.equal(parsedRequest.requested_people, '');
  assert.equal(
    parsedRequest.business_justification,
    'Access is required to support the release pipeline.'
  );
  assert.equal(parsedRequest.dry_run, 'true');
});

test('attachment parser fixture scaffolding keeps the request single-team and comment-driven', () => {
  const markdown = fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'add-team-members-csv-attachment-issue.md'),
    'utf8'
  );

  assert.match(markdown, /### Intake mode\s+csv_attachment/i);
  assert.match(markdown, /### Requested people\s*$/im);
  assert.doesNotMatch(markdown, /bulk csv requested people/i);
});

test('attachment fixture discovery selects the newest requester-authored attachment comment', () => {
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: loadAttachmentCommentsFixture(),
  });

  assert.equal(resolution.resolution_status, 'attachment_candidate_selected');
  assert.equal(resolution.candidate.comment_id, 5103);
  assert.equal(resolution.candidate.filename, 'team-members-corrected.csv');
});

test('attachment fixture discovery selects only requester comments after the latest failed validation boundary', () => {
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: loadAttachmentCommentsFixture(),
    latestFailedValidationAt: '2026-05-21T10:06:00Z',
  });

  assert.equal(resolution.resolution_status, 'attachment_candidate_selected');
  assert.equal(resolution.candidate.comment_id, 5103);
  assert.ok(resolution.findings.every((finding) => String(finding.comment_id || '') !== '5101'));
});