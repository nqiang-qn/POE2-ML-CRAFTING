/** Fracturing Orb eligibility and uniform permanent-modifier selection. */

import { fractureModifierAt, RARITIES, type Item, type Modifier } from "@poe2craft/domain";
import type { CraftingAction } from "./crafting-action.js";

/**
 * Returns whether a modifier is eligible to be selected by a Fracturing Orb.
 *
 * Desecrated modifiers count toward the four-modifier requirement but cannot
 * themselves be fractured.
 *
 * @param modifier - Explicit modifier being considered for fracturing.
 * @returns Whether the modifier can become fractured.
 */
export function isModifierFracturable(modifier: Modifier): boolean {
	return (
		modifier.fractured !== true &&
		modifier.fracturable !== false &&
		modifier.sourceSection?.toLowerCase() !== "desecrated"
	);
}

/** Fractures one uniformly random eligible modifier on a four-modifier rare item. */
export const fracturingOrb: CraftingAction = Object.freeze({
	id: "fracturing-orb",
	name: "Fracturing Orb",
	canApply(item: Item): boolean {
		return (
			item.rarity === RARITIES.RARE &&
			item.modifiers.length >= 4 &&
			!item.modifiers.some((modifier) => modifier.fractured) &&
			item.modifiers.some(isModifierFracturable)
		);
	},
	apply(_database, item, context) {
		if (!this.canApply(item)) {
			throw new Error(
				"Fracturing Orb requires an unfractured rare item with at least four modifiers",
			);
		}
		const candidates = item.modifiers.filter(isModifierFracturable);
		const roll = context.rng();
		if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
			throw new Error("Random-number generator must return a value in [0, 1)");
		}
		const selected = candidates[Math.floor(roll * candidates.length)];
		if (!selected) throw new Error("Failed to select a fracturable modifier");
		const index = item.modifiers.indexOf(selected);
		const fracturedItem = fractureModifierAt(item, index);
		const fracturedModifier = fracturedItem.modifiers[index];
		if (!fracturedModifier) throw new Error("Failed to fracture the selected modifier");
		return Object.freeze({
			item: fracturedItem,
			fracturedModifiers: Object.freeze([fracturedModifier]),
			consumedOmens: Object.freeze([]),
		});
	},
} satisfies CraftingAction);
