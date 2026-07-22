# Research: Tenant Repository Visibility Dropdown

## Decision

The enhancement will add a repository visibility dropdown to the tenant repository creation issue form. It will support at least the values `private`, `internal`, and `public`, with `private` as the default when no explicit choice is provided.

## Rationale

- `private` is the safe default for tenant repositories and minimizes accidental exposure.
- Exposing visibility as a dropdown makes the intent explicit and avoids relying on free-text values.
- Normalizing visibility into a structured request field allows the workflow to validate and apply the selection deterministically.
- The enhancement does not alter tenant boundary, approval, or governance semantics; it only extends repository creation metadata.

## Alternatives Considered

- Free-text visibility field: rejected due to higher validation risk and user confusion.
- Visibility inferred from organization policy or repository naming: rejected because it hides user intent and reduces transparency.
- Defaulting to `public`: rejected because it increases exposure risk for tenant repositories.

## Outcome

Use a structured dropdown with explicit supported values and a safe default of `private`. Implement parser normalization and validation early in the workflow.
