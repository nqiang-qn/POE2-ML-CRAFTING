/** Registry and database-aware availability checks for active crafting actions. */

import type { DatabaseSync } from "node:sqlite";
import type { Item } from "@poe2craft/domain";
import type { CraftingAction } from "./crafting-action.js";
import { chaosOrb, greaterChaosOrb, perfectChaosOrb } from "./chaos-orb.js";
import { exaltedOrb, greaterExaltedOrb, perfectExaltedOrb } from "./exalted-orb.js";
import { essenceActions } from "./essence.js";
import { fracturingOrb } from "./fracturing-orb.js";
import { orbOfAlchemy } from "./orb-of-alchemy.js";
import { orbOfAnnulment } from "./orb-of-annulment.js";
import {
	greaterOrbOfAugmentation,
	orbOfAugmentation,
	perfectOrbOfAugmentation,
} from "./orb-of-augmentation.js";
import {
	greaterOrbOfTransmutation,
	orbOfTransmutation,
	perfectOrbOfTransmutation,
} from "./orb-of-transmutation.js";
import { greaterRegalOrb, perfectRegalOrb, regalOrb } from "./regal-orb.js";

/** Registered currency actions available to policy and UI consumers. */
export const craftingActions: ReadonlyMap<string, CraftingAction> = new Map(
	[
		orbOfTransmutation,
		greaterOrbOfTransmutation,
		perfectOrbOfTransmutation,
		orbOfAugmentation,
		greaterOrbOfAugmentation,
		perfectOrbOfAugmentation,
		regalOrb,
		greaterRegalOrb,
		perfectRegalOrb,
		exaltedOrb,
		greaterExaltedOrb,
		perfectExaltedOrb,
		orbOfAlchemy,
		chaosOrb,
		greaterChaosOrb,
		perfectChaosOrb,
		orbOfAnnulment,
		fracturingOrb,
		...essenceActions,
	].map((action) => [action.id, action]),
);

/**
 * Checks an action using imported data when the action provides that capability.
 *
 * @param database - Open SQLite modifier database.
 * @param action - Crafting action being considered.
 * @param item - Candidate item state.
 * @returns Whether the action is currently applicable.
 */
export function canApplyCraftingAction(
	database: DatabaseSync,
	action: CraftingAction,
	item: Item,
): boolean {
	return action.canApplyWithDatabase?.(database, item) ?? action.canApply(item);
}

/**
 * Returns the actions valid for an item and the currently imported dataset.
 *
 * @param database - Open SQLite modifier database.
 * @param item - Item whose available action space will be calculated.
 * @returns Registered actions that can operate on the item.
 */
export function availableCraftingActions(
	database: DatabaseSync,
	item: Item,
): readonly CraftingAction[] {
	return Object.freeze(
		[...craftingActions.values()].filter((action) =>
			canApplyCraftingAction(database, action, item),
		),
	);
}
