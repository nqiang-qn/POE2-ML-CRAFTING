import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { queryModifiers, querySections, querySources, type ModifierQueryOptions } from "./index.js";

interface CliOptions extends ModifierQueryOptions {
	db: string;
	sections: boolean;
	sources: boolean;
}

function parseArguments(argv: string[]): CliOptions {
	const result: CliOptions = {
		db: "data/poe2db.sqlite3", sections: false, sources: false,
		existingFamilies: [], limit: 100, includeSpecial: false, probabilities: false,
	};
	const existingFamilies: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const option = argv[index];
		const value = (): string => {
			const next = argv[++index];
			if (!next) throw new Error(`Missing value for ${option}`);
			return next;
		};
		if (option === "--db") result.db = value();
		else if (option === "--base") result.base = value();
		else if (option === "--item-level") result.itemLevel = Number(value());
		else if (option === "--generation") result.generation = value();
		else if (option === "--family") result.family = value();
		else if (option === "--existing-family") existingFamilies.push(value());
		else if (option === "--action") {
			const action = value();
			if (action !== "ordinary") throw new Error(`Unsupported action pool: ${action}`);
			result.action = action;
		} else if (option === "--section") result.sourceSection = value();
		else if (option === "--sections") result.sections = true;
		else if (option === "--sources") result.sources = true;
		else if (option === "--include-special") result.includeSpecial = true;
		else if (option === "--probabilities") result.probabilities = true;
		else if (option === "--limit") result.limit = Number(value());
		else throw new Error(`Unknown option: ${option}`);
	}
	result.existingFamilies = existingFamilies;
	return result;
}

function main(): void {
	const options = parseArguments(process.argv.slice(2));
	const database = new DatabaseSync(resolve(options.db), { readOnly: true });
	try {
		const rows = options.sources ? querySources(database)
			: options.sections ? querySections(database) : queryModifiers(database, options);
		console.table(rows);
		console.log(`${rows.length} row(s)`);
	} finally { database.close(); }
}

try { main(); }
catch (error: unknown) {
	console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
