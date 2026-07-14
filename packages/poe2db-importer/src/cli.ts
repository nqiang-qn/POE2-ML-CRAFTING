/** CLI for importing modifier tables from a PoE2DB item-class page. */

import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_URL, importPage } from "./index.js";

interface Arguments {
	url: string;
	db: string;
	htmlFile?: string;
}

function parseArguments(argv: string[]): Arguments {
	const result: Arguments = { url: DEFAULT_URL, db: "data/poe2db.sqlite3" };
	for (let index = 0; index < argv.length; index += 1) {
		const option = argv[index];
		const value = (): string => {
			const next = argv[++index];
			if (!next) throw new Error(`Missing value for ${option}`);
			return next;
		};
		if (option === "--url") result.url = value();
		else if (option === "--db") result.db = value();
		else if (option === "--html-file") result.htmlFile = value();
		else throw new Error(`Unknown option: ${option}`);
	}
	return result;
}

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
	const args = parseArguments(process.argv.slice(2));
	const source = args.htmlFile
		? await readFile(resolve(args.htmlFile), "utf8")
		: await fetchPage(args.url);
	const databasePath = resolve(args.db);
	await mkdir(dirname(databasePath), { recursive: true });
	const database = new DatabaseSync(databasePath);
	try {
		database.exec("PRAGMA foreign_keys=ON");
		const count = importPage(database, args.url, source);
		console.log(`Imported ${count} modifier records from ${args.url} into ${databasePath}`);
	} finally {
		database.close();
	}
}

main().catch((error: unknown) => {
	console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
