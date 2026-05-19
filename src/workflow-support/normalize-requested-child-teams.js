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

function normalizeRequestedChildTeams(input) {
  const normalizedChildTeams = [];
  const requestedChildTeamDetail = [];
  const duplicateChildTeams = [];
  const conflictingChildSlugs = [];
  const invalidChildTeams = [];
  const seenNames = new Set();
  const slugToName = new Map();

  for (const rawValue of toLines(input)) {
    const childTeamName = normalizeTeamName(rawValue);
    if (!childTeamName) {
      continue;
    }

    const normalizedKey = childTeamName.toLowerCase();
    const childTeamSlug = slugifyTeamName(childTeamName);
    let status = 'valid';

    if (!childTeamSlug) {
      invalidChildTeams.push(childTeamName);
      status = 'invalid';
    } else if (seenNames.has(normalizedKey)) {
      duplicateChildTeams.push(childTeamName);
      status = 'duplicate';
    } else if (slugToName.has(childTeamSlug) && slugToName.get(childTeamSlug) !== normalizedKey) {
      conflictingChildSlugs.push({
        slug: childTeamSlug,
        names: [slugToName.get(childTeamSlug), normalizedKey],
      });
      status = 'conflicting';
    }

    requestedChildTeamDetail.push({
      requested_name: childTeamName,
      normalized_slug: childTeamSlug,
      validation_status: status,
    });

    if (status === 'valid') {
      seenNames.add(normalizedKey);
      slugToName.set(childTeamSlug, normalizedKey);
      normalizedChildTeams.push({
        requested_name: childTeamName,
        child_team_slug: childTeamSlug,
      });
    }
  }

  return {
    normalizedChildTeams,
    requestedChildTeamDetail,
    duplicateChildTeams,
    conflictingChildSlugs,
    invalidChildTeams,
  };
}

module.exports = {
  normalizeLogin,
  normalizeRequestedChildTeams,
  normalizeTeamName,
  slugifyTeamName,
  unwrapCodeFence,
};