/** Normalization, persistence, and lookup of immutable market-price snapshots. */

import type { DatabaseSync } from "node:sqlite";

/** poe.ninja exchange categories needed by the crafting optimizer. */
export const POE_NINJA_CATEGORIES = ["Currency", "Essences", "Ritual"] as const;
/** Supported poe.ninja exchange category. */
export type PoeNinjaCategory = (typeof POE_NINJA_CATEGORIES)[number];

interface PoeNinjaItem {
	readonly id: string;
	readonly name: string;
	readonly detailsId: string;
	readonly category: string;
}

interface PoeNinjaLine {
	readonly id: string;
	readonly primaryValue: number;
	readonly volumePrimaryValue?: number;
	readonly maxVolumeCurrency?: string;
	readonly maxVolumeRate?: number;
}

/** Minimal validated shape of a poe.ninja PoE2 exchange overview response. */
export interface PoeNinjaOverview {
	readonly core: {
		readonly primary: string;
		readonly secondary?: string;
		readonly rates: Readonly<Record<string, number>>;
	};
	readonly items: readonly PoeNinjaItem[];
	readonly lines: readonly PoeNinjaLine[];
}

/** One normalized market price retained in a snapshot. */
export interface MarketPrice {
	readonly marketId: string;
	readonly detailsId: string;
	readonly name: string;
	readonly itemCategory: string;
	readonly primaryValue: number;
	readonly exaltedValue: number;
	readonly volumePrimaryValue: number | null;
	readonly maxVolumeCurrency: string | null;
	readonly maxVolumeRate: number | null;
}

/** Immutable set of prices captured together for one league. */
export interface MarketPriceSnapshot {
	readonly league: string;
	readonly capturedAt: string;
	readonly prices: ReadonlyMap<string, MarketPrice & { readonly sourceUrl: string }>;
}

/** SQLite schema for immutable market-price snapshots. */
export const MARKET_PRICE_SCHEMA = `
CREATE TABLE IF NOT EXISTS market_price_imports (
  id INTEGER PRIMARY KEY, provider TEXT NOT NULL, league TEXT NOT NULL,
  category TEXT NOT NULL, source_url TEXT NOT NULL, captured_at TEXT NOT NULL,
  primary_currency TEXT NOT NULL, secondary_currency TEXT,
  exalted_per_primary REAL NOT NULL, raw_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_prices (
  id INTEGER PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES market_price_imports(id),
  market_id TEXT NOT NULL, details_id TEXT NOT NULL, name TEXT NOT NULL,
  item_category TEXT NOT NULL, primary_value REAL NOT NULL,
  exalted_value REAL NOT NULL, volume_primary_value REAL,
  max_volume_currency TEXT, max_volume_rate REAL,
  UNIQUE(import_id, market_id)
);
CREATE INDEX IF NOT EXISTS market_prices_details_idx ON market_prices(details_id);
CREATE INDEX IF NOT EXISTS market_import_lookup_idx
  ON market_price_imports(league, category, captured_at);
`;

function exaltedPerPrimary(overview: PoeNinjaOverview): number {
	const value =
		overview.core.primary === "exalted" ? 1 : overview.core.rates.exalted;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(
			`poe.ninja response does not provide a valid Exalted conversion for ${overview.core.primary}`,
		);
	}
	return value;
}

/**
 * Normalizes a poe.ninja overview into prices keyed by stable `detailsId`.
 *
 * @param overview - Decoded PoE2 exchange overview response.
 * @returns Prices retaining original values and normalized Exalted values.
 * @throws If conversion data, item metadata, or numeric price fields are invalid.
 */
export function normalizePoeNinjaOverview(overview: PoeNinjaOverview): readonly MarketPrice[] {
	const conversion = exaltedPerPrimary(overview);
	const items = new Map(overview.items.map((item) => [item.id, item]));
	return Object.freeze(
		overview.lines.map((line) => {
			const item = items.get(line.id);
			if (!item) throw new Error(`Missing poe.ninja item metadata for ${line.id}`);
			if (!Number.isFinite(line.primaryValue) || line.primaryValue < 0) {
				throw new Error(`Invalid primary value for ${line.id}`);
			}
			return Object.freeze({
				marketId: line.id,
				detailsId: item.detailsId,
				name: item.name,
				itemCategory: item.category,
				primaryValue: line.primaryValue,
				exaltedValue: line.primaryValue * conversion,
				volumePrimaryValue: line.volumePrimaryValue ?? null,
				maxVolumeCurrency: line.maxVolumeCurrency ?? null,
				maxVolumeRate: line.maxVolumeRate ?? null,
			});
		}),
	);
}

/**
 * Stores one immutable poe.ninja market snapshot.
 *
 * @param database - Open writable SQLite database.
 * @param league - Exact, case-sensitive PoE2 league name.
 * @param category - poe.ninja exchange category.
 * @param sourceUrl - Fully parameterized overview endpoint URL.
 * @param capturedAt - ISO timestamp recorded when the response was fetched.
 * @param overview - Decoded overview response.
 * @returns Snapshot import ID and imported price count.
 */
export function importPoeNinjaOverview(
	database: DatabaseSync,
	league: string,
	category: PoeNinjaCategory,
	sourceUrl: string,
	capturedAt: string,
	overview: PoeNinjaOverview,
): { importId: number; count: number } {
	database.exec(MARKET_PRICE_SCHEMA);
	const conversion = exaltedPerPrimary(overview);
	const prices = normalizePoeNinjaOverview(overview);
	let importId: number;
	database.exec("BEGIN");
	try {
		const imported = database
			.prepare(
			`INSERT INTO market_price_imports(provider,league,category,source_url,captured_at,
			primary_currency,secondary_currency,exalted_per_primary,raw_json)
			VALUES ('poe.ninja',?,?,?,?,?,?,?,?)`,
			)
			.run(
			league,
			category,
			sourceUrl,
			capturedAt,
			overview.core.primary,
			overview.core.secondary ?? null,
			conversion,
				JSON.stringify(overview),
			);
		importId = Number(imported.lastInsertRowid);
		const insert = database.prepare(`INSERT INTO market_prices(import_id,market_id,
		details_id,name,item_category,primary_value,exalted_value,volume_primary_value,
		max_volume_currency,max_volume_rate) VALUES (?,?,?,?,?,?,?,?,?,?)`);
		for (const price of prices) {
			insert.run(
				importId,
				price.marketId,
				price.detailsId,
				price.name,
				price.itemCategory,
				price.primaryValue,
				price.exaltedValue,
				price.volumePrimaryValue,
				price.maxVolumeCurrency,
				price.maxVolumeRate,
			);
		}
		database.exec("COMMIT");
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
	return { importId, count: prices.length };
}

/**
 * Loads the latest known Exalted-denominated price for a crafting identifier.
 *
 * @param database - Open SQLite database containing market snapshots.
 * @param league - Exact league whose latest snapshot should be used.
 * @param detailsId - poe.ninja details ID, normally matching an action or Omen ID.
 * @returns Latest matching price, or `undefined` if the item was not imported.
 */
export function latestMarketPrice(
	database: DatabaseSync,
	league: string,
	detailsId: string,
): (MarketPrice & { readonly capturedAt: string; readonly sourceUrl: string }) | undefined {
	const row = database
		.prepare(
			`SELECT p.market_id AS marketId,p.details_id AS detailsId,p.name,
			p.item_category AS itemCategory,p.primary_value AS primaryValue,
			p.exalted_value AS exaltedValue,p.volume_primary_value AS volumePrimaryValue,
			p.max_volume_currency AS maxVolumeCurrency,p.max_volume_rate AS maxVolumeRate,
			i.captured_at AS capturedAt,i.source_url AS sourceUrl
			FROM market_prices p JOIN market_price_imports i ON i.id=p.import_id
			WHERE i.league=? AND p.details_id=? ORDER BY i.captured_at DESC,i.id DESC LIMIT 1`,
		)
		.get(league, detailsId);
	return row as
		| (MarketPrice & { readonly capturedAt: string; readonly sourceUrl: string })
		| undefined;
}

/**
 * Loads one complete poe.ninja snapshot, defaulting to the latest capture.
 *
 * @param database - Open SQLite database containing market snapshots.
 * @param league - Exact league name.
 * @param capturedAt - Optional exact capture timestamp; latest is used when omitted.
 * @returns Snapshot keyed by poe.ninja `detailsId`.
 * @throws If no snapshot exists for the requested league and timestamp.
 */
export function loadMarketPriceSnapshot(
	database: DatabaseSync,
	league: string,
	capturedAt?: string,
): MarketPriceSnapshot {
	const selected =
		capturedAt ??
		(
			database
				.prepare("SELECT MAX(captured_at) AS capturedAt FROM market_price_imports WHERE league=?")
				.get(league) as { capturedAt: string | null }
		).capturedAt;
	if (!selected) throw new Error(`No market price snapshot found for ${league}`);
	const rows = database
		.prepare(
			`SELECT p.market_id AS marketId,p.details_id AS detailsId,p.name,
			p.item_category AS itemCategory,p.primary_value AS primaryValue,
			p.exalted_value AS exaltedValue,p.volume_primary_value AS volumePrimaryValue,
			p.max_volume_currency AS maxVolumeCurrency,p.max_volume_rate AS maxVolumeRate,
			i.source_url AS sourceUrl FROM market_prices p
			JOIN market_price_imports i ON i.id=p.import_id
			WHERE i.league=? AND i.captured_at=? ORDER BY p.details_id`,
		)
		.all(league, selected) as unknown as (MarketPrice & { sourceUrl: string })[];
	if (!rows.length) throw new Error(`No market prices found for ${league} at ${selected}`);
	return Object.freeze({
		league,
		capturedAt: selected,
		prices: new Map(rows.map((row) => [row.detailsId, Object.freeze(row)])),
	});
}
