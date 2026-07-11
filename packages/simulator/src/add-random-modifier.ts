import type { DatabaseSync } from "node:sqlite";
import { addModifier, openGenerationTypes, type Item, type Modifier } from "@poe2craft/domain";
import { applyOmenPoolHooks, type ActionContext } from "./action-context.js";
import { eligibleOrdinaryModifiers } from "./modifier-pool.js";
import { selectWeighted } from "./weighted-selection.js";

/** Result of the shared weighted modifier-addition operation. */
export interface AddRandomModifierResult {
	readonly item: Item;
	readonly modifier: Modifier;
	readonly consumedOmens: readonly string[];
}

/**
 * Adds one eligible weighted ordinary modifier to an item.
 *
 * @param database - Open SQLite modifier database.
 * @param item - Item with at least one open affix slot.
 * @param actionName - Stable action name supplied to Omen hooks.
 * @param context - Randomness and active Omen effects.
 * @returns A new item, selected modifier, and consumed Omen names.
 * @throws If no open slot or positive-weight eligible outcome exists.
 */
export function addRandomModifier(
	database: DatabaseSync,
	item: Item,
	actionName: string,
	context: ActionContext,
): AddRandomModifierResult {
	const openTypes = openGenerationTypes(item);
	if (!openTypes.length) throw new Error("Item has no open affix slot");
	const pool = eligibleOrdinaryModifiers(database, item, openTypes);
	const omenResult = applyOmenPoolHooks(context, actionName, item, pool);
	const selected = selectWeighted(
		omenResult.pool as readonly (Modifier & { weight: number })[],
		context.rng,
	);
	return Object.freeze({
		item: addModifier(item, selected),
		modifier: selected,
		consumedOmens: Object.freeze(omenResult.consumedOmens),
	});
}
