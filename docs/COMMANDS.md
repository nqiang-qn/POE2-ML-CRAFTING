# Command Reference

Run these commands from the repository root:

```text
F:\POE2CRAFTER\POE2-ML-CRAFTING
```

The examples use `npm.cmd` because PowerShell may block the `npm.ps1` wrapper on
Windows.

## Setup

Install the versions recorded in `package-lock.json`:

```powershell
npm.cmd install
```

For a clean, reproducible installation in CI or after deleting `node_modules`:

```powershell
npm.cmd ci
```

## Complete Validation

Run type-checking, linting, formatting verification, and all tests:

```powershell
npm.cmd run check
```

This is the recommended command before committing changes.

## Build and TypeScript

Compile all workspace packages:

```powershell
npm.cmd run build
```

Check strict TypeScript types without relying on emitted JavaScript:

```powershell
npm.cmd run typecheck
```

Compiled output is written to each package's `dist` directory and is ignored by
Git.

## Tests

Run all tests:

```powershell
npm.cmd test
```

Run one test file while developing:

```powershell
npx.cmd tsx tests/import-poe2db-modifiers.test.ts
npx.cmd tsx tests/crafting-actions.test.ts
```

## Linting

Check TypeScript code-quality rules:

```powershell
npm.cmd run lint
```

## Formatting

Format supported repository files using hard tabs displayed at width 4:

```powershell
npm.cmd run format
```

Check formatting without modifying files:

```powershell
npm.cmd run format:check
```

## Import PoE2DB Modifier Data

Import the default strength-gloves page into `data/poe2db.sqlite3`:

```powershell
npm.cmd run import:gloves
```

Import another item-class page into the same database:

```powershell
npm.cmd run import:gloves -- --url https://poe2db.tw/us/Gloves_dex
npm.cmd run import:gloves -- --url https://poe2db.tw/us/Gloves_int
npm.cmd run import:gloves -- --url https://poe2db.tw/us/Gloves_str_dex
npm.cmd run import:gloves -- --url https://poe2db.tw/us/Gloves_str_int
npm.cmd run import:gloves -- --url https://poe2db.tw/us/Gloves_dex_int
```

Write to a different SQLite database:

```powershell
npm.cmd run import:gloves -- --db data/test.sqlite3
```

Import a previously downloaded HTML page without accessing the network:

```powershell
npm.cmd run import:gloves -- `
	--url https://poe2db.tw/us/Gloves_str `
	--html-file path\to\Gloves_str.html
```

Imports use upserts, so rerunning an import updates existing rows without
duplicating them. Each run is retained in the import history.

## Query Imported Data

Show every imported source page and its stored record count:

```powershell
npm.cmd run query:modifiers -- --sources
```

Summarize modifier sections such as `normal`, `essence`, and `bonded`:

```powershell
npm.cmd run query:modifiers -- --sections
```

Show ordinary strength-glove prefixes available at item level 60:

```powershell
npm.cmd run query:modifiers -- `
	--base Gloves_str `
	--action ordinary `
	--item-level 60 `
	--generation Prefix
```

Include normalized probabilities:

```powershell
npm.cmd run query:modifiers -- `
	--base Gloves_str `
	--action ordinary `
	--item-level 60 `
	--generation Prefix `
	--probabilities
```

Exclude a modifier family already present on the item:

```powershell
npm.cmd run query:modifiers -- `
	--base Gloves_str `
	--action ordinary `
	--item-level 60 `
	--existing-family IncreasedLife `
	--probabilities
```

Multiple existing families may be supplied:

```powershell
npm.cmd run query:modifiers -- `
	--base Gloves_str `
	--action ordinary `
	--item-level 60 `
	--existing-family IncreasedLife `
	--existing-family FireResistance
```

Query one exact family:

```powershell
npm.cmd run query:modifiers -- `
	--base Gloves_str `
	--family IncreasedLife
```

Query one exact source section:

```powershell
npm.cmd run query:modifiers -- --section essence
```

Include special sections normally excluded from the initial crafting pool:

```powershell
npm.cmd run query:modifiers -- --include-special --limit 200
```

Use a different database:

```powershell
npm.cmd run query:modifiers -- --db data/test.sqlite3 --sources
```

## Run Crafting Simulations

Run a deterministic Regal Orb simulation against the real glove database:

```powershell
npm.cmd run simulate -- `
	--base Gloves_str `
	--item-level 60 `
	--rarity magic `
	--action regal-orb `
	--runs 100000 `
	--seed 12345 `
	--top 20
```

Simulate Greater Exaltation and write a JSON report:

```powershell
npm.cmd run simulate -- `
	--base Gloves_str `
	--item-level 60 `
	--rarity rare `
	--action exalted-orb `
	--omen greater-exaltation `
	--runs 100000 `
	--seed 12345 `
	--output data/greater-exaltation.json
```

Supply initial modifiers by their displayed affix names. Repeat `--modifier` as
needed. The highest eligible tier with that exact name is selected:

```powershell
npm.cmd run simulate -- `
	--base Gloves_str `
	--item-level 60 `
	--rarity rare `
	--modifier Hale `
	--action orb-of-annulment `
	--omen sinistral-annulment `
	--runs 10000 `
	--seed 7
```

Available action IDs:

- `orb-of-transmutation`
- `greater-orb-of-transmutation`
- `perfect-orb-of-transmutation`
- `orb-of-augmentation`
- `greater-orb-of-augmentation`
- `perfect-orb-of-augmentation`
- `regal-orb`
- `greater-regal-orb`
- `perfect-regal-orb`
- `exalted-orb`
- `greater-exalted-orb`
- `perfect-exalted-orb`
- `orb-of-alchemy`
- `chaos-orb`
- `greater-chaos-orb`
- `perfect-chaos-orb`
- `orb-of-annulment`

Available Omen IDs:

- `greater-exaltation`
- `sinistral-exaltation`
- `dextral-exaltation`
- `sinistral-annulment`
- `dextral-annulment`
- `sinistral-erasure`
- `dextral-erasure`
- `whittling`

`--top` only limits console tables. JSON reports always retain every outcome.

## Common Workflow

```powershell
npm.cmd install
npm.cmd run import:gloves
npm.cmd run query:modifiers -- --sources
npm.cmd run check
```

## Available npm Scripts

The authoritative script definitions are in `package.json`:

| Command                       | Purpose                           |
| ----------------------------- | --------------------------------- |
| `npm.cmd run build`           | Compile all TypeScript packages   |
| `npm.cmd run typecheck`       | Run strict TypeScript checks      |
| `npm.cmd run lint`            | Run ESLint                        |
| `npm.cmd run format`          | Apply Prettier formatting         |
| `npm.cmd run format:check`    | Verify formatting without changes |
| `npm.cmd test`                | Run all tests                     |
| `npm.cmd run check`           | Run the complete validation suite |
| `npm.cmd run import:gloves`   | Import a PoE2DB item-class page   |
| `npm.cmd run query:modifiers` | Query the modifier database       |
| `npm.cmd run simulate`        | Run a seeded crafting simulation  |
