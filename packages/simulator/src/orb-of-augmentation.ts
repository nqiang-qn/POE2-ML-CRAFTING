import type { DatabaseSync } from "node:sqlite";
import { RARITIES, openGenerationTypes, type Item, type Modifier } from "@poe2craft/domain";
import type { ActionContext } from "./action-context.js";
import { addRandomModifier } from "./add-random-modifier.js";
import type { CraftingAction } from "./crafting-action.js";

/** Stable action identifier used by policies and Omen applicability rules. */
export const ORB_OF_AUGMENTATION = "Orb of Augmentation";
/** Result of a successful modifier-adding crafting action. */
export interface CraftResult {
	readonly item: Item;
	readonly addedModifier: Modifier;
	readonly consumedOmens: readonly string[];
}

/**
 * Returns whether an Orb of Augmentation can add an affix to the item.
 *
 * @param item - Candidate item state.
 * @returns Whether the item is magic and has an open magic affix slot.
 */
export function canApplyOrbOfAugmentation(item: Item): boolean {
	return (
		item.rarity === RARITIES.MAGIC &&
		item.modifiers.length < 2 &&
		openGenerationTypes(item).length > 0
	);
}

/**
 * Adds one weighted ordinary modifier to an eligible magic item.
 *
 * The original item is not mutated. Relevant Omen hooks run before selection.
 *
 * @param database - Open SQLite modifier database used for eligibility.
 * @param item - Eligible magic item to augment.
 * @param context - Random-number generator and active Omen effects.
 * @returns A new item, the selected modifier, and consumed Omen names.
 * @throws If the item is not an eligible magic item or no weighted outcome exists.
 */
export function applyOrbOfAugmentation(
	database: DatabaseSync,
	item: Item,
	context: ActionContext,
): CraftResult {
	if (!canApplyOrbOfAugmentation(item)) {
		throw new Error("Orb of Augmentation requires a magic item with an open affix slot");
	}
	const result = addRandomModifier(database, item, ORB_OF_AUGMENTATION, context);
	return Object.freeze({
		item: result.item,
		addedModifier: result.modifier,
		consumedOmens: result.consumedOmens,
	});
}

/** Orb of Augmentation action exposed through the common currency contract. */
export const orbOfAugmentation: CraftingAction = {
	id: "orb-of-augmentation",
	name: ORB_OF_AUGMENTATION,
	canApply: canApplyOrbOfAugmentation,
	apply(database, item, context) {
		const result = applyOrbOfAugmentation(database, item, context);
		return Object.freeze({
			item: result.item,
			addedModifiers: Object.freeze([result.addedModifier]),
			consumedOmens: result.consumedOmens,
		});
	},
};
