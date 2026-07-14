/** Analytical action-outcome enumeration from selection rules and weights. */

import type { DatabaseSync } from "node:sqlite";
import {
	addModifier,
	openGenerationTypes,
	removeModifierAt,
	type Item,
	type Modifier,
} from "@poe2craft/domain";
import { applyOmenPoolHooks, applyOmenRemovalHooks, type ActionContext } from "./action-context.js";
import type { CraftingAction } from "./crafting-action.js";
import { eligibleOrdinaryModifiers } from "./modifier-pool.js";
import { isModifierRemovable } from "./remove-random-modifier.js";

const CHAOS_ACTION_IDS = new Set(["chaos-orb", "greater-chaos-orb", "perfect-chaos-orb"]);

/** One analytically enumerated concrete action result and its exact probability. */
export interface ExactActionOutcome {
	readonly item: Item;
	readonly probability: number;
}

/**
 * Enumerates an action's concrete outcomes directly from selection rules.
 *
 * Chaos tiers are currently supported. Removal is uniform after Omen hooks,
 * while replacement selection uses normalized imported modifier weights.
 *
 * @param database - Open SQLite modifier database.
 * @param item - Concrete item before applying the action.
 * @param action - Currency action whose outcomes should be enumerated.
 * @param context - Active Omens; its random-number generator is not consumed.
 * @returns Exact outcomes, or `null` when the action has no analytical enumerator.
 * @throws If an applicable action produces an empty or invalid selection pool.
 */
export function enumerateExactActionOutcomes(
	database: DatabaseSync,
	item: Item,
	action: CraftingAction,
	context: ActionContext,
): readonly ExactActionOutcome[] | null {
	if (!CHAOS_ACTION_IDS.has(action.id)) return null;
	const removable = item.modifiers.filter(isModifierRemovable);
	const removalPool = applyOmenRemovalHooks(context, action.name, item, removable).pool;
	if (!removalPool.length) throw new Error(`${action.name} has no removable outcome`);
	const outcomes: ExactActionOutcome[] = [];
	for (const removed of removalPool) {
		const index = item.modifiers.indexOf(removed);
		if (index < 0) throw new Error("Omen removal pool contained an unknown modifier");
		const afterRemoval = removeModifierAt(item, index);
		const additions = applyOmenPoolHooks(
			context,
			action.name,
			afterRemoval,
			eligibleOrdinaryModifiers(
				database,
				afterRemoval,
				openGenerationTypes(afterRemoval),
				action.minimumModifierLevel ?? 0,
			),
		).pool as readonly (Modifier & { readonly weight: number })[];
		const totalWeight = additions.reduce((sum, modifier) => sum + modifier.weight, 0);
		if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) {
			throw new Error(`${action.name} has no positive-weight replacement outcome`);
		}
		for (const addition of additions) {
			if (!Number.isSafeInteger(addition.weight) || addition.weight <= 0) {
				throw new Error(`${action.name} encountered an invalid modifier weight`);
			}
			outcomes.push(
				Object.freeze({
					item: addModifier(afterRemoval, addition),
					probability: (1 / removalPool.length) * (addition.weight / totalWeight),
				}),
			);
		}
	}
	return Object.freeze(outcomes);
}
