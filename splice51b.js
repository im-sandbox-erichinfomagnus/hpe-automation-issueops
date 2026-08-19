const fs = require('fs');
const path = 'src/scripts/run-approved-execution.js';
const lines = fs.readFileSync(path, 'utf8').split('\n');
const ours = fs.readFileSync(process.env.TEMP + '\\rae51-ours.js', 'utf8').split('\n');
const theirs = fs.readFileSync(process.env.TEMP + '\\rae51-theirs.js', 'utf8').split('\n');

let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('<<<<<<<') && lines[i + 1] && lines[i + 1].startsWith('async function executeRepoAdminMembership')) { start = i; break; }
}
const rrIdx = lines.findIndex(l => l.startsWith('async function executeRepositoryRulesetManagement'));
if (start < 0 || rrIdx < 0 || rrIdx <= start) { console.error('bounds not found', start, rrIdx); process.exit(1); }

const oStart = ours.findIndex(l => l.startsWith('async function executeRepoAdminMembership'));
const oEnd = ours.findIndex(l => l.startsWith('async function executeRepositoryRulesetManagement'));
const tStart = theirs.findIndex(l => l.startsWith('async function executeCicdAdminMembership'));
const tEnd = theirs.findIndex(l => l.startsWith('async function executeRepositoryRulesetManagement'));
if (oStart < 0 || oEnd < 0 || tStart < 0 || tEnd < 0) { console.error('stage bounds missing'); process.exit(1); }

const replacement = [...ours.slice(oStart, oEnd), ...theirs.slice(tStart, tEnd)];
const out = [...lines.slice(0, start), ...replacement, ...lines.slice(rrIdx)];
fs.writeFileSync(path, out.join('\n'));
console.log(`replaced working[${start + 1}..${rrIdx}] with ours[${oStart + 1}..${oEnd}] + theirs[${tStart + 1}..${tEnd}]`);
