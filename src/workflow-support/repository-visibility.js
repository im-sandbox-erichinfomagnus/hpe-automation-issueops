'use strict';

const ALLOWED_REPOSITORY_VISIBILITIES = ['private', 'internal', 'public'];

function normalizeRepositoryVisibility(value) {
  // issue-ops/parser wraps dropdown values in brackets (e.g. "[internal]"); strip them.
  const normalized = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) {
    return {
      visibility: 'private',
      source: 'default',
    };
  }

  return {
    visibility: normalized,
    source: 'user_selected',
  };
}

function describeAllowedRepositoryVisibilities() {
  return ALLOWED_REPOSITORY_VISIBILITIES.join(', ');
}

module.exports = {
  ALLOWED_REPOSITORY_VISIBILITIES,
  describeAllowedRepositoryVisibilities,
  normalizeRepositoryVisibility,
};