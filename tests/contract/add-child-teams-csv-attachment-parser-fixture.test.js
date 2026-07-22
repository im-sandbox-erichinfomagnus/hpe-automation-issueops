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
    } else if (heading === 'parent team') {
      fields.parent_team = value;
    } else if (heading === 'designated hierarchy approver') {
      fields.designated_approver = value;
    } else if (heading === 'intake mode') {
      fields.intake_mode = value;
    } else if (heading === 'requested child teams') {
      fields.requested_child_teams = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

function loadAttachmentIssueFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-child-teams-csv-attachment-issue.md');
  return parseFixtureMarkdown(fs.readFileSync(fixturePath, 'utf8'));
}

function loadAttachmentCommentsFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-child-teams-csv-attachment-comments.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('attachment parser fixture scaffolding preserves the phase-1 add-child-teams issue form shape', () => {
  const parsedRequest = loadAttachmentIssueFixture();

  assert.equal(parsedRequest.organization, 'octo-org');
  assert.equal(parsedRequest.parent_team, 'Platform Engineering');
  assert.equal(parsedRequest.designated_approver, 'octocat');
  assert.equal(parsedRequest.intake_mode, 'csv_attachment');
  assert.equal(parsedRequest.requested_child_teams, '');
  assert.equal(
    parsedRequest.business_justification,
    'These existing teams should roll up under the parent team to align delegated ownership and hierarchy reporting.'
  );
  assert.equal(parsedRequest.dry_run, 'true');
});

test('attachment parser fixture scaffolding keeps manual child-team textarea empty for csv_attachment mode', () => {
  const markdown = fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'add-child-teams-csv-attachment-issue.md'),
    'utf8'
  );

  assert.match(markdown, /### Intake mode\s+csv_attachment/i);
  assert.match(markdown, /### Requested child teams\s*$/im);
  assert.doesNotMatch(markdown, /bulk csv requested child teams/i);
});

test('attachment fixture discovery selects the newest requester-authored comment candidate', () => {
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: loadAttachmentCommentsFixture(),
  });

  assert.equal(resolution.resolution_status, 'attachment_candidate_selected');
  assert.equal(resolution.candidate.comment_id, 6103);
  assert.equal(resolution.candidate.filename, 'child-teams-corrected.csv');
});

test('attachment fixture discovery respects latest failed validation boundary for candidate selection', () => {
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: loadAttachmentCommentsFixture(),
    latestFailedValidationAt: '2026-05-25T09:06:00Z',
  });

  assert.equal(resolution.resolution_status, 'attachment_candidate_selected');
  assert.equal(resolution.candidate.comment_id, 6103);
  assert.ok(resolution.findings.every((finding) => String(finding.comment_id || '') !== '6101'));
});
