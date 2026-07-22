# Research: Tenant Repos on New Topology

## Phase
Phase 0 - Outline and Research

## Feature
023-tenant-repos-new-topology

## Research Item 1: Authoritative tenant context source for create-tenant-repos

Decision:
Treat canonical topology records in `tenant-registry/` as the primary source, with legacy projection fallback when canonical fields are absent.

Rationale:
Spec 022 established canonical topology fields. create-tenant-repos must align to those fields while remaining operational during migration.

Alternatives considered:
- Legacy-first with optional canonical overlay: rejected because it delays convergence to the new model.
- Canonical-only hard cutover: rejected because existing legacy records would fail.

## Research Item 2: Owned repository list persistence strategy

Decision:
On successful repository creation, append exactly one object to `topology.repositories.owned`; keep prior entries unchanged; initialize `owned` to `[]` when missing.

Rationale:
Append-only semantics preserve history and satisfy multi-repository-per-tenant support without destructive writes.

Alternatives considered:
- Rebuild full owned list each run: rejected due to higher drift and merge risk.
- Track repositories outside tenant topology: rejected because spec requires topology ownership list.

## Research Item 3: Field default policy for owned repository entries

Decision:
`visibility` is required from issue form and is never defaulted. Default only missing non-visibility fields:
- `repoType=service`
- `lifecycle=active`
- `migrationWave=wave-1`
- `source=ghec`

Rationale:
Visibility is already captured in create-repo intake and should remain explicit user intent. Other metadata needs deterministic values to keep entries complete.

Alternatives considered:
- Default visibility to private: rejected by feature requirement.
- Require all fields from issue form: rejected due to current intake scope and UX overhead.

## Research Item 4: Duplicate repository-name validation semantics

Decision:
Validate requested repository name against `topology.repositories.owned[*].repoName` using case-insensitive normalized comparison before approval readiness.

Rationale:
Pre-approval duplicate detection prevents conflicting topology state and unnecessary execution attempts.

Alternatives considered:
- Execution-time only duplicate check: rejected because late failures degrade approval UX.
- Exact-string comparison only: rejected due to casing/normalization false negatives.

## Research Item 5: Idempotency behavior for reruns and concurrency

Decision:
Treat matching normalized repo name + tenant context in `topology.repositories.owned` as topology no-op on rerun, and fail closed when concurrent writes create a duplicate before persistence.

Rationale:
This keeps reconciliation deterministic and prevents duplicate append entries.

Alternatives considered:
- Always append on successful mutation: rejected because reruns would duplicate records.
- Last-write-wins overwrite: rejected due to auditability loss.

## Research Item 6: Observability requirements for topology persistence

Decision:
Audit output must include the appended (or matched no-op) owned entry and an indicator of which fields were defaulted.

Rationale:
Operators need to understand whether values came from request input or deterministic defaults.

Alternatives considered:
- Summary-only evidence: rejected because artifacts must be machine-readable and complete.

## Clarification Resolution Summary

All technical-context unknowns are resolved:
- Canonical vs legacy read precedence is defined.
- Owned-list append and idempotency behavior is defined.
- Visibility sourcing and non-visibility defaults are defined.
- Duplicate-name validation scope and error semantics are defined.
