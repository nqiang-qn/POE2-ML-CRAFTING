/** CLI for reporting imported Essence coverage and glove-class availability. */

import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createItem, RARITIES } from "@poe2craft/domain";
import { createActionContext } from "./action-context.js";
import { createEssenceAction, essenceActionDefinitions, loadEssenceModifier } from "./essence.js";

const GLOVE_BASES = [
	"Gloves_str",
	"Gloves_dex",
	"Gloves_int",
	"Gloves_str_dex",
	"Gloves_str_int",
	"Gloves_dex_int",
] as const;

interface ValidationFailure {
	readonly base: string;
	readonly action: string;
	readonly error: string;
}

/**
 * Validates every registered Essence definition against imported glove data.
 *
 * @param database - Open SQLite database containing all glove imports.
 * @returns Mapping totals and detailed failures.
 */
export function validateEssenceMappings(database: DatabaseSync): {
	readonly checked: number;
	readonly supported: number;
	readonly supportedActions: readonly string[];
	readonly inapplicable: number;
	readonly failures: readonly ValidationFailure[];
} {
	const failures: ValidationFailure[] = [];
	const supportedActions: string[] = [];
	let supported = 0;
	let inapplicable = 0;
	for (const definition of essenceActionDefinitions) {
		const gloveRows = database
			.prepare(
				`SELECT COUNT(*) AS count FROM essence_modifiers
				 WHERE essence_slug = ? AND item_class_slug = 'Gloves'`,
			)
			.get(definition.poe2dbSlug) as { count: number };
		if (gloveRows.count === 0) {
			inapplicable += 1;
			continue;
		}
		supported += 1;
		supportedActions.push(definition.id);
		for (const base of GLOVE_BASES) {
			try {
				const item = createItem({
					base,
					itemLevel: 100,
					rarity: definition.tier === "Greater" ? RARITIES.MAGIC : RARITIES.RARE,
					modifiers:
						definition.tier === "Perfect"
							? [
									{
										name: "Validation Prefix",
										generationType: "Prefix",
										families: ["ValidationPrefix"],
									},
									{
										name: "Validation Suffix",
										generationType: "Suffix",
										families: ["ValidationSuffix"],
									},
								]
							: [],
				});
				loadEssenceModifier(database, item, definition);
				const action = createEssenceAction(definition);
				if (!action.canApplyWithDatabase?.(database, item)) {
					throw new Error("mapping loaded but action was not applicable");
				}
				const result = action.apply(database, item, createActionContext({ rng: () => 0 }));
				if (result.addedModifiers?.[0]?.crafted !== true) {
					throw new Error("action did not create a crafted modifier");
				}
			} catch (error) {
				failures.push({
					base,
					action: definition.id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}
	return Object.freeze({
		checked: essenceActionDefinitions.length,
		supported,
		supportedActions: Object.freeze(supportedActions),
		inapplicable,
		failures: Object.freeze(failures),
	});
}

function main(): void {
	const database = new DatabaseSync(resolve(process.argv[2] ?? "data/poe2db.sqlite3"));
	try {
		const report = validateEssenceMappings(database);
		console.log(
			`Glove Essences: ${report.supported} supported, ${report.inapplicable} inapplicable, ${report.checked} checked`,
		);
		console.log(`Supported: ${report.supportedActions.join(", ")}`);
		if (report.failures.length) console.table(report.failures);
		if (report.failures.length) process.exitCode = 1;
	} finally {
		database.close();
	}
}

main();
