'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { parseTeamHierarchyRequest } = require('../../src/workflow-support/parse-team-hierarchy-request');
const { validateTeamHierarchyRequest } = require('../../src/workflow-support/validate-team-hierarchy-request');

function parseFixtureMarkdown(markdown) {
  const fields = {};
  const sections = markdown.split(/^###\s+/m).filter(Boolean);

  for (const section of sections) {
    const [rawHeading, ...rest] = section.split('\n');
    const value = rest.join('\n').trim();
    const heading = rawHeading.trim().toLowerCase();

    if (heading === 'target organization') {
      fields.organization = value;
    } else if (heading === 'parent team') {
      fields.parent_team = value;
    } else if (heading === 'designated hierarchy approver') {
      fields.designated_approver = value;
    } else if (heading === 'requested child teams') {
      fields.requested_child_teams = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

function loadBaseFixture() {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'add-child-teams-issue.md');
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  return parseFixtureMarkdown(markdown);
}

test('parses a valid add-child-teams fixture into a normalized request', () => {
  const parsedRequest = loadBaseFixture();
  const request = parseTeamHierarchyRequest({
    parsedRequest,
    issue: { number: 501, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.organization, 'octo-org');
  assert.equal(request.parent_team_slug, 'platform-engineering');
  assert.equal(request.designated_approver_login, 'octocat');
  assert.equal(request.intake_mode, 'manual');
  assert.equal(request.requested_child_teams_input, parsedRequest.requested_child_teams);
  assert.equal(request.bulk_csv_input, '');
  assert.equal(request.bulk_csv_submission, null);
  assert.deepEqual(request.csv_row_findings, []);
  assert.equal(request.csv_row_numbering_convention, null);
  assert.deepEqual(
    request.requested_child_links.map((childLink) => childLink.child_team_slug),
    ['application-platform', 'release-engineering']
  );
  assert.equal(request.dry_run, true);
});

test('manual add-child-teams guidance remains visible in the issue form', () => {
  const templatePath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'add-child-teams.yml');
  const template = fs.readFileSync(templatePath, 'utf8');

  assert.match(template, /id:\s+requested_child_teams/);
  assert.match(template, /manual request path/i);
  assert.match(template, /one existing child team per line/i);
  assert.match(template, /requested_child_teams[\s\S]*required:\s+false/i);
  assert.match(template, /validation enforces exactly one populated intake mode/i);
});

test('rejects duplicate child teams from a fixture-derived submission', async () => {
  const parsedRequest = loadBaseFixture();
  parsedRequest.requested_child_teams = `${parsedRequest.requested_child_teams}\nApplication Platform`;

  const validation = await validateTeamHierarchyRequest({
    parsedRequest,
    issue: { number: 502, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, {
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { id: 1, name: 'Platform Engineering', slug: 'platform-engineering', parent: null },
      { id: 2, name: 'Application Platform', slug: 'application-platform', parent: null },
      { id: 3, name: 'Release Engineering', slug: 'release-engineering', parent: null },
    ]),
    resolveTeamMembership: async () => ({ membership: { role: 'maintainer', state: 'active' } }),
  });

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /duplicate child teams/i);
});

test('normalizes requested child teams from a code-fenced textarea payload', () => {
  const request = parseTeamHierarchyRequest({
    parsedRequest: {
      organization: 'octo-org',
      parent_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_child_teams: '```text\nApplication Platform\nAI Governance\n```',
      business_justification: 'Need hierarchy updates',
      dry_run: 'true',
    },
    issue: { number: 503, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  });

  assert.deepEqual(
    request.requested_child_links.map((childLink) => childLink.child_team_slug),
    ['application-platform', 'ai-governance']
  );
  assert.equal(request.intake_mode, 'manual');
  assert.equal(request.bulk_csv_submission, null);
  assert.deepEqual(request.invalid_child_teams, []);
});

test('rejects out-of-scope team creation input with a clear message', async () => {
  const validation = await validateTeamHierarchyRequest({
    parsedRequest: {
      organization: 'octo-org',
      parent_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_child_teams: 'Application Platform',
      requested_team_names: 'New Team',
      business_justification: 'Need hierarchy updates',
      dry_run: 'true',
    },
    issue: { number: 504, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, {
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { id: 1, name: 'Platform Engineering', slug: 'platform-engineering', parent: null },
      { id: 2, name: 'Application Platform', slug: 'application-platform', parent: null },
    ]),
    resolveTeamMembership: async () => ({ membership: { role: 'maintainer', state: 'active' } }),
  });

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /team-creation input is out of scope/i);
});

test('rejects out-of-scope member-management input with a clear message', async () => {
  const validation = await validateTeamHierarchyRequest({
    parsedRequest: {
      organization: 'octo-org',
      parent_team: 'Platform Engineering',
      designated_approver: 'octocat',
      requested_child_teams: 'Application Platform',
      requested_people: 'octocat',
      business_justification: 'Need hierarchy updates',
      dry_run: 'true',
    },
    issue: { number: 505, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, {
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      { id: 1, name: 'Platform Engineering', slug: 'platform-engineering', parent: null },
      { id: 2, name: 'Application Platform', slug: 'application-platform', parent: null },
    ]),
    resolveTeamMembership: async () => ({ membership: { role: 'maintainer', state: 'active' } }),
  });

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /member-management input is out of scope/i);
});

test('rejects ancestor-child cycle requests with a clear message', async () => {
  const validation = await validateTeamHierarchyRequest({
    parsedRequest: {
      organization: 'octo-org',
      parent_team: 'Application Infrastructure',
      designated_approver: 'octocat',
      requested_child_teams: 'Application Platform',
      business_justification: 'Need hierarchy updates',
      dry_run: 'true',
    },
    issue: { number: 506, user: { login: 'requester' } },
    repository: 'octo-org/issueops-speckit',
  }, {
    getOrganization: async () => ({ exists: true }),
    listTeams: async () => ([
      {
        id: 1,
        name: 'Platform Engineering',
        slug: 'platform-engineering',
        parent: null,
      },
      {
        id: 2,
        name: 'Application Platform',
        slug: 'application-platform',
        parent: {
          id: 1,
          name: 'Platform Engineering',
          slug: 'platform-engineering',
        },
      },
      {
        id: 3,
        name: 'Application Infrastructure',
        slug: 'application-infrastructure',
        parent: {
          id: 2,
          name: 'Application Platform',
          slug: 'application-platform',
        },
      },
    ]),
    resolveTeamMembership: async () => ({ membership: { role: 'maintainer', state: 'active' } }),
  });

  assert.equal(validation.is_valid, false);
  assert.match(validation.errors.join('\n'), /team hierarchy cycle/i);
});