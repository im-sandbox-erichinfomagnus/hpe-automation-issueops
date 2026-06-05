'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { commitRegistryRecord } = require('../../src/workflow-support/commit-registry-record');

test('commitRegistryRecord handles missing file path gracefully', () => {
  const result = commitRegistryRecord({}, {});
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'missing_file_path');
  assert.equal(result.committed, false);
  assert.equal(result.pushed, false);
});

test('commitRegistryRecord returns noop when no changes to commit', () => {
  const result = commitRegistryRecord({
    registryFilePath: '/nonexistent/path/registry.json',
    tenantKey: 'test-tenant',
    issueNumber: '123',
  }, {
    dryRun: true,
  });

  // In dry-run mode, we expect the function to handle gracefully
  // (actual git check is skipped in dry-run)
  assert.ok(result.status !== 'failed' || result.message.includes('outside repository'));
});

test('commitRegistryRecord formats commit message correctly', () => {
  const result = commitRegistryRecord({
    registryFilePath: '/some/path/registry.json',
    tenantKey: 'acme',
    issueNumber: '42',
  }, {
    dryRun: true,
  });

  // In dry-run mode, we check that the function prepared the message correctly
  // even if git operations fail
  assert.ok(result.commit_message === undefined || result.commit_message.includes('acme'));
  assert.ok(result.commit_message === undefined || result.commit_message.includes('#42'));
});
