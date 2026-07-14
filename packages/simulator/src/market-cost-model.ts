/** Snapshot-pinned pricing for currency actions and active Omen variants. */

import type { DatabaseSync } from "node:sqlite";
import type { Item } from "@poe2craft/domain";
import {
	loadMarketPriceSnapshot,
	type MarketPrice,
	type MarketPriceSnapshot,
} from "@poe2craft/data";
import { createActionContext, type Omen } from "./action-context.js";
import { availableCraftingActions } from "./action-registry.js";
import type { CraftingAction } from "./crafting-action.js";
import { omens } from "./omens.js";

/** Configuration for snapshot pricing and manual fallbacks. */
export interface MarketCostModelOptions {
	readonly league: string;
	readonly capturedAt?: string;
	readonly minimumVolumePrimaryValue?: number;
	readonly manualExaltedCosts?: Readonly<Record<string, number>>;
}

/** One priced currency or Omen component. */
export interface CostComponent {
	readonly detailsId: string;
	readonly exaltedValue: number | null;
	readonly source: "poe.ninja" | "manual" | "missing";
	readonly capturedAt: string | null;
	readonly sourceUrl: string | null;
	readonly volumePrimaryValue: number | null;
}

/** Total market cost and data-quality warnings for an action variant. */
export interface ActionCost {
	readonly totalExalted: number | null;
	readonly components: readonly CostComponent[];
	readonly warnings: readonly string[];
}

/** Currency action combined with zero or more active crafting Omens. */
export interface CostedActionVariant {
	readonly id: string;
	readonly action: CraftingAction;
	readonly omenIds: readonly string[];
	readonly activeOmens: readonly Omen[];
	readonly cost: ActionCost;
}

/** Snapshot-pinned cost lookup used by graph discovery. */
export interface MarketCostModel {
	readonly league: string;
	readonly capturedAt: string;
	quote(actionId: string, omenIds?: readonly string[]): ActionCost;
}

function componentFor(
	snapshot: MarketPriceSnapshot,
	detailsId: string,
	manualCosts: Readonly<Record<string, number>>,
): CostComponent {
	const price = snapshot.prices.get(detailsId) as
		(MarketPrice & { readonly sourceUrl: string }) | undefined;
	if (price) {
		return Object.freeze({
			detailsId,
			exaltedValue: price.exaltedValue,
			source: "poe.ninja",
			capturedAt: snapshot.capturedAt,
			sourceUrl: price.sourceUrl,
			volumePrimaryValue: price.volumePrimaryValue,
		});
	}
	const manual = manualCosts[detailsId];
	if (typeof manual === "number" && Number.isFinite(manual) && manual >= 0) {
		return Object.freeze({
			detailsId,
			exaltedValue: manual,
			source: "manual",
			capturedAt: null,
			sourceUrl: null,
			volumePrimaryValue: null,
		});
	}
	return Object.freeze({
		detailsId,
		exaltedValue: null,
		source: "missing",
		capturedAt: null,
		sourceUrl: null,
		volumePrimaryValue: null,
	});
}

/**
 * Creates a market model pinned to one immutable snapshot.
 *
 * @param database - Open SQLite database containing poe.ninja snapshots.
 * @param options - League, optional capture, liquidity threshold, and fallbacks.
 * @returns Cost model that prices action and Omen combinations in Exalted Orbs.
 */
export function createMarketCostModel(
	database: DatabaseSync,
	options: MarketCostModelOptions,
): MarketCostModel {
	const snapshot = loadMarketPriceSnapshot(database, options.league, options.capturedAt);
	const manualCosts = options.manualExaltedCosts ?? {};
	const minimumVolume = options.minimumVolumePrimaryValue ?? 0;
	return Object.freeze({
		league: snapshot.league,
		capturedAt: snapshot.capturedAt,
		quote(actionId: string, omenIds: readonly string[] = []): ActionCost {
			const detailsIds = [actionId, ...omenIds.map((id) => `omen-of-${id}`)];
			const components = detailsIds.map((id) => componentFor(snapshot, id, manualCosts));
			const warnings: string[] = [];
			for (const component of components) {
				if (component.source === "missing")
					warnings.push(`Missing market price: ${component.detailsId}`);
				else if (
					component.source === "poe.ninja" &&
					(component.volumePrimaryValue ?? 0) < minimumVolume
				) {
					warnings.push(`Low market volume: ${component.detailsId}`);
				}
			}
			const values = components.map((component) => component.exaltedValue);
			return Object.freeze({
				totalExalted: values.some((value) => value === null)
					? null
					: (values as number[]).reduce((sum, value) => sum + value, 0),
				components: Object.freeze(components),
				warnings: Object.freeze(warnings),
			});
		},
	} satisfies MarketCostModel);
}

function subsets<T>(values: readonly T[]): T[][] {
	return values.reduce<T[][]>(
		(result, value) => [...result, ...result.map((existing) => [...existing, value])],
		[[]],
	);
}

/**
 * Builds valid base and Omen-enhanced action variants for one concrete item.
 *
 * Invalid Omen combinations are discarded by a deterministic dry-run. Missing
 * prices remain visible on the variant but yield a `null` total cost.
 *
 * @param database - Open SQLite crafting and price database.
 * @param item - Concrete item whose action variants are requested.
 * @param costModel - Snapshot-pinned cost model.
 * @param allowedOmenIds - Omen IDs permitted in the optimizer action space.
 * @returns Stable variants sorted by composite ID.
 */
export function availableCostedActionVariants(
	database: DatabaseSync,
	item: Item,
	costModel: MarketCostModel,
	allowedOmenIds: readonly string[] = [],
): readonly CostedActionVariant[] {
	const allowed = allowedOmenIds.map((id) => {
		const omen = omens.get(id);
		if (!omen) throw new Error(`Unknown Omen ${JSON.stringify(id)}`);
		return { id, omen };
	});
	const variants: CostedActionVariant[] = [];
	for (const action of availableCraftingActions(database, item)) {
		const applicable = allowed.filter(({ omen }) =>
			omen.appliesTo({ actionName: action.name, item }),
		);
		for (const selection of subsets(applicable)) {
			const omenIds = selection.map(({ id }) => id).sort();
			const activeOmens = omenIds.map((id) => omens.get(id)!);
			try {
				action.apply(
					database,
					item,
					createActionContext({ rng: () => 0, omens: activeOmens }),
				);
			} catch {
				continue;
			}
			const id = omenIds.length ? `${action.id}+${omenIds.join("+")}` : action.id;
			variants.push(
				Object.freeze({
					id,
					action,
					omenIds: Object.freeze(omenIds),
					activeOmens: Object.freeze(activeOmens),
					cost: costModel.quote(action.id, omenIds),
				}),
			);
		}
	}
	return Object.freeze(variants.sort((left, right) => left.id.localeCompare(right.id)));
}
