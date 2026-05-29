'use strict';

const { executeWithBoundedRetry, parseRateLimitHeaders } = require('./handle-rate-limit');

function getGlobalFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('A fetch implementation is required to download CSV attachments');
  }

  return fetch;
}

function buildAttachmentHeaders(token, extraHeaders = {}) {
  const headers = {
    Accept: 'application/octet-stream',
    'User-Agent': 'issueops-speckit',
    ...extraHeaders,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function inferContentLength(headers) {
  if (!headers) {
    return null;
  }

  const value = typeof headers.get === 'function'
    ? headers.get('content-length')
    : headers['content-length'] || headers.ContentLength;
  return value == null ? null : Number(value);
}

async function decodeUtf8(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (error) {
    throw Object.assign(new Error('Attachment content could not be decoded as UTF-8 text.'), {
      cause: error,
      failure_reason: 'decode_failed',
    });
  }
}

async function downloadCsvAttachment(options = {}) {
  const attachmentUrl = options.attachmentUrl;
  const token = options.token || '';
  const fetchImpl = options.fetchImpl || getGlobalFetch();
  const maxBytes = options.maxBytes || 1024 * 1024;

  if (!attachmentUrl) {
    throw new Error('Attachment URL is required to download CSV content.');
  }

  const result = await executeWithBoundedRetry(async () => {
    const response = await fetchImpl(attachmentUrl, {
      method: 'GET',
      headers: buildAttachmentHeaders(token, options.headers),
    });

    if (!response.ok) {
      throw Object.assign(new Error('Failed to download CSV attachment.'), {
        status: response.status,
        headers: response.headers,
      });
    }

    const declaredSize = inferContentLength(response.headers);
    if (declaredSize != null && declaredSize > maxBytes) {
      throw Object.assign(new Error(`Attachment exceeds the configured size cap of ${maxBytes} bytes.`), {
        status: 413,
        headers: response.headers,
        failure_reason: 'oversized_attachment',
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw Object.assign(new Error(`Attachment exceeds the configured size cap of ${maxBytes} bytes.`), {
        status: 413,
        headers: response.headers,
        failure_reason: 'oversized_attachment',
      });
    }

    const text = await decodeUtf8(buffer);
    return {
      text,
      byte_size: buffer.byteLength,
      downloaded_at: new Date().toISOString(),
      headers: response.headers,
    };
  }, {
    maxRetries: options.maxRetries || 3,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    sleep: options.sleep,
  });

  if (!result.ok) {
    const error = result.error || new Error('Failed to download CSV attachment.');
    error.rate_limit_snapshot = parseRateLimitHeaders(error.headers);
    throw error;
  }

  return {
    ...result.value,
    attempts: result.attempts,
    rate_limit_snapshot: result.retry_plan && result.retry_plan.rate_limit_snapshot
      ? result.retry_plan.rate_limit_snapshot
      : parseRateLimitHeaders(result.value.headers),
  };
}

module.exports = {
  buildAttachmentHeaders,
  decodeUtf8,
  downloadCsvAttachment,
  inferContentLength,
};
