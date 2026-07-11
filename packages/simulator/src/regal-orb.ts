import { RARITIES, changeRarity, type Item } from "@poe2craft/domain";
import { addRandomModifier } from "./add-random-modifier.js";
import type { CraftingAction } from "./crafting-action.js";

/** Regal Orb action: upgrades a magic item to rare and adds one modifier. */
export const regalOrb: CraftingAction = {
	id: "regal-orb",
	name: "Regal Orb",
	canApply(item: Item): boolean {
		return item.rarity === RARITIES.MAGIC;
	},
	apply(database, item, context) {
		if (!this.canApply(item)) throw new Error("Regal Orb requires a magic item");
		const rareItem = changeRarity(item, RARITIES.RARE);
		const result = addRandomModifier(database, rareItem, this.name, context);
		return Object.freeze({
			item: result.item,
			addedModifiers: Object.freeze([result.modifier]),
			consumedOmens: result.consumedOmens,
		});
	},
};
