'use strict';

function unwrapCodeFence(value) {
  const text = String(value || '').trim();
  const match = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  return match ? match[1] : text;
}

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTeamName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugifyTeamName(value) {
  return normalizeTeamName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

function createChildTeamNormalizationState() {
  return {
    duplicateChildTeams: [],
    conflictingChildSlugs: [],
    invalidChildTeams: [],
    seenNames: new Set(),
    slugToName: new Map(),
  };
}

function classifyRequestedChildTeam(value, state = createChildTeamNormalizationState()) {
  const requestedName = normalizeTeamName(value);
  if (!requestedName) {
    return null;
  }

  const normalizedKey = requestedName.toLowerCase();
  const childTeamSlug = slugifyTeamName(requestedName);
  let validationStatus = 'valid';

  if (!childTeamSlug) {
    state.invalidChildTeams.push(requestedName);
    validationStatus = 'invalid';
  } else if (state.seenNames.has(normalizedKey)) {
    state.duplicateChildTeams.push(requestedName);
    validationStatus = 'duplicate';
  } else if (state.slugToName.has(childTeamSlug) && state.slugToName.get(childTeamSlug) !== normalizedKey) {
    state.conflictingChildSlugs.push({
      slug: childTeamSlug,
      names: [state.slugToName.get(childTeamSlug), normalizedKey],
    });
    validationStatus = 'conflicting';
  }

  if (validationStatus === 'valid') {
    state.seenNames.add(normalizedKey);
    state.slugToName.set(childTeamSlug, normalizedKey);
  }

  return {
    requested_name: requestedName,
    normalized_slug: childTeamSlug,
    child_team_slug: childTeamSlug,
    validation_status: validationStatus,
  };
}

function buildNormalizedChildTeamLink(normalizedChildTeam, options = {}) {
  if (!normalizedChildTeam || normalizedChildTeam.validation_status !== 'valid') {
    return null;
  }

  const link = {
    requested_name: normalizedChildTeam.requested_name,
    child_team_slug: normalizedChildTeam.child_team_slug,
  };

  if (options.source_row_number != null) {
    link.source_row_number = options.source_row_number;
  }

  return link;
}

function normalizeRequestedChildTeams(input) {
  const normalizedChildTeams = [];
  const requestedChildTeamDetail = [];
  const state = createChildTeamNormalizationState();

  for (const rawValue of toLines(input)) {
    const normalizedChildTeam = classifyRequestedChildTeam(rawValue, state);
    if (!normalizedChildTeam) {
      continue;
    }

    requestedChildTeamDetail.push({
      requested_name: normalizedChildTeam.requested_name,
      normalized_slug: normalizedChildTeam.normalized_slug,
      validation_status: normalizedChildTeam.validation_status,
    });

    const normalizedChildTeamLink = buildNormalizedChildTeamLink(normalizedChildTeam);
    if (normalizedChildTeamLink) {
      normalizedChildTeams.push(normalizedChildTeamLink);
    }
  }

  return {
    normalizedChildTeams,
    requestedChildTeamDetail,
    duplicateChildTeams: state.duplicateChildTeams,
    conflictingChildSlugs: state.conflictingChildSlugs,
    invalidChildTeams: state.invalidChildTeams,
  };
}

module.exports = {
  buildNormalizedChildTeamLink,
  classifyRequestedChildTeam,
  createChildTeamNormalizationState,
  normalizeLogin,
  normalizeRequestedChildTeams,
  normalizeTeamName,
  slugifyTeamName,
  unwrapCodeFence,
};