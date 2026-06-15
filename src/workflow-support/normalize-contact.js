'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function isValidGithubHandle(handle) {
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(handle);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function normalizeContact(rawValue) {
  const raw = normalizeText(rawValue);

  if (!raw) {
    return {
      normalized: null,
      type: 'absent',
    };
  }

  const withoutAt = raw.startsWith('@') ? raw.slice(1) : raw;
  if (withoutAt && isValidGithubHandle(withoutAt)) {
    return {
      normalized: withoutAt.toLowerCase(),
      type: 'handle',
    };
  }

  if (isValidEmail(raw)) {
    return {
      normalized: raw,
      type: 'email',
    };
  }

  return {
    normalized: raw,
    type: 'invalid',
  };
}

module.exports = {
  isValidEmail,
  isValidGithubHandle,
  normalizeContact,
};
