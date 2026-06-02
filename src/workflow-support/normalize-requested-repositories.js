'use strict';

function unwrapCodeFence(value) {
  const text = String(value || '').trim();
  const match = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
}

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRepositoryName(value) {
  return String(value || '').trim().toLowerCase();
}

function toLines(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => toLines(entry));
  }

  if (value == null) {
    return [];
  }

  if (typeof value === 'object') {
    if (Array.isArray(value.values)) {
      return toLines(value.values);
    }

    if (typeof value.value === 'string') {
      return toLines(value.value);
    }

    return [];
  }

  return unwrapCodeFence(value).split(/\r?\n/);
}

function parseRepositoryReference(rawValue, defaultOwner) {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/^https?:\/\/github\.com\//i, '').replace(/^github\.com\//i, '');
  const segments = normalized.split('/').filter(Boolean);

  if (segments.length === 1) {
    const repositoryName = normalizeRepositoryName(segments[0]);
    return {
      requested_repository_name: trimmed,
      repository_owner: normalizeLogin(defaultOwner || ''),
      repository_name: repositoryName,
      repository_full_name: normalizeLogin(defaultOwner || '')
        ? `${normalizeLogin(defaultOwner || '')}/${repositoryName}`
        : repositoryName,
      validation_status: repositoryName ? 'valid' : 'invalid',
    };
  }

  if (segments.length >= 2) {
    const repositoryOwner = normalizeLogin(segments[segments.length - 2]);
    const repositoryName = normalizeRepositoryName(segments[segments.length - 1]);
    return {
      requested_repository_name: trimmed,
      repository_owner: repositoryOwner,
      repository_name: repositoryName,
      repository_full_name:
        repositoryOwner && repositoryName ? `${repositoryOwner}/${repositoryName}` : '',
      validation_status:
        repositoryOwner && repositoryName ? 'valid' : 'invalid',
    };
  }

  return {
    requested_repository_name: trimmed,
    repository_owner: '',
    repository_name: '',
    repository_full_name: '',
    validation_status: 'invalid',
  };
}

function buildNormalizedRepositoryGrant(parsed, overrides = {}) {
  return {
    ...parsed,
    repository_archived: false,
    current_permission_api_value: 'none',
    current_permission_rank: 0,
    desired_action: 'grant_access',
    execution_result: 'not_started',
    failure_reason: null,
    ...overrides,
  };
}

function normalizeRequestedRepositories(input, options = {}) {
  const defaultOwner = options.defaultOwner || options.default_owner || '';
  const normalizedRepositories = [];
  const requestedRepositoryDetail = [];
  const duplicateRepositories = [];
  const conflictingRepositories = [];
  const invalidRepositories = [];
  const seenFullNames = new Set();
  const seenRequestedNames = new Set();

  for (const rawValue of toLines(input)) {
    const parsed = parseRepositoryReference(rawValue, defaultOwner);
    if (!parsed) {
      continue;
    }

    const requestedNameKey = String(parsed.requested_repository_name || '').trim().toLowerCase();
    let status = parsed.validation_status;

    if (status !== 'valid') {
      invalidRepositories.push(parsed.requested_repository_name);
    } else if (seenRequestedNames.has(requestedNameKey) || seenFullNames.has(parsed.repository_full_name)) {
      duplicateRepositories.push(parsed.requested_repository_name);
      status = 'duplicate';
    } else if (!parsed.repository_owner || !parsed.repository_name) {
      invalidRepositories.push(parsed.requested_repository_name);
      status = 'invalid';
    }

    if (
      status === 'valid' &&
      normalizeLogin(defaultOwner) &&
      parsed.repository_owner &&
      parsed.repository_owner !== normalizeLogin(defaultOwner)
    ) {
      conflictingRepositories.push({
        requested_repository_name: parsed.requested_repository_name,
        repository_full_name: parsed.repository_full_name,
        expected_owner: normalizeLogin(defaultOwner),
        actual_owner: parsed.repository_owner,
      });
      status = 'conflicting';
    }

    requestedRepositoryDetail.push({
      ...parsed,
      validation_status: status,
    });

    if (status === 'valid') {
      seenRequestedNames.add(requestedNameKey);
      seenFullNames.add(parsed.repository_full_name);
      normalizedRepositories.push(buildNormalizedRepositoryGrant(parsed));
    }
  }

  return {
    normalizedRepositories,
    requestedRepositoryDetail,
    duplicateRepositories,
    conflictingRepositories,
    invalidRepositories,
  };
}

module.exports = {
  buildNormalizedRepositoryGrant,
  normalizeLogin,
  normalizeRepositoryName,
  normalizeRequestedRepositories,
  parseRepositoryReference,
  toLines,
  unwrapCodeFence,
};