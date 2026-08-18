'use strict';

const { classifyFailureReason } = require('./reconcile-tenant-variables');

// Reconciliation-first execution for org-wide organization Actions variables.
// Every entry carries its own effective operation (create/update/delete). The
// current state is read first and the API is only called when the desired
// state differs, so re-runs converge as no-ops. Dry-run reports intent only.
async function reconcileOrgVariables(input = {}) {
  const api = input.api;
  const organization = input.organization;
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const dryRun = Boolean(input.dry_run);
  const boundaryRevalidationStatus = input.boundary_revalidation_status || 'matched';

  const applied = [];
  const skipped = [];
  const failed = [];

  if (boundaryRevalidationStatus !== 'matched') {
    for (const entry of entries) {
      failed.push({
        name: entry.name,
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

  for (const entry of entries) {
    const name = entry.name;
    const entryOperation = String(entry.operation || '').toLowerCase();

    let current = null;
    try {
      const currentResult = await api.getOrganizationVariable({ organization, name });
      current = currentResult && currentResult.exists ? currentResult.variable : null;
    } catch (error) {
      failed.push({ name, action: 'read', failure_reason: classifyFailureReason(error) });
      continue;
    }

    if (entryOperation === 'delete') {
      if (!current) {
        skipped.push({ name, action: 'noop', reason: 'already_absent' });
        continue;
      }
      if (dryRun) {
        skipped.push({ name, action: 'delete', reason: 'dry_run' });
        continue;
      }
      try {
        await api.deleteOrganizationVariable({ organization, name });
        applied.push({ name, action: 'deleted' });
      } catch (error) {
        failed.push({ name, action: 'delete', failure_reason: classifyFailureReason(error) });
      }
      continue;
    }

    const desiredValue = entry.value == null ? '' : String(entry.value);
    if (current && String(current.value ?? '') === desiredValue) {
      skipped.push({ name, action: 'noop', reason: 'already_satisfied' });
      continue;
    }

    if (dryRun) {
      skipped.push({ name, action: current ? 'update' : 'create', reason: 'dry_run' });
      continue;
    }

    if (!current) {
      try {
        await api.createOrganizationVariable({
          organization,
          name,
          value: desiredValue,
          visibility: entry.visibility || 'all',
        });
        applied.push({ name, action: 'created' });
      } catch (error) {
        failed.push({ name, action: 'create', failure_reason: classifyFailureReason(error) });
      }
      continue;
    }

    try {
      await api.updateOrganizationVariable({ organization, name, value: desiredValue });
      applied.push({ name, action: 'updated' });
    } catch (error) {
      failed.push({ name, action: 'update', failure_reason: classifyFailureReason(error) });
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
  reconcileOrgVariables,
};
