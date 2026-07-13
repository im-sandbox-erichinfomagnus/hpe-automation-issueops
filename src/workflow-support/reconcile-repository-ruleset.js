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

// Reconciliation-first, per-row execution for a batch of repository rulesets.
// Each row is applied independently and idempotently: create is a no-op when a
// ruleset of the same name exists; delete is a no-op when it is absent. A row
// that was rejected at validation (unauthorized/invalid) is recorded as failed
// without a mutation. A failure on one row never aborts the others. Dry-run
// reports intent without mutation.
async function reconcileRepositoryRuleset(input = {}) {
  const api = input.api;
  const organization = input.organization;
  const rulesetOperation = String(input.ruleset_operation || '').toLowerCase();
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const dryRun = Boolean(input.dry_run);
  const boundaryRevalidationStatus = input.boundary_revalidation_status || 'matched';

  const applied = [];
  const skipped = [];
  const failed = [];

  if (boundaryRevalidationStatus !== 'matched') {
    for (const entry of entries) {
      failed.push({
        repository: entry.repository,
        ruleset_name: entry.ruleset_name,
        action: 'reject',
        failure_reason: 'boundary_mismatch',
      });
    }
    return {
      status: 'blocked',
      dry_run: dryRun,
      boundary_revalidation_status: boundaryRevalidationStatus,
      applied,
      skipped,
      failed,
    };
  }

  const rulesetsCache = new Map();
  async function listRulesets(repo) {
    if (rulesetsCache.has(repo)) {
      return rulesetsCache.get(repo);
    }
    const rulesets = (await api.listRepositoryRulesets({ owner: organization, repo })) || [];
    rulesetsCache.set(repo, rulesets);
    return rulesets;
  }

  for (const entry of entries) {
    const repository = entry.repository;
    const rulesetName = entry.ruleset_name;

    if (entry.row_status === 'rejected' || entry.authorized === false || entry.action === 'reject') {
      failed.push({
        repository,
        ruleset_name: rulesetName,
        action: 'reject',
        failure_reason: entry.failure_reason || 'unauthorized',
      });
      continue;
    }

    let existing = null;
    try {
      const rulesets = await listRulesets(repository);
      existing = rulesets.find(
        (ruleset) => normalizeName(ruleset.name) === normalizeName(rulesetName)
      ) || null;
    } catch (error) {
      failed.push({ repository, ruleset_name: rulesetName, action: 'read', failure_reason: classifyFailureReason(error) });
      continue;
    }

    if (rulesetOperation === 'delete') {
      if (!existing) {
        skipped.push({ repository, ruleset_name: rulesetName, action: 'noop', reason: 'already_absent' });
      } else if (dryRun) {
        skipped.push({ repository, ruleset_name: rulesetName, action: 'delete', reason: 'dry_run' });
      } else {
        try {
          await api.deleteRepositoryRuleset({ owner: organization, repo: repository, rulesetId: existing.id });
          applied.push({ repository, ruleset_name: rulesetName, action: 'deleted', ruleset_id: existing.id });
        } catch (error) {
          failed.push({ repository, ruleset_name: rulesetName, action: 'delete', failure_reason: classifyFailureReason(error) });
        }
      }
      continue;
    }

    // create
    if (existing) {
      skipped.push({ repository, ruleset_name: rulesetName, action: 'noop', reason: 'already_exists', ruleset_id: existing.id });
    } else if (dryRun) {
      skipped.push({ repository, ruleset_name: rulesetName, action: 'create', reason: 'dry_run' });
    } else {
      const payload = entry.ruleset_payload || buildRepositoryRulesetPayload(entry);
      try {
        const result = await api.createRepositoryRuleset({ owner: organization, repo: repository, payload });
        applied.push({
          repository,
          ruleset_name: rulesetName,
          action: 'created',
          ruleset_id: result && result.ruleset ? result.ruleset.id : null,
        });
      } catch (error) {
        failed.push({ repository, ruleset_name: rulesetName, action: 'create', failure_reason: classifyFailureReason(error) });
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
