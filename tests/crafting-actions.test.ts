/** Unit and integration tests for crafting mechanics and graph discovery. */

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createItem, RARITIES } from "@poe2craft/domain";
import { importPoeNinjaOverview, type PoeNinjaOverview } from "@poe2craft/data";
import {
	applyOrbOfAugmentation,
	availableCraftingActions,
	canApplyOrbOfAugmentation,
	chaosOrb,
	craftingActions,
	createActionContext,
	createCraftingTarget,
	craftingStateKey,
	createMarketCostModel,
	discoverReachableStateGraph,
	encodeCraftingState,
	enumerateExactActionOutcomes,
	exaltedOrb,
	essenceActions,
	fracturingOrb,
	greaterOrbOfTransmutation,
	isTargetSatisfied,
	greaterChaosOrb,
	perfectChaosOrb,
	omenOfDextralAnnulment,
	omenOfDextralExaltation,
	omenOfDextralErasure,
	omenOfDextralCrystallisation,
	omenOfGreaterExaltation,
	omenOfSinistralAnnulment,
	omenOfSinistralExaltation,
	omenOfSinistralErasure,
	omenOfSinistralCrystallisation,
	omenOfWhittling,
	orbOfAlchemy,
	orbOfAnnulment,
	orbOfTransmutation,
	perfectOrbOfTransmutation,
	regalOrb,
	runSimulation,
	sampleTransition,
	selectWeighted,
	serializeTransitionArtifact,
	serializeReachableStateGraph,
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
			"fracturing-orb",
			...essenceActions.map((action) => action.id),
		],
	);
});

test("Greater Essence upgrades to rare and creates one crafted modifier", () => {
	const db = fixtureDatabase();
	try {
		db.prepare(
			`INSERT INTO modifiers(source_url,source_section,name,required_level,
			generation_type_id,generation_type,family_json,family_key,weight,modifier_html,
			modifier_text,crafting_tags_json,spawn_tags_json,excluded_tags_json,raw_json,
			last_import_run_id) VALUES ('https://poe2db.tw/us/Gloves_str','essence',
			'<a href="Greater_Essence_of_the_Body">Greater Essence of the Body</a>',
			40,1,'Prefix','["EssenceLife"]','EssenceLife',0,'','+80 to maximum Life',
			'[]','[]','[]','{}',1)`,
		).run();
		const action = craftingActions.get("greater-essence-of-the-body");
		assert.ok(action);
		const item = createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.MAGIC });
		const result = action.apply(db, item, createActionContext({ rng: () => 0 }));
		assert.equal(result.item.rarity, RARITIES.RARE);
		assert.equal(result.addedModifiers?.[0]?.crafted, true);
		assert.equal(result.item.modifiers.filter((modifier) => modifier.crafted).length, 1);
		assert.equal(action.canApply(result.item), false);
	} finally {
		db.close();
	}
});

test("Perfect Essence replaces a removable modifier with one crafted modifier", () => {
	const db = fixtureDatabase();
	try {
		db.prepare(
			`INSERT INTO modifiers(source_url,source_section,name,required_level,
			generation_type_id,generation_type,family_json,family_key,weight,modifier_html,
			modifier_text,crafting_tags_json,spawn_tags_json,excluded_tags_json,raw_json,
			last_import_run_id) VALUES ('https://poe2db.tw/us/Gloves_str','essence',
			'<a href="Perfect_Essence_of_the_Body">Perfect Essence of the Body</a>',
			50,1,'Prefix','["EssenceLife"]','EssenceLife',0,'','8% increased maximum Life',
			'[]','[]','[]','{}',1)`,
		).run();
		const action = craftingActions.get("perfect-essence-of-the-body");
		assert.ok(action);
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [
				{ name: "Old Prefix", generationType: "Prefix", families: ["OldPrefix"] },
				{ name: "Old Suffix", generationType: "Suffix", families: ["OldSuffix"] },
			],
		});
		const result = action.apply(db, item, createActionContext({ rng: () => 0 }));
		assert.equal(result.removedModifiers?.[0]?.name, "Old Prefix");
		assert.equal(result.addedModifiers?.[0]?.crafted, true);
		assert.equal(result.item.modifiers.filter((modifier) => modifier.crafted).length, 1);
	} finally {
		db.close();
	}
});

test("Crystallisation Omens restrict Perfect Essence removal by affix type", () => {
	const db = fixtureDatabase();
	try {
		db.prepare(
			`INSERT INTO modifiers(source_url,source_section,name,required_level,
			generation_type_id,generation_type,family_json,family_key,weight,modifier_html,
			modifier_text,crafting_tags_json,spawn_tags_json,excluded_tags_json,raw_json,
			last_import_run_id) VALUES ('https://poe2db.tw/us/Gloves_str','essence',
			'<a href="Perfect_Essence_of_the_Body">Perfect Essence of the Body</a>',
			50,1,'Prefix','["EssenceLife"]','EssenceLife',0,'','8% increased maximum Life',
			'[]','[]','[]','{}',1)`,
		).run();
		const action = craftingActions.get("perfect-essence-of-the-body");
		assert.ok(action);
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [
				{ name: "Old Prefix", generationType: "Prefix", families: ["OldPrefix"] },
				{ name: "Old Suffix", generationType: "Suffix", families: ["OldSuffix"] },
			],
		});
		const prefixResult = action.apply(
			db,
			item,
			createActionContext({ rng: () => 0, omens: [omenOfSinistralCrystallisation] }),
		);
		assert.equal(prefixResult.removedModifiers?.[0]?.generationType, "Prefix");
		assert.deepEqual(prefixResult.consumedOmens, ["Omen of Sinistral Crystallisation"]);

		const suffixResult = action.apply(
			db,
			item,
			createActionContext({ rng: () => 0, omens: [omenOfDextralCrystallisation] }),
		);
		assert.equal(suffixResult.removedModifiers?.[0]?.generationType, "Suffix");
		assert.deepEqual(suffixResult.consumedOmens, ["Omen of Dextral Crystallisation"]);
	} finally {
		db.close();
	}
});

test("Crystallisation Omens do not apply to Greater Essences", () => {
	const omenInput = {
		actionName: "Greater Essence of the Body",
		item: createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.MAGIC }),
	};
	assert.equal(omenOfSinistralCrystallisation.appliesTo(omenInput), false);
	assert.equal(omenOfDextralCrystallisation.appliesTo(omenInput), false);
});

test("item construction rejects more than one crafted modifier", () => {
	assert.throws(
		() =>
			createItem({
				base: "Gloves_str",
				itemLevel: 60,
				rarity: RARITIES.RARE,
				modifiers: [
					{
						name: "Craft One",
						generationType: "Prefix",
						families: ["One"],
						crafted: true,
					},
					{
						name: "Craft Two",
						generationType: "Suffix",
						families: ["Two"],
						crafted: true,
					},
				],
			}),
		/one crafted modifier/,
	);
});

test("available actions include only Essences mapped for the item class", () => {
	const db = fixtureDatabase();
	try {
		db.prepare(
			`INSERT INTO essence_modifiers(source_url,essence_slug,essence_name,tier,
			item_class_slug,item_class_name,modifier_html,modifier_text,generation_type,
			required_level,last_import_run_id) VALUES
			('https://poe2db.tw/us/Greater_Essence_of_the_Body',
			'Greater_Essence_of_the_Body','Greater Essence of the Body','Greater',
			'Gloves','Gloves','+85 Life','+85 Life','Prefix',36,1)`,
		).run();
		const item = createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.MAGIC });
		const ids = availableCraftingActions(db, item).map((action) => action.id);
		assert.ok(ids.includes("greater-essence-of-the-body"));
		assert.equal(ids.includes("greater-essence-of-abrasion"), false);
	} finally {
		db.close();
	}
});

test("Perfect Essence removes from its required affix side when that side is full", () => {
	const db = fixtureDatabase();
	try {
		db.prepare(
			`INSERT INTO essence_modifiers(source_url,essence_slug,essence_name,tier,
			item_class_slug,item_class_name,modifier_html,modifier_text,generation_type,
			required_level,last_import_run_id) VALUES
			('https://poe2db.tw/us/Perfect_Essence_of_Grounding',
			'Perfect_Essence_of_Grounding','Perfect Essence of Grounding','Perfect',
			'Gloves','Gloves','recoup','Lightning recoup','Suffix',60,1)`,
		).run();
		const action = craftingActions.get("perfect-essence-of-grounding");
		assert.ok(action);
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 80,
			rarity: RARITIES.RARE,
			modifiers: [
				{ name: "Prefix", generationType: "Prefix", families: ["Prefix"] },
				{ name: "Suffix One", generationType: "Suffix", families: ["SuffixOne"] },
				{ name: "Suffix Two", generationType: "Suffix", families: ["SuffixTwo"] },
				{ name: "Suffix Three", generationType: "Suffix", families: ["SuffixThree"] },
			],
		});
		const result = action.apply(db, item, createActionContext({ rng: () => 0 }));
		assert.equal(result.removedModifiers?.[0]?.generationType, "Suffix");
		assert.equal(result.addedModifiers?.[0]?.generationType, "Suffix");
	} finally {
		db.close();
	}
});

test("Fracturing Orb locks a random eligible modifier", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [
				{ name: "Life", generationType: "Prefix", families: ["Life"] },
				{
					name: "Desecrated",
					generationType: "Prefix",
					families: ["Desecrated"],
					sourceSection: "desecrated",
				},
				{ name: "Fire", generationType: "Suffix", families: ["Fire"] },
				{ name: "Cold", generationType: "Suffix", families: ["Cold"] },
			],
		});
		const result = fracturingOrb.apply(db, item, createActionContext({ rng: () => 0 }));
		assert.equal(result.fracturedModifiers?.[0]?.name, "Life");
		assert.equal(result.item.modifiers[0]?.fractured, true);
		assert.equal(item.modifiers[0]?.fractured, undefined);
		assert.equal(fracturingOrb.canApply(result.item), false);
	} finally {
		db.close();
	}
});

test("Fracturing Orb requires an unfractured rare item with four modifiers", () => {
	const item = createItem({
		base: "Gloves_str",
		itemLevel: 60,
		rarity: RARITIES.RARE,
		modifiers: [
			{ name: "One", generationType: "Prefix", families: ["One"] },
			{ name: "Two", generationType: "Prefix", families: ["Two"] },
			{ name: "Three", generationType: "Suffix", families: ["Three"] },
		],
	});
	assert.equal(fracturingOrb.canApply(item), false);
});

test("simulation reports Fracturing Orb outcome frequencies", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [
				{ name: "One", generationType: "Prefix", families: ["One"] },
				{ name: "Two", generationType: "Prefix", families: ["Two"] },
				{ name: "Three", generationType: "Suffix", families: ["Three"] },
				{ name: "Four", generationType: "Suffix", families: ["Four"] },
			],
		});
		const report = runSimulation(db, fracturingOrb, item, { runs: 20, seed: 42 });
		assert.equal(
			Object.values(report.fracturedModifiers).reduce((sum, count) => sum + count, 0),
			20,
		);
	} finally {
		db.close();
	}
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

test("Chaos outcomes are enumerated exactly from removal and modifier weights", () => {
	const db = fixtureDatabase();
	try {
		const item = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.RARE,
			modifiers: [
				{
					name: "Existing",
					requiredLevel: 1,
					generationType: "Prefix",
					families: ["ExistingFamily"],
					familyKey: "ExistingFamily",
				},
			],
		});
		const outcomes = enumerateExactActionOutcomes(
			db,
			item,
			chaosOrb,
			createActionContext({
				rng: () => {
					throw new Error("Exact enumeration must not consume RNG");
				},
			}),
		);
		assert.ok(outcomes);
		assert.ok(outcomes.length > 1);
		assert.ok(
			Math.abs(outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) < 1e-12,
		);
		assert.ok(outcomes.some((outcome) => outcome.item.modifiers[0]?.name === "Hale"));
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

test("target-relative state encoding preserves optimizer-relevant features", () => {
	const target = createCraftingTarget({
		id: "life-and-resistance",
		modifiers: [
			{ id: "life", families: ["IncreasedLife"] },
			{ id: "elemental-resistance", families: ["FireResistance", "ColdResistance"] },
		],
	});
	const item = createItem({
		base: "Gloves_str",
		itemLevel: 80,
		rarity: RARITIES.RARE,
		modifiers: [
			{
				name: "Life",
				generationType: "Prefix",
				families: ["IncreasedLife"],
				familyKey: "IncreasedLife",
				fractured: true,
			},
			{
				name: "Fire",
				generationType: "Suffix",
				families: ["FireResistance"],
				crafted: true,
			},
		],
	});
	const state = encodeCraftingState(item, target);
	assert.deepEqual(state.targetPresence, [true, true]);
	assert.equal(state.prefixCount, 1);
	assert.equal(state.suffixCount, 1);
	assert.equal(state.openPrefixCount, 2);
	assert.equal(state.openSuffixCount, 2);
	assert.equal(state.craftedModifierPresent, true);
	assert.deepEqual(state.fracturedModifierIds, ["IncreasedLife"]);
	assert.deepEqual(state.modifierStateIds, [
		'["Prefix","IncreasedLife",["IncreasedLife"],null,true,true,false,true,null]',
		'["Suffix",null,["FireResistance"],null,false,true,true,true,null]',
	]);
	assert.equal(isTargetSatisfied(item, target), true);
	assert.equal(
		craftingStateKey(state),
		'v2|life-and-resistance|rare|11|1P/1S|2OP/2OS|C1|F:IncreasedLife|M:["Prefix","IncreasedLife",["IncreasedLife"],null,true,true,false,true,null],["Suffix",null,["FireResistance"],null,false,true,true,true,null]',
	);
});

test("crafting targets reject duplicate feature identifiers", () => {
	assert.throws(
		() =>
			createCraftingTarget({
				id: "invalid",
				modifiers: [
					{ id: "life", families: ["Life"] },
					{ id: "life", families: ["OtherLife"] },
				],
			}),
		/Duplicate target modifier ID/,
	);
});

test("transition sampling is deterministic and probabilities sum to one", () => {
	const db = fixtureDatabase();
	try {
		const target = createCraftingTarget({
			id: "life",
			modifiers: [{ id: "life", families: ["IncreasedLife"] }],
		});
		const item = createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.RARE });
		const first = sampleTransition(db, item, target, exaltedOrb, {
			samples: 100,
			seed: 42,
		});
		const second = sampleTransition(db, item, target, exaltedOrb, {
			samples: 100,
			seed: 42,
		});
		assert.deepEqual(first, second);
		assert.equal(
			first.outcomes.reduce((sum, outcome) => sum + outcome.count, 0),
			100,
		);
		assert.ok(
			Math.abs(first.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) <
				Number.EPSILON,
		);
		assert.equal(serializeTransitionArtifact(first), serializeTransitionArtifact(second));
		assert.equal(first.inputStateKey, "v2|life|rare|0|0P/0S|3OP/3OS|C0|F:|M:");
		assert.equal(first.dataSources[0]?.url, "https://poe2db.tw/us/Gloves_str");
	} finally {
		db.close();
	}
});

test("transition sampling rejects unavailable actions", () => {
	const db = fixtureDatabase();
	try {
		const target = createCraftingTarget({ id: "empty", modifiers: [] });
		const normal = createItem({
			base: "Gloves_str",
			itemLevel: 60,
			rarity: RARITIES.NORMAL,
		});
		assert.throws(
			() => sampleTransition(db, normal, target, exaltedOrb, { samples: 1, seed: 1 }),
			/cannot apply/,
		);
	} finally {
		db.close();
	}
});

test("reachable-state discovery is bounded, deterministic, and collision-free", () => {
	const db = fixtureDatabase();
	try {
		const target = createCraftingTarget({
			id: "life",
			modifiers: [{ id: "life", families: ["IncreasedLife"] }],
		});
		const item = createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.RARE });
		const options = {
			samplesPerAction: 100,
			seed: 42,
			maxStates: 10,
			maxDepth: 1,
			actionIds: ["exalted-orb"],
		};
		const first = discoverReachableStateGraph(db, item, target, options);
		const second = discoverReachableStateGraph(db, item, target, options);
		assert.deepEqual(first, second);
		assert.equal(first.transitions.length, 1);
		assert.equal(
			first.transitions[0]?.outcomes.reduce((sum, outcome) => sum + (outcome.count ?? 0), 0),
			100,
		);
		assert.ok(first.states.some((state) => state.terminal));
		assert.ok(first.frontierStateKeys.length > 0);
		assert.equal(first.truncated, true);
		assert.equal(first.collisions.length, 0);
		assert.equal(serializeReachableStateGraph(first), serializeReachableStateGraph(second));
	} finally {
		db.close();
	}
});

test("reachable graphs pin one stored league snapshot and price Omen variants", () => {
	const db = fixtureDatabase();
	try {
		const capturedAt = "2026-07-13T12:00:00.000Z";
		const overview: PoeNinjaOverview = {
			core: { primary: "exalted", secondary: "chaos", rates: {} },
			items: [
				{
					id: "exalted",
					name: "Exalted Orb",
					detailsId: "exalted-orb",
					category: "Currency",
				},
				{
					id: "omen",
					name: "Omen of Sinistral Exaltation",
					detailsId: "omen-of-sinistral-exaltation",
					category: "Ritual",
				},
			],
			lines: [
				{ id: "exalted", primaryValue: 1, volumePrimaryValue: 100 },
				{ id: "omen", primaryValue: 5, volumePrimaryValue: 10 },
			],
		};
		importPoeNinjaOverview(
			db,
			"Test League",
			"Currency",
			"https://poe.ninja/test",
			capturedAt,
			overview,
		);
		const costModel = createMarketCostModel(db, {
			league: "Test League",
			capturedAt,
		});
		assert.equal(costModel.quote("exalted-orb").totalExalted, 1);
		assert.equal(costModel.quote("exalted-orb", ["sinistral-exaltation"]).totalExalted, 6);

		const graph = discoverReachableStateGraph(
			db,
			createItem({ base: "Gloves_str", itemLevel: 60, rarity: RARITIES.RARE }),
			createCraftingTarget({
				id: "life",
				modifiers: [{ id: "life", families: ["IncreasedLife"] }],
			}),
			{
				samplesPerAction: 2,
				seed: 42,
				maxStates: 10,
				maxDepth: 1,
				actionIds: ["exalted-orb"],
				omenIds: ["sinistral-exaltation"],
				market: { league: "Test League", capturedAt },
			},
		);
		assert.deepEqual(graph.marketSnapshot, { league: "Test League", capturedAt });
		assert.deepEqual(
			graph.transitions.map(({ variantId, cost }) => [variantId, cost?.totalExalted]),
			[
				["exalted-orb", 1],
				["exalted-orb+sinistral-exaltation", 6],
			],
		);
	} finally {
		db.close();
	}
});
