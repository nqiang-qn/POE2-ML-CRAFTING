import type { GenerationType } from "@poe2craft/domain";
import type { Omen } from "./action-context.js";

const EXALTED_ORB = "Exalted Orb";
const ORB_OF_ANNULMENT = "Orb of Annulment";
const CHAOS_ORBS = new Set(["Chaos Orb", "Greater Chaos Orb", "Perfect Chaos Orb"]);

function restrictAddition(name: string, generationType: GenerationType): Omen {
	return Object.freeze({
		name,
		appliesTo: ({ actionName }) => actionName === EXALTED_ORB,
		modifyModifierPool: ({ pool }) =>
			pool.filter((modifier) => modifier.generationType === generationType),
	} satisfies Omen);
}

function restrictRemoval(name: string, generationType: GenerationType): Omen {
	return Object.freeze({
		name,
		appliesTo: ({ actionName }) => actionName === ORB_OF_ANNULMENT,
		modifyRemovalPool: ({ pool }) =>
			pool.filter((modifier) => modifier.generationType === generationType),
	} satisfies Omen);
}

function restrictChaosRemoval(name: string, generationType: GenerationType): Omen {
	return Object.freeze({
		name,
		appliesTo: ({ actionName }) => CHAOS_ORBS.has(actionName),
		modifyRemovalPool: ({ pool }) =>
			pool.filter((modifier) => modifier.generationType === generationType),
	} satisfies Omen);
}

/** Causes the next Exalted Orb to add two modifiers sequentially. */
export const omenOfGreaterExaltation: Omen = Object.freeze({
	name: "Omen of Greater Exaltation",
	appliesTo: ({ actionName }) => actionName === EXALTED_ORB,
	modifyAdditionCount: () => 2,
} satisfies Omen);

/** Restricts the next Exalted Orb to prefix modifiers. */
export const omenOfSinistralExaltation = restrictAddition("Omen of Sinistral Exaltation", "Prefix");

/** Restricts the next Exalted Orb to suffix modifiers. */
export const omenOfDextralExaltation = restrictAddition("Omen of Dextral Exaltation", "Suffix");

/** Restricts the next Orb of Annulment to prefix modifiers. */
export const omenOfSinistralAnnulment = restrictRemoval("Omen of Sinistral Annulment", "Prefix");

/** Restricts the next Orb of Annulment to suffix modifiers. */
export const omenOfDextralAnnulment = restrictRemoval("Omen of Dextral Annulment", "Suffix");

/** Restricts the next Chaos Orb of any tier to replacing a prefix modifier. */
export const omenOfSinistralErasure = restrictChaosRemoval("Omen of Sinistral Erasure", "Prefix");

/** Restricts the next Chaos Orb of any tier to replacing a suffix modifier. */
export const omenOfDextralErasure = restrictChaosRemoval("Omen of Dextral Erasure", "Suffix");

/** Makes the next Chaos Orb of any tier replace a lowest-level removable modifier. */
export const omenOfWhittling: Omen = Object.freeze({
	name: "Omen of Whittling",
	removalPriority: 100,
	appliesTo: ({ actionName }) => CHAOS_ORBS.has(actionName),
	modifyRemovalPool: ({ pool }) => {
		const knownLevels = pool.flatMap((modifier) =>
			modifier.requiredLevel === undefined ? [] : [modifier.requiredLevel],
		);
		if (!knownLevels.length) return [];
		const lowestLevel = Math.min(...knownLevels);
		return pool.filter((modifier) => modifier.requiredLevel === lowestLevel);
	},
} satisfies Omen);

/** Active named Omens available to CLI, policy, and web consumers. */
export const omens: ReadonlyMap<string, Omen> = new Map([
	["greater-exaltation", omenOfGreaterExaltation],
	["sinistral-exaltation", omenOfSinistralExaltation],
	["dextral-exaltation", omenOfDextralExaltation],
	["sinistral-annulment", omenOfSinistralAnnulment],
	["dextral-annulment", omenOfDextralAnnulment],
	["sinistral-erasure", omenOfSinistralErasure],
	["dextral-erasure", omenOfDextralErasure],
	["whittling", omenOfWhittling],
]);
