'use strict';

function maskToken(token) {
  if (!token) {
    return '';
  }

  if (token.length <= 8) {
    return `${token.slice(0, 2)}***${token.slice(-1)}`;
  }

  return `${token.slice(0, 4)}***${token.slice(-4)}`;
}

function loadWorkflowToken(options = {}) {
  const env = options.env || process.env;
  const tokenEnvNames = options.tokenEnvNames || [
    'ISSUEOPS_GITHUB_TOKEN',
    'GITHUB_TOKEN',
  ];

  for (const envName of tokenEnvNames) {
    const value = env[envName];
    if (value) {
      const isPatBacked =
        envName === 'ISSUEOPS_GITHUB_TOKEN' || env.GITHUB_TOKEN_IS_PAT === 'true';
      return {
        token: value,
        source: envName,
        is_pat_backed: isPatBacked,
        token_kind: isPatBacked ? 'pat' : envName === 'GITHUB_TOKEN' ? 'github_token' : 'unknown',
        supports_org_mutation: isPatBacked,
        supports_team_hierarchy_mutation: isPatBacked,
        supports_team_repo_access_mutation: isPatBacked,
        masked_token: maskToken(value),
      };
    }
  }

  if (options.required === false) {
    return {
      token: null,
      source: null,
      is_pat_backed: false,
      token_kind: 'missing',
      supports_org_mutation: false,
      supports_team_hierarchy_mutation: false,
      supports_team_repo_access_mutation: false,
      masked_token: '',
    };
  }

  throw new Error(
    `Missing workflow token. Expected one of: ${tokenEnvNames.join(', ')}`
  );
}

module.exports = {
  loadWorkflowToken,
  maskToken,
};