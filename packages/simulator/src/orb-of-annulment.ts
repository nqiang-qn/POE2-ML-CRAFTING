import type { Item } from "@poe2craft/domain";
import type { CraftingAction } from "./crafting-action.js";
import { isModifierRemovable, removeRandomModifier } from "./remove-random-modifier.js";

/** Orb of Annulment action: removes one uniformly selected explicit modifier. */
export const orbOfAnnulment: CraftingAction = {
	id: "orb-of-annulment",
	name: "Orb of Annulment",
	canApply(item: Item): boolean {
		return item.modifiers.some(isModifierRemovable);
	},
	apply(_database, item, context) {
		if (!this.canApply(item)) {
			throw new Error("Orb of Annulment requires at least one removable modifier");
		}
		const result = removeRandomModifier(item, this.name, context);
		return Object.freeze({
			item: result.item,
			removedModifiers: Object.freeze([result.modifier]),
			consumedOmens: result.consumedOmens,
		});
	},
};
