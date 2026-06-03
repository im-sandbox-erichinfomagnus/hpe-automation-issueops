# Research: Create Organization Teams CSV Attachment Intake

## Decision 1: Keep the existing create-org-teams workflow entrypoint and replace the textarea bulk CSV path with an explicit `csv_attachment` intake mode

- **Decision**: Extend the existing `.github/ISSUE_TEMPLATE/create-org-teams.yml`, `.github/workflows/create-org-teams.yml`, and create-org-teams parser and validation modules to support `manual` and `csv_attachment` intake modes while superseding the textarea-based bulk CSV path for new requests.
- **Rationale**: `specs/003-create-org-teams/spec.md` is the authoritative baseline for the manual create-org-teams workflow, and `specs/007-create-org-teams-bulk-csv-mode/spec.md` defines the CSV semantics that must survive this enhancement. Reusing the existing workflow entrypoint, approval gate, reconciliation flow, and audit artifact format avoids behavioral drift between manual and attachment-driven requests.
- **Alternatives considered**:
  - Create a separate attachment-only workflow and issue form: rejected because it would duplicate approval, reconciliation, and audit logic and increase non-regression risk.
  - Keep both textarea bulk CSV and attachment intake indefinitely for new requests: rejected because the feature goal is to move large CSV payload handling out of the issue form while preserving the same downstream semantics.

## Decision 2: Model `csv_attachment` as a two-step request lifecycle with an explicit waiting-for-attachment state

- **Decision**: When `csv_attachment` is selected, the initial issue submission validates only request metadata and then records the request as waiting for attachment until a qualifying requester-authored comment attachment is processed.
- **Rationale**: GitHub issue forms cannot upload files during initial form submission, so the safe lifecycle is: create issue first, then attach CSV in a later requester comment. This keeps approval and mutation blocked until the attachment exists and has passed validation.
- **Alternatives considered**:
  - Request approval before the attachment arrives: rejected because approvers would not be reviewing the actual desired team-creation batch.
  - Treat absence of an attachment as a hard validation failure instead of a waiting state: rejected because the comment attachment is part of the normal happy-path lifecycle, not an exceptional failure.

## Decision 3: Discover attachment candidates conservatively from requester issue comments instead of assuming a first-class issue-attachment API

- **Decision**: Resolve attachment candidates from issue comment content and linked URLs, accept only requester-authored comments on the same issue, require exactly one accepted CSV attachment for the active processing attempt, and fail closed on ambiguity.
- **Rationale**: GitHub issue and issue-comment APIs expose comment bodies rather than a structured attachment collection. Conservative discovery and same-requester validation are required to maintain provenance and avoid processing unrelated or spoofed comment content for a privileged create-teams workflow.
- **Alternatives considered**:
  - Assume GitHub exposes a dedicated issue-attachment API resource: rejected because the supported issue and comment APIs center on raw, text, and HTML bodies rather than attachment objects.
  - Accept any `.csv` link in any comment: rejected because non-requester and unrelated comments must not influence approval readiness for privileged team creation.

## Decision 4: Preserve existing create-org-teams bulk CSV semantics by downloading accepted attachment content and normalizing it through the feature `007` CSV team model

- **Decision**: Download the accepted CSV attachment, decode it as UTF-8 text, and reuse the same `team_name`-header schema, row-level validation rules, duplicate handling, blank-row handling, slug-conflict handling, unsupported-column rules, and downstream requested-team model already established for feature `007`.
- **Rationale**: The enhancement changes intake only. Reusing the existing CSV normalization semantics minimizes new behavioral surface and preserves the review and execution guarantees already approved for high-volume team creation.
- **Alternatives considered**:
  - Introduce an attachment-specific schema or multi-column model: rejected because it would widen scope beyond the single-organization, single-owner request model and create unnecessary divergence from feature `007`.
  - Skip normalization until execution time: rejected because reviewers need validated requested teams and row findings before approval.

## Decision 5: Require corrected files to arrive in later comments and deterministically select the newest eligible requester attachment after the latest failed attachment validation

- **Decision**: If CSV-content validation fails, the workflow stays blocked and requires the requester to post a corrected attachment in a later comment. The active attachment candidate becomes the newest requester attachment comment that appears after the latest failed CSV-attachment validation result.
- **Rationale**: A later-comment correction rule avoids ambiguity around edited comments, replaced links, or stale attachments while aligning with the existing `issue_comment`-triggered workflow design already used in this repository.
- **Alternatives considered**:
  - Re-scan all requester comments and always choose the newest attachment regardless of failure boundaries: rejected because it makes it harder to reason about which attempt superseded which failed validation.
  - Allow editing the original attachment comment to replace the file in place: rejected because attachments are operationally linked content and the specification requires a later comment for corrections.

## Decision 6: Capture attachment provenance as first-class audit evidence and fail closed when provenance cannot be established

- **Decision**: Record attachment URL, issue comment id, uploader login, inferable filename, content hash, and download timestamp in the audit artifact, and block the request if the attachment cannot be safely identified, downloaded, hashed, or decoded.
- **Rationale**: Attachment-based intake is weaker than repo-backed blob references, so provenance and deterministic evidence must compensate for the lack of a commit SHA while preserving auditable IssueOps operations.
- **Alternatives considered**:
  - Store only row-level CSV findings and omit attachment provenance: rejected because it would leave reviewers and operators unable to prove which file was actually processed.
  - Keep processing when attachment metadata is partial or ambiguous: rejected because privileged automation must fail closed when provenance is uncertain.

## Decision 7: Reuse the existing approval gate and execution path unchanged after validated attachment normalization, and ignore later attachment comments after an executed terminal state

- **Decision**: Keep the current single intended-owner approval model, run approval only after attachment validation succeeds, preserve the existing reconciliation-first team-creation path, and ignore later attachment comments after terminal execution.
- **Rationale**: Approval authority is already defined in `specs/003-create-org-teams/spec.md`, and the create-only-missing reconciliation rules are already established in features `003` and `007`. Ignoring later comments after terminal execution prevents accidental reopening of completed privileged operations.
- **Alternatives considered**:
  - Add a second approval command specifically for attachments: rejected because it would introduce avoidable authorization drift.
  - Reopen completed requests whenever a newer attachment appears: rejected because the enhancement explicitly forbids re-invocation after terminal execution.