/** Orb of Augmentation addition to a magic item with one open affix slot. */

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

/** Configuration for an Augmentation currency tier. */
export interface AugmentationActionOptions {
	readonly id: string;
	readonly name: string;
	readonly minimumModifierLevel: number;
}

/**
 * Creates an Augmentation action with a currency-specific modifier-level floor.
 *
 * @param options - Stable ID, display name, and minimum generated modifier level.
 * @returns A registered-action-compatible Augmentation implementation.
 */
export function createAugmentationAction(options: AugmentationActionOptions): CraftingAction {
	return Object.freeze({
		...options,
		canApply: canApplyOrbOfAugmentation,
		apply(database, item, context) {
			if (!this.canApply(item)) {
				throw new Error(`${this.name} requires a magic item with an open affix slot`);
			}
			const result = addRandomModifier(database, item, this.name, context, {
				minimumModifierLevel: options.minimumModifierLevel,
			});
			return Object.freeze({
				item: result.item,
				addedModifiers: Object.freeze([result.modifier]),
				consumedOmens: result.consumedOmens,
			});
		},
	} satisfies CraftingAction);
}

/** Standard Orb of Augmentation with no modifier-level floor. */
export const orbOfAugmentation = createAugmentationAction({
	id: "orb-of-augmentation",
	name: ORB_OF_AUGMENTATION,
	minimumModifierLevel: 0,
});

/** Greater Orb of Augmentation, restricted to level 44+ modifiers. */
export const greaterOrbOfAugmentation = createAugmentationAction({
	id: "greater-orb-of-augmentation",
	name: "Greater Orb of Augmentation",
	minimumModifierLevel: 44,
});

/** Perfect Orb of Augmentation, restricted to level 70+ modifiers. */
export const perfectOrbOfAugmentation = createAugmentationAction({
	id: "perfect-orb-of-augmentation",
	name: "Perfect Orb of Augmentation",
	minimumModifierLevel: 70,
});
