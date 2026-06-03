# Research: Add Team Members CSV Attachment Intake

## Decision 1: Keep the existing add-team-members workflow entrypoint and replace the bulk textarea path with an explicit `csv_attachment` intake mode

- **Decision**: Extend the existing `.github/ISSUE_TEMPLATE/add-team-members.yml`, `.github/workflows/add-team-members.yml`, and add-team-members parser and validation modules to support `manual` and `csv_attachment` intake modes while superseding the textarea-based bulk CSV path for new requests.
- **Rationale**: The enhancement specification is explicitly additive to `specs/001-add-team-members/spec.md` and must preserve all downstream guarantees from `specs/006-add-team-members-bulk-csv-mode/spec.md`. Reusing the existing workflow entrypoint, approval gate, reconciliation flow, and audit artifact format avoids behavioral drift between manual and attachment-driven requests.
- **Alternatives considered**:
  - Create a separate attachment workflow and issue form: rejected because it would duplicate approval, reconciliation, and audit logic and increase regression risk for the existing feature.
  - Keep both textarea bulk CSV and attachment intake indefinitely: rejected because the specification explicitly allows replacement and the user-experience goal is to move large payload handling out of the issue form.

## Decision 2: Model `csv_attachment` as a two-step request lifecycle with an explicit waiting-for-attachment state

- **Decision**: When `csv_attachment` is selected, the initial issue submission validates only request metadata and then records the request as waiting for attachment until a qualifying requester-authored comment attachment is processed.
- **Rationale**: GitHub issue forms cannot upload files during initial form submission, so the safe lifecycle is: create issue first, then attach CSV in a comment. This keeps approval and mutation blocked until the attachment exists and is validated.
- **Alternatives considered**:
  - Request approval before the attachment arrives: rejected because approvers would not be reviewing the actual desired membership batch.
  - Treat absence of an attachment as a hard validation failure instead of a waiting state: rejected because the comment attachment is part of the expected happy-path lifecycle, not an exceptional error.

## Decision 3: Discover attachment candidates conservatively from requester issue comments instead of assuming a first-class issue-attachment API

- **Decision**: Resolve attachment candidates from issue comment content and linked URLs, accept only requester-authored comments on the same issue, require exactly one accepted CSV attachment for the active processing attempt, and fail closed on ambiguity.
- **Rationale**: GitHub issue and issue-comment APIs expose comment bodies rather than a structured attachment collection. Conservative discovery and same-requester validation are required to maintain provenance and avoid processing unrelated or spoofed comment content.
- **Alternatives considered**:
  - Assume GitHub exposes a dedicated issue-attachment API resource: rejected because the supported issue and comment APIs center on raw, text, and HTML bodies rather than attachment objects.
  - Accept any `.csv` link in any comment: rejected because non-requester and unrelated comments must not influence approval readiness for privileged membership changes.

## Decision 4: Preserve existing CSV semantics by downloading accepted attachment content and normalizing it through the existing CSV membership model

- **Decision**: Download the accepted CSV attachment, decode it as UTF-8 text, and reuse the same `username`-header schema, row-level validation rules, duplicate handling, blank-row handling, username normalization, and downstream requested-people model already established for feature `006`.
- **Rationale**: The enhancement changes intake only. Reusing the existing CSV normalization semantics minimizes new behavioral surface and preserves the review and execution guarantees already approved for bulk membership requests.
- **Alternatives considered**:
  - Introduce an attachment-specific schema or multi-column model: rejected because it would widen scope beyond the single-team request model and create unnecessary divergence from feature `006`.
  - Skip normalization until execution time: rejected because reviewers need validated requested people and row findings before approval.

## Decision 5: Require corrected files to arrive in later comments and deterministically select the newest eligible requester attachment after the latest failed attachment validation

- **Decision**: If CSV-content validation fails, the workflow stays blocked and requires the requester to post a corrected attachment in a later comment. The active attachment candidate becomes the newest requester attachment comment that appears after the latest failed CSV-attachment validation result.
- **Rationale**: A later-comment correction rule avoids ambiguity around edited comments, replaced links, or stale attachments while aligning with the existing issue_comment-triggered workflow design.
- **Alternatives considered**:
  - Re-scan all requester comments and always choose the newest attachment regardless of failure boundaries: rejected because it makes it harder to reason about which attempt superseded which failure.
  - Allow editing the original attachment comment to replace the file in place: rejected because attachments are operationally linked content and the specification requires a second comment for corrections.

## Decision 6: Capture attachment provenance as first-class audit evidence and fail closed when provenance cannot be established

- **Decision**: Record attachment URL, issue comment id, uploader login, inferable filename, content hash, and download timestamp in the audit artifact, and block the request if the attachment cannot be safely identified, downloaded, hashed, or decoded.
- **Rationale**: Attachment-based intake is weaker than repo-backed blob references, so provenance and deterministic evidence must compensate for the lack of a commit SHA.
- **Alternatives considered**:
  - Store only row-level CSV findings and omit attachment provenance: rejected because it would leave reviewers and operators unable to prove which file was actually processed.
  - Keep processing when attachment metadata is partial or ambiguous: rejected because privileged automation must fail closed when provenance is uncertain.

## Decision 7: Reuse the existing approval gate and execution path unchanged after validated attachment normalization, and ignore later attachment comments after an executed terminal state

- **Decision**: Keep the current organization-owner approval command model, run approval only after attachment validation succeeds, and preserve the existing reconciliation-first execution path. Once execution reaches a terminal state, later attachment comments are ignored for reprocessing purposes.
- **Rationale**: The approval gate already works by scanning issue comments, so attachment intake can fit into the same event stream while still keeping approval and mutation semantics aligned with feature `001`. Ignoring later comments after terminal execution prevents accidental reopening of completed privileged operations.
- **Alternatives considered**:
  - Add a second approval command specifically for attachments: rejected because it would introduce avoidable authorization drift.
  - Reopen completed requests whenever a newer attachment appears: rejected because the specification explicitly forbids re-invocation after executed terminal state.
