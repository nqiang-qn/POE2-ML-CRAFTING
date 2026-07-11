import type { DatabaseSync } from "node:sqlite";

/** Section-name patterns omitted from the initial supported crafting pool. */
export const INITIAL_EXCLUDED_SECTION_PATTERNS = [
	/augment/i, /bonded/i, /corrupt/i, /sacrifice/i, /orb.*sac/i,
] as const;

/** Modifier row returned from the SQLite data layer. */
export interface ModifierRow {
	source_section: string;
	name: string;
	required_level: number;
	generation_type: string;
	family_key: string;
	family_json: string;
	weight: number;
	modifier_text: string;
	spawn_tags_json: string;
	probability?: number;
	probability_percent?: number;
}

/** Filters and output controls for modifier queries. */
export interface ModifierQueryOptions {
	base?: string | null;
	itemLevel?: number | null;
	generation?: string | null;
	family?: string | null;
	existingFamilies?: readonly string[];
	action?: "ordinary" | null;
	sourceSection?: string | null;
	includeSpecial?: boolean;
	probabilities?: boolean;
	limit?: number;
}

/**
 * Returns whether a source section belongs to the initial supported pool.
 *
 * @param section - PoE2DB `ModsView` section name.
 * @returns `false` for currently unsupported special-mechanic sections.
 */
export function isInitialCraftingSection(section: string): boolean {
	return !INITIAL_EXCLUDED_SECTION_PATTERNS.some((pattern) => pattern.test(section));
}

/**
 * Summarizes imported modifier counts and weights by PoE2DB source section.
 *
 * @param database - Open SQLite modifier database.
 * @returns One summary row per source section.
 */
export function querySections(database: DatabaseSync): Record<string, unknown>[] {
	const rows = database.prepare(`
    SELECT source_section, COUNT(*) AS modifiers,
           MIN(weight) AS min_weight, MAX(weight) AS max_weight
    FROM modifiers GROUP BY source_section ORDER BY source_section
  `).all() as Record<string, unknown>[];
	return rows.map((row) => ({
		...row,
		initial_pool: isInitialCraftingSection(String(row.source_section)),
	}));
}

/**
 * Summarizes the latest import and stored rows for each PoE2DB page.
 *
 * @param database - Open SQLite modifier database.
 * @returns One summary row per imported source URL.
 */
export function querySources(database: DatabaseSync): Record<string, unknown>[] {
	return database.prepare(`
    SELECT r.source_url, r.item_class, r.item_tags,
           r.record_count AS last_import_records,
           COUNT(m.id) AS stored_modifiers,
           MAX(r.fetched_at) AS last_imported_at
    FROM import_runs r
    JOIN (SELECT source_url, MAX(id) AS latest_run_id FROM import_runs GROUP BY source_url) latest
      ON latest.latest_run_id = r.id
    LEFT JOIN modifiers m ON m.source_url = r.source_url
    GROUP BY r.id ORDER BY r.source_url
  `).all() as Record<string, unknown>[];
}

/**
 * Queries modifier rows using base, level, generation, family, and action-pool
 * constraints. Optional probabilities are normalized before display limiting.
 *
 * @param database - Open SQLite modifier database.
 * @param options - Eligibility, source, probability, and result-limit filters.
 * @returns Modifier rows satisfying all requested constraints.
 */
export function queryModifiers(
	database: DatabaseSync,
	options: ModifierQueryOptions = {},
): ModifierRow[] {
	const clauses: string[] = [];
	const values: (string | number)[] = [];
	if (options.base) {
		clauses.push("source_url = ?");
		values.push(`https://poe2db.tw/us/${options.base}`);
	}
	if (options.itemLevel !== null && options.itemLevel !== undefined) {
		clauses.push("required_level <= ?");
		values.push(options.itemLevel);
	}
	if (options.generation) {
		clauses.push("LOWER(generation_type) = LOWER(?)");
		values.push(options.generation);
	}
	if (options.family) {
		clauses.push("family_key = ?");
		values.push(options.family);
	}
	if (options.sourceSection) {
		clauses.push("source_section = ?");
		values.push(options.sourceSection);
	}
	if (options.action === "ordinary") {
		clauses.push("source_section = 'normal'");
		clauses.push("weight > 0");
	}
	const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
	let rows = database.prepare(`
    SELECT source_section, name, required_level, generation_type, family_key,
           family_json, weight, modifier_text, spawn_tags_json
    FROM modifiers ${where} ORDER BY family_key, required_level, name
  `).all(...values) as unknown as ModifierRow[];

	if (!options.includeSpecial) {
		rows = rows.filter((row) => isInitialCraftingSection(row.source_section));
	}
	const existing = new Set(options.existingFamilies ?? []);
	if (existing.size) {
		rows = rows.filter((row) => {
			const families = JSON.parse(row.family_json) as string[];
			return !families.some((family) => existing.has(family));
		});
	}
	if (options.probabilities) {
		const total = rows.reduce((sum, row) => sum + row.weight, 0);
		rows = rows.map((row) => ({
			...row,
			probability: total > 0 ? row.weight / total : 0,
			probability_percent: total > 0 ? Number((100 * row.weight / total).toFixed(6)) : 0,
		}));
	}
	const limit = Number.isSafeInteger(options.limit) && (options.limit ?? 0) > 0
		? options.limit as number : 100;
	return rows.slice(0, limit);
}
