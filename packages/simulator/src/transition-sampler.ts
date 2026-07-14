/** Deterministic sampling of one action into an aggregated transition artifact. */

import type { DatabaseSync } from "node:sqlite";
import type { Item } from "@poe2craft/domain";
import { createActionContext, type Omen } from "./action-context.js";
import { canApplyCraftingAction } from "./action-registry.js";
import type { CraftingAction } from "./crafting-action.js";
import type { CraftingTarget } from "./crafting-target.js";
import { createSeededRandom } from "./simulation-runner.js";
import {
	craftingStateKey,
	encodeCraftingState,
	type EncodedCraftingState,
} from "./state-encoder.js";

/** Configuration for sampling one concrete state-action transition. */
export interface TransitionSampleOptions {
	readonly samples: number;
	readonly seed: number;
	readonly omens?: readonly Omen[];
}

/** Imported source revision attached to a transition artifact. */
export interface TransitionDataSource {
	readonly url: string;
	readonly lastImportedAt: string | null;
}

/** One aggregated encoded outcome from a sampled action. */
export interface TransitionOutcome {
	readonly stateKey: string;
	readonly state: EncodedCraftingState;
	readonly count: number;
	readonly probability: number;
}

/** Versioned, deterministic artifact consumed by optimizer experiments. */
export interface TransitionArtifact {
	readonly schemaVersion: 1;
	readonly target: CraftingTarget;
	readonly action: { readonly id: string; readonly name: string };
	readonly inputStateKey: string;
	readonly inputState: EncodedCraftingState;
	readonly samples: number;
	readonly seed: number;
	readonly omenNames: readonly string[];
	readonly dataSources: readonly TransitionDataSource[];
	readonly outcomes: readonly TransitionOutcome[];
}

function dataSourcesFor(
	database: DatabaseSync,
	item: Item,
	action: CraftingAction,
): readonly TransitionDataSource[] {
	const urls = new Set([`https://poe2db.tw/us/${item.base}`]);
	if (action.name.includes("Essence")) {
		const rows = database
			.prepare("SELECT DISTINCT source_url FROM essence_modifiers WHERE essence_name = ?")
			.all(action.name) as unknown as { source_url: string }[];
		for (const row of rows) urls.add(row.source_url);
	}
	return Object.freeze(
		[...urls].sort().map((url) => {
			const row = database
				.prepare(
					"SELECT MAX(fetched_at) AS lastImportedAt FROM import_runs WHERE source_url = ?",
				)
				.get(url) as { lastImportedAt: string | null } | undefined;
			return Object.freeze({ url, lastImportedAt: row?.lastImportedAt ?? null });
		}),
	);
}

/**
 * Samples one action repeatedly from the same concrete item state.
 *
 * @param database - Open SQLite modifier database.
 * @param item - Concrete starting item reused independently for every sample.
 * @param target - Objective used to encode input and outcome states.
 * @param action - Database-applicable action being sampled.
 * @param options - Sample count, deterministic seed, and optional Omens.
 * @returns A versioned aggregate transition artifact sorted by outcome key.
 * @throws If options are invalid, the action is unavailable, or a sample fails.
 */
export function sampleTransition(
	database: DatabaseSync,
	item: Item,
	target: CraftingTarget,
	action: CraftingAction,
	options: TransitionSampleOptions,
): TransitionArtifact {
	if (!Number.isSafeInteger(options.samples) || options.samples < 1) {
		throw new Error("Transition sample count must be a positive safe integer");
	}
	if (!canApplyCraftingAction(database, action, item)) {
		throw new Error(`${action.name} cannot apply to the input item`);
	}
	const inputState = encodeCraftingState(item, target);
	const rng = createSeededRandom(options.seed);
	const context = createActionContext({ rng, omens: options.omens ?? [] });
	const aggregate = new Map<string, { readonly state: EncodedCraftingState; count: number }>();
	for (let sample = 0; sample < options.samples; sample += 1) {
		const result = action.apply(database, item, context);
		const state = encodeCraftingState(result.item, target);
		const key = craftingStateKey(state);
		const existing = aggregate.get(key);
		if (existing) existing.count += 1;
		else aggregate.set(key, { state, count: 1 });
	}
	const outcomes = [...aggregate.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([stateKey, outcome]) =>
			Object.freeze({
				stateKey,
				state: outcome.state,
				count: outcome.count,
				probability: outcome.count / options.samples,
			}),
		);
	return Object.freeze({
		schemaVersion: 1,
		target,
		action: Object.freeze({ id: action.id, name: action.name }),
		inputStateKey: craftingStateKey(inputState),
		inputState,
		samples: options.samples,
		seed: options.seed,
		omenNames: Object.freeze((options.omens ?? []).map((omen) => omen.name)),
		dataSources: dataSourcesFor(database, item, action),
		outcomes: Object.freeze(outcomes),
	});
}

/**
 * Serializes a transition artifact using stable two-space-indented JSON.
 *
 * @param artifact - Artifact returned by `sampleTransition`.
 * @returns Deterministic JSON ending with a newline.
 */
export function serializeTransitionArtifact(artifact: TransitionArtifact): string {
	return `${JSON.stringify(artifact, null, 2)}\n`;
}
