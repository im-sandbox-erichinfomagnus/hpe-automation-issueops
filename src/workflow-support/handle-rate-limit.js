'use strict';

function readHeader(headers, name) {
  if (!headers) {
    return undefined;
  }

  if (typeof headers.get === 'function') {
    return headers.get(name);
  }

  return headers[name] || headers[name.toLowerCase()];
}

function parseRateLimitHeaders(headers) {
  const remaining = readHeader(headers, 'x-ratelimit-remaining');
  const reset = readHeader(headers, 'x-ratelimit-reset');
  const retryAfter = readHeader(headers, 'retry-after');

  return {
    remaining: remaining == null ? null : Number(remaining),
    reset_epoch_seconds: reset == null ? null : Number(reset),
    retry_after_seconds: retryAfter == null ? null : Number(retryAfter),
  };
}

function isRetryableGitHubFailure(error = {}) {
  const status = error.status;
  const headers = parseRateLimitHeaders(error.headers);
  const message = String(error.payload && error.payload.message ? error.payload.message : error.message || '').toLowerCase();
  const hasSecondaryLimitSignal = message.includes('secondary rate limit');
  const hitPrimaryLimit = headers.remaining === 0;

  if (status === 429) {
    return true;
  }

  if (status === 403 && (hitPrimaryLimit || hasSecondaryLimitSignal || headers.retry_after_seconds)) {
    return true;
  }

  return false;
}

function computeRetryDelayMs(options = {}) {
  const attempt = options.attempt || 1;
  const headers = parseRateLimitHeaders(options.headers);
  const baseDelayMs = options.baseDelayMs || 1000;
  const maxDelayMs = options.maxDelayMs || 30000;

  if (headers.retry_after_seconds) {
    return Math.min(headers.retry_after_seconds * 1000, maxDelayMs);
  }

  if (headers.reset_epoch_seconds) {
    const untilResetMs = Math.max((headers.reset_epoch_seconds * 1000) - Date.now(), 0);
    if (untilResetMs > 0) {
      return Math.min(untilResetMs, maxDelayMs);
    }
  }

  return Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
}

function createRetryPlan(options = {}) {
  const attempt = options.attempt || 1;
  const maxRetries = options.maxRetries || 3;
  const retryable = isRetryableGitHubFailure(options.error || options);

  return {
    retryable,
    next_attempt: retryable && attempt < maxRetries ? attempt + 1 : null,
    delay_ms:
      retryable && attempt < maxRetries
        ? computeRetryDelayMs({
            attempt,
            headers: (options.error || options).headers,
            baseDelayMs: options.baseDelayMs,
            maxDelayMs: options.maxDelayMs,
          })
        : 0,
    exhausted: !retryable || attempt >= maxRetries,
    rate_limit_snapshot: parseRateLimitHeaders((options.error || options).headers),
  };
}

function buildRateLimitContext(error = {}, options = {}) {
  const retryPlan = createRetryPlan({
    error,
    attempt: options.attempt || 1,
    maxRetries: options.maxRetries || 3,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
  });

  return {
    operation: options.operation || 'github_api_request',
    retryable: retryPlan.retryable,
    should_retry: retryPlan.retryable && retryPlan.next_attempt != null,
    stop_mutation: !retryPlan.retryable || retryPlan.exhausted,
    retry_plan: retryPlan,
    rate_limit_snapshot: retryPlan.rate_limit_snapshot,
  };
}

function buildRepositoryGrantRateLimitContext(error = {}, options = {}) {
  return buildRateLimitContext(error, {
    operation: options.operation || 'team_repository_grant',
    attempt: options.attempt || 1,
    maxRetries: options.maxRetries || 3,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
  });
}

function buildTenantBootstrapRateLimitContext(error = {}, options = {}) {
  return buildRateLimitContext(error, {
    operation: options.operation || 'tenant_bootstrap_mutation',
    attempt: options.attempt || 1,
    maxRetries: options.maxRetries || 3,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
  });
}

function buildTenantRepoCreationRateLimitContext(error = {}, options = {}) {
  return buildRateLimitContext(error, {
    operation: options.operation || 'tenant_repo_creation_mutation',
    attempt: options.attempt || 1,
    maxRetries: options.maxRetries || 3,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
  });
}

function buildTopologyRegistryReadRateLimitContext(error = {}, options = {}) {
  return buildRateLimitContext(error, {
    operation: options.operation || 'tenant_topology_registry_read',
    attempt: options.attempt || 1,
    maxRetries: options.maxRetries || 3,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
  });
}

function buildCapabilityAssignmentRateLimitContext(error = {}, options = {}) {
  return buildRateLimitContext(error, {
    operation: options.operation || 'tenant_cicd_capability_assignment',
    attempt: options.attempt || 1,
    maxRetries: options.maxRetries || 3,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
  });
}

function buildOwnedTopologyPersistenceRateLimitContext(error = {}, options = {}) {
  return buildRateLimitContext(error, {
    operation: options.operation || 'tenant_topology_owned_persistence',
    attempt: options.attempt || 1,
    maxRetries: options.maxRetries || 3,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
  });
}

async function executeWithBoundedRetry(operation, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const sleep = options.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  let lastRetryPlan = {
    retryable: false,
    next_attempt: null,
    delay_ms: 0,
    exhausted: false,
    rate_limit_snapshot: null,
  };

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const value = await operation(attempt);
      return {
        ok: true,
        value,
        attempts: attempt,
        retry_plan: lastRetryPlan,
      };
    } catch (error) {
      if (error && error.team_sync_blocked) {
        return {
          ok: false,
          error,
          attempts: attempt,
          retry_plan: {
            retryable: false,
            next_attempt: null,
            delay_ms: 0,
            exhausted: true,
            rate_limit_snapshot: parseRateLimitHeaders(error.headers),
          },
        };
      }

      const retryPlan = createRetryPlan({
        error,
        attempt,
        maxRetries,
        baseDelayMs: options.baseDelayMs,
        maxDelayMs: options.maxDelayMs,
      });
      lastRetryPlan = retryPlan;

      if (!retryPlan.retryable || retryPlan.next_attempt == null) {
        return {
          ok: false,
          error,
          attempts: attempt,
          retry_plan: retryPlan,
        };
      }

      await sleep(retryPlan.delay_ms);
    }
  }

  return {
    ok: false,
    error: new Error('Retry executor exhausted unexpectedly'),
    attempts: maxRetries,
    retry_plan: {
      retryable: false,
      next_attempt: null,
      delay_ms: 0,
      exhausted: true,
      rate_limit_snapshot: null,
    },
  };
}

async function executeCapabilityOperationWithRetry(operation, options = {}) {
  return executeWithBoundedRetry(operation, {
    maxRetries: options.maxRetries || 3,
    sleep: options.sleep,
    baseDelayMs: options.baseDelayMs || 1000,
    maxDelayMs: options.maxDelayMs || 30000,
  });
}

module.exports = {
  buildCapabilityAssignmentRateLimitContext,
  buildRepositoryGrantRateLimitContext,
  buildTenantRepoCreationRateLimitContext,
  buildTenantBootstrapRateLimitContext,
  buildRateLimitContext,
  buildOwnedTopologyPersistenceRateLimitContext,
  buildTopologyRegistryReadRateLimitContext,
  computeRetryDelayMs,
  createRetryPlan,
  executeCapabilityOperationWithRetry,
  executeWithBoundedRetry,
  isRetryableGitHubFailure,
  parseRateLimitHeaders,
  readHeader,
};