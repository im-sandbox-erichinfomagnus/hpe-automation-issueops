'use strict';

// Underscore is permitted so EMU logins (<handle>_<enterprise-shortcode>) validate.
const GITHUB_LOGIN_PATTERN = /^[a-z\d](?:[a-z\d]|[-_](?=[a-z\d])){0,38}$/i;

function unwrapCodeFence(value) {
  const text = String(value || '').trim();
  const match = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
}

function toCandidateList(input) {
  if (Array.isArray(input)) {
    return input.flatMap((value) => toCandidateList(value));
  }

  if (input == null) {
    return [];
  }

  if (typeof input === 'object') {
    if (Array.isArray(input.values)) {
      return toCandidateList(input.values);
    }

    if (typeof input.value === 'string') {
      return toCandidateList(input.value);
    }

    return [];
  }

  return unwrapCodeFence(input)
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeLogin(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function isPlausibleGitHubLogin(login) {
  return GITHUB_LOGIN_PATTERN.test(login);
}

function buildRequestedPersonDetail(rawValue, extra = {}) {
  const username = normalizeLogin(rawValue);
  const isValid = isPlausibleGitHubLogin(username);

  return {
    original: rawValue,
    username,
    is_valid: isValid,
    ...extra,
  };
}

function classifyRequestedPerson(rawValue, options = {}) {
  const username = normalizeLogin(
    Object.prototype.hasOwnProperty.call(options, 'username') ? options.username : rawValue
  );
  const isValid = Object.prototype.hasOwnProperty.call(options, 'isValid')
    ? Boolean(options.isValid)
    : isPlausibleGitHubLogin(username);
  const detail = buildRequestedPersonDetail(rawValue, {
    ...options.detail,
    username,
    is_valid: isValid,
  });

  if (!isValid) {
    return {
      status: 'invalid',
      username,
      detail,
    };
  }

  if (options.seen && options.seen.has(username)) {
    return {
      status: 'duplicate',
      username,
      detail,
    };
  }

  if (options.seen) {
    options.seen.add(username);
  }

  return {
    status: 'valid',
    username,
    detail,
  };
}

function normalizeRequestedPeople(input) {
  const candidates = toCandidateList(input);
  const seen = new Set();
  const duplicatePeople = [];
  const invalidPeople = [];
  const normalizedPeople = [];
  const requestedPeopleDetail = [];

  for (const rawValue of candidates) {
    const classification = classifyRequestedPerson(rawValue, { seen });
    const detail = classification.detail;
    const username = classification.username;

    requestedPeopleDetail.push(detail);

    if (classification.status === 'invalid') {
      invalidPeople.push(username || rawValue);
      continue;
    }

    if (classification.status === 'duplicate') {
      duplicatePeople.push(username);
      continue;
    }

    normalizedPeople.push(username);
  }

  return {
    normalizedPeople,
    duplicatePeople,
    invalidPeople,
    requestedPeopleDetail,
    findings: {
      duplicate_count: duplicatePeople.length,
      invalid_count: invalidPeople.length,
      normalized_count: normalizedPeople.length,
      duplicate_people: duplicatePeople,
      invalid_people: invalidPeople,
    },
  };
}

module.exports = {
  buildRequestedPersonDetail,
  classifyRequestedPerson,
  GITHUB_LOGIN_PATTERN,
  isPlausibleGitHubLogin,
  normalizeLogin,
  normalizeRequestedPeople,
  unwrapCodeFence,
};