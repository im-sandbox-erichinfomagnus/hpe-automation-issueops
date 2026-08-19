// Refreshes issue form defaults from repository context and hosted-runner catalog.
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.ISSUEOPS_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
const ORG = process.env.RUNNER_ORG || process.env.GITHUB_REPOSITORY_OWNER;
const FORM = '.github/ISSUE_TEMPLATE/create-tenant-hosted-runner.yml';
const TEMPLATE_DIR = '.github/ISSUE_TEMPLATE';

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

function replaceOrganizationValue(text, org) {
  const lines = text.split('\n');
  let changed = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== 'id: organization') {
      continue;
    }

    let blockEnd = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].startsWith('  - type: ')) {
        blockEnd = j;
        break;
      }
    }

    let valueIndex = -1;
    let placeholderIndex = -1;
    let descriptionIndex = -1;
    for (let j = i + 1; j < blockEnd; j += 1) {
      const trimmed = lines[j].trim();
      if (trimmed.startsWith('value:')) {
        valueIndex = j;
        break;
      }
      if (placeholderIndex === -1 && trimmed.startsWith('placeholder:')) {
        placeholderIndex = j;
      }
      if (descriptionIndex === -1 && trimmed.startsWith('description:')) {
        descriptionIndex = j;
      }
    }

    if (valueIndex !== -1) {
      const indent = lines[valueIndex].match(/^\s*/)[0];
      const replacement = `${indent}value: ${org}`;
      if (lines[valueIndex] !== replacement) {
        lines[valueIndex] = replacement;
        changed = true;
      }
      continue;
    }

    const insertAt = placeholderIndex !== -1
      ? placeholderIndex
      : descriptionIndex !== -1
        ? descriptionIndex + 1
        : i + 1;
    const indentSource = lines[Math.max(i + 1, Math.min(insertAt, lines.length - 1))] || '      ';
    const indent = indentSource.match(/^\s*/)[0] || '      ';
    lines.splice(insertAt, 0, `${indent}value: ${org}`);
    changed = true;
  }

  return {
    text: lines.join('\n'),
    changed,
  };
}

function refreshTemplateOrganizationDefaults(org) {
  const templateFiles = fs.readdirSync(TEMPLATE_DIR)
    .filter((name) => name.endsWith('.yml'))
    .map((name) => path.join(TEMPLATE_DIR, name));

  let updatedCount = 0;
  for (const templatePath of templateFiles) {
    const original = fs.readFileSync(templatePath, 'utf8');
    const result = replaceOrganizationValue(original, org);
    if (result.changed) {
      fs.writeFileSync(templatePath, result.text);
      updatedCount += 1;
    }
  }

  return {
    templateCount: templateFiles.length,
    updatedCount,
  };
}

(async () => {
  if (!ORG) throw new Error('No org: set RUNNER_ORG');

  const orgRefresh = refreshTemplateOrganizationDefaults(ORG);
  console.log(`organization defaults refreshed in ${orgRefresh.updatedCount}/${orgRefresh.templateCount} templates`);

  if (!TOKEN) throw new Error('No token: set ISSUEOPS_GITHUB_TOKEN or GITHUB_TOKEN');

  const imagesResp = await api(`/orgs/${ORG}/actions/hosted-runners/images/github-owned`);
  const sizesResp = await api(`/orgs/${ORG}/actions/hosted-runners/machine-sizes`);

  const images = [...new Map(
    (imagesResp.images || [])
      .filter((image) => image && image.id != null)
      .map((image) => [String(image.id), image])
  ).values()]
    .sort((a, b) => {
      const aUbuntu = String(a.display_name || '').toLowerCase().includes('ubuntu');
      const bUbuntu = String(b.display_name || '').toLowerCase().includes('ubuntu');
      return Number(bUbuntu) - Number(aUbuntu) || String(a.display_name || '').localeCompare(String(b.display_name || ''));
    })
    .map((image) => String(image.id));
  const sizes = [...new Set((sizesResp.machine_specs || []).map((s) => s.id).filter(Boolean))];

  if (images.length === 0 || sizes.length === 0) {
    throw new Error(`empty catalog: images=${images.length} sizes=${sizes.length}`);
  }

  let text = fs.readFileSync(FORM, 'utf8');
  text = replaceOptions(text, 'runner_image_id', renderOptions(images, true));
  text = replaceOptions(text, 'runner_size', renderOptions(sizes, false));
  fs.writeFileSync(FORM, text);
  console.log(`runner catalog refreshed for ${ORG}: images=${images.length}, sizes=${sizes.length}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
