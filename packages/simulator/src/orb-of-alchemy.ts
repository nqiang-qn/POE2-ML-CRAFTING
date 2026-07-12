import { RARITIES, createItem, type Item, type Modifier } from "@poe2craft/domain";
import { addRandomModifier } from "./add-random-modifier.js";
import type { CraftingAction } from "./crafting-action.js";

/** Orb of Alchemy action: reforges a normal or magic item as a four-mod rare. */
export const orbOfAlchemy: CraftingAction = Object.freeze({
	id: "orb-of-alchemy",
	name: "Orb of Alchemy",
	minimumModifierLevel: 0,
	canApply(item: Item): boolean {
		return item.rarity === RARITIES.NORMAL || item.rarity === RARITIES.MAGIC;
	},
	apply(database, item, context) {
		if (!this.canApply(item)) {
			throw new Error("Orb of Alchemy requires a normal or magic item");
		}
		const modifierCount = 4;
		let currentItem = createItem({
			base: item.base,
			itemLevel: item.itemLevel,
			rarity: RARITIES.RARE,
			modifiers: [],
		});
		const addedModifiers: Modifier[] = [];
		const consumedOmens = new Set<string>();
		for (let index = 0; index < modifierCount; index += 1) {
			const result = addRandomModifier(database, currentItem, this.name, context);
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
