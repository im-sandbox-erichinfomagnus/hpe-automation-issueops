'use strict';

const { execSync } = require('child_process');
const path = require('path');

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
 * @param {string} options.env - Environment object for git commands (default: process.env)
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
      stdio: 'pipe',
      encoding: 'utf8',
      cwd: repoRoot,
      env,
    };

    // Stage the file
    if (!dryRun) {
      try {
        execSync(`git add "${relativeFilePath}"`, execOptions);
      } catch (addErr) {
        console.error(`[registry-commit] git add failed: ${addErr.message}`);
        throw addErr;
      }
    }

    // Check if there are changes to commit
    let hasChanges = false;
    try {
      execSync('git diff --cached --quiet', execOptions);
      hasChanges = false;
    } catch (e) {
      // Non-zero exit means there are changes
      hasChanges = true;
    }

    if (!hasChanges) {
      return {
        status: 'noop',
        message: 'No changes to commit (registry file may not have changed)',
        committed: false,
        pushed: false,
      };
    }

    // Commit the file
    if (!dryRun) {
      try {
        execSync(`git commit -m "${commitMessage}"`, execOptions);
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
        currentBranch = execSync('git rev-parse --abbrev-ref HEAD', execOptions)
          .toString()
          .trim();
      } catch (e) {
        console.warn(`[registry-commit] Could not determine current branch, defaulting to 'main'`);
      }

      try {
        execSync(`git push origin ${currentBranch}`, execOptions);
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
