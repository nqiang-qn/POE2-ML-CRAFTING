# POE2-ML-CRAFTING

An experimental, model-based crafting optimizer for Path of Exile 2.

See [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) for the proposed architecture,
milestones, and strategy for working without official modifier spawn weights.
Public APIs follow the repository's [Coding Standards](docs/CODING_STANDARDS.md),
including required TSDoc documentation for exported functions and types.
All commands you can run locally are collected in the
[Command Reference](docs/COMMANDS.md).

## Development

The production code is organized as strict TypeScript workspace packages:

- `@poe2craft/domain`
- `@poe2craft/data`
- `@poe2craft/poe2db-importer`
- `@poe2craft/simulator`

Install, type-check, and test with:

```powershell
npm.cmd install
npm.cmd run check
```

Python will be added as a separate experimentation layer for transition models,
optimization, and ML; it will consume versioned artifacts produced by the
TypeScript simulator.

## Import PoE2DB glove modifiers

The initial data importer reads modifier metadata and `DropChance` weights embedded
in PoE2DB's strength-gloves page and stores them in SQLite:

```powershell
npm.cmd run import:gloves
```

The default output is `data/poe2db.sqlite3`. Use `--url` for another item-class
page, `--db` for another database path, or `--html-file` to import a cached page
without making a network request.

PoE2DB is a third-party source. Every row retains its source URL and raw record;
the weights should be treated as sourced estimates rather than official GGG data.

Inspect the imported modifier sections or query the initial crafting pool with:

```powershell
npm.cmd run query:modifiers -- --sections
npm.cmd run query:modifiers -- --sources
npm.cmd run query:modifiers -- --item-level 60 --generation Prefix
```

The initial pool retains but excludes augment, bonded, corrupted, and Orb of
Sacrifice sections. Pass `--include-special` to include them in query output.

## Crafting simulator

The simulator currently provides immutable item state, database-backed ordinary
modifier eligibility, weighted selection, composable Omen addition/removal
hooks, minimum-modifier-level currency tiers, and a shared action registry.
Implemented actions include normal, Greater, and Perfect variants of
Transmutation, Augmentation, Regal, and Exalted currencies, plus Orb of
Alchemy, normal/Greater/Perfect Chaos Orbs, and Orb of Annulment. Alchemy
reforges normal or magic items into four-modifier rares. Chaos removes before
adding its replacement, while fractured and explicitly protected modifiers are
excluded from removal. Individual named Omens are intentionally added only
after their in-game rules have been verified and tested.

Query the eligible ordinary-currency pool for an item, optionally excluding
families already present on it:

```powershell
npm.cmd run query:modifiers -- --base Gloves_str --action ordinary `
    --item-level 60 --generation Prefix --probabilities

npm.cmd run query:modifiers -- --base Gloves_str --action ordinary `
    --item-level 60 --existing-family IncreasedLife --probabilities
```
