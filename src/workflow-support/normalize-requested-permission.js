'use strict';

const ROLE_LABEL_TO_API_VALUE = {
  read: 'pull',
  triage: 'triage',
  write: 'push',
  maintain: 'maintain',
  admin: 'admin',
};

const API_PERMISSION_RANK = {
  none: 0,
  pull: 1,
  triage: 2,
  push: 3,
  maintain: 4,
  admin: 5,
};

function normalizePermissionLabel(value) {
  return String(value || '').trim().toLowerCase();
}

function isSupportedPermissionLabel(value) {
  return Object.prototype.hasOwnProperty.call(
    ROLE_LABEL_TO_API_VALUE,
    normalizePermissionLabel(value)
  );
}

function isSupportedPermissionApiValue(value) {
  return Object.prototype.hasOwnProperty.call(
    API_PERMISSION_RANK,
    String(value || '').trim().toLowerCase()
  );
}

function getPermissionRank(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return API_PERMISSION_RANK[normalized] ?? -1;
}

function comparePermissionStrength(leftValue, rightValue) {
  return getPermissionRank(leftValue) - getPermissionRank(rightValue);
}

function normalizeRequestedPermission(value) {
  const requestedPermissionLabel = normalizePermissionLabel(value);
  const requestedPermissionApiValue = ROLE_LABEL_TO_API_VALUE[requestedPermissionLabel] || '';

  return {
    requested_permission_label: requestedPermissionLabel,
    requested_permission_api_value: requestedPermissionApiValue,
    requested_permission_rank: requestedPermissionApiValue
      ? getPermissionRank(requestedPermissionApiValue)
      : -1,
    is_supported: Boolean(requestedPermissionApiValue),
  };
}

module.exports = {
  API_PERMISSION_RANK,
  ROLE_LABEL_TO_API_VALUE,
  comparePermissionStrength,
  getPermissionRank,
  isSupportedPermissionApiValue,
  isSupportedPermissionLabel,
  normalizePermissionLabel,
  normalizeRequestedPermission,
};