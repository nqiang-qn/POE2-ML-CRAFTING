import type { DatabaseSync } from "node:sqlite";
import type { Item, Modifier } from "@poe2craft/domain";
import type { ActionContext } from "./action-context.js";

/** Result shared by currency actions that add or remove explicit modifiers. */
export interface CraftingActionResult {
	readonly item: Item;
	readonly addedModifiers?: readonly Modifier[];
	readonly removedModifiers?: readonly Modifier[];
	readonly consumedOmens: readonly string[];
}

/** Common contract used by the simulator, policy engine, and future web UI. */
export interface CraftingAction {
	readonly id: string;
	readonly name: string;
	readonly minimumModifierLevel?: number;

	/**
	 * Checks whether the action can operate on an item state.
	 *
	 * @param item - Candidate item state.
	 * @returns Whether the currency action is valid for the item.
	 */
	canApply(item: Item): boolean;

	/**
	 * Applies the action and returns a new immutable item state.
	 *
	 * @param database - Open SQLite modifier database.
	 * @param item - Eligible item state.
	 * @param context - Randomness and active Omen effects.
	 * @returns The resulting item and action details.
	 */
	apply(database: DatabaseSync, item: Item, context: ActionContext): CraftingActionResult;
}
