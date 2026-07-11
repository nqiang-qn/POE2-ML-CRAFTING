import type { DatabaseSync } from "node:sqlite";

/** Default PoE2DB page imported when no URL is supplied. */
export const DEFAULT_URL = "https://poe2db.tw/us/Gloves_str";
const CONSTRUCTOR_MARKER = "new ModsView(";

type JsonObject = Record<string, unknown>;

/**
 * Extracts the JSON object embedded in PoE2DB's `new ModsView(...)` call.
 *
 * @param source - Complete HTML source of a PoE2DB item-class page.
 * @returns The decoded object passed to `ModsView`.
 * @throws If the constructor marker or a complete JSON object cannot be found.
 */
export function extractModsView(source: string): JsonObject {
	const markerIndex = source.indexOf(CONSTRUCTOR_MARKER);
	if (markerIndex < 0)
		throw new Error(`Could not find ${JSON.stringify(CONSTRUCTOR_MARKER)} in page`);
	const start = source.indexOf("{", markerIndex + CONSTRUCTOR_MARKER.length);
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < source.length; index += 1) {
		const character = source[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') inString = false;
			continue;
		}
		if (character === '"') inString = true;
		else if (character === "{") depth += 1;
		else if (character === "}") {
			depth -= 1;
			if (depth === 0) return JSON.parse(source.slice(start, index + 1)) as JsonObject;
		}
	}
	throw new Error("Unterminated ModsView JSON object");
}

/**
 * Iterates modifier-shaped records across the embedded ModsView sections.
 *
 * @param view - Decoded `ModsView` constructor object.
 * @returns Section and modifier-record pairs.
 */
export function* modifierRecords(view: JsonObject): Generator<[string, JsonObject]> {
	for (const [section, value] of Object.entries(view)) {
		if (!Array.isArray(value)) continue;
		for (const candidate of value) {
			if (candidate === null || typeof candidate !== "object") continue;
			const record = candidate as JsonObject;
			const required = ["Name", "Level", "ModGenerationTypeID", "DropChance"];
			if (required.every((key) => Object.hasOwn(record, key))) yield [section, record];
		}
	}
}

/**
 * Converts PoE2DB's rendered modifier HTML into normalized plain text.
 *
 * @param value - Modifier HTML stored in PoE2DB's `str` property.
 * @returns Tag-free text with decoded entities and normalized whitespace.
 */
export function htmlToText(value: string): string {
	const entities: Record<string, string> = {
		amp: "&",
		quot: '"',
		apos: "'",
		lt: "<",
		gt: ">",
		ndash: "–",
		mdash: "—",
		nbsp: " ",
	};
	return value
		.replace(/<[^>]*>/g, "")
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match: string, entity: string) => {
			if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
			if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
			return entities[entity.toLowerCase()] ?? match;
		})
		.replace(/\s+/g, " ")
		.trim();
}

/** SQLite schema used for imports, provenance, and modifier queries. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY, source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, item_class TEXT,
  item_class_id INTEGER, item_tags TEXT, record_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS modifiers (
  id INTEGER PRIMARY KEY, source_url TEXT NOT NULL, source_section TEXT NOT NULL,
  name TEXT NOT NULL, required_level INTEGER NOT NULL, generation_type_id INTEGER NOT NULL,
  generation_type TEXT, family_json TEXT NOT NULL, family_key TEXT NOT NULL,
  weight INTEGER NOT NULL, modifier_html TEXT NOT NULL, modifier_text TEXT NOT NULL,
  crafting_tags_json TEXT NOT NULL, spawn_tags_json TEXT NOT NULL,
  excluded_tags_json TEXT NOT NULL, hover_url TEXT, raw_json TEXT NOT NULL,
  last_import_run_id INTEGER NOT NULL REFERENCES import_runs(id),
  UNIQUE(source_url, source_section, name, required_level,
         generation_type_id, family_key, modifier_text)
);
CREATE INDEX IF NOT EXISTS modifiers_family_idx ON modifiers(family_key);
CREATE INDEX IF NOT EXISTS modifiers_weight_idx ON modifiers(weight);
CREATE INDEX IF NOT EXISTS modifiers_level_idx ON modifiers(required_level);
`;

const UPSERT = `
INSERT INTO modifiers (source_url, source_section, name, required_level,
 generation_type_id, generation_type, family_json, family_key, weight,
 modifier_html, modifier_text, crafting_tags_json, spawn_tags_json,
 excluded_tags_json, hover_url, raw_json, last_import_run_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(source_url, source_section, name, required_level,
 generation_type_id, family_key, modifier_text)
DO UPDATE SET generation_type=excluded.generation_type, weight=excluded.weight,
 modifier_html=excluded.modifier_html, crafting_tags_json=excluded.crafting_tags_json,
 spawn_tags_json=excluded.spawn_tags_json, excluded_tags_json=excluded.excluded_tags_json,
 hover_url=excluded.hover_url, raw_json=excluded.raw_json,
 last_import_run_id=excluded.last_import_run_id
`;

function arrayJson(record: JsonObject, key: string): string {
	return JSON.stringify(Array.isArray(record[key]) ? record[key] : []);
}

/**
 * Imports one PoE2DB item-class page into SQLite using idempotent upserts.
 *
 * Raw third-party records and their source URL are retained for provenance.
 *
 * @param database - Open writable SQLite database.
 * @param sourceUrl - Canonical URL from which the page was obtained.
 * @param source - Complete page HTML containing a `ModsView` object.
 * @returns The number of modifier records encountered in the source page.
 * @throws If embedded data is malformed or a database operation fails.
 */
export function importPage(database: DatabaseSync, sourceUrl: string, source: string): number {
	database.exec(SCHEMA);
	const view = extractModsView(source);
	const options = view.opt && typeof view.opt === "object" ? (view.opt as JsonObject) : {};
	const generations = view.gen && typeof view.gen === "object" ? (view.gen as JsonObject) : {};
	const run = database
		.prepare(
			`
    INSERT INTO import_runs(source_url, item_class, item_class_id, item_tags) VALUES (?, ?, ?, ?)
  `,
		)
		.run(
			sourceUrl,
			options.ItemClassesCode == null ? null : String(options.ItemClassesCode),
			options.ItemClassesID == null ? null : Number(options.ItemClassesID),
			options.tags == null ? null : String(options.tags),
		);
	const runId = Number(run.lastInsertRowid);
	const upsert = database.prepare(UPSERT);
	let count = 0;
	database.exec("BEGIN");
	try {
		for (const [section, record] of modifierRecords(view)) {
			const families = Array.isArray(record.ModFamilyList)
				? record.ModFamilyList.map(String)
				: [];
			const generationId = Number(record.ModGenerationTypeID);
			const modifierHtml = String(record.str ?? "");
			upsert.run(
				sourceUrl,
				section,
				String(record.Name),
				Number(record.Level),
				generationId,
				generations[String(generationId)] == null
					? null
					: String(generations[String(generationId)]),
				JSON.stringify(families),
				families.join("|"),
				Number(record.DropChance),
				modifierHtml,
				htmlToText(modifierHtml),
				arrayJson(record, "fossil_no"),
				arrayJson(record, "spawn_no"),
				arrayJson(record, "adds_no"),
				record.hover == null ? null : String(record.hover),
				JSON.stringify(record),
				runId,
			);
			count += 1;
		}
		database.prepare("UPDATE import_runs SET record_count=? WHERE id=?").run(count, runId);
		database.exec("COMMIT");
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
	return count;
}
