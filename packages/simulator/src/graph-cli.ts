/** CLI for discovering and serializing a bounded reachable crafting graph. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createItem, type CreateItemInput } from "@poe2craft/domain";
import { createCraftingTarget, type CreateCraftingTargetInput } from "./crafting-target.js";
import {
	discoverReachableStateGraph,
	serializeReachableStateGraph,
	type ReachableGraphOptions,
} from "./reachable-state-graph.js";

interface GraphConfig {
	readonly database?: string;
	readonly item: CreateItemInput;
	readonly target: CreateCraftingTargetInput;
	readonly options: ReachableGraphOptions;
}

function readOption(argv: string[], name: string): string {
	const index = argv.indexOf(name);
	const value = index < 0 ? undefined : argv[index + 1];
	if (!value) throw new Error(`Missing required ${name} option`);
	return value;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const configPath = resolve(readOption(argv, "--config"));
	const outputPath = resolve(readOption(argv, "--output"));
	const config = JSON.parse(await readFile(configPath, "utf8")) as GraphConfig;
	const database = new DatabaseSync(resolve(config.database ?? "data/poe2db.sqlite3"));
	try {
		const graph = discoverReachableStateGraph(
			database,
			createItem(config.item),
			createCraftingTarget(config.target),
			config.options,
		);
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, serializeReachableStateGraph(graph), "utf8");
		console.log(
			`Wrote ${graph.states.length} states and ${graph.transitions.length} transitions to ${outputPath}`,
		);
		if (graph.truncated) console.warn("warning: graph contains an unexpanded frontier");
		if (graph.collisions.length) {
			console.warn(`warning: ${graph.collisions.length} state abstraction collision(s)`);
		}
	} finally {
		database.close();
	}
}

main().catch((error: unknown) => {
	console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
