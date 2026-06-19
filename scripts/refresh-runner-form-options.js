// Refreshes the hard-coded dropdown options in the create-tenant-hosted-runner
// issue form from GitHub's live hosted-runner image and machine-size catalog.
const fs = require('fs');

const TOKEN = process.env.ISSUEOPS_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
const ORG = process.env.RUNNER_ORG || process.env.GITHUB_REPOSITORY_OWNER;
const FORM = '.github/ISSUE_TEMPLATE/create-tenant-hosted-runner.yml';

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function renderOptions(items, quote) {
  return items.map((x) => (quote ? `        - "${x}"` : `        - ${x}`)).join('\n');
}

function replaceOptions(text, fieldId, optionsBlock) {
  const re = new RegExp(`(    id: ${fieldId}\\n[\\s\\S]*?      options:\\n)([\\s\\S]*?)(\\n      default:)`);
  if (!re.test(text)) {
    throw new Error(`options block not found for ${fieldId}`);
  }
  return text.replace(re, `$1${optionsBlock}$3`);
}

(async () => {
  if (!TOKEN) throw new Error('No token: set ISSUEOPS_GITHUB_TOKEN or GITHUB_TOKEN');
  if (!ORG) throw new Error('No org: set RUNNER_ORG');

  const imagesResp = await api(`/orgs/${ORG}/actions/hosted-runners/images/github-owned`);
  const sizesResp = await api(`/orgs/${ORG}/actions/hosted-runners/machine-sizes`);

  const images = [...new Set((imagesResp.images || []).map((i) => i.display_name).filter(Boolean))]
    .sort((a, b) => Number(b.toLowerCase().includes('ubuntu')) - Number(a.toLowerCase().includes('ubuntu')));
  const sizes = [...new Set((sizesResp.machine_specs || []).map((s) => s.id).filter(Boolean))];

  if (images.length === 0 || sizes.length === 0) {
    throw new Error(`empty catalog: images=${images.length} sizes=${sizes.length}`);
  }

  let text = fs.readFileSync(FORM, 'utf8');
  text = replaceOptions(text, 'runner_image_id', renderOptions(images, true));
  text = replaceOptions(text, 'runner_size', renderOptions(sizes, false));
  fs.writeFileSync(FORM, text);
  console.log(`images: ${images.length}, sizes: ${sizes.length}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
