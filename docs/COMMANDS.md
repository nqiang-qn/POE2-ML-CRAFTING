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

Import Greater and Perfect Essence currency pages and their class mappings:

```powershell
npm.cmd run import:essences
```

Import a timestamped poe.ninja snapshot for Currency, Essences, and Ritual
(which contains Omens), normalized to Exalted Orb values:

```powershell
npm.cmd run import:prices -- --league "Runes of Aldur"
```

This is an explicit, manual snapshot command. The simulator and graph exporter
never contact poe.ninja. Run it once when beginning a league, or again only when
you intentionally want a newer snapshot; older snapshots remain immutable.

## Query Imported Data

Show every imported source page and its stored record count:

```powershell
npm.cmd run query:modifiers -- --sources
npm.cmd run validate:essences
```

## Sample a Transition Artifact

Create a JSON configuration containing `item`, `target`, `actionId`, `samples`,
and `seed`, then write a deterministic artifact for Python experiments:

```powershell
npm.cmd run sample:transition -- `
	--config path\to\transition-config.json `
	--output data\transitions\sample.json
```

The optional configuration fields are `database` and `omenIds`.

Discover and export a bounded reachable-state graph using a JSON configuration
with `item`, `target`, and `options`:

```powershell
npm.cmd run discover:graph -- `
	--config path\to\graph-config.json `
	--output data\transitions\graph.json
```

Graph schema version 3 records each transition's `method`. Chaos Orb, Greater
Chaos Orb, and Perfect Chaos Orb transitions are enumerated exactly from
uniform removal choices and imported replacement weights; their `seed` and
outcome `count` fields are `null`. Unsupported actions retain deterministic
sampling and record `method: "sampled"`.

To price graph transitions, add a static league snapshot and allowed Omens to
`options`:

```json
{
	"samplesPerAction": 1000,
	"seed": 42,
	"maxStates": 10000,
	"maxDepth": 20,
	"actionIds": ["exalted-orb"],
	"omenIds": ["sinistral-exaltation"],
	"market": {
		"league": "Runes of Aldur",
		"capturedAt": "2026-07-14T01:40:34.805Z"
	}
}
```

If `capturedAt` is omitted, discovery selects the latest already-stored
snapshot once and records the resolved timestamp in `marketSnapshot`. It does
not refresh prices. Providing `capturedAt` makes reruns independent of later
manual imports.

## Solve a Crafting Policy

Python 3.11 or newer is recommended. The solver uses only the standard library,
so there are no Python packages to install.

Run value iteration over a complete, priced graph:

```powershell
python experiments/value_iteration.py `
	--graph data/transitions/graph.json `
	--output data/policies/policy.json
```

The solver rejects truncated graphs, state-abstraction collisions, missing
prices, invalid probabilities, and non-terminal states without actions. The
following approximation flags must therefore be chosen explicitly when needed:

```powershell
python experiments/value_iteration.py `
	--graph data/transitions/graph.json `
	--output data/policies/policy.json `
	--allow-truncated `
	--allow-collisions
```

Run the dependency-free Python tests:

```powershell
python -m unittest discover -s experiments -p "test_*.py"
```

The equivalent project command is `npm.cmd run test:python`. It includes a
cross-language fixture that serializes a graph through the TypeScript simulator
API, solves it with Python, and validates the policy with seeded rollouts.

Validate the generated policy with deterministic Monte Carlo rollouts:

```powershell
python experiments/policy_rollout.py `
	--graph data/transitions/graph.json `
	--policy data/policies/policy.json `
	--output data/policies/validation.json `
	--episodes 10000 `
	--seed 42
```

The report includes termination rate, failure states, mean/median/tail cost,
step statistics, standard error, and the difference between simulated and
value-iteration expected cost. Prediction error is omitted when any episode
hits `--max-steps`, because the successful-only cost sample is then censored.

## Run the Real Glove Example

Discover a graph for repeatedly using Chaos Orbs on a real level-60 strength
glove until the `IncreasedLife` family appears:

```powershell
npm.cmd run discover:graph -- `
	--config examples/gloves-life-chaos.json `
	--output data/transitions/gloves-life-chaos.json

python experiments/value_iteration.py `
	--graph data/transitions/gloves-life-chaos.json `
	--output data/policies/gloves-life-chaos-policy.json

python experiments/policy_rollout.py `
	--graph data/transitions/gloves-life-chaos.json `
	--policy data/policies/gloves-life-chaos-policy.json `
	--output data/policies/gloves-life-chaos-validation.json `
	--episodes 10000 `
	--seed 42
```

The encoder retains every modifier attribute inspected by implemented crafting
mechanics, so this example produces a complete graph with no abstraction
collisions. Its Chaos transitions are exact relative to the imported PoE2DB
weights and pinned league price snapshot. Those third-party weights are still
not a claim that the model perfectly reproduces hidden in-game behavior.

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
- `fracturing-orb`

Greater and Perfect Essence IDs follow these patterns:

- `greater-essence-of-<family>`
- `perfect-essence-of-<family>`

For example, `greater-essence-of-the-body` and
`perfect-essence-of-grounding`. Lesser, normal, and Corrupted Essences are not
registered in the current endgame scope.

Available Omen IDs:

- `greater-exaltation`
- `sinistral-exaltation`
- `dextral-exaltation`
- `sinistral-annulment`
- `dextral-annulment`
- `sinistral-erasure`
- `dextral-erasure`
- `whittling`
- `sinistral-crystallisation`
- `dextral-crystallisation`

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
