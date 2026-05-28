'use strict';

function buildAssignmentFinding(assignment, overrides = {}) {
  return {
    cost_center: assignment.cost_center,
    login: assignment.login,
    action: assignment.action === 'remove' ? 'remove' : 'add',
    source_row_number: assignment.source_row_number || null,
    validation_status: assignment.validation_status || 'valid',
    desired_action: assignment.desired_action || (assignment.action === 'remove' ? 'remove_user' : 'add_user'),
    current_membership_state: 'unknown',
    execution_result: 'not_started',
    failure_reason: assignment.failure_reason || null,
    ...overrides,
  };
}

async function validateCostCenterRequest(request, hooks = {}) {
  const errors = [];
  const warnings = [];
  const csvSubmission = request.csv_submission || null;

  if (!request.enterprise) {
    errors.push('Enterprise slug is required.');
  }

  if (!request.intended_approver_login) {
    errors.push('Intended approver login is required.');
  }

  if (!request.intake_mode) {
    errors.push('Provide a cost center assignments CSV with a `cost_center,login,action` header.');
  }

  if (csvSubmission && csvSubmission.schema_status === 'invalid') {
    for (const schemaError of csvSubmission.schema_errors || []) {
      errors.push(schemaError);
    }
  }

  const requestedAssignments = request.requested_assignments || [];
  const invalidAssignments = request.invalid_assignments || [];
  if (requestedAssignments.length === 0 && invalidAssignments.length === 0 && request.intake_mode) {
    errors.push('No usable assignment rows were found in the CSV.');
  }

  if ((request.invalid_assignments || []).length > 0) {
    warnings.push(
      `${request.invalid_assignments.length} CSV row(s) were rejected during parsing and will be skipped.`
    );
  }

  if ((request.duplicate_assignments || []).length > 0) {
    warnings.push(
      `${request.duplicate_assignments.length} duplicate CSV row(s) were collapsed.`
    );
  }

  let enterpriseVisible = null;
  let liveStateVerified = false;
  let existingCostCenters = [];

  const listCostCenters = hooks.listCostCenters;
  if (typeof listCostCenters === 'function' && request.enterprise) {
    try {
      existingCostCenters = await listCostCenters({ enterprise: request.enterprise });
      enterpriseVisible = true;
      liveStateVerified = true;
    } catch (error) {
      enterpriseVisible = false;
      liveStateVerified = false;
      warnings.push(
        `Live cost center state could not be confirmed (${error.message}). Validation continued against the CSV only.`
      );
    }
  } else {
    warnings.push(
      'No enterprise billing token was available, so live cost center state was not confirmed. The execution phase will run in dry-run and report the planned changes.'
    );
  }

  const assignmentFindings = requestedAssignments.map((assignment) => buildAssignmentFinding(assignment));

  const isValid = errors.length === 0 && requestedAssignments.length > 0;

  return {
    is_valid: isValid,
    request_status: isValid ? 'validated' : 'validation_failed',
    errors,
    warnings,
    enterprise_visible: enterpriseVisible,
    live_state_verified: liveStateVerified,
    existing_cost_centers: existingCostCenters,
    csv_submission: csvSubmission,
    csv_row_findings: request.csv_row_findings || [],
    csv_row_numbering_convention: request.csv_row_numbering_convention || null,
    requested_assignments: assignmentFindings,
    request: {
      ...request,
      request_status: isValid ? 'validated' : 'validation_failed',
    },
  };
}

module.exports = {
  buildAssignmentFinding,
  validateCostCenterRequest,
};
