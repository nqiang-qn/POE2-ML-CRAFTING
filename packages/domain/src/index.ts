/** Immutable item, modifier, rarity, and affix-capacity domain primitives. */

/** Supported item rarities and their serialized values. */
export const RARITIES = {
	NORMAL: "normal",
	MAGIC: "magic",
	RARE: "rare",
} as const;

/** Serialized item rarity. */
export type Rarity = (typeof RARITIES)[keyof typeof RARITIES];
/** Prefix or suffix modifier-generation category. */
export type GenerationType = "Prefix" | "Suffix";

/** Modifier data required by crafting-domain operations. */
export interface Modifier {
	readonly name: string;
	readonly requiredLevel?: number;
	readonly generationType: GenerationType;
	readonly families: readonly string[];
	readonly familyKey?: string;
	readonly weight?: number;
	readonly text?: string;
	readonly sourceSection?: string;
	readonly spawnTags?: readonly string[];
	readonly fractured?: boolean;
	readonly fracturable?: boolean;
	readonly crafted?: boolean;
	readonly removable?: boolean;
}

/** Immutable item state consumed and produced by crafting actions. */
export interface Item {
	readonly base: string;
	readonly itemLevel: number;
	readonly rarity: Rarity;
	readonly modifiers: readonly Modifier[];
}

/** Input accepted when constructing an immutable item. */
export interface CreateItemInput {
	base: string;
	itemLevel: number;
	rarity: Rarity;
	modifiers?: readonly Modifier[];
}

/**
 * Creates a validated, shallowly immutable item state.
 *
 * Modifier objects and the modifier collection are copied and frozen, so later
 * crafting operations cannot mutate the input state accidentally.
 *
 * @param input - Base, item level, rarity, and optional initial modifiers.
 * @returns A validated item whose modifier collection is immutable.
 * @throws If the base is empty, item level is invalid, or rarity is unsupported.
 */
export function createItem(input: CreateItemInput): Item {
	const { base, itemLevel, rarity, modifiers = [] } = input;
	if (!base) throw new Error("Item base is required");
	if (!Number.isInteger(itemLevel) || itemLevel < 1) {
		throw new Error("Item level must be a positive integer");
	}
	if (!(Object.values(RARITIES) as string[]).includes(rarity)) {
		throw new Error(`Invalid rarity: ${rarity}`);
	}
	if (modifiers.filter((modifier) => modifier.crafted).length > 1) {
		throw new Error("An item cannot have more than one crafted modifier");
	}
	return Object.freeze({
		base,
		itemLevel,
		rarity,
		modifiers: Object.freeze(modifiers.map((modifier) => Object.freeze({ ...modifier }))),
	});
}

/**
 * Counts the prefix and suffix modifiers currently present on an item.
 *
 * @param item - Item whose explicit affixes will be counted.
 * @returns Separate prefix and suffix counts.
 */
export function affixCounts(item: Item): { prefixes: number; suffixes: number } {
	return item.modifiers.reduce(
		(counts, modifier) => {
			if (modifier.generationType === "Prefix") counts.prefixes += 1;
			else counts.suffixes += 1;
			return counts;
		},
		{ prefixes: 0, suffixes: 0 },
	);
}

/**
 * Returns the prefix and suffix capacities imposed by the item's rarity.
 *
 * @param item - Item whose rarity determines its affix capacities.
 * @returns Maximum prefix and suffix counts.
 */
export function affixLimits(item: Item): { prefixes: number; suffixes: number } {
	if (item.rarity === RARITIES.MAGIC) return { prefixes: 1, suffixes: 1 };
	if (item.rarity === RARITIES.RARE) return { prefixes: 3, suffixes: 3 };
	return { prefixes: 0, suffixes: 0 };
}

/**
 * Returns the affix generation types for which the item still has capacity.
 *
 * @param item - Item to inspect for open affix slots.
 * @returns Any currently open `Prefix` and `Suffix` generation types.
 */
export function openGenerationTypes(item: Item): GenerationType[] {
	const counts = affixCounts(item);
	const limits = affixLimits(item);
	const result: GenerationType[] = [];
	if (counts.prefixes < limits.prefixes) result.push("Prefix");
	if (counts.suffixes < limits.suffixes) result.push("Suffix");
	return result;
}

/**
 * Returns the unique modifier families already occupying the item.
 *
 * @param item - Item whose modifier-family conflicts will be collected.
 * @returns Deduplicated modifier-family identifiers.
 */
export function existingFamilies(item: Item): string[] {
	return [...new Set(item.modifiers.flatMap((modifier) => modifier.families))];
}

/**
 * Returns a new immutable item containing the additional modifier.
 *
 * @param item - Existing item, which is not mutated.
 * @param modifier - Modifier to append to the new item state.
 * @returns A new immutable item state.
 */
export function addModifier(item: Item, modifier: Modifier): Item {
	return createItem({ ...item, modifiers: [...item.modifiers, modifier] });
}

/**
 * Returns a new immutable item with one modifier marked as fractured.
 *
 * @param item - Item containing the modifier to fracture.
 * @param index - Zero-based modifier index.
 * @returns A new immutable item with the selected modifier locked in place.
 * @throws If the modifier index is outside the item modifier collection.
 */
export function fractureModifierAt(item: Item, index: number): Item {
	if (!Number.isInteger(index) || index < 0 || index >= item.modifiers.length) {
		throw new Error(`Modifier index ${index} is outside the item modifier collection`);
	}
	return createItem({
		...item,
		modifiers: item.modifiers.map((modifier, modifierIndex) =>
			modifierIndex === index ? { ...modifier, fractured: true } : modifier,
		),
	});
}

/**
 * Returns a new immutable item with a different rarity.
 *
 * @param item - Existing item, which is not mutated.
 * @param rarity - Rarity assigned to the new state.
 * @returns A new immutable item retaining the original modifiers.
 */
export function changeRarity(item: Item, rarity: Rarity): Item {
	return createItem({ ...item, rarity });
}

/**
 * Removes one modifier by index and returns a new immutable item.
 *
 * @param item - Existing item, which is not mutated.
 * @param index - Zero-based modifier index to remove.
 * @returns A new immutable item without the selected modifier.
 * @throws If the index does not identify an existing modifier.
 */
export function removeModifierAt(item: Item, index: number): Item {
	if (!Number.isInteger(index) || index < 0 || index >= item.modifiers.length) {
		throw new Error(`Invalid modifier index: ${index}`);
	}
	return createItem({
		...item,
		modifiers: item.modifiers.filter((_, modifierIndex) => modifierIndex !== index),
	});
}
