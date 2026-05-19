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

function normalizeRequestedTeams(input) {
  const normalizedTeams = [];
  const requestedTeamDetail = [];
  const duplicateTeamNames = [];
  const conflictingSlugs = [];
  const invalidTeamNames = [];
  const seenNames = new Set();
  const slugToName = new Map();

  for (const rawValue of toLines(input)) {
    const teamName = normalizeTeamName(rawValue);
    if (!teamName) {
      continue;
    }

    const normalizedKey = teamName.toLowerCase();
    const slug = slugifyTeamName(teamName);
    let status = 'valid';

    if (!slug) {
      invalidTeamNames.push(teamName);
      status = 'invalid';
    } else if (seenNames.has(normalizedKey)) {
      duplicateTeamNames.push(teamName);
      status = 'duplicate';
    } else if (slugToName.has(slug) && slugToName.get(slug) !== normalizedKey) {
      conflictingSlugs.push({
        slug,
        names: [slugToName.get(slug), normalizedKey],
      });
      status = 'conflicting';
    }

    requestedTeamDetail.push({
      requested_name: teamName,
      normalized_slug: slug,
      validation_status: status,
    });

    if (status === 'valid') {
      seenNames.add(normalizedKey);
      slugToName.set(slug, normalizedKey);
      normalizedTeams.push({
        requested_name: teamName,
        normalized_slug: slug,
      });
    }
  }

  return {
    normalizedTeams,
    requestedTeamDetail,
    duplicateTeamNames,
    conflictingSlugs,
    invalidTeamNames,
  };
}

module.exports = {
  normalizeLogin,
  normalizeRequestedTeams,
  normalizeTeamName,
  slugifyTeamName,
  unwrapCodeFence,
};