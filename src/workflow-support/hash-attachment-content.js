'use strict';

const crypto = require('crypto');

function hashAttachmentContent(content, options = {}) {
  const algorithm = options.algorithm || 'sha256';
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''), 'utf8');
  return crypto.createHash(algorithm).update(buffer).digest('hex');
}

module.exports = {
  hashAttachmentContent,
};