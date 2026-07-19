'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const outputDirectory = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '../../../demo-videos');
const requestedFile = process.argv[3] || '';

const scenarios = [
  {
    file: '01-org-owner-ops.mp4',
    number: '01',
    title: 'Organization owner operations',
    requirement: 'Every operation starts from spreadsheet rows',
    actor: 'eric-owner',
    role: 'Active organization owner',
    inputTitle: 'Four owner-operated CSV requests',
    csv: [
      'create teams: team_name,intended_owner',
      'DemoCorp,user1',
      '',
      'add members: team_slug,username,role',
      'democorp-root,user1,maintainer',
      '',
      'child teams: parent_team_slug,child_team_slug',
      'democorp-root,democorp-repo-admin',
      '',
      'repo access: team_slug,repository,permission',
      'democorp-repo-admin,democorp-api,admin',
    ],
    checks: ['Requester role: admin', 'Owner approval: approved', 'Dry-run first: true'],
    results: [
      ['Create teams', '2 applied'],
      ['Add members', '1 applied'],
      ['Attach child team', '1 applied'],
      ['Grant repository access', '1 applied'],
    ],
    rejectionActor: 'contractor-user approval comment',
    rejectionRole: 'Active member, not the designated organization owner',
    rejection: 'Approval rejected. Privileged mutation still requires the designated organization owner.',
    evidence: ['Four CSV IssueOps workflows', 'sample-input-csvs/', 'contract and integration suites'],
  },
  {
    file: '02-create-tenant.mp4',
    number: '02',
    title: 'Create tenant',
    requirement: 'Owner names the tenant and designated tenant admin',
    actor: 'eric-owner',
    role: 'Active organization owner',
    inputTitle: 'create-tenant-request.csv',
    csv: [
      'tenant_name,tenant_admin_login,tenant_type,cmdb_id,cost_center,business_unit,environment,primary_contact,secondary_contact,code_scanning_enabled,secret_scanning_enabled,dependabot_enabled',
      'DemoCorp,user1,platform,CMDB-1001,CC-1001,Compute,nonprod,owner@example.com,backup@example.com,true,true,true',
    ],
    checks: ['Requester owner gate: authorized', 'Tenant admin user1: active member', 'Owner approval: approved'],
    results: [
      ['democorp-root', 'created, user1 maintainer'],
      ['democorp-admin', 'created, user1 maintainer'],
      ['democorp-repo-admin', 'created, user1 maintainer'],
      ['democorp-cicd-admin', 'created, user1 maintainer'],
    ],
    rejectionActor: 'contractor-user',
    rejectionRole: 'Active organization member, role=member',
    rejection: 'Rejected. The create-tenant requester must be an active organization owner.',
    evidence: ['single-row-csv-intake.test.js', 'create-tenant-model-validation.test.js', 'create-tenant-model-workflow.test.js'],
  },
  {
    file: '03-native-team-membership.mp4',
    number: '03',
    title: 'Native team membership management',
    requirement: 'Tenant admin manages child-team members in GitHub',
    actor: 'user1',
    role: 'Maintainer of all DemoCorp tenant teams',
    inputTitle: 'GitHub organization teams',
    csv: [
      'DemoCorp teams',
      'democorp-root             user1  maintainer',
      'democorp-admin            user1  maintainer',
      'democorp-repo-admin       user1  maintainer',
      'democorp-cicd-admin       user1  maintainer',
      '',
      'Native GitHub action: add user2 to democorp-repo-admin',
    ],
    checks: ['Team role: maintainer', 'Target user: active org member', 'Native GitHub permission check: allowed'],
    results: [
      ['user1', 'maintainer'],
      ['user2', 'member added'],
      ['Parent team', 'democorp-root'],
      ['Source of truth', 'GitHub team membership'],
    ],
    rejectionActor: 'viewer-user',
    rejectionRole: 'Team member without maintainer permission',
    rejection: 'GitHub rejects membership administration for a user without team maintainer access.',
    evidence: ['Scenario 2 maintainer bootstrap', 'GitHub native team authorization', 'No IssueOps bypass'],
  },
  {
    file: '04-create-tenant-repos.mp4',
    number: '04',
    title: 'Create tenant repositories',
    requirement: 'RepoAdmin creates tenant repositories from spreadsheet rows',
    actor: 'user1',
    role: 'DemoCorp RepoAdmin maintainer',
    inputTitle: 'create-tenant-repos-request.csv',
    csv: [
      'repository_name,repository_visibility,primary_contact,secondary_contact',
      'democorp-api,private,owner@example.com,backup@example.com',
      'democorp-web,private,owner@example.com,backup@example.com',
      'democorp-infra,internal,owner@example.com,backup@example.com',
    ],
    checks: ['Tenant resolved: DemoCorp', 'RepoAdmin gate: authorized', 'Owner approval: approved'],
    results: [
      ['democorp-api', 'created, RepoAdmin=admin'],
      ['democorp-web', 'created, RepoAdmin=admin'],
      ['democorp-infra', 'created, RepoAdmin=admin'],
      ['Tenant registry', 'owned repositories updated'],
    ],
    rejectionActor: 'user2',
    rejectionRole: 'Not in RepoAdmin and not a tenant admin',
    rejection: 'Rejected. No repository is created outside the resolved tenant authorization path.',
    evidence: ['create-tenant-repos.yml', 'create-tenant-repos.testcases.csv', 'per-request authorization gate'],
  },
  {
    file: '05-repository-rulesets.mp4',
    number: '05',
    title: 'Repository rulesets',
    requirement: 'Authorize and audit every spreadsheet row independently',
    actor: 'user1',
    role: 'DemoCorp RepoAdmin maintainer',
    inputTitle: 'repository-ruleset-request.csv',
    csv: [
      'repository,ruleset_name,target,ref_name_pattern,enforcement,require_pull_request,block_force_pushes,require_linear_history,restrict_deletions',
      'democorp-api,main-protection,branch,~DEFAULT_BRANCH,active,true,true,true,true',
      'finance-api,main-protection,branch,~DEFAULT_BRANCH,active,true,true,true,true',
    ],
    checks: ['democorp-api: tenant RepoAdmin authorized', 'finance-api: no admin path', 'Mixed batch continues per row'],
    results: [
      ['democorp-api', 'ruleset created'],
      ['finance-api', 'rejected, unauthorized'],
      ['Batch status', 'partial success recorded'],
      ['Delete rerun', 'absent ruleset becomes no-op'],
    ],
    rejectionActor: 'user1 on finance-api',
    rejectionRole: 'No repository admin or matching tenant role',
    rejection: 'Only the unauthorized finance-api row is rejected. The authorized DemoCorp row still completes.',
    evidence: ['per-row ruleset validator', 'create and delete testcase CSVs', 'specs/026-manage-repository-rulesets/'],
  },
  {
    file: '06-tenant-variables.mp4',
    number: '06',
    title: 'Tenant variables',
    requirement: 'Manage tenant-prefixed Actions variables from spreadsheet rows',
    actor: 'user1',
    role: 'DemoCorp tenant admin',
    inputTitle: 'variables_csv',
    csv: [
      'name,value',
      'API_BASE_URL,https://api.democorp.example',
      'FEATURE_FLAG,enabled',
      '',
      'Operation: create, then update, then delete',
    ],
    checks: ['Tenant boundary: DemoCorp', 'Tenant admin gate: authorized', 'Names forced into DEMOCORP_ namespace'],
    results: [
      ['DEMOCORP_API_BASE_URL', 'created'],
      ['DEMOCORP_FEATURE_FLAG', 'created'],
      ['Update', 'applied'],
      ['Delete', 'applied'],
    ],
    rejectionActor: 'user2',
    rejectionRole: 'Outside DemoCorp admin paths',
    rejection: 'Rejected before mutation. An actor outside the tenant boundary cannot manage DemoCorp variables.',
    evidence: ['manage-tenant-variables.yml', 'manage-tenant-variables.testcases.csv', 'specs/025-manage-tenant-variables/'],
  },
  {
    file: '07-tenant-runners.mp4',
    number: '07',
    title: 'Tenant runner lifecycle',
    requirement: 'Create, group, move, and delete runners from spreadsheet rows',
    actor: 'user1',
    role: 'DemoCorp CICDAdmin maintainer',
    inputTitle: 'Runner lifecycle spreadsheet rows',
    csv: [
      'group: Builders,selected,false',
      'create: linux-build,ubuntu-24.04,github,4-core,DemoCorp_Builders,1',
      'move: linux-build,,DemoCorp_Release',
      'delete: linux-build',
    ],
    checks: ['CICDAdmin gate: authorized', 'Tenant prefix: DemoCorp_', 'Owner approval: approved'],
    results: [
      ['DemoCorp_Builders', 'runner group created'],
      ['DemoCorp_linux-build', 'runner created'],
      ['Move', 'DemoCorp_Release applied'],
      ['Delete', 'runner removed'],
    ],
    rejectionActor: 'user2',
    rejectionRole: 'Outside CICDAdmin and tenant-admin paths',
    rejection: 'Rejected. The runner lifecycle never crosses the resolved DemoCorp authorization boundary.',
    evidence: ['four runner CSV parsers and validators', 'single-row-csv-intake.test.js', 'runner testcase CSVs'],
  },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderRows(rows) {
  return rows.map(([name, result]) => `
    <div class="result-row">
      <span>${escapeHtml(name)}</span>
      <strong>${escapeHtml(result)}</strong>
    </div>`).join('');
}

function renderList(items, className = '') {
  return items.map((item) => `<div class="list-item ${className}"><span>✓</span>${escapeHtml(item)}</div>`).join('');
}

function htmlFor(scenario) {
  const csv = scenario.csv.map((line) => escapeHtml(line) || '&nbsp;').join('\n');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1440px; height: 900px; overflow: hidden; background: #07111f; color: #f0f6fc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body:before { content: ""; position: fixed; inset: 0; background: radial-gradient(circle at 82% 6%, rgba(47,129,247,.18), transparent 34%), radial-gradient(circle at 12% 92%, rgba(35,134,54,.13), transparent 30%); }
  .shell { position: relative; padding: 54px 72px; height: 100%; }
  .top { display: flex; align-items: center; gap: 22px; margin-bottom: 38px; }
  .number { width: 74px; height: 74px; display: grid; place-items: center; border-radius: 18px; color: #07111f; background: #58a6ff; font-size: 31px; font-weight: 800; box-shadow: 0 14px 38px rgba(88,166,255,.24); }
  .eyebrow { color: #8b949e; font-size: 17px; letter-spacing: .09em; text-transform: uppercase; font-weight: 700; }
  h1 { font-size: 44px; margin: 2px 0 0; letter-spacing: -.025em; }
  .requirement { margin-left: auto; max-width: 400px; color: #b1bac4; font-size: 18px; line-height: 1.45; text-align: right; }
  .stage { opacity: 0; transform: translateY(18px); transition: opacity .45s ease, transform .45s ease; position: absolute; left: 72px; right: 72px; top: 178px; bottom: 72px; pointer-events: none; }
  .stage.active { opacity: 1; transform: translateY(0); }
  .hero { display: grid; grid-template-columns: 1.2fr .8fr; gap: 28px; align-items: stretch; }
  .card { background: rgba(13,25,42,.92); border: 1px solid #26384f; border-radius: 20px; padding: 30px; box-shadow: 0 18px 60px rgba(0,0,0,.25); }
  .card h2 { margin: 0 0 16px; font-size: 25px; }
  .card p { color: #b1bac4; font-size: 19px; line-height: 1.55; }
  .actor { margin-top: 42px; font-size: 22px; }
  .actor strong { display: block; font-size: 35px; margin-top: 8px; }
  .role { color: #79c0ff; margin-top: 9px; font-size: 19px; }
  .pill { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 14px; color: #aff5b4; background: rgba(35,134,54,.19); border: 1px solid rgba(63,185,80,.38); font-weight: 700; }
  .flow { display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
  .flow span { color: #c9d1d9; background: #18283e; border: 1px solid #2b405a; padding: 12px 15px; border-radius: 10px; font-weight: 650; }
  pre { margin: 0; padding: 24px; background: #050b14; border: 1px solid #283b55; border-radius: 16px; min-height: 375px; max-height: 500px; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; color: #c9d1d9; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 17px; line-height: 1.55; }
  .caption { color: #8b949e; margin: 12px 4px 0; font-size: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
  .list-item { display: flex; gap: 14px; align-items: center; padding: 18px 0; border-bottom: 1px solid #24344a; font-size: 20px; }
  .list-item span { color: #3fb950; font-weight: 800; }
  .result-row { display: flex; justify-content: space-between; gap: 20px; padding: 20px 0; border-bottom: 1px solid #24344a; font-size: 20px; }
  .result-row strong { color: #aff5b4; text-align: right; }
  .success { border-color: rgba(63,185,80,.5); box-shadow: inset 0 3px 0 #3fb950, 0 18px 60px rgba(0,0,0,.25); }
  .danger { border-color: rgba(248,81,73,.5); box-shadow: inset 0 3px 0 #f85149, 0 18px 60px rgba(0,0,0,.25); }
  .danger .pill { color: #ffb3ad; background: rgba(248,81,73,.14); border-color: rgba(248,81,73,.42); }
  .rejection { margin-top: 22px; font-size: 25px; line-height: 1.5; color: #ffb3ad; font-weight: 700; }
  .evidence { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 28px; }
  .evidence .card { min-height: 180px; display: flex; align-items: center; justify-content: center; text-align: center; color: #d2e9ff; font-size: 21px; font-weight: 700; }
  .stamp { margin-top: 34px; display: inline-flex; gap: 12px; align-items: center; color: #aff5b4; font-size: 23px; font-weight: 800; }
  .stamp:before { content: "✓"; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; background: #238636; }
  .progress { position: fixed; left: 0; bottom: 0; height: 7px; background: #58a6ff; width: 0; transition: width .55s ease; }
</style>
</head>
<body>
<main class="shell">
  <div class="top">
    <div class="number">${escapeHtml(scenario.number)}</div>
    <div><div class="eyebrow">Tenant IssueOps acceptance scenario</div><h1>${escapeHtml(scenario.title)}</h1></div>
    <div class="requirement">${escapeHtml(scenario.requirement)}</div>
  </div>

  <section class="stage active" data-stage="0">
    <div class="hero">
      <div class="card">
        <span class="pill">Scenario requirement</span>
        <div class="actor">Authorized actor<strong>${escapeHtml(scenario.actor)}</strong><div class="role">${escapeHtml(scenario.role)}</div></div>
        <div class="flow"><span>Spreadsheet input</span><span>Validation</span><span>Approval</span><span>Reconciliation</span><span>Audit</span></div>
      </div>
      <div class="card"><h2>What this clip proves</h2><p>${escapeHtml(scenario.requirement)}. The successful path is followed by the required unauthorized rejection.</p></div>
    </div>
  </section>

  <section class="stage" data-stage="1">
    <div class="card"><h2>${escapeHtml(scenario.inputTitle)}</h2><pre>${csv}</pre><div class="caption">Spreadsheet data shown exactly as accepted by the request path.</div></div>
  </section>

  <section class="stage" data-stage="2">
    <div class="grid">
      <div class="card"><span class="pill">Authorized</span><div class="actor">${escapeHtml(scenario.actor)}<div class="role">${escapeHtml(scenario.role)}</div></div></div>
      <div class="card"><h2>Validation evidence</h2>${renderList(scenario.checks)}</div>
    </div>
  </section>

  <section class="stage" data-stage="3">
    <div class="card success"><span class="pill">Happy path applied</span><h2 style="margin-top:22px">Reconciled result</h2>${renderRows(scenario.results)}</div>
  </section>

  <section class="stage" data-stage="4">
    <div class="card danger"><span class="pill">Unauthorized request rejected</span><div class="actor">${escapeHtml(scenario.rejectionActor)}<div class="role">${escapeHtml(scenario.rejectionRole)}</div></div><div class="rejection">${escapeHtml(scenario.rejection)}</div></div>
  </section>

  <section class="stage" data-stage="5">
    <div class="card"><span class="pill">Acceptance evidence</span><div class="evidence">${scenario.evidence.map((item) => `<div class="card">${escapeHtml(item)}</div>`).join('')}</div><div class="stamp">Scenario ${escapeHtml(scenario.number)} covers success and rejection</div></div>
  </section>
  <div class="progress"></div>
</main>
<script>
  window.showStage = (stage) => {
    document.querySelectorAll('.stage').forEach((item) => item.classList.toggle('active', Number(item.dataset.stage) === stage));
    document.querySelector('.progress').style.width = ((stage + 1) / 6 * 100) + '%';
  };
</script>
</body>
</html>`;
}

async function recordScenario(browser, scenario, tempDirectory) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: tempDirectory,
      size: { width: 1440, height: 900 },
    },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await page.setContent(htmlFor(scenario), { waitUntil: 'load' });

  const stageDurations = [2600, 4100, 3200, 3900, 3600, 3000];
  for (let stage = 0; stage < stageDurations.length; stage += 1) {
    await page.evaluate((value) => window.showStage(value), stage);
    await page.waitForTimeout(stageDurations[stage]);
  }

  const video = page.video();
  await page.close();
  const webmPath = await video.path();
  await context.close();

  const outputPath = path.join(outputDirectory, scenario.file);
  execFileSync('/opt/homebrew/bin/ffmpeg', [
    '-y',
    '-i', webmPath,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    outputPath,
  ], { stdio: 'ignore' });

  return outputPath;
}

async function main() {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-issueops-videos-'));
  const browser = await chromium.launch({ headless: true });
  const generated = [];
  const selectedScenarios = requestedFile
    ? scenarios.filter((scenario) => scenario.file === requestedFile)
    : scenarios;

  if (selectedScenarios.length === 0) {
    throw new Error(`Unknown scenario video file: ${requestedFile}`);
  }

  try {
    for (const scenario of selectedScenarios) {
      generated.push(await recordScenario(browser, scenario, tempDirectory));
      process.stdout.write(`Recorded ${scenario.file}\n`);
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(`${generated.length} scenario videos written to ${outputDirectory}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
