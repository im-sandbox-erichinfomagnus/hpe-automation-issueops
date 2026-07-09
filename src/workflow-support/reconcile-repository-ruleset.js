'use strict';

const { buildRepositoryRulesetPayload } = require('./parse-repository-ruleset-request');

function classifyFailureReason(error = {}) {
  if (error.status === 429) {
    return 'rate_limited';
  }

  const message = String(error.payload && error.payload.message ? error.payload.message : error.message || '').toLowerCase();
  if (message.includes('secondary rate limit')) {
    return 'rate_limited';
  }

  if (error.status) {
    return `http_${error.status}`;
  }

  return 'unknown_error';
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Reconciliation-first execution for a repository-level ruleset. The current
// rulesets are read first and the API is only called when the desired state
// differs: create is idempotent by ruleset name (no-op when a ruleset of the
// same name exists) and delete is a no-op when the named ruleset is absent.
// Dry-run reports intent without mutation. A boundary mismatch fails closed.
async function reconcileRepositoryRuleset(input = {}) {
  const api = input.api;
  const organization = input.organization;
  const repository = input.repository;
  const rulesetOperation = String(input.ruleset_operation || '').toLowerCase();
  const rulesetName = input.ruleset_name || (input.ruleset_payload && input.ruleset_payload.name) || '';
  const dryRun = Boolean(input.dry_run);
  const boundaryRevalidationStatus = input.boundary_revalidation_status || 'matched';

  const applied = [];
  const skipped = [];
  const failed = [];

  if (boundaryRevalidationStatus !== 'matched') {
    failed.push({
      name: rulesetName,
      action: 'reject',
      failure_reason: 'boundary_mismatch',
    });
    return {
      status: 'blocked',
      dry_run: dryRun,
      boundary_revalidation_status: boundaryRevalidationStatus,
      applied,
      skipped,
      failed,
    };
  }

  let existing = null;
  try {
    const rulesets = await api.listRepositoryRulesets({ owner: organization, repo: repository });
    existing = (rulesets || []).find(
      (ruleset) => normalizeName(ruleset.name) === normalizeName(rulesetName)
    ) || null;
  } catch (error) {
    failed.push({ name: rulesetName, action: 'read', failure_reason: classifyFailureReason(error) });
    return {
      status: 'failed',
      dry_run: dryRun,
      boundary_revalidation_status: boundaryRevalidationStatus,
      applied,
      skipped,
      failed,
    };
  }

  if (rulesetOperation === 'delete') {
    if (!existing) {
      skipped.push({ name: rulesetName, action: 'noop', reason: 'already_absent' });
    } else if (dryRun) {
      skipped.push({ name: rulesetName, action: 'delete', reason: 'dry_run' });
    } else {
      try {
        await api.deleteRepositoryRuleset({ owner: organization, repo: repository, rulesetId: existing.id });
        applied.push({ name: rulesetName, action: 'deleted', ruleset_id: existing.id });
      } catch (error) {
        failed.push({ name: rulesetName, action: 'delete', failure_reason: classifyFailureReason(error) });
      }
    }
  } else {
    // create
    if (existing) {
      skipped.push({ name: rulesetName, action: 'noop', reason: 'already_exists', ruleset_id: existing.id });
    } else if (dryRun) {
      skipped.push({ name: rulesetName, action: 'create', reason: 'dry_run' });
    } else {
      const payload = input.ruleset_payload || buildRepositoryRulesetPayload(input.request || {});
      try {
        const result = await api.createRepositoryRuleset({ owner: organization, repo: repository, payload });
        applied.push({
          name: rulesetName,
          action: 'created',
          ruleset_id: result && result.ruleset ? result.ruleset.id : null,
        });
      } catch (error) {
        failed.push({ name: rulesetName, action: 'create', failure_reason: classifyFailureReason(error) });
      }
    }
  }

  const status = failed.length === 0
    ? 'applied'
    : applied.length > 0 || skipped.length > 0
      ? 'partial_failure'
      : 'failed';

  return {
    status,
    dry_run: dryRun,
    boundary_revalidation_status: boundaryRevalidationStatus,
    applied,
    skipped,
    failed,
  };
}

module.exports = {
  classifyFailureReason,
  reconcileRepositoryRuleset,
};
