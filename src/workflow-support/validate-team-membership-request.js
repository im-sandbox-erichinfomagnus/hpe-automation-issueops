'use strict';

const { parseTeamMembershipRequest } = require('./parse-team-membership-request');
const { unwrapCodeFence } = require('./normalize-requested-people');
const {
  describeBulkCsvRowIssue,
  normalizeBulkCsvRequestedPeople,
} = require('./normalize-bulk-csv-requested-people');
const { downloadCsvAttachment } = require('./download-csv-attachment');
const { hashAttachmentContent } = require('./hash-attachment-content');
const { resolveCsvAttachmentComment } = require('./resolve-csv-attachment-comment');

function hasPopulatedInput(value) {
  return unwrapCodeFence(value).trim() !== '';
}

async function validateTeamMembershipRequest(input = {}, options = {}) {
  const request = input.request_id ? input : parseTeamMembershipRequest(input);
  const errors = [];
  const warnings = [];
  const resolver = options.resolveUser;
  const teamLookup = options.getTeam;
  const issueComments = options.issueComments || input.issueComments || input.issue_comments || [];
  const latestFailedValidationAt = options.latestFailedValidationAt || input.latestFailedValidationAt || null;
  const latestFailedValidationAttemptId = options.latestFailedValidationAttemptId || input.latestFailedValidationAttemptId || null;
  const terminalStateReached = ['executed', 'partially_executed', 'failed'].includes(request.request_status);
  let attachmentResolution = null;
  let attachmentRateLimitSnapshot = null;

  if (!request.organization) {
    errors.push('Target organization is required.');
  }

  if (!request.team_slug) {
    errors.push('Target team slug is required.');
  }

  const manualPopulated = hasPopulatedInput(request.requested_people_input);
  const legacyBulkCsvPopulated = hasPopulatedInput(request.legacy_bulk_csv_input);

  if (!request.intake_mode) {
    errors.push('Exactly one supported intake mode must be selected: manual or csv_attachment.');
  }

  if (legacyBulkCsvPopulated) {
    errors.push('The bulk CSV textarea intake is no longer supported. Select csv_attachment and upload the CSV as a requester-authored issue comment attachment.');
  }

  if (request.intake_mode === 'csv_attachment' && manualPopulated) {
    errors.push('requested_people must be empty when intake_mode is csv_attachment.');
  }

  if (request.intake_mode === 'csv_attachment') {
    attachmentResolution = resolveCsvAttachmentComment({
      requesterLogin: request.requester_login,
      issueComments,
      latestFailedValidationAt,
      terminalStateReached,
    });

    request.validation_findings.attachment_comment_findings = attachmentResolution.findings;

    if (attachmentResolution.resolution_status === 'ignored_terminal_state') {
      warnings.push('Later attachment comments are ignored after the request reaches a terminal execution state.');
      request.accepted_attachment_submission = {
        ...request.accepted_attachment_submission,
        acceptance_status: 'ignored_terminal_state',
        rejection_reason: 'terminal_state_ignored',
      };
      request.attachment_validation_attempt = {
        ...request.attachment_validation_attempt,
        request_id: request.request_id,
        attempt_status: 'ignored_terminal_state',
        evaluated_at: new Date().toISOString(),
      };
    } else if (attachmentResolution.resolution_status === 'waiting_for_attachment') {
      request.request_status = 'waiting_for_attachment';
      request.attachment_validation_attempt = {
        ...request.attachment_validation_attempt,
        request_id: request.request_id,
        attempt_status: 'waiting',
        evaluated_at: new Date().toISOString(),
      };
      warnings.push('Request is waiting for a requester-authored CSV attachment comment.');
    } else if (attachmentResolution.resolution_status === 'attachment_rejected') {
      const candidate = attachmentResolution.candidate || {};
      request.accepted_attachment_submission = {
        ...request.accepted_attachment_submission,
        comment_id: candidate.comment_id || null,
        comment_created_at: candidate.comment_created_at || null,
        uploader_login: candidate.uploader_login || null,
        attachment_url: candidate.attachment_url || null,
        filename: candidate.filename || null,
        extension: candidate.extension || null,
        acceptance_status: 'rejected',
        rejection_reason: candidate.rejection_reason || 'attachment_rejected',
      };
      request.attachment_validation_attempt = {
        ...request.attachment_validation_attempt,
        request_id: request.request_id,
        candidate_comment_id: candidate.comment_id || null,
        attempt_status: 'attachment_rejected',
        errors: [`Attachment candidate was rejected: ${candidate.rejection_reason || 'attachment_rejected'}.`],
        evaluated_at: new Date().toISOString(),
      };
      errors.push(`Attachment candidate was rejected: ${candidate.rejection_reason || 'attachment_rejected'}.`);
    } else if (attachmentResolution.resolution_status === 'attachment_candidate_selected') {
      const candidate = attachmentResolution.candidate;
      try {
        const downloadedAttachment = await downloadCsvAttachment({
          attachmentUrl: candidate.attachment_url,
          token: options.token,
          fetchImpl: options.fetchImpl,
          maxBytes: options.maxAttachmentBytes,
          maxRetries: options.maxRetries,
          baseDelayMs: options.baseDelayMs,
          maxDelayMs: options.maxDelayMs,
          sleep: options.sleep,
        });
        attachmentRateLimitSnapshot = downloadedAttachment.rate_limit_snapshot;
        const attachmentHash = hashAttachmentContent(downloadedAttachment.text);
        const attachmentNormalization = normalizeBulkCsvRequestedPeople(downloadedAttachment.text);

        request.bulk_csv_input = downloadedAttachment.text;
        request.bulk_csv_submission = {
          encoding: attachmentNormalization.encoding,
          header_columns: attachmentNormalization.header_columns,
          required_columns: attachmentNormalization.required_columns,
          unsupported_columns: attachmentNormalization.unsupported_columns,
          row_count: attachmentNormalization.row_count,
          valid_row_count: attachmentNormalization.valid_row_count,
          invalid_row_count: attachmentNormalization.invalid_row_count,
          duplicate_row_count: attachmentNormalization.duplicate_row_count,
          schema_status: attachmentNormalization.schema_status,
          schema_errors: attachmentNormalization.schema_errors,
        };
        request.requested_people = attachmentNormalization.normalizedPeople;
        request.requested_people_detail = attachmentNormalization.requestedPeopleDetail.map((detail) => ({
          ...detail,
          source_comment_id: candidate.comment_id || null,
        }));
        request.duplicate_people = attachmentNormalization.duplicatePeople;
        request.invalid_people = attachmentNormalization.invalidPeople;
        request.csv_row_findings = attachmentNormalization.csv_row_findings;
        request.validation_findings.duplicate_people = attachmentNormalization.duplicatePeople;
        request.validation_findings.invalid_people = attachmentNormalization.invalidPeople;
        request.validation_findings.csv_row_findings = attachmentNormalization.csv_row_findings;
        request.accepted_attachment_submission = {
          ...request.accepted_attachment_submission,
          comment_id: candidate.comment_id || null,
          comment_created_at: candidate.comment_created_at || null,
          uploader_login: candidate.uploader_login || null,
          attachment_url: candidate.attachment_url,
          filename: candidate.filename || null,
          extension: candidate.extension || null,
          content_hash: attachmentHash,
          downloaded_at: downloadedAttachment.downloaded_at,
          byte_size: downloadedAttachment.byte_size,
          acceptance_status: 'accepted',
          rejection_reason: null,
        };
        request.attachment_validation_attempt = {
          ...request.attachment_validation_attempt,
          attempt_id: `${request.request_id}:${candidate.comment_id}`,
          request_id: request.request_id,
          candidate_comment_id: candidate.comment_id || null,
          attempt_status: attachmentNormalization.schema_status === 'valid' ? 'csv_valid' : 'csv_invalid',
          evaluated_at: downloadedAttachment.downloaded_at,
          errors: attachmentNormalization.schema_errors,
          warnings: [],
          supersedes_attempt_id: latestFailedValidationAttemptId,
        };

        for (const schemaError of attachmentNormalization.schema_errors || []) {
          errors.push(schemaError);
        }

        for (const finding of attachmentNormalization.csv_row_findings || []) {
          if (finding.validation_status === 'blank') {
            continue;
          }
          if (finding.validation_status === 'duplicate') {
            warnings.push(
              `CSV row ${finding.row_number} duplicates username ${finding.username || 'unknown'} and was deduplicated.`
            );
            continue;
          }
          if (finding.validation_status === 'invalid') {
            errors.push(describeBulkCsvRowIssue(finding));
          }
        }
      } catch (error) {
        attachmentRateLimitSnapshot = error.rate_limit_snapshot || null;
        request.accepted_attachment_submission = {
          ...request.accepted_attachment_submission,
          comment_id: candidate.comment_id || null,
          comment_created_at: candidate.comment_created_at || null,
          uploader_login: candidate.uploader_login || null,
          attachment_url: candidate.attachment_url,
          filename: candidate.filename || null,
          extension: candidate.extension || null,
          acceptance_status: 'rejected',
          rejection_reason: error.failure_reason || 'download_failed',
        };
        request.attachment_validation_attempt = {
          ...request.attachment_validation_attempt,
          attempt_id: `${request.request_id}:${candidate.comment_id}`,
          request_id: request.request_id,
          candidate_comment_id: candidate.comment_id || null,
          attempt_status: 'attachment_rejected',
          evaluated_at: new Date().toISOString(),
          errors: [error.message],
          warnings: [],
          supersedes_attempt_id: latestFailedValidationAttemptId,
        };
        errors.push(error.message);
      }
    }
  }

  if (request.intake_mode === 'manual' && request.requested_people.length === 0) {
    errors.push('At least one valid requested person is required.');
  }

  if (request.intake_mode === 'csv_attachment' && request.request_status !== 'waiting_for_attachment' && request.requested_people.length === 0) {
    errors.push('At least one valid requested person is required from the accepted CSV attachment.');
  }

  if (request.intake_mode !== 'csv_attachment' && request.invalid_people.length > 0) {
    errors.push(`Invalid GitHub usernames: ${request.invalid_people.join(', ')}`);
  }

  if (request.duplicate_people.length > 0) {
    warnings.push(`Duplicate usernames were deduplicated: ${request.duplicate_people.join(', ')}`);
  }

  let teamExists = false;
  let teamSyncBlocked = false;

  if (request.organization && request.team_slug && typeof teamLookup === 'function') {
    const teamResult = await teamLookup({
      organization: request.organization,
      teamSlug: request.team_slug,
    });
    teamExists = Boolean(teamResult && teamResult.exists);
    teamSyncBlocked = Boolean(teamResult && teamResult.team_sync_blocked);
    if (!teamExists) {
      errors.push('The target team does not exist or is not visible to the workflow identity.');
    }
    if (teamSyncBlocked) {
      errors.push('The target team is synchronized by IdP and cannot be mutated through the API.');
    }
  }

  const requestedPeople = [];
  const requestedPeopleDetailMap = new Map(
    (request.requested_people_detail || [])
      .filter((detail) => detail && detail.username)
      .map((detail) => [detail.username, detail])
  );
  for (const username of request.requested_people) {
    let resolutionStatus = 'resolved';
    let failureReason = null;

    if (typeof resolver === 'function') {
      const resolved = await resolver({
        organization: request.organization,
        username,
      });

      if (!resolved || resolved.exists === false) {
        resolutionStatus = 'unresolved';
        failureReason = 'user_not_found';
        errors.push(`Requested user ${username} could not be resolved in the organization context.`);
      }
    }

    requestedPeople.push({
      username,
      source_row_number: requestedPeopleDetailMap.get(username)
        ? requestedPeopleDetailMap.get(username).source_row_number || null
        : null,
      source_comment_id: requestedPeopleDetailMap.get(username)
        ? requestedPeopleDetailMap.get(username).source_comment_id || null
        : null,
      resolution_status: resolutionStatus,
      current_membership_state: 'unknown',
      desired_action: resolutionStatus === 'resolved' ? 'add_member' : 'reject',
      execution_result: 'not_started',
      failure_reason: failureReason,
    });
  }

  return {
    is_valid: errors.length === 0 && request.request_status !== 'waiting_for_attachment',
    request_status: request.request_status === 'waiting_for_attachment'
      ? 'waiting_for_attachment'
      : errors.length === 0
        ? 'awaiting_approval'
        : 'validation_failed',
    errors,
    warnings,
    team_exists: teamExists,
    team_sync_blocked: teamSyncBlocked,
    attachment_rate_limit_snapshot: attachmentRateLimitSnapshot,
    attachment_validation_attempt: request.attachment_validation_attempt,
    accepted_attachment_submission: request.accepted_attachment_submission,
    bulk_csv_submission: request.bulk_csv_submission,
    csv_row_findings: request.csv_row_findings || [],
    csv_row_numbering_convention: request.csv_row_numbering_convention,
    requested_people: requestedPeople,
    request: {
      ...request,
      request_status: request.request_status === 'waiting_for_attachment'
        ? 'waiting_for_attachment'
        : errors.length === 0
          ? 'awaiting_approval'
          : 'validation_failed',
    },
  };
}

module.exports = {
  validateTeamMembershipRequest,
};