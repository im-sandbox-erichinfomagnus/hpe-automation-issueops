'use strict';

const GITHUB_LOGIN_PATTERN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

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

function normalizeRequestedPeople(input) {
  const candidates = toCandidateList(input);
  const seen = new Set();
  const duplicatePeople = [];
  const invalidPeople = [];
  const normalizedPeople = [];
  const requestedPeopleDetail = [];

  for (const rawValue of candidates) {
    const username = normalizeLogin(rawValue);
    const isValid = isPlausibleGitHubLogin(username);

    requestedPeopleDetail.push({
      original: rawValue,
      username,
      is_valid: isValid,
    });

    if (!isValid) {
      invalidPeople.push(username || rawValue);
      continue;
    }

    if (seen.has(username)) {
      duplicatePeople.push(username);
      continue;
    }

    seen.add(username);
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
  GITHUB_LOGIN_PATTERN,
  isPlausibleGitHubLogin,
  normalizeLogin,
  normalizeRequestedPeople,
  unwrapCodeFence,
};