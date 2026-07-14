/** Mechanic-complete optimizer state encoding and stable state-key generation. */

import { affixCounts, affixLimits, type Item, type Modifier, type Rarity } from "@poe2craft/domain";
import type { CraftingTarget } from "./crafting-target.js";

/** Target-relative features retained by the initial tabular optimizer. */
export interface EncodedCraftingState {
	readonly schemaVersion: 2;
	readonly targetId: string;
	readonly rarity: Rarity;
	readonly targetPresence: readonly boolean[];
	readonly prefixCount: number;
	readonly suffixCount: number;
	readonly openPrefixCount: number;
	readonly openSuffixCount: number;
	readonly craftedModifierPresent: boolean;
	readonly fracturedModifierIds: readonly string[];
	readonly modifierStateIds: readonly string[];
}

function modifierIdentity(item: Item, index: number): string {
	const modifier = item.modifiers[index];
	if (!modifier) throw new Error(`Missing modifier at index ${index}`);
	return modifier.familyKey ?? ([...modifier.families].sort().join("+") || modifier.name);
}

/**
 * Encodes the modifier attributes that can change crafting eligibility or odds.
 *
 * Rolled values, display text, and names are intentionally excluded because the
 * implemented crafting mechanics do not inspect them.
 *
 * @param modifier - Explicit modifier to identify for optimizer state.
 * @returns Stable JSON tuple suitable for sorting and state-key serialization.
 */
export function mechanicModifierId(modifier: Modifier): string {
	return JSON.stringify([
		modifier.generationType,
		modifier.familyKey ?? null,
		[...modifier.families].sort(),
		modifier.requiredLevel ?? null,
		modifier.fractured ?? false,
		modifier.fracturable ?? true,
		modifier.crafted ?? false,
		modifier.removable ?? true,
		modifier.sourceSection?.toLowerCase() ?? null,
	]);
}

/**
 * Encodes a concrete item into deterministic target-relative optimizer features.
 *
 * @param item - Concrete item state produced by the crafting simulator.
 * @param target - Crafting objective used to calculate presence bits.
 * @returns Immutable, JSON-serializable optimizer state features.
 */
export function encodeCraftingState(item: Item, target: CraftingTarget): EncodedCraftingState {
	const families = new Set(item.modifiers.flatMap((modifier) => modifier.families));
	const counts = affixCounts(item);
	const limits = affixLimits(item);
	const fracturedModifierIds = item.modifiers
		.map((modifier, index) => (modifier.fractured ? modifierIdentity(item, index) : undefined))
		.filter((identity): identity is string => identity !== undefined)
		.sort();
	const modifierStateIds = item.modifiers.map(mechanicModifierId).sort();
	return Object.freeze({
		schemaVersion: 2,
		targetId: target.id,
		rarity: item.rarity,
		targetPresence: Object.freeze(
			target.modifiers.map((feature) =>
				feature.families.some((family) => families.has(family)),
			),
		),
		prefixCount: counts.prefixes,
		suffixCount: counts.suffixes,
		openPrefixCount: limits.prefixes - counts.prefixes,
		openSuffixCount: limits.suffixes - counts.suffixes,
		craftedModifierPresent: item.modifiers.some((modifier) => modifier.crafted),
		fracturedModifierIds: Object.freeze(fracturedModifierIds),
		modifierStateIds: Object.freeze(modifierStateIds),
	});
}

/**
 * Serializes encoded features into a stable key for transition-table maps.
 *
 * @param state - State produced by `encodeCraftingState`.
 * @returns Deterministic compact key containing every retained feature.
 */
export function craftingStateKey(state: EncodedCraftingState): string {
	const presence = state.targetPresence.map((present) => (present ? "1" : "0")).join("");
	return [
		`v${state.schemaVersion}`,
		state.targetId,
		state.rarity,
		presence,
		`${state.prefixCount}P/${state.suffixCount}S`,
		`${state.openPrefixCount}OP/${state.openSuffixCount}OS`,
		state.craftedModifierPresent ? "C1" : "C0",
		`F:${state.fracturedModifierIds.join(",")}`,
		`M:${state.modifierStateIds.join(",")}`,
	].join("|");
}
