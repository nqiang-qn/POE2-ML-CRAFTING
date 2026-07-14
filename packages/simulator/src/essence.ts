/** Greater and Perfect Essence actions backed by imported class mappings. */

import type { DatabaseSync } from "node:sqlite";
import {
	addModifier,
	changeRarity,
	existingFamilies,
	openGenerationTypes,
	RARITIES,
	type Item,
	type Modifier,
} from "@poe2craft/domain";
import type { CraftingAction } from "./crafting-action.js";
import { isModifierRemovable, removeRandomModifier } from "./remove-random-modifier.js";

/** Supported endgame Essence tiers. */
export type EssenceTier = "Greater" | "Perfect";

/** Configuration for one item-class-specific Essence action. */
export interface EssenceActionOptions {
	readonly id: string;
	readonly name: string;
	readonly poe2dbSlug: string;
	readonly tier: EssenceTier;
}

interface EssenceModifierRow {
	readonly required_level: number;
	readonly generation_type: "Prefix" | "Suffix";
	readonly family_json: string;
	readonly family_key: string;
	readonly modifier_text: string;
}

interface CrawledEssenceModifierRow {
	readonly required_level: number;
	readonly generation_type: "Prefix" | "Suffix";
	readonly modifier_text: string;
}

/**
 * Loads the guaranteed crafted modifier for an Essence and item base.
 *
 * @param database - Open SQLite database containing imported PoE2DB modifiers.
 * @param item - Target item whose base selects the imported source page.
 * @param options - Essence identity and tier configuration.
 * @returns The guaranteed modifier marked as crafted.
 * @throws If the Essence has no unambiguous, level-eligible mapping for the base.
 */
export function loadEssenceModifier(
	database: DatabaseSync,
	item: Item,
	options: EssenceActionOptions,
): Modifier {
	const importedPage = database
		.prepare("SELECT COUNT(*) AS count FROM essence_modifiers WHERE essence_slug = ?")
		.get(options.poe2dbSlug) as { count: number };
	if (importedPage.count > 0) {
		const crawledRows = database
			.prepare(
				`SELECT DISTINCT required_level, generation_type, modifier_text
				 FROM essence_modifiers WHERE essence_slug = ? AND item_class_slug = 'Gloves'
				 AND required_level <= ?`,
			)
			.all(options.poe2dbSlug, item.itemLevel) as unknown as CrawledEssenceModifierRow[];
		if (crawledRows.length !== 1) {
			throw new Error(
				`${options.name} requires exactly one crawled glove mapping; found ${crawledRows.length}`,
			);
		}
		const row = crawledRows[0];
		if (!row) throw new Error(`Failed to load the crawled modifier for ${options.name}`);
		return Object.freeze({
			name: `${options.name}: ${row.modifier_text}`,
			requiredLevel: row.required_level,
			generationType: row.generation_type,
			families: Object.freeze([`Essence:${options.poe2dbSlug}`]),
			familyKey: `Essence:${options.poe2dbSlug}`,
			text: row.modifier_text,
			sourceSection: "essence",
			crafted: true,
		});
	}
	const rows = database
		.prepare(
			`SELECT DISTINCT required_level, generation_type, family_json, family_key,
			 modifier_text FROM modifiers
			 WHERE source_url = ? AND source_section = 'essence' AND name LIKE ?
			 AND required_level <= ?`,
		)
		.all(
			`https://poe2db.tw/us/${item.base}`,
			`%href="${options.poe2dbSlug}"%`,
			item.itemLevel,
		) as unknown as EssenceModifierRow[];
	if (rows.length !== 1) {
		throw new Error(
			`${options.name} requires exactly one level-eligible mapping for ${item.base}; found ${rows.length}`,
		);
	}
	const row = rows[0];
	if (!row) throw new Error(`Failed to load the crafted modifier for ${options.name}`);
	return Object.freeze({
		name: `${options.name}: ${row.modifier_text}`,
		requiredLevel: row.required_level,
		generationType: row.generation_type,
		families: Object.freeze(JSON.parse(row.family_json) as string[]),
		familyKey: row.family_key,
		text: row.modifier_text,
		sourceSection: "essence",
		crafted: true,
	});
}

function hasCraftedModifier(item: Item): boolean {
	return item.modifiers.some((modifier) => modifier.crafted);
}

function assertCanAddEssenceModifier(item: Item, modifier: Modifier, name: string): void {
	if (!openGenerationTypes(item).includes(modifier.generationType)) {
		throw new Error(`${name} has no open ${modifier.generationType.toLowerCase()} slot`);
	}
	const occupiedFamilies = new Set(existingFamilies(item));
	if (modifier.families.some((family) => occupiedFamilies.has(family))) {
		throw new Error(`${name} conflicts with an existing modifier family`);
	}
}

function conflictsWithExistingFamily(item: Item, modifier: Modifier): boolean {
	const occupiedFamilies = new Set(existingFamilies(item));
	return modifier.families.some((family) => occupiedFamilies.has(family));
}

function perfectRemovalFilter(item: Item, modifier: Modifier): (candidate: Modifier) => boolean {
	const hasOpenRequiredSlot = openGenerationTypes(item).includes(modifier.generationType);
	return (candidate) =>
		hasOpenRequiredSlot || candidate.generationType === modifier.generationType;
}

/**
 * Creates a Greater or Perfect Essence action backed by imported crafted data.
 *
 * Greater Essences upgrade a magic item to rare and add their guaranteed
 * crafted modifier. Perfect Essences replace one removable modifier on a rare
 * item with their guaranteed crafted modifier.
 *
 * @param options - Stable identity, PoE2DB slug, and Essence tier.
 * @returns A configured Essence crafting action.
 */
export function createEssenceAction(options: EssenceActionOptions): CraftingAction {
	return Object.freeze({
		id: options.id,
		name: options.name,
		canApply(item: Item): boolean {
			if (hasCraftedModifier(item)) return false;
			if (options.tier === "Greater") return item.rarity === RARITIES.MAGIC;
			return item.rarity === RARITIES.RARE && item.modifiers.some(isModifierRemovable);
		},
		canApplyWithDatabase(database, item): boolean {
			if (!this.canApply(item)) return false;
			try {
				const craftedModifier = loadEssenceModifier(database, item, options);
				if (conflictsWithExistingFamily(item, craftedModifier)) return false;
				if (options.tier === "Greater") {
					return openGenerationTypes(changeRarity(item, RARITIES.RARE)).includes(
						craftedModifier.generationType,
					);
				}
				const filter = perfectRemovalFilter(item, craftedModifier);
				return item.modifiers.some(
					(modifier) => isModifierRemovable(modifier) && filter(modifier),
				);
			} catch {
				return false;
			}
		},
		apply(database, item, context) {
			if (!this.canApplyWithDatabase?.(database, item)) {
				throw new Error(`${this.name} cannot apply to this item`);
			}
			const craftedModifier = loadEssenceModifier(database, item, options);
			if (options.tier === "Greater") {
				const rareItem = changeRarity(item, RARITIES.RARE);
				assertCanAddEssenceModifier(rareItem, craftedModifier, this.name);
				return Object.freeze({
					item: addModifier(rareItem, craftedModifier),
					addedModifiers: Object.freeze([craftedModifier]),
					consumedOmens: Object.freeze([]),
				});
			}

			const removal = removeRandomModifier(
				item,
				this.name,
				context,
				perfectRemovalFilter(item, craftedModifier),
			);
			assertCanAddEssenceModifier(removal.item, craftedModifier, this.name);
			return Object.freeze({
				item: addModifier(removal.item, craftedModifier),
				removedModifiers: Object.freeze([removal.modifier]),
				addedModifiers: Object.freeze([craftedModifier]),
				consumedOmens: Object.freeze(removal.consumedOmens),
			});
		},
	} satisfies CraftingAction);
}

const ESSENCE_FAMILIES = [
	"Abrasion",
	"Alacrity",
	"Battle",
	"Command",
	"Electricity",
	"Enhancement",
	"Flames",
	"Grounding",
	"Haste",
	"Ice",
	"Insulation",
	"Opulence",
	"Ruin",
	"Seeking",
	"Sorcery",
	"Thawing",
	"the Body",
	"the Infinite",
	"the Mind",
] as const;

function essenceId(tier: EssenceTier, family: string): string {
	return `${tier.toLowerCase()}-essence-of-${family.toLowerCase().replaceAll(" ", "-")}`;
}

/** Greater and Perfect Essence definitions available to data validators. */
export const essenceActionDefinitions: readonly EssenceActionOptions[] = Object.freeze(
	(["Greater", "Perfect"] as const).flatMap((tier) =>
		ESSENCE_FAMILIES.map((family) => {
			const name = `${tier} Essence of ${family}`;
			return Object.freeze({
				id: essenceId(tier, family),
				name,
				poe2dbSlug: name.replaceAll(" ", "_"),
				tier,
			});
		}),
	),
);

/** Greater and Perfect Essence actions available to registry consumers. */
export const essenceActions: readonly CraftingAction[] = Object.freeze(
	essenceActionDefinitions.map(createEssenceAction),
);
