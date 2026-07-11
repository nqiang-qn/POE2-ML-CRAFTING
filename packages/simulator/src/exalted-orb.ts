import { RARITIES, openGenerationTypes, type Item } from "@poe2craft/domain";
import { addRandomModifier } from "./add-random-modifier.js";
import type { CraftingAction } from "./crafting-action.js";

/** Exalted Orb action: adds one random modifier to a rare item with capacity. */
export const exaltedOrb: CraftingAction = {
	id: "exalted-orb",
	name: "Exalted Orb",
	canApply(item: Item): boolean {
		return item.rarity === RARITIES.RARE && openGenerationTypes(item).length > 0;
	},
	apply(database, item, context) {
		if (!this.canApply(item))
			throw new Error("Exalted Orb requires a rare item with an open affix slot");
		const result = addRandomModifier(database, item, this.name, context);
		return Object.freeze({
			item: result.item,
			addedModifiers: Object.freeze([result.modifier]),
			consumedOmens: result.consumedOmens,
		});
	},
};
