'use strict';

const { parseSingleCsvRow } = require('./parse-single-csv-row');

const TENANT_CSV_COLUMNS = [
  'tenant_name',
  'tenant_admin_login',
  'tenant_type',
  'cmdb_id',
  'cost_center',
  'business_unit',
  'environment',
  'primary_contact',
  'secondary_contact',
  'code_scanning_enabled',
  'secret_scanning_enabled',
  'dependabot_enabled',
];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeIssueFormScalar(value) {
  const normalized = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  const candidateLine = normalized
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !/^#{1,6}\s+/.test(line)) || '';

  return candidateLine
    .replace(/\[([^\]]+)\]\((?:mailto:)?([^\)]+)\)/gi, (_match, label, target) => {
      const targetText = String(target || '').trim();
      return targetText || String(label || '').trim();
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeContactField(value) {
  const normalized = normalizeIssueFormScalar(value);
  const emailMatch = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return emailMatch ? emailMatch[0] : normalized;
}

function normalizeSlug(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 100);
}

function normalizeBoolean(value, defaultValue) {
  if (value == null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function normalizeEnum(value, allowedValues, defaultValue) {
  if (value == null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : defaultValue;
}

function normalizeTenantType(value) {
  return normalizeEnum(value, ['application', 'platform', 'shared-services'], 'application');
}

function normalizeEnvironment(value) {
  return normalizeEnum(value, ['prod', 'nonprod'], 'nonprod');
}

function normalizeLifecycleStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized || normalized === 'active') {
    return 'active';
  }
  if (['blocked', 'inactive', 'suspended'].includes(normalized)) {
    return 'blocked';
  }
  if (['partial_failure', 'partial-failure', 'failed_after_approved_execution', 'partially_executed'].includes(normalized)) {
    return 'partial_failure';
  }
  if (['decommissioned', 'retired'].includes(normalized)) {
    return 'decommissioned';
  }
  return 'active';
}

function readField(source, keys) {
  for (const key of keys) {
    if (source && source[key] != null && source[key] !== '') {
      return source[key];
    }
  }

  return '';
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function deriveTenantTeams(tenantDisplayName) {
  const normalizedTenant = normalizeSlug(tenantDisplayName);
  const rootTeamName = `${normalizedTenant}-root`;
  const adminTeamName = `${normalizedTenant}-admin`;
  const repoAdminsTeamName = `${normalizedTenant}-repo-admin`;
  const cicdAdminTeamName = `${normalizedTenant}-cicd-admin`;

  return {
    tenant_team_name: rootTeamName,
    tenant_team_slug: normalizeSlug(rootTeamName),
    admin_team_name: adminTeamName,
    admin_team_slug: normalizeSlug(adminTeamName),
    repo_admin_team_name: repoAdminsTeamName,
    repo_admin_team_slug: normalizeSlug(repoAdminsTeamName),
    cicd_admin_team_name: cicdAdminTeamName,
    cicd_admin_team_slug: normalizeSlug(cicdAdminTeamName),
  };
}

function deriveOrganizationRoleSpecifications(tenantKey) {
  const normalizedTenantKey = normalizeSlug(tenantKey || 'tenant');

  return [
    {
      role_key: 'tenant-admin',
      role_name: `${normalizedTenantKey}-tenant-admin`,
      permission_intent: 'create repos, create teams, manage repository access',
    },
    {
      role_key: 'repo-admin',
      role_name: `${normalizedTenantKey}-repo-admin`,
      permission_intent: 'create repos and manage repository access',
    },
    {
      role_key: 'developer',
      role_name: `${normalizedTenantKey}-developer`,
      permission_intent: 'contribute code to tenant repositories',
    },
    {
      role_key: 'viewer',
      role_name: `${normalizedTenantKey}-viewer`,
      permission_intent: 'read-only access to tenant repositories',
    },
  ];
}

function deriveCanonicalTopologyDraft(tenantDisplayName, organization) {
  const normalizedTenant = normalizeSlug(tenantDisplayName);
  const rootSlug = `${normalizedTenant}-root`;
  const adminSlug = `${normalizedTenant}-admin`;
  const repoAdminSlug = `${normalizedTenant}-repo-admin`;
  const cicdAdminSlug = `${normalizedTenant}-cicd-admin`;

  return {
    organization: {
      orgName: normalizeText(organization).toLowerCase(),
    },
    teams: {
      tenantRootTeam: rootSlug,
      structure: [
        {
          team: rootSlug,
          parent: null,
          type: 'root',
        },
        {
          team: adminSlug,
          parent: rootSlug,
          type: 'admin',
        },
        {
          team: repoAdminSlug,
          parent: rootSlug,
          type: 'repo-admin',
        },
        {
          team: cicdAdminSlug,
          parent: rootSlug,
          type: 'cicd-admin',
        },
      ],
    },
    repositories: {
      owned: [],
    },
    runnerTopology: {
      runnerGroups: [],
    },
    accessModel: {
      enforcement: 'tenant-boundary',
      roles: ['tenant-admin', 'repo-admin', 'developer', 'viewer'],
      organizationRoleSpecifications: deriveOrganizationRoleSpecifications(normalizedTenant),
    },
  };
}

function projectLegacyTenantRecord(legacyRecord = {}) {
  if (!legacyRecord || typeof legacyRecord !== 'object' || !legacyRecord.tenant_key) {
    return null;
  }

  const tenantDisplayName = normalizeText(legacyRecord.tenant_display_name || legacyRecord.tenant_key);
  const organization = normalizeText(legacyRecord.organization).toLowerCase();
  const topologyDraft = deriveCanonicalTopologyDraft(tenantDisplayName, organization);

  return {
    tenant_id: normalizeText(legacyRecord.tenant_key),
    tenant_name: tenantDisplayName,
    tenant_type: normalizeTenantType(legacyRecord.tenant_type),
    topology: topologyDraft,
    metadata: {
      createdBy: normalizeText(legacyRecord.requester_login).toLowerCase() || null,
      primaryContact: normalizeText(legacyRecord.primary_contact) || '',
      secondaryContact: normalizeText(legacyRecord.secondary_contact) || null,
    },
    compatibility_mode: 'legacy_projection',
    lifecycle_status_equivalent: normalizeLifecycleStatus(legacyRecord.lifecycle_status),
    legacy_lifecycle_status: normalizeText(legacyRecord.lifecycle_status) || null,
    source_issue_number: legacyRecord.source_issue_number || null,
    source_run_id: legacyRecord.source_run_id || null,
  };
}

function buildRequestId(repository, issueNumber, runId, runAttempt) {
  const issuePart = issueNumber != null ? String(issueNumber) : 'manual';
  const runPart = runId != null ? String(runId) : 'local';
  const attemptPart = runAttempt != null ? String(runAttempt) : '1';
  return `${repository || 'unknown-repo'}#${issuePart}/${runPart}.${attemptPart}`;
}

function parseCicdCapabilityIntent(parsed = {}, input = {}) {
  return {
    requested: normalizeBoolean(
      readField(parsed, ['cicd_capability_requested', 'parsed_cicd_capability_requested']) || input.cicd_capability_requested,
      true
    ),
    primary_path_available: normalizeBoolean(
      readField(parsed, ['cicd_primary_path_available', 'parsed_cicd_primary_path_available']) || input.cicd_primary_path_available,
      true
    ),
    primary_policy_approved: normalizeBoolean(
      readField(parsed, ['cicd_primary_policy_approved', 'parsed_cicd_primary_policy_approved']) || input.cicd_primary_policy_approved,
      true
    ),
    fallback_path_available: normalizeBoolean(
      readField(parsed, ['cicd_fallback_path_available', 'parsed_cicd_fallback_path_available']) || input.cicd_fallback_path_available,
      true
    ),
    fallback_policy_approved: normalizeBoolean(
      readField(parsed, ['cicd_fallback_policy_approved', 'parsed_cicd_fallback_policy_approved']) || input.cicd_fallback_policy_approved,
      true
    ),
    tenant_scope_resolvable: normalizeBoolean(
      readField(parsed, ['cicd_tenant_scope_resolvable', 'parsed_cicd_tenant_scope_resolvable']) || input.cicd_tenant_scope_resolvable,
      true
    ),
    requested_scope: normalizeText(
      readField(parsed, ['cicd_requested_scope', 'parsed_cicd_requested_scope']) || input.cicd_requested_scope || 'tenant'
    ).toLowerCase(),
    requires_broad_org_scope: normalizeBoolean(
      readField(parsed, ['cicd_requires_broad_org_scope', 'parsed_cicd_requires_broad_org_scope']) || input.cicd_requires_broad_org_scope,
      false
    ),
    requires_org_owner_grant: normalizeBoolean(
      readField(parsed, ['cicd_requires_org_owner_grant', 'parsed_cicd_requires_org_owner_grant']) || input.cicd_requires_org_owner_grant,
      false
    ),
  };
}

function parseTenantCreationRequest(input = {}) {
  const parsed = input.parsedRequest || input.parsed_request || {};
  const issue = input.issue || {};
  const runContext = input.runContext || input.run_context || {};

  const repository = input.repository || runContext.repository || process.env.GITHUB_REPOSITORY || '';
  const issueNumber = input.issueNumber || issue.number || runContext.issue_number || process.env.ISSUE_NUMBER;
  const requesterLogin = normalizeText(input.requesterLogin || issue.user && issue.user.login || '').toLowerCase();
  const legacyProjection = projectLegacyTenantRecord(input.legacyTenantRecord || input.legacy_tenant_record || null);
  const tenantCsv = parseSingleCsvRow(
    readField(parsed, ['tenant_csv', 'parsed_tenant_csv']) || input.tenant_csv || input.tenantCsv,
    TENANT_CSV_COLUMNS
  );
  const csvRow = tenantCsv.row || {};
  const organization = normalizeText(
    pickFirstNonEmpty(
      readField(parsed, ['organization', 'parsed_organization']),
      input.organization,
      legacyProjection && legacyProjection.topology && legacyProjection.topology.organization && legacyProjection.topology.organization.orgName
    )
  );
  const tenantDisplayName = normalizeIssueFormScalar(
    pickFirstNonEmpty(
      csvRow.tenant_name,
      readField(parsed, ['tenant_name', 'parsed_tenant_name']),
      input.tenant_name,
      legacyProjection && legacyProjection.tenant_name
    )
  );
  const tenantAdminLogin = normalizeIssueFormScalar(
    pickFirstNonEmpty(
      csvRow.tenant_admin_login,
      readField(parsed, ['tenant_admin_login', 'parsed_tenant_admin_login']),
      input.tenant_admin_login,
      input.tenantAdminLogin
    )
  ).toLowerCase();
  const designatedApprover = normalizeIssueFormScalar(readField(parsed, ['designated_approver', 'parsed_designated_approver']) || input.designated_approver).toLowerCase();
  const tenantType = normalizeTenantType(
    pickFirstNonEmpty(
      csvRow.tenant_type,
      readField(parsed, ['tenant_type', 'parsed_tenant_type']),
      input.tenant_type,
      legacyProjection && legacyProjection.tenant_type
    )
  );
  const primaryContact = normalizeContactField(
    pickFirstNonEmpty(
      csvRow.primary_contact,
      readField(parsed, ['primary_contact', 'parsed_primary_contact']),
      input.primary_contact,
      legacyProjection && legacyProjection.metadata && legacyProjection.metadata.primaryContact
    )
  );
  const secondaryContact = normalizeContactField(
    pickFirstNonEmpty(
      csvRow.secondary_contact,
      readField(parsed, ['secondary_contact', 'parsed_secondary_contact']),
      input.secondary_contact,
      legacyProjection && legacyProjection.metadata && legacyProjection.metadata.secondaryContact
    )
  ) || null;
  const cmdbId = normalizeIssueFormScalar(pickFirstNonEmpty(csvRow.cmdb_id, readField(parsed, ['cmdb_id', 'parsed_cmdb_id']), input.cmdb_id)) || null;
  const costCenter = normalizeIssueFormScalar(pickFirstNonEmpty(csvRow.cost_center, readField(parsed, ['cost_center', 'parsed_cost_center']), input.cost_center)) || null;
  const businessUnit = normalizeIssueFormScalar(pickFirstNonEmpty(csvRow.business_unit, readField(parsed, ['business_unit', 'parsed_business_unit']), input.business_unit)) || null;
  const environment = normalizeEnvironment(pickFirstNonEmpty(csvRow.environment, readField(parsed, ['environment', 'parsed_environment']), input.environment));
  const governanceCodeScanningEnabled = normalizeBoolean(
    pickFirstNonEmpty(csvRow.code_scanning_enabled, readField(parsed, ['governance_code_scanning_enabled', 'parsed_governance_code_scanning_enabled']), input.governance_code_scanning_enabled),
    true
  );
  const governanceSecretScanningEnabled = normalizeBoolean(
    pickFirstNonEmpty(csvRow.secret_scanning_enabled, readField(parsed, ['governance_secret_scanning_enabled', 'parsed_governance_secret_scanning_enabled']), input.governance_secret_scanning_enabled),
    true
  );
  const governanceDependabotEnabled = normalizeBoolean(
    pickFirstNonEmpty(csvRow.dependabot_enabled, readField(parsed, ['governance_dependabot_enabled', 'parsed_governance_dependabot_enabled']), input.governance_dependabot_enabled),
    true
  );
  const dryRun = normalizeBoolean(readField(parsed, ['dry_run', 'parsed_dry_run']) || input.dry_run, true);
  const justification = normalizeIssueFormScalar(readField(parsed, ['justification', 'parsed_justification', 'business_justification']) || input.justification);
  const submittedAt = input.submittedAt || new Date().toISOString();
  const requestId = buildRequestId(
    repository,
    issueNumber,
    runContext.run_id || process.env.GITHUB_RUN_ID,
    runContext.run_attempt || process.env.GITHUB_RUN_ATTEMPT
  );

  const tenantKey = normalizeSlug(tenantDisplayName);
  const derivedTeams = deriveTenantTeams(tenantDisplayName);
  const topologyDraft = deriveCanonicalTopologyDraft(tenantDisplayName, organization);
  const cicdCapabilityIntent = parseCicdCapabilityIntent(parsed, input);

  return {
    request_id: requestId,
    issue_number: issueNumber == null ? null : Number(issueNumber),
    repository,
    requester_login: requesterLogin,
    organization: organization.toLowerCase(),
    tenant_display_name: tenantDisplayName,
    tenant_key: tenantKey,
    tenant_type: tenantType,
    tenant_admin_login: tenantAdminLogin,
    designated_approver_login: designatedApprover,
    primary_contact: primaryContact,
    secondary_contact: secondaryContact,
    external_mappings: {
      cmdb_id: cmdbId,
      cost_center: costCenter,
      business_unit: businessUnit,
      environment,
    },
    governance: {
      code_scanning: {
        enabled: governanceCodeScanningEnabled,
        mandatory: true,
      },
      secret_scanning: {
        enabled: governanceSecretScanningEnabled,
        mandatory: true,
      },
      dependabot: {
        enabled: governanceDependabotEnabled,
      },
    },
    topology: topologyDraft,
    compatibility: legacyProjection
      ? {
        mode: legacyProjection.compatibility_mode,
        lifecycle_status_equivalent: legacyProjection.lifecycle_status_equivalent,
        legacy_source: {
          source_issue_number: legacyProjection.source_issue_number,
          source_run_id: legacyProjection.source_run_id,
        },
        provenance: {
          source_issue_number: legacyProjection.source_issue_number,
          source_run_id: legacyProjection.source_run_id,
          legacy_lifecycle_status: legacyProjection.legacy_lifecycle_status,
        },
      }
      : {
        mode: 'canonical',
        lifecycle_status_equivalent: 'active',
        legacy_source: null,
        provenance: null,
      },
    dry_run: dryRun,
    business_justification: justification,
    submitted_at: submittedAt,
    intake_mode: tenantCsv.provided ? 'csv' : 'manual',
    csv_input_provided: tenantCsv.provided,
    csv_row_count: tenantCsv.row_count,
    csv_input_errors: tenantCsv.errors,
    request_status: 'submitted',
    requested_teams: [
      {
        requested_name: derivedTeams.tenant_team_name,
        normalized_slug: derivedTeams.tenant_team_slug,
        desired_action: 'create_team',
        validation_status: 'valid',
        execution_result: 'not_started',
        failure_reason: null,
      },
      {
        requested_name: derivedTeams.admin_team_name,
        normalized_slug: derivedTeams.admin_team_slug,
        desired_action: 'create_team',
        validation_status: 'valid',
        execution_result: 'not_started',
        failure_reason: null,
      },
      {
        requested_name: derivedTeams.repo_admin_team_name,
        normalized_slug: derivedTeams.repo_admin_team_slug,
        desired_action: 'create_team',
        validation_status: 'valid',
        execution_result: 'not_started',
        failure_reason: null,
      },
      {
        requested_name: derivedTeams.cicd_admin_team_name,
        normalized_slug: derivedTeams.cicd_admin_team_slug,
        desired_action: 'create_team',
        validation_status: 'valid',
        execution_result: 'not_started',
        failure_reason: null,
      },
    ],
    parent_team_slug: derivedTeams.tenant_team_slug,
    requested_child_links: [
      {
        child_team_slug: derivedTeams.admin_team_slug,
        requested_child_name: derivedTeams.admin_team_name,
        desired_action: 'link_child',
        validation_status: 'valid',
        execution_result: 'not_started',
        failure_reason: null,
      },
      {
        child_team_slug: derivedTeams.repo_admin_team_slug,
        requested_child_name: derivedTeams.repo_admin_team_name,
        desired_action: 'link_child',
        validation_status: 'valid',
        execution_result: 'not_started',
        failure_reason: null,
      },
      {
        child_team_slug: derivedTeams.cicd_admin_team_slug,
        requested_child_name: derivedTeams.cicd_admin_team_name,
        desired_action: 'link_child',
        validation_status: 'valid',
        execution_result: 'not_started',
        failure_reason: null,
      },
    ],
    tenant_team_name: derivedTeams.tenant_team_name,
    tenant_team_slug: derivedTeams.tenant_team_slug,
    admin_team_name: derivedTeams.admin_team_name,
    admin_team_slug: derivedTeams.admin_team_slug,
    repo_admin_team_name: derivedTeams.repo_admin_team_name,
    repo_admin_team_slug: derivedTeams.repo_admin_team_slug,
    cicd_admin_team_name: derivedTeams.cicd_admin_team_name,
    cicd_admin_team_slug: derivedTeams.cicd_admin_team_slug,
    cicd_capability_intent: cicdCapabilityIntent,
  };
}

module.exports = {
  TENANT_CSV_COLUMNS,
  parseTenantCreationRequest,
  normalizeEnvironment,
  normalizeTenantType,
  normalizeBoolean,
  normalizeSlug,
  deriveCanonicalTopologyDraft,
  projectLegacyTenantRecord,
};
