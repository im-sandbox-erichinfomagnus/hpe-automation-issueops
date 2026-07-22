'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeContact } = require('../../src/workflow-support/normalize-contact');

test('normalizeContact accepts valid bare GitHub handle', () => {
  assert.deepEqual(normalizeContact('octocat'), {
    normalized: 'octocat',
    type: 'handle',
  });
});

test('normalizeContact accepts valid @-prefixed GitHub handle', () => {
  assert.deepEqual(normalizeContact('@OctoCat'), {
    normalized: 'octocat',
    type: 'handle',
  });
});

test('normalizeContact rejects handle with leading hyphen', () => {
  assert.deepEqual(normalizeContact('-octocat'), {
    normalized: '-octocat',
    type: 'invalid',
  });
});

test('normalizeContact rejects handle with trailing hyphen', () => {
  assert.deepEqual(normalizeContact('octocat-'), {
    normalized: 'octocat-',
    type: 'invalid',
  });
});

test('normalizeContact rejects handle over 39 characters', () => {
  const tooLong = 'a'.repeat(40);
  assert.deepEqual(normalizeContact(tooLong), {
    normalized: tooLong,
    type: 'invalid',
  });
});

test('normalizeContact rejects handle containing spaces', () => {
  assert.deepEqual(normalizeContact('octo cat'), {
    normalized: 'octo cat',
    type: 'invalid',
  });
});

test('normalizeContact accepts email with plus alias', () => {
  assert.deepEqual(normalizeContact('alice+repo@example.com'), {
    normalized: 'alice+repo@example.com',
    type: 'email',
  });
});

test('normalizeContact rejects email without domain', () => {
  assert.deepEqual(normalizeContact('alice@'), {
    normalized: 'alice@',
    type: 'invalid',
  });
});

test('normalizeContact rejects freeform string with no at-sign', () => {
  assert.deepEqual(normalizeContact('not a handle or email'), {
    normalized: 'not a handle or email',
    type: 'invalid',
  });
});

test('normalizeContact returns absent for blank input', () => {
  assert.deepEqual(normalizeContact('   '), {
    normalized: null,
    type: 'absent',
  });
});

test('normalizeContact returns absent for null input', () => {
  assert.deepEqual(normalizeContact(null), {
    normalized: null,
    type: 'absent',
  });
});

test('normalizeContact returns absent for undefined input', () => {
  assert.deepEqual(normalizeContact(undefined), {
    normalized: null,
    type: 'absent',
  });
});

test('normalizeContact handles same value used for both contacts deterministically', () => {
  const primary = normalizeContact('octocat');
  const secondary = normalizeContact('octocat');

  assert.deepEqual(primary, {
    normalized: 'octocat',
    type: 'handle',
  });
  assert.deepEqual(secondary, {
    normalized: 'octocat',
    type: 'handle',
  });
});
