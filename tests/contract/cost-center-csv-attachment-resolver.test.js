'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isCsvLink,
  extractAttachmentLinks,
  findLatestCsvAttachmentInComments,
  resolveCostCenterCsvAttachment,
} = require('../../src/workflow-support/resolve-cost-center-csv-attachment');

test('finds a .csv user-attachments link in a comment body', () => {
  const commentBody = [
    'Here are the assignments.',
    '[cost-centers.csv](https://github.com/user-attachments/files/123/cost-centers.csv)',
  ].join('\n');

  const result = resolveCostCenterCsvAttachment({ commentBody });

  assert.ok(result);
  assert.equal(result.attachment_url, 'https://github.com/user-attachments/files/123/cost-centers.csv');
  assert.equal(result.filename, 'cost-centers.csv');
});

test('finds a .csv attachment link in the issue body when no comment is present', () => {
  const issueBody = [
    '### Cost center assignments',
    '',
    '[reorg.csv](https://github.com/octo-org/cost-center-demo/files/9/reorg.csv)',
  ].join('\n');

  const result = resolveCostCenterCsvAttachment({ issueBody });

  assert.ok(result);
  assert.equal(result.attachment_url, 'https://github.com/octo-org/cost-center-demo/files/9/reorg.csv');
  assert.equal(result.filename, 'reorg.csv');
});

test('prefers a comment attachment over an issue-body attachment', () => {
  const commentBody = '[fresh.csv](https://github.com/user-attachments/files/200/fresh.csv)';
  const issueBody = '[stale.csv](https://github.com/user-attachments/files/100/stale.csv)';

  const result = resolveCostCenterCsvAttachment({ commentBody, issueBody });

  assert.ok(result);
  assert.equal(result.attachment_url, 'https://github.com/user-attachments/files/200/fresh.csv');
});

test('ignores non-csv attachments', () => {
  const commentBody = [
    '![screenshot](https://github.com/user-attachments/assets/abc/screenshot.png)',
    '[notes.txt](https://github.com/user-attachments/files/5/notes.txt)',
  ].join('\n');

  assert.equal(resolveCostCenterCsvAttachment({ commentBody }), null);
});

test('returns null when no attachment is present in either source', () => {
  assert.equal(resolveCostCenterCsvAttachment({ commentBody: 'just text', issueBody: 'more text' }), null);
  assert.equal(resolveCostCenterCsvAttachment({}), null);
});

test('findLatestCsvAttachmentInComments picks the newest comment carrying a .csv', () => {
  const comments = [
    { body: 'just discussing', created_at: '2026-05-20T10:00:00Z' },
    {
      body: '[old.csv](https://github.com/user-attachments/files/1/old.csv)',
      created_at: '2026-05-21T10:00:00Z',
    },
    {
      body: '[new.csv](https://github.com/user-attachments/files/2/new.csv)',
      created_at: '2026-05-23T10:00:00Z',
    },
    { body: 'approved', created_at: '2026-05-24T10:00:00Z' },
  ];

  const result = findLatestCsvAttachmentInComments(comments);

  assert.ok(result);
  assert.equal(result.attachment_url, 'https://github.com/user-attachments/files/2/new.csv');
  assert.equal(result.filename, 'new.csv');
});

test('findLatestCsvAttachmentInComments returns null when no comment has a .csv', () => {
  const comments = [
    { body: 'no files here', created_at: '2026-05-20T10:00:00Z' },
    { body: 'approved', created_at: '2026-05-21T10:00:00Z' },
  ];

  assert.equal(findLatestCsvAttachmentInComments(comments), null);
  assert.equal(findLatestCsvAttachmentInComments([]), null);
});

test('isCsvLink and extractAttachmentLinks classify links by extension', () => {
  const links = extractAttachmentLinks(
    '[plan.csv](https://github.com/user-attachments/files/1/plan.csv) and [pic.png](https://example.com/pic.png)'
  );

  const csvLinks = links.filter(isCsvLink);
  assert.equal(csvLinks.length, 1);
  assert.equal(csvLinks[0].filename, 'plan.csv');
});
