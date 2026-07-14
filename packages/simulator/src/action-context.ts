/** Shared random-number and Omen hook context used by crafting actions. */

import type { Item, Modifier } from "@poe2craft/domain";

/** Common values supplied when checking whether an Omen applies. */
export interface OmenInput {
	actionName: string;
	item: Item;
}
/** Omen input that additionally contains the current modifier pool. */
export interface ModifierPoolInput extends OmenInput {
	pool: readonly Modifier[];
}
/** Effect capable of modifying a compatible crafting action. */
export interface Omen {
	readonly name: string;
	/** Orders removal hooks; restrictive filters run before selectors. */
	readonly removalPriority?: number;
	appliesTo(input: OmenInput): boolean;
	modifyAdditionCount?(input: OmenInput & { count: number }): number;
	modifyModifierPool?(input: ModifierPoolInput): readonly Modifier[];
	modifyRemovalPool?(input: ModifierPoolInput): readonly Modifier[];
}

/**
 * Applies relevant Omen removal-pool hooks in declaration order.
 *
 * @param context - Randomness and active Omens for the crafting action.
 * @param actionName - Stable action name used by Omen applicability rules.
 * @param item - Item being crafted.
 * @param pool - Removable modifiers before Omen transformations.
 * @returns The transformed removal pool and consumed Omen names.
 */
export function applyOmenRemovalHooks(
	context: ActionContext,
	actionName: string,
	item: Item,
	pool: readonly Modifier[],
): { pool: readonly Modifier[]; consumedOmens: string[] } {
	let current = [...pool];
	const consumedOmens: string[] = [];
	const orderedOmens = context.omens
		.map((omen, index) => ({ omen, index }))
		.sort(
			(left, right) =>
				(left.omen.removalPriority ?? 0) - (right.omen.removalPriority ?? 0) ||
				left.index - right.index,
		);
	for (const { omen } of orderedOmens) {
		if (!omen.appliesTo({ actionName, item })) continue;
		if (!omen.modifyRemovalPool) continue;
		current = [...omen.modifyRemovalPool({ actionName, item, pool: current })];
		consumedOmens.push(omen.name);
	}
	return { pool: current, consumedOmens };
}

/**
 * Applies Omen hooks that change how many modifiers an action adds.
 *
 * @param context - Randomness and active Omens for the crafting action.
 * @param actionName - Stable action name used by Omen applicability rules.
 * @param item - Item being crafted before additions begin.
 * @param initialCount - Modifier count normally added by the currency.
 * @returns The transformed count and consumed Omen names.
 * @throws If an Omen returns a negative or non-integer count.
 */
export function applyOmenAdditionCountHooks(
	context: ActionContext,
	actionName: string,
	item: Item,
	initialCount: number,
): { count: number; consumedOmens: string[] } {
	let count = initialCount;
	const consumedOmens: string[] = [];
	for (const omen of context.omens) {
		if (!omen.appliesTo({ actionName, item }) || !omen.modifyAdditionCount) continue;
		count = omen.modifyAdditionCount({ actionName, item, count });
		if (!Number.isInteger(count) || count < 0) {
			throw new Error(`Omen ${omen.name} returned invalid addition count ${count}`);
		}
		consumedOmens.push(omen.name);
	}
	return { count, consumedOmens };
}

/** Runtime dependencies and effects shared through one crafting action. */
export interface ActionContext {
	readonly rng: () => number;
	readonly omens: readonly Omen[];
}

/**
 * Creates an immutable crafting context with injectable randomness and Omens.
 *
 * @param input - Optional random-number generator and active Omen collection.
 * @returns An immutable context shared through one crafting action.
 */
export function createActionContext(input: Partial<ActionContext> = {}): ActionContext {
	return Object.freeze({
		rng: input.rng ?? Math.random,
		omens: Object.freeze([...(input.omens ?? [])]),
	});
}

/**
 * Applies every relevant Omen's modifier-pool hook in declaration order.
 *
 * @param context - Randomness and active Omens for the crafting action.
 * @param actionName - Stable action name used by Omen applicability rules.
 * @param item - Item being crafted.
 * @param pool - Eligible modifier pool before Omen transformations.
 * @returns The transformed pool and names of Omens consumed by the action.
 */
export function applyOmenPoolHooks(
	context: ActionContext,
	actionName: string,
	item: Item,
	pool: readonly Modifier[],
): { pool: readonly Modifier[]; consumedOmens: string[] } {
	let current = [...pool];
	const consumedOmens: string[] = [];
	for (const omen of context.omens) {
		if (!omen.appliesTo({ actionName, item })) continue;
		if (!omen.modifyModifierPool) continue;
		current = [...omen.modifyModifierPool({ actionName, item, pool: current })];
		consumedOmens.push(omen.name);
	}
	return { pool: current, consumedOmens };
}
