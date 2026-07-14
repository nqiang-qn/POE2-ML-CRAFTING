/** CLI for explicitly importing immutable per-league poe.ninja price snapshots. */

import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	importPoeNinjaOverview,
	POE_NINJA_CATEGORIES,
	type PoeNinjaOverview,
} from "./market-prices.js";

function option(argv: string[], name: string, fallback: string): string {
	const index = argv.indexOf(name);
	if (index < 0) return fallback;
	const value = argv[index + 1];
	if (!value) throw new Error(`Missing value for ${name}`);
	return value;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const league = option(argv, "--league", "Runes of Aldur");
	const databasePath = resolve(option(argv, "--db", "data/poe2db.sqlite3"));
	const capturedAt = new Date().toISOString();
	const database = new DatabaseSync(databasePath);
	let total = 0;
	try {
		database.exec("PRAGMA foreign_keys=ON");
		for (const category of POE_NINJA_CATEGORIES) {
			const url = `https://poe.ninja/poe2/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${category}`;
			const response = await fetch(url, {
				headers: {
					"user-agent": "POE2-ML-CRAFTING/0.1 (market snapshot importer)",
					accept: "application/json",
				},
			});
			if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
			const overview = (await response.json()) as PoeNinjaOverview;
			const imported = importPoeNinjaOverview(
				database,
				league,
				category,
				url,
				capturedAt,
				overview,
			);
			total += imported.count;
			console.log(`Imported ${imported.count} ${category} prices`);
		}
		console.log(`Stored ${total} prices for ${league} at ${capturedAt}`);
	} finally {
		database.close();
	}
}

main().catch((error: unknown) => {
	console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
