import { removeModifierAt, type Item, type Modifier } from "@poe2craft/domain";
import { applyOmenRemovalHooks } from "./action-context.js";
import type { CraftingAction } from "./crafting-action.js";

/** Orb of Annulment action: removes one uniformly selected explicit modifier. */
export const orbOfAnnulment: CraftingAction = {
	id: "orb-of-annulment",
	name: "Orb of Annulment",
	canApply(item: Item): boolean {
		return item.modifiers.length > 0;
	},
	apply(_database, item, context) {
		if (!this.canApply(item))
			throw new Error("Orb of Annulment requires at least one modifier");
		const omenResult = applyOmenRemovalHooks(context, this.name, item, item.modifiers);
		if (!omenResult.pool.length)
			throw new Error("No removable modifiers remain after Omen effects");
		const poolIndex = Math.floor(context.rng() * omenResult.pool.length);
		const removed = omenResult.pool[poolIndex];
		if (!removed) throw new Error("Random-number generator must return a value in [0, 1)");
		const itemIndex = item.modifiers.indexOf(removed as Modifier);
		if (itemIndex < 0) throw new Error("Omen removal pool contained an unknown modifier");
		return Object.freeze({
			item: removeModifierAt(item, itemIndex),
			removedModifiers: Object.freeze([removed]),
			consumedOmens: Object.freeze(omenResult.consumedOmens),
		});
	},
};
