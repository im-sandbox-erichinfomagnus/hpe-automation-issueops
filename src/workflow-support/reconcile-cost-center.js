'use strict';

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function indexCostCenters(costCenters = []) {
  const byName = new Map();
  for (const costCenter of costCenters) {
    const key = normalizeName(costCenter.name);
    if (!key) {
      continue;
    }
    const members = new Set(
      (costCenter.resources || [])
        .filter((resource) => String(resource.type || '').toLowerCase() === 'user')
        .map((resource) => String(resource.name || '').toLowerCase())
    );
    byName.set(key, { id: costCenter.id || null, name: costCenter.name, members });
  }
  return byName;
}

function reconcileCostCenter(input = {}) {
  const request = input.request || {};
  const validatedAssignments = input.validatedAssignments || request.requested_assignments || [];
  const dryRun = Boolean(input.dry_run ?? request.dry_run);
  const enterpriseExists = input.enterprise_exists !== false;
  const liveStateVerified = input.live_state_verified === true;
  const byName = indexCostCenters(input.currentCostCenters || []);

  const costCentersToCreate = [];
  const seenCreateNames = new Set();
  const assignmentsToAdd = [];
  const assignmentsToRemove = [];
  const assignmentsAlreadySatisfied = [];
  const assignmentsRejected = [];

  for (const assignment of validatedAssignments) {
    if (assignment.validation_status && assignment.validation_status !== 'valid') {
      assignmentsRejected.push({
        ...assignment,
        desired_action: 'reject',
        failure_reason: assignment.failure_reason || 'rejected',
      });
      continue;
    }

    const nameKey = normalizeName(assignment.cost_center);
    const login = String(assignment.login || '').toLowerCase();
    const action = assignment.action === 'remove' ? 'remove' : 'add';
    const existing = byName.get(nameKey);

    if (action === 'remove') {
      if (liveStateVerified) {
        if (!existing) {
          assignmentsAlreadySatisfied.push({ ...assignment, reason: 'cost_center_absent' });
          continue;
        }
        if (!existing.members.has(login)) {
          assignmentsAlreadySatisfied.push({ ...assignment, reason: 'user_absent' });
          continue;
        }
      }
      assignmentsToRemove.push({
        cost_center: assignment.cost_center,
        cost_center_id: existing ? existing.id : null,
        login: assignment.login,
        source_row_number: assignment.source_row_number || null,
      });
      continue;
    }

    if (!existing) {
      if (!seenCreateNames.has(nameKey)) {
        seenCreateNames.add(nameKey);
        costCentersToCreate.push(assignment.cost_center);
      }
      assignmentsToAdd.push({
        cost_center: assignment.cost_center,
        cost_center_id: null,
        login: assignment.login,
        source_row_number: assignment.source_row_number || null,
      });
      continue;
    }

    if (liveStateVerified && existing.members.has(login)) {
      assignmentsAlreadySatisfied.push({ ...assignment, reason: 'user_present' });
      continue;
    }

    assignmentsToAdd.push({
      cost_center: assignment.cost_center,
      cost_center_id: existing.id,
      login: assignment.login,
      source_row_number: assignment.source_row_number || null,
    });
  }

  const hasWork =
    costCentersToCreate.length > 0 ||
    assignmentsToAdd.length > 0 ||
    assignmentsToRemove.length > 0;

  return {
    enterprise_exists: enterpriseExists,
    live_state_verified: liveStateVerified,
    intake_mode: request.intake_mode || null,
    cost_centers_to_create: costCentersToCreate,
    assignments_to_add: assignmentsToAdd,
    assignments_to_remove: assignmentsToRemove,
    assignments_already_satisfied: assignmentsAlreadySatisfied,
    assignments_rejected: assignmentsRejected,
    total_requested: validatedAssignments.length,
    dry_run: dryRun,
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    state:
      !hasWork || dryRun
        ? 'validated'
        : 'approved_for_execution',
  };
}

module.exports = {
  indexCostCenters,
  reconcileCostCenter,
};
