/** CLI for sampling and serializing one configured state-action transition. */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createItem, type CreateItemInput } from "@poe2craft/domain";
import { craftingActions } from "./action-registry.js";
import { createCraftingTarget, type CreateCraftingTargetInput } from "./crafting-target.js";
import { omens } from "./omens.js";
import { sampleTransition, serializeTransitionArtifact } from "./transition-sampler.js";

interface TransitionConfig {
	readonly database?: string;
	readonly item: CreateItemInput;
	readonly target: CreateCraftingTargetInput;
	readonly actionId: string;
	readonly samples: number;
	readonly seed: number;
	readonly omenIds?: readonly string[];
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
	const config = JSON.parse(await readFile(configPath, "utf8")) as TransitionConfig;
	const action = craftingActions.get(config.actionId);
	if (!action) throw new Error(`Unknown action ${JSON.stringify(config.actionId)}`);
	const activeOmens = (config.omenIds ?? []).map((id) => {
		const omen = omens.get(id);
		if (!omen) throw new Error(`Unknown Omen ${JSON.stringify(id)}`);
		return omen;
	});
	const database = new DatabaseSync(resolve(config.database ?? "data/poe2db.sqlite3"));
	try {
		const artifact = sampleTransition(
			database,
			createItem(config.item),
			createCraftingTarget(config.target),
			action,
			{ samples: config.samples, seed: config.seed, omens: activeOmens },
		);
		await writeFile(outputPath, serializeTransitionArtifact(artifact), "utf8");
		console.log(`Wrote ${artifact.outcomes.length} outcomes to ${outputPath}`);
	} finally {
		database.close();
	}
}

main().catch((error: unknown) => {
	console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
