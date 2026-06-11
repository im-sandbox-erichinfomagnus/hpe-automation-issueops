'use strict';

// Cost centers are enterprise-scoped; there is no cheap REST check for a user's
// enterprise billing role, so authorization rests on two things: the designated
// approver named in the request must be the one who comments 'approved', and the
// executing credential is an enterprise-billing-scoped PAT (enforced by the policy
// guard). This resolver only decides whether the commenter is that designated
// approver.
function resolveCostCenterApprover(input = {}) {
  const approverLogin = String(input.approverLogin || '').toLowerCase();
  const designatedApproverLogin = String(input.designatedApproverLogin || '').toLowerCase();

  if (!approverLogin) {
    return { approver_login: '', approver_role: 'other' };
  }

  if (!designatedApproverLogin || approverLogin !== designatedApproverLogin) {
    return { approver_login: approverLogin, approver_role: 'other' };
  }

  return { approver_login: approverLogin, approver_role: 'designated_approver' };
}

module.exports = {
  resolveCostCenterApprover,
};
