# Research: Add Child Teams CSV Attachment Intake

## Decision 1: Keep the existing add-child-teams workflow entrypoint and add `csv_attachment` as a second intake mode

- Decision: Extend the existing add-child-teams issue form, parser, and validation flow to support `manual` and `csv_attachment` intake modes in one workflow path.
- Rationale: Baseline behavior from feature `004` and preserved CSV semantics from feature `008` must remain non-regressive. Reusing a single workflow path avoids policy drift between intake modes.
- Alternatives considered:
  - Create a separate attachment-only workflow: rejected because it duplicates approval and reconciliation logic.
  - Keep textarea bulk CSV as primary intake for new requests: rejected because this feature intentionally moves high-volume ingestion to attachment comments.

## Decision 2: Model attachment mode as a waiting lifecycle before approval

- Decision: Requests using `csv_attachment` enter `waiting_for_attachment` after metadata validation and cannot proceed to approval or execution until an accepted attachment passes CSV validation.
- Rationale: Issue forms cannot upload files at submission time. Waiting state is the safe and explicit lifecycle for two-step ingestion.
- Alternatives considered:
  - Fail immediately if no attachment exists at issue creation: rejected because that is expected in the two-step workflow.
  - Allow approval while waiting: rejected because approvers must review normalized requested child links from actual attachment content.

## Decision 3: Attachment candidate discovery must be conservative and requester-bound

- Decision: Accept only requester-authored same-issue comments; require exactly one qualifying attachment candidate for an active validation attempt; fail closed on ambiguity.
- Rationale: Privileged hierarchy changes need deterministic provenance and strict actor scoping.
- Alternatives considered:
  - Accept any commenter attachment: rejected as an authorization bypass risk.
  - Auto-select among multiple attachment candidates in one comment: rejected due to ambiguity and audit risk.

## Decision 4: Preserve feature 008 CSV semantics after attachment download

- Decision: Download accepted attachment content as UTF-8 CSV and apply the same child-team header and row semantics from feature `008`, including normalization, duplicate/conflict detection, blank-row handling, and row-level findings.
- Rationale: Attachment mode changes intake, not domain semantics.
- Alternatives considered:
  - Introduce attachment-specific CSV schema: rejected because it widens scope and creates behavior divergence.
  - Defer CSV validation until execution stage: rejected because approval requires pre-execution validated inputs.

## Decision 5: Correction workflow uses newest requester attachment after latest failed attempt

- Decision: After CSV validation failure, the active candidate becomes the newest eligible requester attachment comment posted after the latest failed attachment-validation result.
- Rationale: This yields deterministic supersession and clear correction intent while preserving auditability.
- Alternatives considered:
  - Reprocess all historical comments each run without failed-attempt boundary: rejected because candidate intent becomes ambiguous.
  - Allow in-place edits to failed attachment comments as correction path: rejected because comment-linked attachments should be superseded by explicit later comments.

## Decision 6: Preserve terminal-state immutability across fresh runners

- Decision: Treat `executed`, `partially_executed`, and failed-after-approved-execution outcomes as immutable for reprocessing, enforced by operation-aware terminal labels and restored per-issue audit artifacts.
- Rationale: Later attachment comments must not reopen privileged workflows.
- Alternatives considered:
  - Allow reopening on new valid attachment comments: rejected by explicit anti-regression requirement.
  - Depend on in-memory run state only: rejected because fresh runners need durable terminal-state evidence.

## Decision 7: Keep approval and reconciliation semantics unchanged after normalization

- Decision: After attachment CSV passes validation, use existing single designated hierarchy approver checks, reconciliation-first execution, no-op handling, dry-run behavior, and bounded retries.
- Rationale: Existing governance and safety controls already cover privileged hierarchy mutations.
- Alternatives considered:
  - Introduce attachment-specific approval role: rejected because it changes authorization model and increases risk.
  - Skip drift recomputation after approval: rejected because reconciliation must read latest hierarchy state before mutation.
