'use strict';

const { downloadCsvAttachment } = require('./download-csv-attachment');

function inferFilenameFromUrl(url = '') {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname || '');
    const filename = pathname.split('/').filter(Boolean).pop() || '';
    return filename || null;
  } catch {
    return null;
  }
}

function inferFilenameFromLink(link = {}) {
  const inferredFromUrl = inferFilenameFromUrl(link.url || '');
  const normalizedLabel = String(link.label || '').trim();

  if (normalizedLabel && normalizedLabel.toLowerCase().endsWith('.csv')) {
    return normalizedLabel;
  }

  return inferredFromUrl || normalizedLabel || null;
}

function normalizeAnchorLabel(label = '') {
  const text = String(label || '').trim();
  return /[<>]/.test(text) ? '' : text;
}

function extractAttachmentLinks(body = '') {
  const links = [];
  const seen = new Set();
  const text = String(body || '');

  function addLink(link = {}) {
    const url = link.url;
    if (!url || seen.has(url)) {
      return;
    }

    seen.add(url);
    links.push({
      label: link.label || '',
      url,
      filename: inferFilenameFromLink(link),
    });
  }

  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
  for (const match of text.matchAll(markdownLinkPattern)) {
    addLink({
      label: match[1] || '',
      url: match[2],
    });
  }

  const markdownImagePattern = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi;
  for (const match of text.matchAll(markdownImagePattern)) {
    addLink({
      label: match[1] || '',
      url: match[2],
    });
  }

  const htmlAnchorPattern = /<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>(.*?)<\/a>/gi;
  for (const match of text.matchAll(htmlAnchorPattern)) {
    const rawLabel = normalizeAnchorLabel(match[2]);
    addLink({
      label: rawLabel,
      url: match[1],
    });
  }

  const htmlAttachmentPattern = /<(?:img|source)\b[^>]*(?:src|href)=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  for (const match of text.matchAll(htmlAttachmentPattern)) {
    addLink({
      url: match[1],
    });
  }

  const urlPattern = /https?:\/\/[^\s)"'<>]+/gi;
  for (const match of text.matchAll(urlPattern)) {
    addLink({ url: match[0] });
  }

  return links;
}

function isCsvLink(link = {}) {
  const candidates = [
    link.filename,
    link.label,
    inferFilenameFromUrl(link.url || ''),
  ];

  return candidates.some((candidate) => String(candidate || '').trim().toLowerCase().endsWith('.csv'));
}

function resolveCostCenterCsvAttachment(options = {}) {
  const sources = [options.commentBody, options.issueBody];

  for (const source of sources) {
    if (!source) {
      continue;
    }

    const csvLinks = extractAttachmentLinks(source).filter(isCsvLink);
    if (csvLinks.length > 0) {
      const selected = csvLinks[0];
      return {
        attachment_url: selected.url,
        filename: inferFilenameFromLink(selected),
      };
    }
  }

  return null;
}

function findLatestCsvAttachmentInComments(comments = []) {
  const ordered = [...comments].sort((left, right) => {
    return String(right.created_at || '').localeCompare(String(left.created_at || ''));
  });

  for (const comment of ordered) {
    const attachment = resolveCostCenterCsvAttachment({ commentBody: comment.body || '' });
    if (attachment) {
      return { ...attachment, comment };
    }
  }

  return null;
}

async function downloadCostCenterCsvAttachment(options = {}) {
  const downloader = options.downloadImpl || downloadCsvAttachment;
  const result = await downloader({
    attachmentUrl: options.attachmentUrl,
    token: options.token,
    fetchImpl: options.fetchImpl,
    maxBytes: options.maxBytes,
    maxRetries: options.maxRetries,
    sleep: options.sleep,
  });

  return result;
}

module.exports = {
  downloadCostCenterCsvAttachment,
  extractAttachmentLinks,
  findLatestCsvAttachmentInComments,
  inferFilenameFromLink,
  inferFilenameFromUrl,
  isCsvLink,
  resolveCostCenterCsvAttachment,
};
