import type { CraftingAction } from "./crafting-action.js";
import { chaosOrb, greaterChaosOrb, perfectChaosOrb } from "./chaos-orb.js";
import { exaltedOrb, greaterExaltedOrb, perfectExaltedOrb } from "./exalted-orb.js";
import { orbOfAlchemy } from "./orb-of-alchemy.js";
import { orbOfAnnulment } from "./orb-of-annulment.js";
import {
	greaterOrbOfAugmentation,
	orbOfAugmentation,
	perfectOrbOfAugmentation,
} from "./orb-of-augmentation.js";
import {
	greaterOrbOfTransmutation,
	orbOfTransmutation,
	perfectOrbOfTransmutation,
} from "./orb-of-transmutation.js";
import { greaterRegalOrb, perfectRegalOrb, regalOrb } from "./regal-orb.js";

/** Registered currency actions available to policy and UI consumers. */
export const craftingActions: ReadonlyMap<string, CraftingAction> = new Map(
	[
		orbOfTransmutation,
		greaterOrbOfTransmutation,
		perfectOrbOfTransmutation,
		orbOfAugmentation,
		greaterOrbOfAugmentation,
		perfectOrbOfAugmentation,
		regalOrb,
		greaterRegalOrb,
		perfectRegalOrb,
		exaltedOrb,
		greaterExaltedOrb,
		perfectExaltedOrb,
		orbOfAlchemy,
		chaosOrb,
		greaterChaosOrb,
		perfectChaosOrb,
		orbOfAnnulment,
	].map((action) => [action.id, action]),
);
