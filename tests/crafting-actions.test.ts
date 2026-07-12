import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createItem, RARITIES } from "@poe2craft/domain";
import {
	applyOrbOfAugmentation,
	canApplyOrbOfAugmentation,
	chaosOrb,
	craftingActions,
	createActionContext,
	exaltedOrb,
	greaterOrbOfTransmutation,
	greaterChaosOrb,
	perfectChaosOrb,
	omenOfDextralAnnulment,
	omenOfDextralExaltation,
	omenOfDextralErasure,
	omenOfGreaterExaltation,
	omenOfSinistralAnnulment,
	omenOfSinistralExaltation,
	omenOfSinistralErasure,
	omenOfWhittling,
	orbOfAlchemy,
	orbOfAnnulment,
	orbOfTransmutation,
	perfectOrbOfTransmutation,
	regalOrb,
	runSimulation,
	selectWeighted,
	type Omen,
} from "@poe2craft/simulator";
import { SCHEMA } from "@poe2craft/poe2db-importer";

function fixtureDatabase(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	db.exec(SCHEMA);
	db.prepare("INSERT INTO import_runs(source_url, record_count) VALUES (?, 0)").run(
		"https://poe2db.tw/us/Gloves_str",
	);
	const insert = db.prepare(`INSERT INTO modifiers(source_url,source_section,name,
    required_level,generation_type_id,generation_type,family_json,family_key,weight,
    modifier_html,modifier_text,crafting_tags_json,spawn_tags_json,excluded_tags_json,
    raw_json,last_import_run_id) VALUES ('https://poe2db.tw/us/Gloves_str','normal',
    ?,1,?,?,?, ?,?,'',?,'[]','[]','[]','{}',1)`);
	insert.run("Hale", 1, "Prefix", '["IncreasedLife"]', "IncreasedLife", 1000, "+10 Life");
	insert.run("of Ice", 2, "Suffix", '["ColdResistance"]', "ColdResistance", 500, "+10% Cold");
	insert.run("of Fire", 2, "Suffix", '["FireResistance"]', "FireResistance", 500, "+10% Fire");
	return db;
}

test("weighted selection observes exact boundaries", () => {
	const candidates = [
		{ weight: 1, name: "a" },
		{ weight: 3, name: "b" },
	];
	assert.equal(selectWeighted(candidates, () => 0.249).name, "a");
	assert.equal(selectWeighted(candidates, () => 0.25).name, "b");
});

test("augmentation fills an open affix and supports Omen hooks", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.MAGIC });
		const omen: Omen = {
			name: "Test Suffix Omen",
			appliesTo: () => true,
			modifyModifierPool: ({ pool }) => pool.filter((mod) => mod.generationType === "Suffix"),
		};
		const result = applyOrbOfAugmentation(
			db,
			item,
			createActionContext({ rng: () => 0.75, omens: [omen] }),
		);
		assert.equal(result.addedModifier.name, "of Fire");
		assert.deepEqual(result.consumedOmens, ["Test Suffix Omen"]);
		assert.equal(item.modifiers.length, 0);
		assert.equal(result.item.modifiers.length, 1);
		assert.equal(canApplyOrbOfAugmentation(result.item), true);
	} finally {
		db.close();
	}
});

test("augmentation rejects non-magic items", () => {
	assert.equal(
		canApplyOrbOfAugmentation(
			createItem({
				base: "Gloves_str",
				itemLevel: 60,
				rarity: RARITIES.NORMAL,
			}),
		),
		false,
	);
});

test("Regal upgrades a magic item to rare and adds one modifier", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.MAGIC });
		const result = regalOrb.apply(db, item, createActionContext({ rng: () => 0 }));
		assert.equal(result.item.rarity, RARITIES.RARE);
		assert.equal(result.item.modifiers.length, 1);
		assert.equal(result.addedModifiers?.length, 1);
		assert.equal(item.rarity, RARITIES.MAGIC);
	} finally {
		db.close();
	}
});

test("Exalted adds a modifier to a rare item", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.RARE });
		const result = exaltedOrb.apply(db, item, createActionContext({ rng: () => 0.4 }));
		assert.equal(result.item.rarity, RARITIES.RARE);
		assert.equal(result.item.modifiers.length, 1);
		assert.equal(result.addedModifiers?.[0]?.name, "of Fire");
	} finally {
		db.close();
	}
});

test("Annulment removes uniformly from the Omen-filtered pool", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [
				{ name: "Hale", generationType: "Prefix", families: ["IncreasedLife"] },
				{ name: "of Fire", generationType: "Suffix", families: ["FireResistance"] },
			],
		});
		const omen: Omen = {
			name: "Test Suffix Annulment Omen",
			appliesTo: ({ actionName }) => actionName === "Orb of Annulment",
			modifyRemovalPool: ({ pool }) => pool.filter((mod) => mod.generationType === "Suffix"),
		};
		const result = orbOfAnnulment.apply(
			db,
			item,
			createActionContext({ rng: () => 0, omens: [omen] }),
		);
		assert.equal(result.removedModifiers?.[0]?.name, "of Fire");
		assert.equal(result.item.modifiers[0]?.name, "Hale");
		assert.deepEqual(result.consumedOmens, ["Test Suffix Annulment Omen"]);
	} finally {
		db.close();
	}
});

test("action registry exposes all tiered modifier-adding currencies", () => {
	assert.deepEqual(
		[...craftingActions.keys()],
		[
			"orb-of-transmutation",
			"greater-orb-of-transmutation",
			"perfect-orb-of-transmutation",
			"orb-of-augmentation",
			"greater-orb-of-augmentation",
			"perfect-orb-of-augmentation",
			"regal-orb",
			"greater-regal-orb",
			"perfect-regal-orb",
			"exalted-orb",
			"greater-exalted-orb",
			"perfect-exalted-orb",
			"orb-of-alchemy",
			"chaos-orb",
			"greater-chaos-orb",
			"perfect-chaos-orb",
			"orb-of-annulment",
		],
	);
});

test("Annulment and Chaos preserve fractured modifiers", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [
				{
					name: "Fractured Hale",
					generationType: "Prefix",
					families: ["IncreasedLife"],
					fractured: true,
				},
				{ name: "of Fire", generationType: "Suffix", families: ["FireResistance"] },
			],
		});
		const annulled = orbOfAnnulment.apply(db, item, createActionContext({ rng: () => 0 }));
		assert.equal(annulled.removedModifiers?.[0]?.name, "of Fire");
		assert.equal(annulled.item.modifiers[0]?.fractured, true);

		const chaos = chaosOrb.apply(db, item, createActionContext({ rng: () => 0 }));
		assert.equal(chaos.removedModifiers?.[0]?.name, "of Fire");
		assert.equal(
			chaos.item.modifiers.some((modifier) => modifier.fractured),
			true,
		);
	} finally {
		db.close();
	}
});

test("Chaos removes before rolling, freeing the removed modifier family", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [
				{ name: "Old Life", generationType: "Prefix", families: ["IncreasedLife"] },
			],
		});
		const rolls = [0, 0.9];
		const result = chaosOrb.apply(
			db,
			item,
			createActionContext({ rng: () => rolls.shift() ?? 0 }),
		);
		assert.equal(result.removedModifiers?.[0]?.name, "Old Life");
		assert.equal(result.addedModifiers?.[0]?.familyKey, "IncreasedLife");
		assert.equal(result.item.modifiers.length, 1);
	} finally {
		db.close();
	}
});

test("Perfect Chaos enforces its replacement modifier-level floor", () => {
	const db = fixtureDatabase();
	try {
		db.prepare(
			`INSERT INTO modifiers(source_url,source_section,name,required_level,
			generation_type_id,generation_type,family_json,family_key,weight,modifier_html,
			modifier_text,crafting_tags_json,spawn_tags_json,excluded_tags_json,raw_json,
			last_import_run_id) VALUES ('https://poe2db.tw/us/Gloves_str','normal','Perfect Life',
			50,1,'Prefix','["PerfectLife"]','PerfectLife',1000,'','perfect','[]','[]','[]','{}',1)`,
		).run();
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [{ name: "Old", generationType: "Suffix", families: ["Old"] }],
		});
		const result = perfectChaosOrb.apply(db, item, createActionContext({ rng: () => 0 }));
		assert.equal(result.addedModifiers?.[0]?.name, "Perfect Life");
		assert.ok((result.addedModifiers?.[0]?.requiredLevel ?? 0) >= 50);
	} finally {
		db.close();
	}
});

test("Alchemy discards magic affixes and generates exactly four new modifiers", () => {
	const db = fixtureDatabase();
	try {
		db.prepare(
			`INSERT INTO modifiers(source_url,source_section,name,required_level,
			generation_type_id,generation_type,family_json,family_key,weight,modifier_html,
			modifier_text,crafting_tags_json,spawn_tags_json,excluded_tags_json,raw_json,
			last_import_run_id) VALUES ('https://poe2db.tw/us/Gloves_str','normal','of Wind',
			1,2,'Suffix','["Speed"]','Speed',500,'','speed','[]','[]','[]','{}',1)`,
		).run();
		const magic = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.MAGIC,
			modifiers: [
				{ name: "Discarded", generationType: "Prefix", families: ["DiscardedFamily"] },
			],
		});
		const result = orbOfAlchemy.apply(db, magic, createActionContext({ rng: () => 0 }));
		assert.equal(result.item.rarity, RARITIES.RARE);
		assert.equal(result.item.modifiers.length, 4);
		assert.equal(result.addedModifiers?.length, 4);
		assert.equal(
			result.item.modifiers.some((modifier) => modifier.name === "Discarded"),
			false,
		);
	} finally {
		db.close();
	}
});

test("Transmutation tiers upgrade normal items and enforce modifier-level floors", () => {
	const db = fixtureDatabase();
	try {
		const insert = db.prepare(`INSERT INTO modifiers(source_url,source_section,name,
			required_level,generation_type_id,generation_type,family_json,family_key,weight,
			modifier_html,modifier_text,crafting_tags_json,spawn_tags_json,excluded_tags_json,
			raw_json,last_import_run_id) VALUES ('https://poe2db.tw/us/Gloves_str','normal',
			?,?,1,'Prefix',?, ?,1000,'',?,'[]','[]','[]','{}',1)`);
		insert.run("Greater Tier", 44, '["GreaterTier"]', "GreaterTier", "greater");
		insert.run("Perfect Tier", 70, '["PerfectTier"]', "PerfectTier", "perfect");

		const level60 = createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.NORMAL });
		const normal = orbOfTransmutation.apply(db, level60, createActionContext({ rng: () => 0 }));
		assert.equal(normal.item.rarity, RARITIES.MAGIC);
		assert.ok((normal.addedModifiers?.[0]?.requiredLevel ?? 0) <= 60);

		const greater = greaterOrbOfTransmutation.apply(
			db,
			level60,
			createActionContext({ rng: () => 0 }),
		);
		assert.equal(greater.addedModifiers?.[0]?.name, "Greater Tier");
		assert.throws(() =>
			perfectOrbOfTransmutation.apply(db, level60, createActionContext({ rng: () => 0 })),
		);

		const level70 = createItem({ base: "Gloves_str", itemLevel: 70, rarity: RARITIES.NORMAL });
		const perfect = perfectOrbOfTransmutation.apply(
			db,
			level70,
			createActionContext({ rng: () => 0 }),
		);
		assert.equal(perfect.addedModifiers?.[0]?.name, "Perfect Tier");
	} finally {
		db.close();
	}
});

test("Greater Exaltation adds two sequentially eligible modifiers", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.RARE });
		const result = exaltedOrb.apply(
			db,
			item,
			createActionContext({ rng: () => 0, omens: [omenOfGreaterExaltation] }),
		);
		assert.equal(result.addedModifiers?.length, 2);
		assert.equal(result.item.modifiers.length, 2);
		assert.notEqual(
			result.addedModifiers?.[0]?.families[0],
			result.addedModifiers?.[1]?.families[0],
		);
		assert.deepEqual(result.consumedOmens, ["Omen of Greater Exaltation"]);
	} finally {
		db.close();
	}
});

test("named Exaltation Omens restrict additions to prefixes or suffixes", () => {
	const db = fixtureDatabase();
	try {
		const empty = createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.RARE });
		const prefix = exaltedOrb.apply(
			db,
			empty,
			createActionContext({ rng: () => 0, omens: [omenOfSinistralExaltation] }),
		);
		assert.equal(prefix.addedModifiers?.[0]?.generationType, "Prefix");
		const suffix = exaltedOrb.apply(
			db,
			empty,
			createActionContext({ rng: () => 0, omens: [omenOfDextralExaltation] }),
		);
		assert.equal(suffix.addedModifiers?.[0]?.generationType, "Suffix");
	} finally {
		db.close();
	}
});

test("named Annulment Omens restrict removal to prefixes or suffixes", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [
				{ name: "Hale", generationType: "Prefix", families: ["IncreasedLife"] },
				{ name: "of Fire", generationType: "Suffix", families: ["FireResistance"] },
			],
		});
		const prefixResult = orbOfAnnulment.apply(
			db,
			item,
			createActionContext({ rng: () => 0, omens: [omenOfSinistralAnnulment] }),
		);
		assert.equal(prefixResult.removedModifiers?.[0]?.generationType, "Prefix");
		const suffixResult = orbOfAnnulment.apply(
			db,
			item,
			createActionContext({ rng: () => 0, omens: [omenOfDextralAnnulment] }),
		);
		assert.equal(suffixResult.removedModifiers?.[0]?.generationType, "Suffix");
	} finally {
		db.close();
	}
});

test("Erasure Omens restrict removal for every Chaos Orb tier", () => {
	const db = fixtureDatabase();
	try {
		db.prepare(
			`UPDATE modifiers SET required_level = 50 WHERE name IN ('Hale', 'of Fire')`,
		).run();
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [
				{ name: "Old Prefix", generationType: "Prefix", families: ["OldPrefix"] },
				{ name: "Old Suffix", generationType: "Suffix", families: ["OldSuffix"] },
			],
		});
		for (const action of [chaosOrb, greaterChaosOrb, perfectChaosOrb]) {
			const prefixResult = action.apply(
				db,
				item,
				createActionContext({ rng: () => 0, omens: [omenOfSinistralErasure] }),
			);
			assert.equal(prefixResult.removedModifiers?.[0]?.generationType, "Prefix");
			assert.deepEqual(prefixResult.consumedOmens, ["Omen of Sinistral Erasure"]);

			const suffixResult = action.apply(
				db,
				item,
				createActionContext({ rng: () => 0, omens: [omenOfDextralErasure] }),
			);
			assert.equal(suffixResult.removedModifiers?.[0]?.generationType, "Suffix");
			assert.deepEqual(suffixResult.consumedOmens, ["Omen of Dextral Erasure"]);
		}
	} finally {
		db.close();
	}
});

test("Whittling removes the lowest-level modifier and composes with Erasure", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [
				{
					name: "Low Prefix",
					requiredLevel: 10,
					generationType: "Prefix",
					families: ["LowPrefix"],
				},
				{
					name: "High Prefix",
					requiredLevel: 40,
					generationType: "Prefix",
					families: ["HighPrefix"],
				},
				{
					name: "Lowest Suffix",
					requiredLevel: 1,
					generationType: "Suffix",
					families: ["LowestSuffix"],
				},
			],
		});
		const whittled = chaosOrb.apply(
			db,
			item,
			createActionContext({ rng: () => 0, omens: [omenOfWhittling] }),
		);
		assert.equal(whittled.removedModifiers?.[0]?.name, "Lowest Suffix");

		const stacked = chaosOrb.apply(
			db,
			item,
			createActionContext({
				rng: () => 0,
				omens: [omenOfWhittling, omenOfSinistralErasure],
			}),
		);
		assert.equal(stacked.removedModifiers?.[0]?.name, "Low Prefix");
		assert.deepEqual(stacked.consumedOmens, ["Omen of Sinistral Erasure", "Omen of Whittling"]);
	} finally {
		db.close();
	}
});

test("simulation reports are deterministic and aggregate every run", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.RARE });
		const first = runSimulation(db, exaltedOrb, item, { runs: 100, seed: 42 });
		const second = runSimulation(db, exaltedOrb, item, { runs: 100, seed: 42 });
		assert.deepEqual(first, second);
		assert.equal(
			Object.values(first.addedModifiers).reduce((sum, count) => sum + count, 0),
			100,
		);
		assert.equal(
			Object.values(first.resultingAffixCounts).reduce((sum, count) => sum + count, 0),
			100,
		);
	} finally {
		db.close();
	}
});
