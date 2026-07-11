import type { DatabaseSync } from "node:sqlite";
import { existingFamilies, type GenerationType, type Item, type Modifier } from "@poe2craft/domain";
import { queryModifiers, type ModifierRow } from "@poe2craft/data";

function toModifier(row: ModifierRow): Modifier & { weight: number } {
	return Object.freeze({
		name: row.name,
		requiredLevel: row.required_level,
		generationType: row.generation_type as GenerationType,
		families: Object.freeze(JSON.parse(row.family_json) as string[]),
		familyKey: row.family_key,
		weight: row.weight,
		text: row.modifier_text,
		sourceSection: row.source_section,
		spawnTags: Object.freeze(JSON.parse(row.spawn_tags_json) as string[]),
	});
}

/**
 * Loads ordinary modifiers eligible for the item's base, level, open affix
 * types, and existing modifier-family exclusions.
 *
 * Returned weights are relative PoE2DB `DropChance` values, not probabilities.
 *
 * @param database - Open SQLite modifier database.
 * @param item - Item supplying base, level, and existing-family constraints.
 * @param generationTypes - Prefix/suffix types with capacity for a new affix.
 * @returns Eligible domain modifiers with positive relative weights.
 */
export function eligibleOrdinaryModifiers(
	database: DatabaseSync,
	item: Item,
	generationTypes: readonly GenerationType[],
): (Modifier & { weight: number })[] {
	const allowed = new Set(generationTypes);
	return queryModifiers(database, {
		base: item.base,
		action: "ordinary",
		itemLevel: item.itemLevel,
		existingFamilies: existingFamilies(item),
		limit: Number.MAX_SAFE_INTEGER,
	})
		.filter((row) => allowed.has(row.generation_type as GenerationType))
		.map(toModifier);
}
