import { RARITIES, openGenerationTypes, type Item, type Modifier } from "@poe2craft/domain";
import { applyOmenAdditionCountHooks } from "./action-context.js";
import { addRandomModifier } from "./add-random-modifier.js";
import type { CraftingAction } from "./crafting-action.js";

/** Configuration for an Exalted currency tier. */
export interface ExaltedActionOptions {
	readonly id: string;
	readonly name: string;
	readonly minimumModifierLevel: number;
}

/**
 * Creates an Exalted action that adds one modifier before applicable Omen effects.
 *
 * @param options - Stable ID, display name, and minimum generated modifier level.
 * @returns A configured Exalted action.
 */
export function createExaltedAction(options: ExaltedActionOptions): CraftingAction {
	return Object.freeze({
		...options,
		canApply(item: Item): boolean {
			return item.rarity === RARITIES.RARE && openGenerationTypes(item).length > 0;
		},
		apply(database, item, context) {
			if (!this.canApply(item)) {
				throw new Error(`${this.name} requires a rare item with an open affix slot`);
			}
			const countResult = applyOmenAdditionCountHooks(context, this.name, item, 1);
			let currentItem = item;
			const addedModifiers: Modifier[] = [];
			const consumedOmens = new Set(countResult.consumedOmens);
			for (let index = 0; index < countResult.count; index += 1) {
				const result = addRandomModifier(database, currentItem, this.name, context, {
					minimumModifierLevel: options.minimumModifierLevel,
				});
				currentItem = result.item;
				addedModifiers.push(result.modifier);
				for (const omen of result.consumedOmens) consumedOmens.add(omen);
			}
			return Object.freeze({
				item: currentItem,
				addedModifiers: Object.freeze(addedModifiers),
				consumedOmens: Object.freeze([...consumedOmens]),
			});
		},
	} satisfies CraftingAction);
}

/** Standard Exalted Orb with no modifier-level floor. */
export const exaltedOrb = createExaltedAction({
	id: "exalted-orb",
	name: "Exalted Orb",
	minimumModifierLevel: 0,
});

/** Greater Exalted Orb, restricted to level 35+ modifiers. */
export const greaterExaltedOrb = createExaltedAction({
	id: "greater-exalted-orb",
	name: "Greater Exalted Orb",
	minimumModifierLevel: 35,
});

/** Perfect Exalted Orb, restricted to level 50+ modifiers. */
export const perfectExaltedOrb = createExaltedAction({
	id: "perfect-exalted-orb",
	name: "Perfect Exalted Orb",
	minimumModifierLevel: 50,
});
