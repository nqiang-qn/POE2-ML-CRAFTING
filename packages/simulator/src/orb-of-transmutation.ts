import { RARITIES, changeRarity, type Item } from "@poe2craft/domain";
import { addRandomModifier } from "./add-random-modifier.js";
import type { CraftingAction } from "./crafting-action.js";

/** Configuration for a Transmutation currency tier. */
export interface TransmutationActionOptions {
	readonly id: string;
	readonly name: string;
	readonly minimumModifierLevel: number;
}

/**
 * Creates a Transmutation action that upgrades a normal item to magic with one modifier.
 *
 * @param options - Stable ID, display name, and minimum generated modifier level.
 * @returns A configured Transmutation action.
 */
export function createTransmutationAction(options: TransmutationActionOptions): CraftingAction {
	return Object.freeze({
		...options,
		canApply(item: Item): boolean {
			return item.rarity === RARITIES.NORMAL && item.modifiers.length === 0;
		},
		apply(database, item, context) {
			if (!this.canApply(item)) {
				throw new Error(`${this.name} requires a normal item without explicit modifiers`);
			}
			const magicItem = changeRarity(item, RARITIES.MAGIC);
			const result = addRandomModifier(database, magicItem, this.name, context, {
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

/** Standard Orb of Transmutation with no modifier-level floor. */
export const orbOfTransmutation = createTransmutationAction({
	id: "orb-of-transmutation",
	name: "Orb of Transmutation",
	minimumModifierLevel: 0,
});

/** Greater Orb of Transmutation, restricted to level 44+ modifiers. */
export const greaterOrbOfTransmutation = createTransmutationAction({
	id: "greater-orb-of-transmutation",
	name: "Greater Orb of Transmutation",
	minimumModifierLevel: 44,
});

/** Perfect Orb of Transmutation, restricted to level 70+ modifiers. */
export const perfectOrbOfTransmutation = createTransmutationAction({
	id: "perfect-orb-of-transmutation",
	name: "Perfect Orb of Transmutation",
	minimumModifierLevel: 70,
});
