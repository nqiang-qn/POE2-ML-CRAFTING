/** CLI for running deterministic repeated simulations from JSON configuration. */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	RARITIES,
	affixCounts,
	affixLimits,
	createItem,
	type Modifier,
	type Rarity,
} from "@poe2craft/domain";
import { queryModifiers } from "@poe2craft/data";
import { craftingActions } from "./action-registry.js";
import { omens } from "./omens.js";
import { runSimulation, type SimulationReport } from "./simulation-runner.js";

interface CliOptions {
	db: string;
	base: string;
	itemLevel: number;
	rarity: Rarity;
	action: string;
	runs: number;
	seed: number;
	omenIds: string[];
	modifierNames: string[];
	top: number;
	output?: string;
}

function readValue(argv: string[], index: { value: number }, option: string): string {
	const value = argv[++index.value];
	if (!value) throw new Error(`Missing value for ${option}`);
	return value;
}

function parseArguments(argv: string[]): CliOptions {
	const result: CliOptions = {
		db: "data/poe2db.sqlite3",
		base: "Gloves_str",
		itemLevel: 60,
		rarity: RARITIES.MAGIC,
		action: "regal-orb",
		runs: 10000,
		seed: 12345,
		omenIds: [],
		modifierNames: [],
		top: 20,
	};
	const index = { value: 0 };
	for (; index.value < argv.length; index.value += 1) {
		const option = argv[index.value];
		if (option === "--db") result.db = readValue(argv, index, option);
		else if (option === "--base") result.base = readValue(argv, index, option);
		else if (option === "--item-level")
			result.itemLevel = Number(readValue(argv, index, option));
		else if (option === "--rarity") {
			const rarity = readValue(argv, index, option);
			if (!(Object.values(RARITIES) as string[]).includes(rarity)) {
				throw new Error(`Unsupported rarity: ${rarity}`);
			}
			result.rarity = rarity as Rarity;
		} else if (option === "--action") result.action = readValue(argv, index, option);
		else if (option === "--runs") result.runs = Number(readValue(argv, index, option));
		else if (option === "--seed") result.seed = Number(readValue(argv, index, option));
		else if (option === "--omen") result.omenIds.push(readValue(argv, index, option));
		else if (option === "--modifier") result.modifierNames.push(readValue(argv, index, option));
		else if (option === "--top") result.top = Number(readValue(argv, index, option));
		else if (option === "--output") result.output = readValue(argv, index, option);
		else throw new Error(`Unknown option: ${option}`);
	}
	return result;
}

function resolveInitialModifiers(database: DatabaseSync, options: CliOptions): Modifier[] {
	const rows = queryModifiers(database, {
		base: options.base,
		action: "ordinary",
		itemLevel: options.itemLevel,
		limit: Number.MAX_SAFE_INTEGER,
	});
	return options.modifierNames.map((name) => {
		const matches = rows.filter((row) => row.name.toLowerCase() === name.toLowerCase());
		const row = matches.sort((left, right) => right.required_level - left.required_level)[0];
		if (!row) throw new Error(`No eligible ordinary modifier named ${JSON.stringify(name)}`);
		return Object.freeze({
			name: row.name,
			requiredLevel: row.required_level,
			generationType: row.generation_type as "Prefix" | "Suffix",
			families: Object.freeze(JSON.parse(row.family_json) as string[]),
			familyKey: row.family_key,
			weight: row.weight,
			text: row.modifier_text,
		});
	});
}

function validateInitialItem(item: ReturnType<typeof createItem>): void {
	const counts = affixCounts(item);
	const limits = affixLimits(item);
	if (counts.prefixes > limits.prefixes || counts.suffixes > limits.suffixes) {
		throw new Error("Initial modifiers exceed the item's rarity affix limits");
	}
	const families = item.modifiers.flatMap((modifier) => modifier.families);
	if (new Set(families).size !== families.length) {
		throw new Error("Initial modifiers contain a modifier-family conflict");
	}
}

function sortedCounts(
	counts: Readonly<Record<string, number>>,
	limit = Number.MAX_SAFE_INTEGER,
): Record<string, number> {
	return Object.fromEntries(
		Object.entries(counts)
			.sort((left, right) => right[1] - left[1])
			.slice(0, limit),
	);
}

function printReport(report: SimulationReport, top: number): void {
	console.log(
		`${report.action.name}: ${report.runs.toLocaleString()} runs (seed ${report.seed})`,
	);
	console.log(
		`Input: ${report.input.base}, ilvl ${report.input.itemLevel}, ${report.input.rarity}, ${report.input.modifierCount} modifier(s)`,
	);
	if (report.omenNames.length) console.log(`Omens: ${report.omenNames.join(", ")}`);
	console.log(
		`Data: ${report.dataSource.url} (last imported ${report.dataSource.lastImportedAt ?? "unknown"})`,
	);
	if (Object.keys(report.addedModifiers).length) {
		console.log(`Top ${top} added modifier frequencies:`);
		console.table(sortedCounts(report.addedModifiers, top));
	}
	if (Object.keys(report.removedModifiers).length) {
		console.log(`Top ${top} removed modifier frequencies:`);
		console.table(sortedCounts(report.removedModifiers, top));
	}
	if (Object.keys(report.fracturedModifiers).length) {
		console.log(`Top ${top} fractured modifier frequencies:`);
		console.table(sortedCounts(report.fracturedModifiers, top));
	}
	console.log("Resulting affix counts:");
	console.table(sortedCounts(report.resultingAffixCounts));
	if (Object.keys(report.consumedOmens).length) {
		console.log("Consumed Omens:");
		console.table(sortedCounts(report.consumedOmens));
	}
}

async function main(): Promise<void> {
	const options = parseArguments(process.argv.slice(2));
	const action = craftingActions.get(options.action);
	if (!action) throw new Error(`Unknown action ${JSON.stringify(options.action)}`);
	const activeOmens = options.omenIds.map((id) => {
		const omen = omens.get(id);
		if (!omen) throw new Error(`Unknown active Omen ${JSON.stringify(id)}`);
		return omen;
	});
	const database = new DatabaseSync(resolve(options.db), { readOnly: true });
	try {
		const item = createItem({
			base: options.base,
			itemLevel: options.itemLevel,
			rarity: options.rarity,
			modifiers: resolveInitialModifiers(database, options),
		});
		validateInitialItem(item);
		const report = runSimulation(database, action, item, {
			runs: options.runs,
			seed: options.seed,
			omens: activeOmens,
		});
		if (!Number.isSafeInteger(options.top) || options.top < 1) {
			throw new Error("Top result count must be a positive safe integer");
		}
		printReport(report, options.top);
		if (options.output) {
			const output = resolve(options.output);
			await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
			console.log(`Wrote JSON report to ${output}`);
		}
	} finally {
		database.close();
	}
}

main().catch((error: unknown) => {
	console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
