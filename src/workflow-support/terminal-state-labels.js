'use strict';

// A terminal state label is <prefix><suffix>, and GitHub rejects any label name longer
// than 50 characters with HTTP 422. The prefixes run to 37 characters, so a status name
// that reads well in an audit artifact can still be unusable as a label:
// issueops:create-tenant-hosted-runner:partially_executed is 55 and has never been
// creatable, which left ten operations unable to label a partial execution at all.
//
// The fix is to stop using the status value as the label suffix. The status stays
// descriptive and is what gets persisted; the suffix is derived from it here, and only
// where it has to be.
const GITHUB_LABEL_MAX_LENGTH = 50;

// Short spellings, used ONLY when the descriptive status would overflow for a given
// prefix. A status with no entry here always keeps its own spelling.
const SHORT_LABEL_SUFFIXES = Object.freeze({
  partially_executed: 'partial',
});

function normalize(value) {
  return String(value || '');
}

// The suffix to use for this status under this prefix.
//
// Shortening is per-prefix and never pre-emptive: a label that already fits keeps its
// exact current spelling. That matters because labels are live on issues in the sandbox
// and at HPE - issueops:create-tenant-repos:partially_executed is 47 characters and has
// been applied for months. Shortening it everywhere would orphan every one of those.
function labelSuffixForStatus(prefix, status) {
  const prefixText = normalize(prefix);
  const statusText = normalize(status);
  if (`${prefixText}${statusText}`.length <= GITHUB_LABEL_MAX_LENGTH) {
    return statusText;
  }

  return SHORT_LABEL_SUFFIXES[statusText] || statusText;
}

// The single label to create or apply for this status.
function terminalStateLabel(prefix, status) {
  return `${normalize(prefix)}${labelSuffixForStatus(prefix, status)}`;
}

// Every spelling this status may already appear under for this prefix.
//
// Used when reading a status back off an issue and when working out which managed labels
// are stale, so an issue carrying the older long spelling is still recognised and still
// cleaned up rather than left behind next to the new one.
function terminalStateLabelVariants(prefix, status) {
  const prefixText = normalize(prefix);
  const statusText = normalize(status);
  const variants = new Set([`${prefixText}${statusText}`]);
  const shortSuffix = SHORT_LABEL_SUFFIXES[statusText];
  if (shortSuffix) {
    variants.add(`${prefixText}${shortSuffix}`);
  }

  return [...variants];
}

// Map a suffix read off a label back to the status value it stands for. A suffix that is
// not a short spelling is already the status.
function statusForLabelSuffix(suffix) {
  const suffixText = normalize(suffix);
  const entry = Object.entries(SHORT_LABEL_SUFFIXES).find(([, short]) => short === suffixText);
  return entry ? entry[0] : suffixText;
}

module.exports = {
  GITHUB_LABEL_MAX_LENGTH,
  SHORT_LABEL_SUFFIXES,
  labelSuffixForStatus,
  terminalStateLabel,
  terminalStateLabelVariants,
  statusForLabelSuffix,
};
