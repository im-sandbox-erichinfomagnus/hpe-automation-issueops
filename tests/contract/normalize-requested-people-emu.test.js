'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeRequestedPeople } = require('../../src/workflow-support/normalize-requested-people');
const { normalizeBulkCsvRequestedPeople } = require('../../src/workflow-support/normalize-bulk-csv-requested-people');

// EMU logins are <github-handle>_<enterprise-shortcode>; the shortcode is not hard-coded.
const EMU_LOGINS = [
  'stephen-rosinbaum_hpeprod',
  'sunil-kumar-d-v_hpeprod',
  'evan-caille_hpeprod',
];

test('EMU logins with an enterprise shortcode suffix are accepted', () => {
  const result = normalizeRequestedPeople(EMU_LOGINS.join('\n'));

  assert.deepEqual(result.invalidPeople, [], JSON.stringify(result.invalidPeople));
  assert.deepEqual(result.normalizedPeople, EMU_LOGINS);
  assert.equal(result.findings.invalid_count, 0);
});

test('EMU logins are normalized the same way as any other login', () => {
  const result = normalizeRequestedPeople('  @Stephen-Rosinbaum_HPEPROD  ');

  assert.deepEqual(result.normalizedPeople, ['stephen-rosinbaum_hpeprod']);
  assert.deepEqual(result.invalidPeople, []);
});

test('plain github.com handles remain valid', () => {
  const result = normalizeRequestedPeople('octocat\nsome-user\n@hubot');

  assert.deepEqual(result.normalizedPeople, ['octocat', 'some-user', 'hubot']);
  assert.deepEqual(result.invalidPeople, []);
});

test('degenerate underscore logins are still rejected', () => {
  const result = normalizeRequestedPeople('_bad\nbad_\na__b\n_\n__');

  assert.deepEqual(result.normalizedPeople, []);
  assert.equal(result.invalidPeople.length, 5, JSON.stringify(result.invalidPeople));
});

test('the existing invalid samples are still rejected', () => {
  const result = normalizeRequestedPeople('octocat\n-bad-login-\nnot a login');

  assert.deepEqual(result.normalizedPeople, ['octocat']);
  assert.deepEqual(result.invalidPeople, ['-bad-login-', 'not a login']);
});

test('the 39-character GitHub username cap still holds', () => {
  const atCap = 'a'.repeat(39);
  const overCap = 'a'.repeat(40);

  assert.deepEqual(normalizeRequestedPeople(atCap).normalizedPeople, [atCap]);
  assert.deepEqual(normalizeRequestedPeople(overCap).normalizedPeople, []);
  assert.deepEqual(normalizeRequestedPeople(overCap).invalidPeople, [overCap]);
});

test('the bulk CSV people path accepts EMU logins too', () => {
  const result = normalizeBulkCsvRequestedPeople(`username\n${EMU_LOGINS.join('\n')}`);

  assert.deepEqual(result.invalidPeople, [], JSON.stringify(result.invalidPeople));
  assert.deepEqual(result.normalizedPeople, EMU_LOGINS);
});

test('the bulk CSV people path still rejects degenerate underscore logins', () => {
  const result = normalizeBulkCsvRequestedPeople('username\n_bad\nbad_\na__b');

  assert.deepEqual(result.normalizedPeople, []);
  assert.equal(result.invalidPeople.length, 3, JSON.stringify(result.invalidPeople));
});
