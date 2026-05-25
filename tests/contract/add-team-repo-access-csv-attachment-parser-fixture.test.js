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
    } else if (heading === 'target team') {
      fields.target_team = value;
    } else if (heading === 'designated repository-access approver') {
      fields.designated_approver = value;
    } else if (heading === 'intake mode') {
      fields.intake_mode = value;
    } else if (heading === 'requested repositories') {
      fields.requested_repositories = value;
    } else if (heading === 'requested permission level') {
      fields.permission_level = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

function loadAttachmentIssueFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-repo-access-csv-attachment-issue.md');
  return parseFixtureMarkdown(fs.readFileSync(fixturePath, 'utf8'));
}

function loadAttachmentCommentsFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-team-repo-access-csv-attachment-comments.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('attachment parser fixture scaffold preserves the phase-1 add-team-repo-access issue form shape', () => {
  const parsedRequest = loadAttachmentIssueFixture();

  assert.equal(parsedRequest.organization, 'octo-org');
  assert.equal(parsedRequest.target_team, 'Platform Engineering');
  assert.equal(parsedRequest.designated_approver, 'octocat');
  assert.equal(parsedRequest.intake_mode, 'csv_attachment');
  assert.equal(parsedRequest.requested_repositories, '');
  assert.equal(parsedRequest.permission_level, 'write');
  assert.match(parsedRequest.business_justification, /attachment-driven intake/i);
  assert.equal(parsedRequest.dry_run, 'true');
});

test('attachment parser fixture scaffold keeps manual repository textarea empty for csv_attachment mode', () => {
  const markdown = fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'add-team-repo-access-csv-attachment-issue.md'),
    'utf8'
  );

  assert.match(markdown, /### Intake mode\s+csv_attachment/i);
  assert.match(markdown, /### Requested repositories\s*$/im);
});

test('attachment comments fixture preserves requester correction ordering and approval event', () => {
  const comments = loadAttachmentCommentsFixture();

  assert.equal(comments.length, 6);
  assert.equal(comments[0].user.login, 'other-user');
  assert.match(comments[1].body, /repo-access\.txt/i);
  assert.match(comments[4].body, /repo-access-corrected\.csv/i);
  assert.equal(comments[5].body, 'approved');
});

test('attachment parser fixture discovers newest requester CSV candidate after prior failed attempt', () => {
  const comments = loadAttachmentCommentsFixture();
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: comments,
    latestFailedValidationAt: '2026-05-25T10:06:00Z',
  });

  assert.equal(resolution.resolution_status, 'attachment_candidate_selected');
  assert.equal(resolution.candidate.comment_id, 9105);
  assert.match(resolution.candidate.attachment_url, /repo-access-corrected\.csv/i);
});

test('attachment parser fixture fails closed on ambiguous requester CSV comment set', () => {
  const comments = loadAttachmentCommentsFixture().filter((comment) => comment.id <= 9103);
  const resolution = resolveCsvAttachmentComment({
    requesterLogin: 'requester',
    issueComments: comments,
  });

  assert.equal(resolution.resolution_status, 'attachment_rejected');
  assert.equal(resolution.candidate.rejection_reason, 'ambiguous_attachment_set');
  assert.equal(resolution.candidate.comment_id, 9103);
});
