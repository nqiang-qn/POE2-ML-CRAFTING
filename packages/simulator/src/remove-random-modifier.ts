import { removeModifierAt, type Item, type Modifier } from "@poe2craft/domain";
import { applyOmenRemovalHooks, type ActionContext } from "./action-context.js";

/** Result of the shared uniformly random modifier-removal operation. */
export interface RemoveRandomModifierResult {
	readonly item: Item;
	readonly modifier: Modifier;
	readonly consumedOmens: readonly string[];
}

/**
 * Returns whether a modifier may be removed by ordinary crafting currency.
 *
 * @param modifier - Explicit modifier being considered for removal.
 * @returns `false` for fractured or explicitly non-removable modifiers.
 */
export function isModifierRemovable(modifier: Modifier): boolean {
	return modifier.fractured !== true && modifier.removable !== false;
}

/**
 * Removes one uniformly selected eligible modifier from an immutable item.
 *
 * @param item - Item containing at least one removable explicit modifier.
 * @param actionName - Stable action name supplied to Omen applicability rules.
 * @param context - Random-number generator and active Omen effects.
 * @returns A new item, removed modifier, and consumed Omen names.
 * @throws If no candidate remains or RNG returns outside `[0, 1)`.
 */
export function removeRandomModifier(
	item: Item,
	actionName: string,
	context: ActionContext,
): RemoveRandomModifierResult {
	const candidates = item.modifiers.filter(isModifierRemovable);
	const omenResult = applyOmenRemovalHooks(context, actionName, item, candidates);
	if (!omenResult.pool.length) throw new Error("No removable modifiers remain");
	const roll = context.rng();
	if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
		throw new Error("Random-number generator must return a value in [0, 1)");
	}
	const removed = omenResult.pool[Math.floor(roll * omenResult.pool.length)];
	if (!removed) throw new Error("Failed to select a removable modifier");
	const itemIndex = item.modifiers.indexOf(removed);
	if (itemIndex < 0) throw new Error("Omen removal pool contained an unknown modifier");
	return Object.freeze({
		item: removeModifierAt(item, itemIndex),
		modifier: removed,
		consumedOmens: Object.freeze(omenResult.consumedOmens),
	});
}
