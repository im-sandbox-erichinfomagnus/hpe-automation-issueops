'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.join(__dirname, '..', '..');
const attributesPath = path.join(repositoryRoot, '.gitattributes');

test('tenant registry files use the fail-closed binary merge driver', () => {
  const attributes = fs.readFileSync(attributesPath, 'utf8');
  assert.match(attributes, /^tenant-registry\/\*\*\s+.*\bmerge=binary\b/m);

  const result = execFileSync(
    'git',
    ['check-attr', 'merge', '--', 'tenant-registry/acme.json'],
    { cwd: repositoryRoot, encoding: 'utf8' }
  ).trim();

  assert.equal(result, 'tenant-registry/acme.json: merge: binary');
});

test('concurrent tenant record changes stop the merge and keep runtime state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-registry-merge-'));
  const registryDirectory = path.join(directory, 'tenant-registry');
  const registryPath = path.join(registryDirectory, 'acme.json');
  const runGit = (...args) => execFileSync('git', args, {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    fs.mkdirSync(registryDirectory);
    fs.copyFileSync(attributesPath, path.join(directory, '.gitattributes'));
    fs.writeFileSync(registryPath, '{"version":"baseline"}\n');

    runGit('init', '--initial-branch=main');
    runGit('config', 'user.name', 'Tenant Registry Test');
    runGit('config', 'user.email', 'tenant-registry-test@example.invalid');
    runGit('add', '.');
    runGit('commit', '-m', 'baseline');

    runGit('switch', '-c', 'upstream-update');
    fs.writeFileSync(registryPath, '{"version":"template-update"}\n');
    runGit('add', 'tenant-registry/acme.json');
    runGit('commit', '-m', 'update template record');

    runGit('switch', 'main');
    fs.writeFileSync(registryPath, '{"version":"runtime-state"}\n');
    runGit('add', 'tenant-registry/acme.json');
    runGit('commit', '-m', 'persist runtime tenant state');

    const merge = spawnSync('git', ['merge', 'upstream-update', '--no-edit'], {
      cwd: directory,
      encoding: 'utf8',
    });

    assert.notEqual(merge.status, 0);
    assert.match(runGit('status', '--porcelain'), /^UU tenant-registry\/acme\.json$/m);
    assert.equal(fs.readFileSync(registryPath, 'utf8'), '{"version":"runtime-state"}\n');
  } finally {
    spawnSync('git', ['merge', '--abort'], { cwd: directory });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
