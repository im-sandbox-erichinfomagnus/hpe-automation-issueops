'use strict';

const { normalizeLogin } = require('./normalize-requested-people');

function sortCommentsAscending(issueComments = []) {
  return [...issueComments].sort((left, right) => {
    return String(left.created_at || '').localeCompare(String(right.created_at || ''));
  });
}

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

function isTrustedGitHubAttachmentUrl(url = '') {
  try {
    const parsed = new URL(url);
    const hostname = String(parsed.hostname || '').toLowerCase();
    const pathname = String(parsed.pathname || '');
    const isLegacyRepositoryFilesPath = /^\/[^/]+\/[^/]+\/files\/[0-9]+\//.test(pathname);
    const isUserAttachmentPath = pathname.startsWith('/user-attachments/files/');

    return (
      parsed.protocol === 'https:'
      && hostname === 'github.com'
      && !parsed.username
      && !parsed.password
      && (isUserAttachmentPath || isLegacyRepositoryFilesPath)
    );
  } catch {
    return false;
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

function extractCommentLinks(body = '') {
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

function classifyAttachmentComment(comment = {}, options = {}) {
  const requesterLogin = normalizeLogin(options.requesterLogin || '');
  const authorLogin = normalizeLogin(comment.user && comment.user.login);
  const links = extractCommentLinks(comment.body || '');
  const csvLinks = links.filter(isCsvLink);

  if (!authorLogin || authorLogin !== requesterLogin) {
    return {
      status: 'non_requester',
      comment_id: comment.id || null,
      uploader_login: authorLogin || null,
      attachment_links: csvLinks,
      rejection_reason: 'non_requester',
    };
  }

  if (links.length > 0 && csvLinks.length === 0) {
    return {
      status: 'non_csv_attachment',
      comment_id: comment.id || null,
      comment_created_at: comment.created_at || null,
      uploader_login: authorLogin || null,
      attachment_links: links,
      rejection_reason: 'missing_csv_extension',
    };
  }

  if (csvLinks.length === 0) {
    return {
      status: 'no_attachment',
      comment_id: comment.id || null,
      uploader_login: authorLogin || null,
      attachment_links: [],
      rejection_reason: 'no_csv_attachment',
    };
  }

  if (csvLinks.length === 1 && !isTrustedGitHubAttachmentUrl(csvLinks[0].url || '')) {
    return {
      status: 'non_csv_attachment',
      comment_id: comment.id || null,
      comment_created_at: comment.created_at || null,
      uploader_login: authorLogin || null,
      attachment_links: csvLinks,
      rejection_reason: 'unsupported_attachment_host',
    };
  }

  if (csvLinks.length > 1) {
    return {
      status: 'ambiguous',
      comment_id: comment.id || null,
      uploader_login: authorLogin || null,
      attachment_links: csvLinks,
      rejection_reason: 'ambiguous_attachment_set',
    };
  }

  const selected = csvLinks[0];
  const filename = inferFilenameFromLink(selected);
  return {
    status: 'accepted_candidate',
    comment_id: comment.id || null,
    comment_created_at: comment.created_at || null,
    uploader_login: authorLogin || null,
    attachment_url: selected.url,
    filename: filename,
    extension: filename && String(filename).toLowerCase().endsWith('.csv') ? '.csv' : null,
    attachment_links: csvLinks,
    rejection_reason: null,
  };
}

function resolveCsvAttachmentComment(options = {}) {
  const issueComments = sortCommentsAscending(options.issueComments || []);
  const requesterLogin = options.requesterLogin || '';
  const latestFailedValidationAt = options.latestFailedValidationAt || null;
  const terminalStateReached = Boolean(options.terminalStateReached);

  if (terminalStateReached) {
    return {
      resolution_status: 'ignored_terminal_state',
      candidate: null,
      findings: [],
      latest_failed_validation_at: latestFailedValidationAt,
    };
  }

  const findings = [];
  let latestRequesterAttempt = null;

  for (const comment of issueComments) {
    if (latestFailedValidationAt && String(comment.created_at || '') <= String(latestFailedValidationAt)) {
      continue;
    }

    const classification = classifyAttachmentComment(comment, { requesterLogin });
    findings.push(classification);

    if (
      classification.uploader_login === normalizeLogin(requesterLogin)
      && classification.status !== 'no_attachment'
    ) {
      latestRequesterAttempt = classification;
    }
  }

  if (!latestRequesterAttempt) {
    return {
      resolution_status: 'waiting_for_attachment',
      candidate: null,
      findings,
      latest_failed_validation_at: latestFailedValidationAt,
    };
  }

  if (latestRequesterAttempt.status !== 'accepted_candidate') {
    return {
      resolution_status: 'attachment_rejected',
      candidate: latestRequesterAttempt,
      findings,
      latest_failed_validation_at: latestFailedValidationAt,
    };
  }

  return {
    resolution_status: 'attachment_candidate_selected',
    candidate: latestRequesterAttempt,
    findings,
    latest_failed_validation_at: latestFailedValidationAt,
  };
}

module.exports = {
  classifyAttachmentComment,
  extractCommentLinks,
  inferFilenameFromUrl,
  inferFilenameFromLink,
  isCsvLink,
  isTrustedGitHubAttachmentUrl,
  resolveCsvAttachmentComment,
  sortCommentsAscending,
};
