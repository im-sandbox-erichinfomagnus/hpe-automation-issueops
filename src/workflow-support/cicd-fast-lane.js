'use strict';

// The CI/CD fast lane, in one place.
//
// These operations waive the approval comment when the requester already holds the tenant
// CI/CD role, because the requester gate at intake has already proved the authority the
// approval would have confirmed. Until 1.0.8 the list and the qualifying paths lived
// privately inside run-approval-gate.js, and the five validators that need the same answer
// could not see them - so each one demanded a designated approver the gate was never going
// to consult. Keeping one definition here is what stops those two answers drifting apart.
const CICD_FAST_LANE_OPERATIONS = [
  'hosted_runner_creation',
  'hosted_runner_deletion',
  'hosted_runner_move',
  'runner_group_creation',
  'tenant_variable_management',
];

// The authorization paths that qualify. 'tenant_admin_maintainer' is stamped by the tenant
// CI/CD context resolver for a match on the tenant admin team; 'tenant_cicd_admin_team' for
// a match on the dedicated CI/CD admin team. Anything else - 'none' included - does not
// waive approval, and a requester on that path still needs an approver.
const CICD_ROLE_HOLDER_PATHS = ['tenant_cicd_admin_team', 'tenant_admin_maintainer'];

function isCicdFastLaneOperation(operation) {
  return CICD_FAST_LANE_OPERATIONS.includes(String(operation || ''));
}

// True when the approval comment will be waived for a requester on this path, so asking them
// to name an approver serves no purpose. Fails closed: an absent or unrecognised path is not
// a waiver, and the designated-approver requirement stands.
function waivesApprovalComment(requesterAuthorizationPath) {
  return CICD_ROLE_HOLDER_PATHS.includes(String(requesterAuthorizationPath || ''));
}

module.exports = {
  CICD_FAST_LANE_OPERATIONS,
  CICD_ROLE_HOLDER_PATHS,
  isCicdFastLaneOperation,
  waivesApprovalComment,
};
