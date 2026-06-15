'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function createGitCommandError(args, result) {
  const stderr = String(result && result.stderr || '').trim();
  const suffix = stderr ? `: ${stderr}` : '';
  const error = new Error(`git ${args.join(' ')} failed with exit code ${result.status}${suffix}`);
  error.exitCode = result.status;
  error.stdout = String(result && result.stdout || '');
  error.stderr = String(result && result.stderr || '');
  return error;
}

function runGit(args, execOptions) {
  const result = spawnSync('git', args, execOptions);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw createGitCommandError(args, result);
  }
  return String(result.stdout || '');
}

function resolveGitIdentity(env = {}) {
  const actor = String(env.GITHUB_ACTOR || '').trim();
  const defaultName = actor || 'github-actions[bot]';
  const defaultEmail = actor
    ? `${actor}@users.noreply.github.com`
    : '41898282+github-actions[bot]@users.noreply.github.com';

  return {
    name: String(env.GIT_COMMITTER_NAME || env.GIT_AUTHOR_NAME || defaultName).trim() || defaultName,
    email: String(env.GIT_COMMITTER_EMAIL || env.GIT_AUTHOR_EMAIL || defaultEmail).trim() || defaultEmail,
  };
}

function ensureGitIdentity(execOptions, env = {}) {
  const { name, email } = resolveGitIdentity(env);

  let configuredName = '';
  let configuredEmail = '';

  try {
    configuredName = runGit(['config', '--get', 'user.name'], execOptions).trim();
  } catch (_error) {
    configuredName = '';
  }

  try {
    configuredEmail = runGit(['config', '--get', 'user.email'], execOptions).trim();
  } catch (_error) {
    configuredEmail = '';
  }

  if (!configuredName) {
    runGit(['config', 'user.name', name], execOptions);
  }

  if (!configuredEmail) {
    runGit(['config', 'user.email', email], execOptions);
  }
}

/**
 * Commit and push a tenant registry record to the repository.
 * This implements the durable repository write path for registry persistence.
 *
 * @param {Object} input - Configuration object
 * @param {string} input.registryFilePath - Absolute path to the registry file to commit
 * @param {string} input.tenantKey - Tenant key (used in commit message)
 * @param {string} input.issueNumber - Issue number (used in commit message)
 * @param {string} input.repoRoot - Repository root directory (for relative path calculation)
 * @param {Object} options - Execution options
 * @param {boolean} options.dryRun - If true, don't actually commit/push
 * @param {Object} options.env - Environment object for git commands (default: process.env)
 * @returns {Object} Result with status, message, and any errors
 */
function commitRegistryRecord(input = {}, options = {}) {
  const registryFilePath = input.registryFilePath || '';
  const tenantKey = input.tenantKey || 'unknown-tenant';
  const issueNumber = input.issueNumber || 'manual';
  const repoRoot = input.repoRoot || process.cwd();
  const dryRun = options.dryRun === true;
  const env = options.env || process.env;

  if (!registryFilePath) {
    return {
      status: 'failed',
      message: 'Registry file path is required',
      error: 'missing_file_path',
      committed: false,
      pushed: false,
    };
  }

  const commitMessage = `docs: persist tenant registry for ${tenantKey} (issue #${issueNumber})`;

  try {
    // Get relative path for cleaner git output
    const relativeFilePath = path.relative(repoRoot, registryFilePath);

    const execOptions = {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      cwd: repoRoot,
      env,
    };

    // Stage the file
    if (!dryRun) {
      try {
        runGit(['add', relativeFilePath], execOptions);
      } catch (addErr) {
        console.error(`[registry-commit] git add failed: ${addErr.message}`);
        throw addErr;
      }
    }

    // Check if there are changes to commit
    const diffResult = spawnSync('git', ['diff', '--cached', '--quiet'], execOptions);
    if (diffResult.error) {
      throw diffResult.error;
    }
    let hasChanges = false;
    if (diffResult.status === 0) {
      hasChanges = false;
    } else if (diffResult.status === 1) {
      hasChanges = true;
    } else {
      throw createGitCommandError(['diff', '--cached', '--quiet'], diffResult);
    }

    if (!hasChanges) {
      return {
        status: 'noop',
        message: 'No changes to commit (registry file may not have changed)',
        committed: false,
        pushed: false,
      };
    }

    if (!dryRun) {
      try {
        ensureGitIdentity(execOptions, env);
      } catch (identityErr) {
        console.error(`[registry-commit] git identity setup failed: ${identityErr.message}`);
        throw identityErr;
      }
    }

    // Commit the file
    if (!dryRun) {
      try {
        runGit(['commit', '-m', commitMessage], execOptions);
      } catch (commitErr) {
        console.error(`[registry-commit] git commit failed: ${commitErr.message}`);
        throw commitErr;
      }
    }

    // Push to repository
    if (!dryRun) {
      // Get current branch name
      let currentBranch = 'main';
      try {
        currentBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], execOptions).trim();
      } catch (e) {
        console.warn(`[registry-commit] Could not determine current branch, defaulting to 'main'`);
      }

      try {
        runGit(['push', 'origin', currentBranch], execOptions);
      } catch (pushErr) {
        console.error(`[registry-commit] git push failed: ${pushErr.message}`);
        throw pushErr;
      }
    }

    return {
      status: 'committed',
      message: `Registry record committed and pushed: ${commitMessage}`,
      committed: true,
      pushed: !dryRun,
      commit_message: commitMessage,
    };
  } catch (error) {
    return {
      status: 'failed',
      message: `Failed to commit/push registry record: ${error.message}`,
      error: error.message,
      committed: false,
      pushed: false,
    };
  }
}

module.exports = {
  commitRegistryRecord,
};
