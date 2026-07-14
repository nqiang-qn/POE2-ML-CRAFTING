/** Standard, Greater, and Perfect Chaos Orb remove-and-replace actions. */

import { RARITIES, type Item } from "@poe2craft/domain";
import { addRandomModifier } from "./add-random-modifier.js";
import type { CraftingAction } from "./crafting-action.js";
import { isModifierRemovable, removeRandomModifier } from "./remove-random-modifier.js";

/** Configuration for a Chaos currency tier. */
export interface ChaosActionOptions {
	readonly id: string;
	readonly name: string;
	readonly minimumModifierLevel: number;
}

/**
 * Creates a Chaos action that removes one modifier before adding a replacement.
 *
 * Eligibility is recalculated after removal, so the removed modifier's family
 * becomes available to the replacement roll.
 *
 * @param options - Stable ID, display name, and minimum replacement modifier level.
 * @returns A configured Chaos action.
 */
export function createChaosAction(options: ChaosActionOptions): CraftingAction {
	return Object.freeze({
		...options,
		canApply(item: Item): boolean {
			return item.rarity === RARITIES.RARE && item.modifiers.some(isModifierRemovable);
		},
		apply(database, item, context) {
			if (!this.canApply(item)) {
				throw new Error(`${this.name} requires a rare item with a removable modifier`);
			}
			const removal = removeRandomModifier(item, this.name, context);
			const addition = addRandomModifier(database, removal.item, this.name, context, {
				minimumModifierLevel: options.minimumModifierLevel,
			});
			return Object.freeze({
				item: addition.item,
				removedModifiers: Object.freeze([removal.modifier]),
				addedModifiers: Object.freeze([addition.modifier]),
				consumedOmens: Object.freeze([
					...new Set([...removal.consumedOmens, ...addition.consumedOmens]),
				]),
			});
		},
	} satisfies CraftingAction);
}

/** Standard Chaos Orb with no replacement modifier-level floor. */
export const chaosOrb = createChaosAction({
	id: "chaos-orb",
	name: "Chaos Orb",
	minimumModifierLevel: 0,
});

/** Greater Chaos Orb, restricted to level 35+ replacement modifiers. */
export const greaterChaosOrb = createChaosAction({
	id: "greater-chaos-orb",
	name: "Greater Chaos Orb",
	minimumModifierLevel: 35,
});

/** Perfect Chaos Orb, restricted to level 50+ replacement modifiers. */
export const perfectChaosOrb = createChaosAction({
	id: "perfect-chaos-orb",
	name: "Perfect Chaos Orb",
	minimumModifierLevel: 50,
});
