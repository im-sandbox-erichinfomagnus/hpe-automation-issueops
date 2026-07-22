# Research: Add Team Repo Access CSV Attachment Intake

## Decision 1: Keep existing add-team-repo-access entrypoint and add csv_attachment as second intake mode

- Decision: Extend the existing add-team-repo-access issue form and workflow to support `manual` and `csv_attachment` intake in one path.
- Rationale: Non-regression against `specs/005-add-team-repo-access/spec.md` and preserved CSV semantics from `specs/009-add-team-repo-access-bulk-csv-mode/spec.md` require one consistent validation/approval/reconciliation pipeline.
- Alternatives considered:
  - Separate attachment-only workflow: rejected due to duplicated policy logic and drift risk.
  - Keep textarea bulk CSV as primary for new requests: rejected because this enhancement intentionally moves high-volume intake to attachment comments.

## Decision 2: Model attachment mode with explicit waiting lifecycle

- Decision: Valid `csv_attachment` metadata enters `waiting_for_attachment` and stays approval-blocked until an accepted requester attachment passes CSV-content validation.
- Rationale: Request intake and attachment upload are separate user actions; safe staged progression is required.
- Alternatives considered:
  - Immediate validation failure when no attachment exists at issue creation: rejected because no attachment at submission time is expected.
  - Allow approval while waiting: rejected because approvers need normalized repository rows from an accepted attachment.

## Decision 3: Use conservative requester-only attachment candidate selection

- Decision: Accept only requester-authored same-issue comments with exactly one qualifying CSV attachment candidate per active attempt.
- Rationale: Prevents ambiguous inputs and preserves auditable provenance boundaries.
- Alternatives considered:
  - Accept non-requester attachment comments: rejected due to authorization and spoofing risk.
  - Automatically choose from multiple CSV attachments in one comment: rejected as ambiguous and unsafe.

## Decision 4: Preserve 009 CSV semantics after attachment download

- Decision: After download and UTF-8 validation, process attachment CSV using preserved `repository` header requirements and row-level semantics from feature 009.
- Rationale: Intake transport changes, but normalization/validation semantics must remain stable.
- Alternatives considered:
  - Introduce new attachment-specific CSV schema: rejected due to avoidable semantic divergence.
  - Relax duplicate/conflict handling: rejected because it would regress deterministic baseline behavior.

## Decision 5: Correction flow uses newest requester attachment after latest failed attempt

- Decision: For failed attachment-validation attempts, select the newest eligible requester attachment comment posted after the latest failed attempt.
- Rationale: Deterministic correction behavior with clear supersession and traceability.
- Alternatives considered:
  - Reprocess all historical requester comments each run: rejected due to ambiguous intent.
  - Allow in-place correction via editing old comments: rejected because attachment lifecycle is comment-event driven.

## Decision 6: Enforce terminal-state immutability using artifacts and operation-aware labels

- Decision: Treat `executed`, `partially_executed`, and `failed_after_approved_execution` as immutable for attachment reprocessing, enforced through restored artifacts and operation-aware labels.
- Rationale: Later attachments must not reopen completed privileged workflows.
- Alternatives considered:
  - Allow reopening with new valid attachments: rejected by non-regression and safety requirements.
  - Depend only on in-memory run state: rejected because fresh runners require durable terminal evidence.

## Decision 7: Keep approval and repo-access reconciliation semantics unchanged post-validation

- Decision: Once attachment rows validate, preserve baseline add-team-repo-access approval, permission compatibility checks, no-op handling, dry-run behavior, and bounded retries.
- Rationale: Governance and mutation safety should remain unchanged across intake modes.
- Alternatives considered:
  - Add attachment-specific approver model: rejected due to governance inconsistency.
  - Skip pre-execution drift recomputation: rejected because stale-state changes are part of baseline reconciliation safety.
