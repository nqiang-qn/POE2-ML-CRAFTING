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
	appliesTo(input: OmenInput): boolean;
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
	for (const omen of context.omens) {
		if (!omen.appliesTo({ actionName, item })) continue;
		if (omen.modifyRemovalPool) {
			current = [...omen.modifyRemovalPool({ actionName, item, pool: current })];
		}
		consumedOmens.push(omen.name);
	}
	return { pool: current, consumedOmens };
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
		if (omen.modifyModifierPool)
			current = [...omen.modifyModifierPool({ actionName, item, pool: current })];
		consumedOmens.push(omen.name);
	}
	return { pool: current, consumedOmens };
}
