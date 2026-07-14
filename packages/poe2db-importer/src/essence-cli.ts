/** CLI for crawling and importing Greater and Perfect Essence mappings. */

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { importEssencePage } from "./index.js";

const FAMILIES = [
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
	"the_Body",
	"the_Infinite",
	"the_Mind",
] as const;

async function fetchPage(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: {
			"user-agent": "POE2-ML-CRAFTING/0.1 (modifier research; cached importer)",
			accept: "text/html,application/xhtml+xml",
		},
	});
	if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
	return response.text();
}

async function main(): Promise<void> {
	const databasePath = resolve(process.argv[2] ?? "data/poe2db.sqlite3");
	await mkdir(dirname(databasePath), { recursive: true });
	const urls = (["Greater", "Perfect"] as const).flatMap((tier) =>
		FAMILIES.map((family) => `https://poe2db.tw/us/${tier}_Essence_of_${family}`),
	);
	const database = new DatabaseSync(databasePath);
	let imported = 0;
	try {
		database.exec("PRAGMA foreign_keys=ON");
		for (let offset = 0; offset < urls.length; offset += 4) {
			const batch = urls.slice(offset, offset + 4);
			const pages = await Promise.all(
				batch.map(async (url) => ({ url, source: await fetchPage(url) })),
			);
			for (const page of pages)
				imported += importEssencePage(database, page.url, page.source);
			console.log(
				`Fetched ${Math.min(offset + batch.length, urls.length)}/${urls.length} pages`,
			);
		}
		console.log(`Imported ${imported} Essence class mappings into ${databasePath}`);
	} finally {
		database.close();
	}
}

main().catch((error: unknown) => {
	console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
