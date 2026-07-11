import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createItem, RARITIES } from "@poe2craft/domain";
import {
	applyOrbOfAugmentation,
	canApplyOrbOfAugmentation,
	craftingActions,
	createActionContext,
	exaltedOrb,
	orbOfAnnulment,
	regalOrb,
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

test("action registry exposes the four implemented currencies", () => {
	assert.deepEqual(
		[...craftingActions.keys()],
		["orb-of-augmentation", "regal-orb", "exalted-orb", "orb-of-annulment"],
	);
});
