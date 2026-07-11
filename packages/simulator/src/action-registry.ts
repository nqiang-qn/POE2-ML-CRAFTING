import type { CraftingAction } from "./crafting-action.js";
import { exaltedOrb } from "./exalted-orb.js";
import { orbOfAnnulment } from "./orb-of-annulment.js";
import { orbOfAugmentation } from "./orb-of-augmentation.js";
import { regalOrb } from "./regal-orb.js";

/** Registered currency actions available to policy and UI consumers. */
export const craftingActions: ReadonlyMap<string, CraftingAction> = new Map(
	[orbOfAugmentation, regalOrb, exaltedOrb, orbOfAnnulment].map((action) => [action.id, action]),
);
