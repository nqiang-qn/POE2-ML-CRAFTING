/** TypeScript graph fixture consumed by the cross-language optimizer test. */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	serializeReachableStateGraph,
	type ActionCost,
	type EncodedCraftingState,
	type ReachableStateGraph,
} from "@poe2craft/simulator";

const MARKET_SNAPSHOT = Object.freeze({
	league: "End-to-End Fixture",
	capturedAt: "2026-01-01T00:00:00.000Z",
});

function state(targetPresence: boolean): EncodedCraftingState {
	return Object.freeze({
		schemaVersion: 2,
		targetId: "fixture-life",
		rarity: "rare",
		targetPresence: Object.freeze([targetPresence]),
		prefixCount: targetPresence ? 1 : 0,
		suffixCount: 0,
		openPrefixCount: targetPresence ? 2 : 3,
		openSuffixCount: 3,
		craftedModifierPresent: false,
		fracturedModifierIds: Object.freeze([]),
		modifierStateIds: Object.freeze([]),
	});
}

function cost(totalExalted: number): ActionCost {
	return Object.freeze({
		totalExalted,
		components: Object.freeze([]),
		warnings: Object.freeze([]),
	});
}

/**
 * Builds a hand-solvable graph serialized by the production TypeScript API.
 *
 * @returns Complete graph whose optimal initial policy costs two Exalted Orbs.
 */
export function createEndToEndFixtureGraph(): ReachableStateGraph {
	return Object.freeze({
		schemaVersion: 3,
		target: Object.freeze({
			id: "fixture-life",
			modifiers: Object.freeze([
				Object.freeze({ id: "life", families: Object.freeze(["IncreasedLife"]) }),
			]),
		}),
		initialStateKey: "start",
		options: Object.freeze({
			samplesPerAction: 2,
			seed: 42,
			maxStates: 3,
			maxDepth: 2,
			actionIds: Object.freeze(["cheap", "expensive", "finish"]),
			omenIds: Object.freeze([]),
		}),
		marketSnapshot: MARKET_SNAPSHOT,
		states: Object.freeze([
			Object.freeze({
				stateKey: "start",
				state: state(false),
				depth: 0,
				terminal: false,
				representativeSignature: "fixture-start",
				availableActionIds: Object.freeze(["cheap", "expensive"]),
			}),
			Object.freeze({
				stateKey: "retry",
				state: state(false),
				depth: 1,
				terminal: false,
				representativeSignature: "fixture-retry",
				availableActionIds: Object.freeze(["finish"]),
			}),
			Object.freeze({
				stateKey: "done",
				state: state(true),
				depth: 2,
				terminal: true,
				representativeSignature: "fixture-done",
				availableActionIds: Object.freeze([]),
			}),
		]),
		transitions: Object.freeze([
			Object.freeze({
				fromStateKey: "start",
				variantId: "cheap",
				actionId: "cheap",
				omenIds: Object.freeze([]),
				cost: cost(1),
				method: "exact",
				seed: 1,
				outcomes: Object.freeze([
					Object.freeze({ stateKey: "retry", count: 2, probability: 1 }),
				]),
			}),
			Object.freeze({
				fromStateKey: "start",
				variantId: "expensive",
				actionId: "expensive",
				omenIds: Object.freeze([]),
				cost: cost(3),
				method: "exact",
				seed: 2,
				outcomes: Object.freeze([
					Object.freeze({ stateKey: "done", count: 2, probability: 1 }),
				]),
			}),
			Object.freeze({
				fromStateKey: "retry",
				variantId: "finish",
				actionId: "finish",
				omenIds: Object.freeze([]),
				cost: cost(1),
				method: "exact",
				seed: 3,
				outcomes: Object.freeze([
					Object.freeze({ stateKey: "done", count: 2, probability: 1 }),
				]),
			}),
		]),
		collisions: Object.freeze([]),
		frontierStateKeys: Object.freeze([]),
		omittedStateKeys: Object.freeze([]),
		truncated: false,
	});
}

function outputOption(argv: readonly string[]): string {
	const index = argv.indexOf("--output");
	const value = index < 0 ? undefined : argv[index + 1];
	if (!value) throw new Error("Missing required --output option");
	return resolve(value);
}

async function main(): Promise<void> {
	const output = outputOption(process.argv.slice(2));
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, serializeReachableStateGraph(createEndToEndFixtureGraph()), "utf8");
	console.log(`Wrote end-to-end fixture graph to ${output}`);
}

main().catch((error: unknown) => {
	console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
