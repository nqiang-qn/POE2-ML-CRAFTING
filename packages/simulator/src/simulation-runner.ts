/** Seeded repeated-action simulation and aggregate outcome reporting. */

import type { DatabaseSync } from "node:sqlite";
import { affixCounts, type Item } from "@poe2craft/domain";
import { createActionContext, type Omen } from "./action-context.js";
import type { CraftingAction } from "./crafting-action.js";
import { canApplyCraftingAction } from "./action-registry.js";

/** Configuration for repeated independent executions of one crafting action. */
export interface SimulationOptions {
	readonly runs: number;
	readonly seed: number;
	readonly omens?: readonly Omen[];
}

/** Aggregate outcome report produced by a simulation batch. */
export interface SimulationReport {
	readonly schemaVersion: 1;
	readonly action: { readonly id: string; readonly name: string };
	readonly input: {
		readonly base: string;
		readonly itemLevel: number;
		readonly rarity: string;
		readonly modifierCount: number;
	};
	readonly runs: number;
	readonly seed: number;
	readonly omenNames: readonly string[];
	readonly dataSource: {
		readonly url: string;
		readonly lastImportedAt: string | null;
	};
	readonly addedModifiers: Readonly<Record<string, number>>;
	readonly removedModifiers: Readonly<Record<string, number>>;
	readonly fracturedModifiers: Readonly<Record<string, number>>;
	readonly resultingAffixCounts: Readonly<Record<string, number>>;
	readonly consumedOmens: Readonly<Record<string, number>>;
}

/**
 * Creates a deterministic Mulberry32 pseudo-random-number generator.
 *
 * @param seed - Unsigned 32-bit seed; other finite integers are normalized.
 * @returns A function producing values in the half-open interval `[0, 1)`.
 * @throws If the seed is not a finite integer.
 */
export function createSeededRandom(seed: number): () => number {
	if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
		throw new Error("Simulation seed must be a finite integer");
	}
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function increment(target: Record<string, number>, key: string): void {
	target[key] = (target[key] ?? 0) + 1;
}

/**
 * Runs one action repeatedly from the same starting item and aggregates outcomes.
 *
 * Every run is independent: the action always receives the original item state.
 * This function does not mutate the database, item, action, or Omen collection.
 *
 * @param database - Open SQLite modifier database.
 * @param action - Registered crafting action to execute.
 * @param item - Starting item used independently for every run.
 * @param options - Run count, deterministic seed, and optional active Omens.
 * @returns A JSON-serializable aggregate simulation report.
 * @throws If arguments are invalid, the action cannot apply, or an outcome fails.
 */
export function runSimulation(
	database: DatabaseSync,
	action: CraftingAction,
	item: Item,
	options: SimulationOptions,
): SimulationReport {
	if (!Number.isSafeInteger(options.runs) || options.runs < 1) {
		throw new Error("Simulation runs must be a positive safe integer");
	}
	if (!canApplyCraftingAction(database, action, item)) {
		throw new Error(`${action.name} cannot apply to the input item`);
	}

	const addedModifiers: Record<string, number> = {};
	const removedModifiers: Record<string, number> = {};
	const fracturedModifiers: Record<string, number> = {};
	const resultingAffixCounts: Record<string, number> = {};
	const consumedOmens: Record<string, number> = {};
	const rng = createSeededRandom(options.seed);
	const context = createActionContext({ rng, omens: options.omens ?? [] });
	const sourceUrl = `https://poe2db.tw/us/${item.base}`;
	const sourceRow = database
		.prepare("SELECT MAX(fetched_at) AS lastImportedAt FROM import_runs WHERE source_url = ?")
		.get(sourceUrl) as { lastImportedAt: string | null } | undefined;

	for (let run = 0; run < options.runs; run += 1) {
		const result = action.apply(database, item, context);
		for (const modifier of result.addedModifiers ?? [])
			increment(addedModifiers, modifier.name);
		for (const modifier of result.removedModifiers ?? [])
			increment(removedModifiers, modifier.name);
		for (const modifier of result.fracturedModifiers ?? [])
			increment(fracturedModifiers, modifier.name);
		for (const omen of result.consumedOmens) increment(consumedOmens, omen);
		const counts = affixCounts(result.item);
		increment(resultingAffixCounts, `${counts.prefixes}P/${counts.suffixes}S`);
	}

	return Object.freeze({
		schemaVersion: 1,
		action: Object.freeze({ id: action.id, name: action.name }),
		input: Object.freeze({
			base: item.base,
			itemLevel: item.itemLevel,
			rarity: item.rarity,
			modifierCount: item.modifiers.length,
		}),
		runs: options.runs,
		seed: options.seed,
		omenNames: Object.freeze((options.omens ?? []).map((omen) => omen.name)),
		dataSource: Object.freeze({
			url: sourceUrl,
			lastImportedAt: sourceRow?.lastImportedAt ?? null,
		}),
		addedModifiers: Object.freeze(addedModifiers),
		removedModifiers: Object.freeze(removedModifiers),
		fracturedModifiers: Object.freeze(fracturedModifiers),
		resultingAffixCounts: Object.freeze(resultingAffixCounts),
		consumedOmens: Object.freeze(consumedOmens),
	});
}
