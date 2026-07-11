# Implementation Plan

## Goal

Build a Path of Exile 2 crafting simulator and optimizer inspired by Denny
Britz's article, [Solving Path of Exile item crafting with Reinforcement
Learning](https://dennybritz.com/posts/poe-crafting/).

The intended system will:

1. Represent items, modifiers, and crafting actions.
2. Simulate stochastic crafting transitions.
3. Estimate a transition model from simulator samples.
4. Solve the resulting Markov Decision Process (MDP) using value iteration.
5. Produce a crafting policy optimized for currency cost or number of actions.

## Main Constraint: Missing Spawn Weights

PoE 2 modifier metadata can be extracted or gathered from community data, but
accurate modifier spawn weights do not appear to be available from the client
data. PoE2DB does, however, embed third-party `DropChance` weights in its item
class calculator pages. Therefore, the project must record their provenance and
must not couple crafting rules to one assumed set of weights.

Weights will be accessed through a replaceable `WeightModel` interface with at
least these implementations:

- `UniformWeightModel`: all eligible modifiers have equal weight. Used only for
  development and tests.
- `ConfiguredWeightModel`: loads manually supplied weights from versioned JSON.
- `Poe2DbWeightModel`: loads imported PoE2DB weights from a versioned SQLite
  snapshot.
- `EmpiricalWeightModel`: estimates probabilities from observed crafting data.

Uniform weights must never be presented as accurate in-game probabilities.
Optimizer output should identify the weight model and data version used.

An additional research path is to learn feature-state transitions directly
from observations without recovering individual modifier weights.

## Initial Scope

The first version should deliberately cover a small crafting problem:

- One item class.
- One fixed item level.
- Normal, magic, and rare rarity states.
- A small synthetic pool of approximately 10-20 modifiers.
- Prefix and suffix limits.
- Modifier level eligibility.
- Modifier-group conflicts.
- Four initial actions:
    - Orb of Transmutation
    - Orb of Augmentation
    - Regal Orb
    - Orb of Annulment

The initial ordinary crafting pool includes base prefix and base suffix
modifiers. Imported augment, bonded, corrupted, and Orb of Sacrifice modifiers
remain stored for future mechanics but are excluded from initial simulations.

This scope is intended to validate the architecture and optimizer. It is not an
accurate general-purpose PoE 2 crafting simulator.

## Proposed Architecture

```text
src/
    domain/
        item.py
        modifier.py
        actions.py
        task.py
    data/
        loader.py
        schema.py
    simulation/
        eligibility.py
        weights.py
        simulator.py
    mdp/
        features.py
        model.py
        value_iteration.py
        policy.py
    observations/
        clipboard_parser.py
        estimator.py
tests/
data/
    toy_modifiers.json
    observations/
```

TypeScript is the production language for the importer, shared domain model,
crafting simulator, API, and future web application. Python is reserved for
transition-model experiments, statistical analysis, value iteration, and later
machine-learning work. The two environments will exchange versioned SQLite,
Arrow/Parquet, or model artifacts rather than making a cross-language call for
every simulated transition. A faster simulation core can be considered later
if profiling shows that transition sampling is a bottleneck.

## Core Domain Model

### Modifier

A modifier should initially contain:

```python
@dataclass(frozen=True)
class Modifier:
        id: str
        generation_type: Literal["prefix", "suffix"]
        required_level: int
        groups: frozenset[str]
        tags: frozenset[str]
        weight: float | None
```

The modifier identity and eligibility metadata are domain data. Selection
probability belongs to the selected weight model.

### Item

```python
@dataclass(frozen=True)
class Item:
        base_type: str
        item_level: int
        rarity: Literal["normal", "magic", "rare"]
        modifiers: tuple[Modifier, ...]
```

Later versions may add fractures, corrupted state, quality, sockets, and other
mechanic-specific properties.

### Actions

Each action should expose:

- Whether it is valid for an item.
- Its currency cost.
- How it mutates or replaces an item.
- Its random choices through an injected random-number generator and
  `WeightModel`.

The simulator must support deterministic seeded runs for reproducible tests.

## Eligibility Before Probability

Modifier selection should be split into two steps:

1. Determine which modifiers are eligible.
2. Ask the active weight model to select from eligible candidates.

Eligibility includes:

- Required item level.
- Correct item/base tags.
- Available prefix or suffix slots.
- Modifier-group conflicts.
- Any restrictions imposed by the current crafting action.

This division lets most of the simulator be implemented and tested without
knowing real spawn weights.

## MDP Design

### State

The initial feature representation will be relative to a crafting target:

```text
target modifier presence bits
prefix count
suffix count
rarity
open prefix count
open suffix count
```

For example, an item containing target modifiers one and three might have a
feature prefix such as `1010`.

The compact state intentionally omits the exact identities of irrelevant
modifiers. This makes tabular learning practical but can introduce a
simulation-to-reality gap when their groups or tags affect future actions. The
representation should be expanded only when tests demonstrate that information
is required.

### Actions

The available action set depends on the current item. Invalid actions should
not be emitted by the action-space provider.

### Transition Model

For each reachable feature state and valid action:

1. Clone a representative concrete item.
2. Apply the action many times.
3. Convert each result to a feature state.
4. Count and normalize the outcomes to estimate `P(s' | s, a)`.

Sampling must be seeded in tests. Production experiments should record the
seed, sample count, data version, and weight model.

### Reward

Support at least two objectives:

- Fewest steps: `reward = -1`.
- Lowest expected cost: `reward = -action_cost`.

The learned transition model can be reused when action costs change.

### Solver

Use tabular value iteration with terminal target states. The output should
include:

- The best action for each reachable state.
- Expected remaining cost or steps.
- Convergence diagnostics.
- The assumptions and data versions used.

Monte Carlo rollouts should independently validate the resulting policy.

## Working Without Real Weights

### Development

Use a small, synthetic modifier pool with deliberately chosen weights. Include
test cases whose optimal strategies can be calculated by hand.

### Sensitivity Analysis

Evaluate policies under several plausible weight models, such as:

- Uniform weights.
- Equal weights within a modifier tier.
- Progressively rarer high-tier modifiers.
- Random plausible weight vectors.

An action should be described as robust only when it remains preferable across
a documented range of assumptions.

### Empirical Data

For tightly controlled item bases, levels, and crafting actions:

1. Manually perform crafts in game.
2. Copy resulting item text.
3. Parse and store the observation with its full experimental context.
4. Estimate outcome probabilities with smoothing and confidence intervals.

Start with actions that add exactly one modifier, because their observations
are easier to interpret than complete rerolls.

The project should not automate game input. Observation tooling should accept
manually copied clipboard text or imported datasets.

### Direct Transition Learning

Where sufficient observations exist, estimate `P(s' | s, a)` directly in
feature space. This avoids identifying individual weights but requires enough
data for every relevant state-action pair.

## Milestones

### Milestone 1: Toy Simulator

- Create project packaging and test configuration.
- Define immutable `Modifier`, `Item`, `Action`, and `CraftingTask` models.
- Implement modifier eligibility and affix capacity rules.
- Implement seeded uniform and configured weight models.
- Implement the four initial currency actions.
- Add unit tests for every crafting rule.

Exit criterion: a seeded toy craft produces reproducible, valid items.

### Milestone 2: MDP Prototype

- Implement target-relative feature encoding.
- Discover reachable feature states by sampling.
- Build and serialize the transition table.
- Implement cost-based and step-based value iteration.
- Extract a policy.
- Validate it with Monte Carlo rollouts.

Exit criterion: the optimizer finds the expected strategy for a hand-solvable
toy problem.

### Milestone 3: Real Metadata

- Define a versioned JSON schema for PoE 2 modifier metadata.
- Add an importer for a selected community or extracted data source.
- Record source version and game patch with each dataset.
- Add a validator for missing groups, tags, levels, and base applicability.
- Run the simulator on one real item class using explicitly synthetic weights.

Exit criterion: real modifier eligibility works while probability assumptions
remain visibly labeled.

### Milestone 4: Empirical Probabilities

- Define an observation schema.
- Parse manually copied PoE 2 item text.
- Deduplicate and validate observations.
- Estimate probabilities and uncertainty.
- Compare empirical results with configured assumptions.

Exit criterion: at least one narrowly defined action/base/level experiment uses
measured rather than assumed probabilities.

### Milestone 5: Robust Recommendations

- Run policy sensitivity analysis across weight uncertainty.
- Flag recommendations that change under plausible assumptions.
- Include expected cost distributions rather than only means.
- Add patch-aware invalidation of data and models.

Exit criterion: recommendations communicate both the strategy and how strongly
the available evidence supports it.

## First Deliverable

Given a toy modifier pool, a target item, configurable weights, and currency
costs, produce the cheapest crafting policy and verify its expected cost using
Monte Carlo rollouts.

This deliverable proves the simulation and optimization pipeline. Accurate PoE
2 weights then become an explicit data-quality problem instead of an
architectural blocker.

## Non-Goals for the First Version

- Complete coverage of every PoE 2 crafting mechanic.
- Neural-network policies or feature learning.
- Exact in-game probability claims based on uniform weights.
- Automated interaction with the game client.
- A graphical interface before simulator correctness is established.

## Immediate Next Step

Implement Milestone 1 with one synthetic item class and enough modifiers to
exercise prefix/suffix limits, level requirements, and group conflicts.
