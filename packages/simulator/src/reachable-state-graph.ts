/** Bounded crafting-state discovery with exact and sampled transition methods. */

import type { DatabaseSync } from "node:sqlite";
import type { Item, Modifier } from "@poe2craft/domain";
import { createActionContext } from "./action-context.js";
import { availableCraftingActions } from "./action-registry.js";
import type { CraftingTarget } from "./crafting-target.js";
import { isTargetSatisfied } from "./crafting-target.js";
import { createSeededRandom } from "./simulation-runner.js";
import { enumerateExactActionOutcomes } from "./exact-transition.js";
import {
	availableCostedActionVariants,
	createMarketCostModel,
	type ActionCost,
	type MarketCostModelOptions,
} from "./market-cost-model.js";
import {
	craftingStateKey,
	encodeCraftingState,
	mechanicModifierId,
	type EncodedCraftingState,
} from "./state-encoder.js";

/** Bounds and deterministic controls for reachable-state discovery. */
export interface ReachableGraphOptions {
	readonly samplesPerAction: number;
	readonly seed: number;
	readonly maxStates: number;
	readonly maxDepth: number;
	readonly actionIds?: readonly string[];
	readonly omenIds?: readonly string[];
	readonly market?: MarketCostModelOptions;
}

/** One encoded state retained by the reachable graph. */
export interface ReachableGraphState {
	readonly stateKey: string;
	readonly state: EncodedCraftingState;
	readonly depth: number;
	readonly terminal: boolean;
	readonly representativeSignature: string;
	readonly availableActionIds: readonly string[];
}

/** One normalized transition outcome in the reachable graph. */
export interface ReachableGraphOutcome {
	readonly stateKey: string;
	readonly count: number | null;
	readonly probability: number;
}

/** Sampled transition distribution for one state-action pair. */
export interface ReachableGraphTransition {
	readonly fromStateKey: string;
	readonly variantId: string;
	readonly actionId: string;
	readonly omenIds: readonly string[];
	readonly cost: ActionCost | null;
	readonly method: "exact" | "sampled";
	readonly seed: number | null;
	readonly outcomes: readonly ReachableGraphOutcome[];
}

/** Diagnostic for concrete items merged by the compact feature encoder. */
export interface StateAbstractionCollision {
	readonly stateKey: string;
	readonly representativeSignatures: readonly string[];
	readonly actionSets: readonly (readonly string[])[];
}

/** Versioned graph artifact ready for cost annotation and solver export. */
export interface ReachableStateGraph {
	readonly schemaVersion: 3;
	readonly target: CraftingTarget;
	readonly initialStateKey: string;
	readonly options: ReachableGraphOptions;
	readonly marketSnapshot: { readonly league: string; readonly capturedAt: string } | null;
	readonly states: readonly ReachableGraphState[];
	readonly transitions: readonly ReachableGraphTransition[];
	readonly collisions: readonly StateAbstractionCollision[];
	readonly frontierStateKeys: readonly string[];
	readonly omittedStateKeys: readonly string[];
	readonly truncated: boolean;
}

function normalizedModifier(modifier: Modifier): object {
	return {
		mechanicId: mechanicModifierId(modifier),
	};
}

/**
 * Produces a deterministic mechanic-relevant signature for collision diagnostics.
 *
 * @param item - Concrete item whose full explicit state will be serialized.
 * @returns Stable signature excluding display-only and rolled-value properties.
 */
export function concreteItemSignature(item: Item): string {
	const modifiers = item.modifiers
		.map((modifier) => JSON.stringify(normalizedModifier(modifier)))
		.sort();
	return JSON.stringify({
		base: item.base,
		itemLevel: item.itemLevel,
		rarity: item.rarity,
		modifiers,
	});
}

function positiveSafeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive`);
}

/**
 * Discovers a bounded reachable feature-state graph by simulator sampling.
 *
 * @param database - Open SQLite modifier database.
 * @param initialItem - Concrete item at the root of the discovery graph.
 * @param target - Terminal crafting objective and feature-encoding context.
 * @param options - Sampling seed, limits, and optional action allowlist.
 * @returns Deterministic graph, frontier, truncation, and collision diagnostics.
 */
export function discoverReachableStateGraph(
	database: DatabaseSync,
	initialItem: Item,
	target: CraftingTarget,
	options: ReachableGraphOptions,
): ReachableStateGraph {
	positiveSafeInteger(options.samplesPerAction, "samplesPerAction");
	positiveSafeInteger(options.maxStates, "maxStates");
	if (!Number.isSafeInteger(options.maxDepth) || options.maxDepth < 0) {
		throw new Error("maxDepth must be a non-negative safe integer");
	}
	const allowedActions = options.actionIds ? new Set(options.actionIds) : undefined;
	const masterRng = createSeededRandom(options.seed);
	const costModel = options.market ? createMarketCostModel(database, options.market) : undefined;
	const states = new Map<string, ReachableGraphState>();
	const signatures = new Map<string, Map<string, readonly string[]>>();
	const transitions: ReachableGraphTransition[] = [];
	const frontier = new Set<string>();
	const omitted = new Set<string>();
	const queue: { item: Item; depth: number }[] = [{ item: initialItem, depth: 0 }];

	const variantsFor = (item: Item) => {
		if (costModel) {
			return availableCostedActionVariants(
				database,
				item,
				costModel,
				options.omenIds ?? [],
			).filter((variant) => !allowedActions || allowedActions.has(variant.action.id));
		}
		return availableCraftingActions(database, item)
			.filter((action) => !allowedActions || allowedActions.has(action.id))
			.map((action) => ({
				id: action.id,
				action,
				omenIds: Object.freeze([] as string[]),
				activeOmens: Object.freeze([]),
				cost: null,
			}));
	};

	const actionIdsFor = (item: Item): readonly string[] =>
		Object.freeze(variantsFor(item).map((variant) => variant.id));

	const observe = (item: Item, depth: number): string => {
		const encoded = encodeCraftingState(item, target);
		const key = craftingStateKey(encoded);
		const actionIds = isTargetSatisfied(item, target) ? Object.freeze([]) : actionIdsFor(item);
		const signature = concreteItemSignature(item);
		const observed = signatures.get(key) ?? new Map<string, readonly string[]>();
		observed.set(signature, actionIds);
		signatures.set(key, observed);
		if (!states.has(key)) {
			if (states.size >= options.maxStates) {
				omitted.add(key);
				return key;
			}
			states.set(
				key,
				Object.freeze({
					stateKey: key,
					state: encoded,
					depth,
					terminal: isTargetSatisfied(item, target),
					representativeSignature: signature,
					availableActionIds: actionIds,
				}),
			);
			if (depth < options.maxDepth && !isTargetSatisfied(item, target)) {
				queue.push({ item, depth });
			} else if (!isTargetSatisfied(item, target)) frontier.add(key);
		}
		return key;
	};

	queue.length = 0;
	const initialStateKey = observe(initialItem, 0);
	while (queue.length) {
		const current = queue.shift();
		if (!current) break;
		const fromState = encodeCraftingState(current.item, target);
		const fromStateKey = craftingStateKey(fromState);
		const variants = variantsFor(current.item);
		for (const variant of variants) {
			const exactContext = createActionContext({ omens: variant.activeOmens });
			const exactOutcomes = enumerateExactActionOutcomes(
				database,
				current.item,
				variant.action,
				exactContext,
			);
			if (exactOutcomes) {
				const probabilities = new Map<string, number>();
				for (const outcome of exactOutcomes) {
					const outcomeKey = observe(outcome.item, current.depth + 1);
					probabilities.set(
						outcomeKey,
						(probabilities.get(outcomeKey) ?? 0) + outcome.probability,
					);
				}
				transitions.push(
					Object.freeze({
						fromStateKey,
						variantId: variant.id,
						actionId: variant.action.id,
						omenIds: variant.omenIds,
						cost: variant.cost,
						method: "exact",
						seed: null,
						outcomes: Object.freeze(
							[...probabilities.entries()]
								.sort(([left], [right]) => left.localeCompare(right))
								.map(([stateKey, probability]) =>
									Object.freeze({ stateKey, count: null, probability }),
								),
						),
					}),
				);
				continue;
			}
			const transitionSeed = Math.floor(masterRng() * 0x1_0000_0000);
			const context = createActionContext({
				rng: createSeededRandom(transitionSeed),
				omens: variant.activeOmens,
			});
			const counts = new Map<string, number>();
			for (let sample = 0; sample < options.samplesPerAction; sample += 1) {
				const result = variant.action.apply(database, current.item, context);
				const outcomeKey = observe(result.item, current.depth + 1);
				counts.set(outcomeKey, (counts.get(outcomeKey) ?? 0) + 1);
			}
			transitions.push(
				Object.freeze({
					fromStateKey,
					variantId: variant.id,
					actionId: variant.action.id,
					omenIds: variant.omenIds,
					cost: variant.cost,
					method: "sampled",
					seed: transitionSeed,
					outcomes: Object.freeze(
						[...counts.entries()]
							.sort(([left], [right]) => left.localeCompare(right))
							.map(([stateKey, count]) =>
								Object.freeze({
									stateKey,
									count,
									probability: count / options.samplesPerAction,
								}),
							),
					),
				}),
			);
		}
	}

	const collisions = [...signatures.entries()]
		.filter(([, observed]) => observed.size > 1)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([stateKey, observed]) =>
			Object.freeze({
				stateKey,
				representativeSignatures: Object.freeze([...observed.keys()].sort()),
				actionSets: Object.freeze(
					[...observed.entries()]
						.sort(([left], [right]) => left.localeCompare(right))
						.map(([, actionIds]) => actionIds),
				),
			}),
		);
	return Object.freeze({
		schemaVersion: 3,
		target,
		initialStateKey,
		options: Object.freeze({
			...options,
			actionIds: Object.freeze([...(options.actionIds ?? [])]),
			omenIds: Object.freeze([...(options.omenIds ?? [])]),
		}),
		marketSnapshot: costModel
			? Object.freeze({ league: costModel.league, capturedAt: costModel.capturedAt })
			: null,
		states: Object.freeze(
			[...states.values()].sort((a, b) => a.stateKey.localeCompare(b.stateKey)),
		),
		transitions: Object.freeze(
			transitions.sort(
				(a, b) =>
					a.fromStateKey.localeCompare(b.fromStateKey) ||
					a.variantId.localeCompare(b.variantId),
			),
		),
		collisions: Object.freeze(collisions),
		frontierStateKeys: Object.freeze([...frontier].sort()),
		omittedStateKeys: Object.freeze([...omitted].sort()),
		truncated: frontier.size > 0 || omitted.size > 0,
	});
}

/**
 * Serializes a reachable graph as deterministic JSON.
 *
 * @param graph - Graph returned by `discoverReachableStateGraph`.
 * @returns Stable, indented JSON ending with a newline.
 */
export function serializeReachableStateGraph(graph: ReachableStateGraph): string {
	return `${JSON.stringify(graph, null, 2)}\n`;
}
