/** Tests for market normalization and immutable price snapshots. */

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
	importPoeNinjaOverview,
	latestMarketPrice,
	normalizePoeNinjaOverview,
	type PoeNinjaOverview,
} from "@poe2craft/data";

const OVERVIEW: PoeNinjaOverview = {
	core: {
		primary: "divine",
		secondary: "chaos",
		rates: { exalted: 100, chaos: 5 },
	},
	items: [
		{
			id: "exalted",
			name: "Exalted Orb",
			detailsId: "exalted-orb",
			category: "Currency",
		},
	],
	lines: [
		{
			id: "exalted",
			primaryValue: 0.01,
			volumePrimaryValue: 50,
			maxVolumeCurrency: "divine",
			maxVolumeRate: 100,
		},
	],
};

test("normalizes poe.ninja values to Exalted Orbs", () => {
	const prices = normalizePoeNinjaOverview(OVERVIEW);
	assert.equal(prices[0]?.detailsId, "exalted-orb");
	assert.equal(prices[0]?.primaryValue, 0.01);
	assert.equal(prices[0]?.exaltedValue, 1);
});

test("stores immutable snapshots and loads the latest price", () => {
	const db = new DatabaseSync(":memory:");
	try {
		const url = "https://poe.ninja/example";
		assert.equal(
			importPoeNinjaOverview(
				db,
				"Test League",
				"Currency",
				url,
				"2026-01-01T00:00:00.000Z",
				OVERVIEW,
			).count,
			1,
		);
		const later = {
			...OVERVIEW,
			lines: [{ ...OVERVIEW.lines[0]!, primaryValue: 0.02 }],
		};
		importPoeNinjaOverview(
			db,
			"Test League",
			"Currency",
			url,
			"2026-01-02T00:00:00.000Z",
			later,
		);
		assert.equal(
			(
				db.prepare("SELECT COUNT(*) AS count FROM market_price_imports").get() as {
					count: number;
				}
			).count,
			2,
		);
		const latest = latestMarketPrice(db, "Test League", "exalted-orb");
		assert.equal(latest?.primaryValue, 0.02);
		assert.equal(latest?.exaltedValue, 2);
		assert.equal(latest?.capturedAt, "2026-01-02T00:00:00.000Z");
	} finally {
		db.close();
	}
});
