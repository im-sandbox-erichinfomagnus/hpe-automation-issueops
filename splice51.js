const fs = require('fs');
const path = 'src/scripts/run-request-validation.js';
const lines = fs.readFileSync(path, 'utf8').split('\n');
const ours = fs.readFileSync(process.env.TEMP + '\\rrv51-ours.js', 'utf8').split('\n');
const theirs = fs.readFileSync(process.env.TEMP + '\\rrv51-theirs.js', 'utf8').split('\n');

// Bounds in the working file: first conflict whose ours side starts the repo-admin
// dispatch branch, through the last marker line before the tenant-variable branch.
let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('<<<<<<<') && lines[i + 1] && lines[i + 1].includes('} else if (isRepoAdminMembership) {')) { start = i; break; }
}
const tvIdx = lines.findIndex((l, i) => i > start && l.includes('} else if (isTenantVariableManagement) {') && !l.startsWith('<'));
if (start < 0 || tvIdx < 0) { console.error('bounds not found', start, tvIdx); process.exit(1); }

const oStart = ours.findIndex(l => l.includes('} else if (isRepoAdminMembership) {'));
const oEnd = ours.findIndex((l, i) => i > oStart && l.includes('} else if (isTenantVariableManagement) {'));
const tStart = theirs.findIndex(l => l.includes('} else if (isCicdAdminMembership) {'));
const tEnd = theirs.findIndex((l, i) => i > tStart && l.includes('} else if (isTenantVariableManagement) {'));
if (oStart < 0 || oEnd < 0 || tStart < 0 || tEnd < 0) { console.error('stage bounds missing'); process.exit(1); }

const replacement = [...ours.slice(oStart, oEnd), ...theirs.slice(tStart, tEnd)];
const out = [...lines.slice(0, start), ...replacement, ...lines.slice(tvIdx)];
fs.writeFileSync(path, out.join('\n'));
console.log(`replaced working[${start + 1}..${tvIdx}] with ours[${oStart + 1}..${oEnd}] + theirs[${tStart + 1}..${tEnd}]`);
