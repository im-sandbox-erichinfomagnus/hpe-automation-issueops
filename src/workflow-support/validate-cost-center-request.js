'use strict';

const {
  ALLOWED_ACTIONS,
  COST_CENTER_NAME_MAX_LENGTH,
  parseCostCenterRequest,
} = require('./parse-cost-center-request');

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function describeResources(resources = []) {
  return resources
    .map((resource) => `${resource.type || 'resource'}:${resource.name || ''}`.replace(/:$/, ''))
    .join(', ');
}

async function validateCostCenterRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseCostCenterRequest(input);
  const errors = [];
  const warnings = [];

  if (!request.enterprise) {
    errors.push('Enterprise slug is required.');
  }
  if (!request.designated_approver_login) {
    errors.push('A designated approver is required.');
  }
  if (request.csv_schema_status === 'empty') {
    errors.push('The cost-center spreadsheet is empty.');
  } else if (request.csv_schema_status === 'invalid_header') {
    errors.push('The spreadsheet header must include at least the columns: cost_center, action.');
  }
  if (Array.isArray(request.unsupported_columns) && request.unsupported_columns.length > 0) {
    warnings.push(`Ignored unsupported columns: ${request.unsupported_columns.join(', ')}.`);
  }
  if (request.duplicate_row_count > 0) {
    warnings.push(`Removed ${request.duplicate_row_count} duplicate row(s).`);
  }
  if ((request.requested_changes || []).length === 0 && request.csv_schema_status === 'valid') {
    errors.push('The spreadsheet has a header but no data rows.');
  }

  let liveAccess = typeof options.listCostCenters === 'function';
  let activeCostCenters = [];
  if (liveAccess) {
    try {
      activeCostCenters = await options.listCostCenters({ enterprise: request.enterprise, state: 'active' });
    } catch (error) {
      // Fail soft: a missing or under-scoped token (e.g. the Actions GITHUB_TOKEN,
      // which cannot read enterprise billing) degrades to a spreadsheet-only plan
      // rather than failing the whole request.
      liveAccess = false;
      const reason = error && error.status ? `HTTP ${error.status}` : (error && error.message) || 'access error';
      warnings.push(`Could not list live cost centers (${reason}); the plan below is computed from the spreadsheet and will be verified at execution.`);
    }
  } else {
    warnings.push('Could not list live cost centers (no enterprise billing access); the plan below is computed from the spreadsheet and will be verified at execution.');
  }

  const byId = new Map();
  const byNameLower = new Map();
  for (const costCenter of activeCostCenters) {
    if (costCenter.id) {
      byId.set(String(costCenter.id).toLowerCase(), costCenter);
    }
    const nameKey = normalizeName(costCenter.name);
    if (nameKey) {
      if (!byNameLower.has(nameKey)) {
        byNameLower.set(nameKey, []);
      }
      byNameLower.get(nameKey).push(costCenter);
    }
  }

  function resolveTarget(row) {
    if (row.cost_center_id) {
      const match = byId.get(String(row.cost_center_id).toLowerCase()) || null;
      return { match, ambiguous: false, candidates: match ? [match] : [] };
    }
    const candidates = byNameLower.get(normalizeName(row.cost_center_input)) || [];
    if (candidates.length > 1) {
      return { match: null, ambiguous: true, candidates };
    }
    return { match: candidates[0] || null, ambiguous: false, candidates };
  }

  async function evaluateRow(row) {
    const base = {
      ...row,
      resolved_cost_center_id: null,
      resolved_name: '',
      new_name: row.new_name_input,
      desired_action: 'reject',
      validation_status: 'rejected',
      failure_reason: null,
      detail: '',
    };

    if (!ALLOWED_ACTIONS.includes(row.action)) {
      return { ...base, failure_reason: 'invalid_action', detail: `Action must be one of: ${ALLOWED_ACTIONS.join(', ')}.` };
    }
    if (!row.cost_center_input) {
      return { ...base, failure_reason: 'missing_cost_center', detail: 'cost_center is required.' };
    }

    // Fail-soft: without live access we cannot resolve ids/existence. Carry the
    // intended mutation as unverified; execution re-validates with live access.
    if (!liveAccess) {
      if (row.action === 'rename' && !row.new_name_input) {
        return { ...base, failure_reason: 'missing_new_name', detail: 'rename requires new_name.' };
      }
      if (row.new_name_input.length > COST_CENTER_NAME_MAX_LENGTH || row.cost_center_input.length > COST_CENTER_NAME_MAX_LENGTH) {
        return { ...base, failure_reason: 'name_too_long', detail: `Names must be at most ${COST_CENTER_NAME_MAX_LENGTH} characters.` };
      }
      return {
        ...base,
        desired_action: `${row.action}_cost_center`,
        validation_status: 'unverified',
        detail: 'Planned from the spreadsheet; will be verified against live cost centers at execution.',
      };
    }

    const { match, ambiguous, candidates } = resolveTarget(row);

    if (row.action === 'create') {
      if (row.cost_center_input.length > COST_CENTER_NAME_MAX_LENGTH) {
        return { ...base, failure_reason: 'name_too_long', detail: `Names must be at most ${COST_CENTER_NAME_MAX_LENGTH} characters.` };
      }
      if (match) {
        return {
          ...base,
          resolved_cost_center_id: match.id,
          resolved_name: match.name,
          desired_action: 'noop',
          validation_status: 'noop',
          detail: 'Cost center already exists.',
        };
      }
      return {
        ...base,
        desired_action: 'create_cost_center',
        validation_status: 'valid',
        detail: '',
      };
    }

    if (row.action === 'rename') {
      if (!row.new_name_input) {
        return { ...base, failure_reason: 'missing_new_name', detail: 'rename requires new_name.' };
      }
      if (row.new_name_input.length > COST_CENTER_NAME_MAX_LENGTH) {
        return { ...base, failure_reason: 'name_too_long', detail: `Names must be at most ${COST_CENTER_NAME_MAX_LENGTH} characters.` };
      }
      if (ambiguous) {
        return {
          ...base,
          failure_reason: 'ambiguous_cost_center',
          detail: `Name matches ${candidates.length} cost centers; set cost_center_id to one of: ${candidates.map((c) => c.id).join(', ')}.`,
        };
      }
      if (!match) {
        return { ...base, failure_reason: 'not_found', detail: 'No active cost center matches for rename.' };
      }
      if (normalizeName(match.name) === normalizeName(row.new_name_input)) {
        return {
          ...base,
          resolved_cost_center_id: match.id,
          resolved_name: match.name,
          desired_action: 'noop',
          validation_status: 'noop',
          detail: 'Cost center already has the requested name.',
        };
      }
      const targetNameOwners = byNameLower.get(normalizeName(row.new_name_input)) || [];
      const collision = targetNameOwners.some((owner) => String(owner.id) !== String(match.id));
      if (collision) {
        return {
          ...base,
          resolved_cost_center_id: match.id,
          resolved_name: match.name,
          failure_reason: 'name_taken',
          detail: `Another cost center already uses the name '${row.new_name_input}'.`,
        };
      }
      return {
        ...base,
        resolved_cost_center_id: match.id,
        resolved_name: match.name,
        desired_action: 'rename_cost_center',
        validation_status: 'valid',
        detail: '',
      };
    }

    // delete
    if (ambiguous) {
      return {
        ...base,
        failure_reason: 'ambiguous_cost_center',
        detail: `Name matches ${candidates.length} cost centers; set cost_center_id to one of: ${candidates.map((c) => c.id).join(', ')}.`,
      };
    }
    if (!match) {
      return {
        ...base,
        desired_action: 'noop',
        validation_status: 'noop',
        detail: 'No active cost center to delete (already absent).',
      };
    }

    let resources = match.resources || [];
    if ((!resources || resources.length === 0) && typeof options.getCostCenter === 'function') {
      const detailed = await options.getCostCenter({ enterprise: request.enterprise, costCenterId: match.id });
      resources = detailed && detailed.cost_center ? detailed.cost_center.resources || [] : [];
    }
    if (resources.length > 0 && !row.force) {
      return {
        ...base,
        resolved_cost_center_id: match.id,
        resolved_name: match.name,
        failure_reason: 'delete_blocked',
        detail: `Cost center still has ${resources.length} attached resource(s): ${describeResources(resources)}. Detach them (allocation op) or set force=true.`,
      };
    }
    return {
      ...base,
      resolved_cost_center_id: match.id,
      resolved_name: match.name,
      desired_action: 'delete_cost_center',
      validation_status: 'valid',
      detail: resources.length > 0 ? `Forced delete of a non-empty cost center (${resources.length} resource(s)).` : '',
    };
  }

  const evaluated = [];
  for (const row of request.requested_changes || []) {
    evaluated.push(await evaluateRow(row));
  }

  // Cross-row conflict detection: two mutating rows targeting the same cost center
  // with different actions cannot both proceed.
  const groups = new Map();
  for (const row of evaluated) {
    if (row.validation_status !== 'valid' && row.validation_status !== 'unverified') {
      continue;
    }
    const key = row.resolved_cost_center_id
      ? `id:${String(row.resolved_cost_center_id).toLowerCase()}`
      : `name:${normalizeName(row.cost_center_input)}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }
  for (const rowsInGroup of groups.values()) {
    const distinctActions = new Set(rowsInGroup.map((row) => row.desired_action));
    if (rowsInGroup.length > 1 && distinctActions.size > 1) {
      for (const row of rowsInGroup) {
        row.desired_action = 'reject';
        row.validation_status = 'rejected';
        row.failure_reason = 'conflicting_rows';
        row.detail = `Rows ${rowsInGroup.map((r) => r.source_row_number).join(', ')} target the same cost center with conflicting actions.`;
      }
    }
  }

  const rejectedRows = evaluated.filter((row) => row.validation_status === 'rejected');
  if (rejectedRows.length > 0) {
    warnings.push(`${rejectedRows.length} row(s) were rejected and will be skipped; see the per-row table.`);
  }

  const requestStatus = errors.length === 0 ? 'awaiting_approval' : 'validation_failed';

  return {
    is_valid: errors.length === 0,
    request_status: requestStatus,
    errors,
    warnings,
    live_access: liveAccess,
    requested_changes: evaluated,
    counts: {
      create: evaluated.filter((r) => r.desired_action === 'create_cost_center').length,
      rename: evaluated.filter((r) => r.desired_action === 'rename_cost_center').length,
      delete: evaluated.filter((r) => r.desired_action === 'delete_cost_center').length,
      noop: evaluated.filter((r) => r.validation_status === 'noop').length,
      rejected: rejectedRows.length,
    },
    request: {
      ...request,
      requested_changes: evaluated,
      request_status: requestStatus,
    },
  };
}

module.exports = {
  validateCostCenterRequest,
};
