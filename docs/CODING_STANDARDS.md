# Coding Standards

## Public API Documentation

Every exported function, class, interface, and non-obvious constant must have a
TSDoc comment. Documentation should explain behavior and contracts rather than
repeat the TypeScript signature.

Function documentation should include, where applicable:

- The domain operation performed.
- Important assumptions and invariants.
- `@param` entries when a parameter's meaning is not self-evident.
- `@returns` when the result needs interpretation.
- `@throws` for validation and domain errors callers should handle.
- Whether the function mutates input or returns immutable state.
- Probability units and random-number-generator expectations.

Example:

```ts
/**
 * Selects one candidate in proportion to its non-negative integer weight.
 *
 * @param candidates - Eligible outcomes with relative weights.
 * @param rng - Supplies a value in the half-open interval `[0, 1)`.
 * @returns The selected candidate without modifying the input array.
 * @throws If the pool is empty, contains an invalid weight, or has zero total weight.
 */
```

Private helpers only need comments when their purpose or algorithm is not clear
from their name and types.

## Formatting and Linting

Source and configuration files use hard tabs displayed at four columns. The
repository's `.editorconfig` and Prettier configuration are authoritative.

Run the complete validation suite with:

```powershell
npm.cmd run check
```

Individual commands are available when iterating:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd run format
```

ESLint checks TypeScript correctness and maintainability rules. Prettier checks
layout, including the four-column tab convention.

## Data Provenance

Imported data structures must document their source and whether a field is
official, datamined, third-party, inferred, or empirically measured. Probability
code must state whether values are relative weights or normalized probabilities.

Mechanics exposed by third-party databases must also be verified as active in
the current game patch before entering the simulator's supported API. Removed or
legacy mechanics may remain in imported raw data, but must not be registered as
active actions or effects.
