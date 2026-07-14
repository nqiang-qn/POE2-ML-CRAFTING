/** Validated modifier-family objectives used to identify successful crafts. */

import type { Item } from "@poe2craft/domain";

/** One desired modifier feature, satisfied by any listed modifier family. */
export interface TargetModifier {
	readonly id: string;
	readonly families: readonly string[];
}

/** Validated collection of modifier features that define a successful craft. */
export interface CraftingTarget {
	readonly id: string;
	readonly modifiers: readonly TargetModifier[];
}

/** Input accepted when constructing a crafting target. */
export interface CreateCraftingTargetInput {
	readonly id: string;
	readonly modifiers: readonly TargetModifier[];
}

/**
 * Creates an immutable, validated crafting target.
 *
 * @param input - Stable target ID and desired modifier-family alternatives.
 * @returns A frozen target suitable for simulation and serialization.
 * @throws If IDs are empty or duplicated, or a target feature has no families.
 */
export function createCraftingTarget(input: CreateCraftingTargetInput): CraftingTarget {
	if (!input.id.trim()) throw new Error("Crafting target ID is required");
	const ids = new Set<string>();
	const modifiers = input.modifiers.map((modifier) => {
		if (!modifier.id.trim()) throw new Error("Target modifier ID is required");
		if (ids.has(modifier.id)) throw new Error(`Duplicate target modifier ID: ${modifier.id}`);
		ids.add(modifier.id);
		const families = [...new Set(modifier.families.map((family) => family.trim()))].filter(
			Boolean,
		);
		if (!families.length) {
			throw new Error(`Target modifier ${modifier.id} requires at least one family`);
		}
		return Object.freeze({ id: modifier.id, families: Object.freeze(families) });
	});
	return Object.freeze({ id: input.id, modifiers: Object.freeze(modifiers) });
}

/**
 * Tests whether every desired target feature is present on an item.
 *
 * @param item - Concrete item state being evaluated.
 * @param target - Target whose modifier features must all be satisfied.
 * @returns Whether the item is a terminal success state for the target.
 */
export function isTargetSatisfied(item: Item, target: CraftingTarget): boolean {
	const presentFamilies = new Set(item.modifiers.flatMap((modifier) => modifier.families));
	return target.modifiers.every((feature) =>
		feature.families.some((family) => presentFamilies.has(family)),
	);
}
