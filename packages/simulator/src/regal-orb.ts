/** Regal Orb upgrade from magic to rare with one weighted modifier addition. */

import { RARITIES, changeRarity, type Item } from "@poe2craft/domain";
import { addRandomModifier } from "./add-random-modifier.js";
import type { CraftingAction } from "./crafting-action.js";

/** Configuration for a Regal currency tier. */
export interface RegalActionOptions {
	readonly id: string;
	readonly name: string;
	readonly minimumModifierLevel: number;
}

/**
 * Creates a Regal action that upgrades magic to rare and adds one modifier.
 *
 * @param options - Stable ID, display name, and minimum generated modifier level.
 * @returns A configured Regal action.
 */
export function createRegalAction(options: RegalActionOptions): CraftingAction {
	return Object.freeze({
		...options,
		canApply(item: Item): boolean {
			return item.rarity === RARITIES.MAGIC;
		},
		apply(database, item, context) {
			if (!this.canApply(item)) throw new Error(`${this.name} requires a magic item`);
			const rareItem = changeRarity(item, RARITIES.RARE);
			const result = addRandomModifier(database, rareItem, this.name, context, {
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

/** Standard Regal Orb with no modifier-level floor. */
export const regalOrb = createRegalAction({
	id: "regal-orb",
	name: "Regal Orb",
	minimumModifierLevel: 0,
});

/** Greater Regal Orb, restricted to level 35+ modifiers. */
export const greaterRegalOrb = createRegalAction({
	id: "greater-regal-orb",
	name: "Greater Regal Orb",
	minimumModifierLevel: 35,
});

/** Perfect Regal Orb, restricted to level 50+ modifiers. */
export const perfectRegalOrb = createRegalAction({
	id: "perfect-regal-orb",
	name: "Perfect Regal Orb",
	minimumModifierLevel: 50,
});
