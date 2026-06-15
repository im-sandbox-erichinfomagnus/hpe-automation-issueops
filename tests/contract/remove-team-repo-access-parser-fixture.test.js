'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseTeamRepoAccessRemovalRequest } = require('../../src/workflow-support/parse-team-repo-access-removal-request');

function parseFixtureMarkdown(markdown) {
  const fields = {};
  const sections = markdown.split(/^###\s+/m).filter(Boolean);

  for (const section of sections) {
    const [rawHeading, ...rest] = section.split('\n');
    const value = rest.join('\n').trim();
    const heading = rawHeading.trim().toLowerCase();

    if (heading === 'target organization') {
      fields.organization = value;
    } else if (heading === 'target team') {
      fields.team = value;
    } else if (heading === 'designated repository-access approver') {
      fields.designated_approver = value;
    } else if (heading === 'intake mode') {
      fields.intake_mode = value;
    } else if (heading === 'requested repositories') {
      fields.requested_repositories = value;
    } else if (heading === 'business justification') {
      fields.business_justification = value;
    } else if (heading === 'dry-run mode') {
      fields.dry_run = value;
    }
  }

  return fields;
}

test('manual fixture exposes required removal fields', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'remove-team-repo-access-manual-issue.md');
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  const parsed = parseFixtureMarkdown(markdown);

  assert.equal(parsed.organization, 'octo-org');
  assert.equal(parsed.team, 'platform-engineering');
  assert.equal(parsed.designated_approver, 'octocat');
  assert.equal(parsed.intake_mode, 'manual');
  assert.match(parsed.requested_repositories, /service-catalog/);
  assert.equal(parsed.dry_run, 'true');
});

test('issue form exposes required governance and intake fields for removal requests', () => {
  const issueTemplatePath = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'remove-team-repo-access.yml');
  const issueTemplate = fs.readFileSync(issueTemplatePath, 'utf8');

  assert.match(issueTemplate, /id:\s+organization/);
  assert.match(issueTemplate, /id:\s+team/);
  assert.match(issueTemplate, /id:\s+designated_approver/);
  assert.match(issueTemplate, /id:\s+intake_mode/);
  assert.match(issueTemplate, /id:\s+requested_repositories/);
  assert.match(issueTemplate, /-\s+manual/);
  assert.match(issueTemplate, /-\s+csv_attachment/);
  assert.match(issueTemplate, /id:\s+business_justification/);
  assert.match(issueTemplate, /id:\s+dry_run/);
});

test('parser normalizes manual fixture into repository-removal request payload', () => {
  const fixturePath = path.join(__dirname, '..', 'fixtures', 'remove-team-repo-access-manual-issue.md');
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  const parsed = parseFixtureMarkdown(markdown);
  const request = parseTeamRepoAccessRemovalRequest({
    parsedRequest: {
      organization: parsed.organization,
      team: parsed.team,
      designated_approver: parsed.designated_approver,
      intake_mode: parsed.intake_mode,
      requested_repositories: parsed.requested_repositories,
      dry_run: parsed.dry_run,
    },
    issue: {
      number: 9101,
      user: { login: 'requester' },
    },
    repository: 'octo-org/issueops-speckit',
  });

  assert.equal(request.organization, 'octo-org');
  assert.equal(request.team_slug, 'platform-engineering');
  assert.equal(request.designated_approver_login, 'octocat');
  assert.equal(request.intake_mode, 'manual');
  assert.equal(request.request_status, 'submitted');
  assert.deepEqual(
    request.requested_repository_removals.map((entry) => entry.repository_full_name),
    ['octo-org/service-catalog', 'octo-org/developer-portal']
  );
});

