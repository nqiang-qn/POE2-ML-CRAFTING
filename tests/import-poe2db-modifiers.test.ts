/** Tests for PoE2DB modifier and Essence extraction into SQLite. */

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { isInitialCraftingSection, queryModifiers } from "@poe2craft/data";
import {
	extractEssencePage,
	extractModsView,
	htmlToText,
	importEssencePage,
	importPage,
	modifierRecords,
} from "@poe2craft/poe2db-importer";

const ESSENCE_SAMPLE = `<meta property="og:title" content="Greater Essence of the Body" />
<table><thead><tr><th>Class</th><th>Modifier</th><th>Pre/Suf</th><th>Required Level</th></tr></thead>
<tbody><tr><td><a class="ItemClasses" href="Gloves">Gloves</a></td>
<td><span>+(85<span class="ndash">—</span>99)</span> to maximum Life</td><td>Prefix</td><td>36</td></tr></tbody></table>`;

const SAMPLE = `<script>new ModsView({"gen":{"1":"Prefix","2":"Suffix"},"opt":{"ItemClassesCode":"Gloves","ItemClassesID":12,"tags":"str_armour"},"normal":[{"Name":"Hale","Level":"1","ModGenerationTypeID":"1","ModFamilyList":["IncreasedLife"],"DropChance":"1000","str":"<span>+(10<span>—</span>19)</span> to maximum Life","fossil_no":["life"],"adds_no":[],"spawn_no":["gloves"]}]});</script>`;

test("extracts and imports modifier weights idempotently", () => {
	const view = extractModsView(SAMPLE);
	assert.equal((view.opt as Record<string, unknown>).ItemClassesCode, "Gloves");
	assert.equal([...modifierRecords(view)][0]?.[1].DropChance, "1000");
	assert.equal(htmlToText("<span>+(10<span>—</span>19)</span> Life"), "+(10—19) Life");
	const db = new DatabaseSync(":memory:");
	try {
		assert.equal(importPage(db, "https://poe2db.tw/us/Gloves_str", SAMPLE), 1);
		assert.equal(importPage(db, "https://poe2db.tw/us/Gloves_str", SAMPLE), 1);
		assert.equal((db.prepare("SELECT COUNT(*) n FROM modifiers").get() as { n: number }).n, 1);
	} finally {
		db.close();
	}
});

test("extracts and imports Essence item-class mappings idempotently", () => {
	const url = "https://poe2db.tw/us/Greater_Essence_of_the_Body";
	const page = extractEssencePage(url, ESSENCE_SAMPLE);
	assert.equal(page.slug, "Greater_Essence_of_the_Body");
	assert.equal(page.modifiers[0]?.itemClassSlug, "Gloves");
	assert.equal(page.modifiers[0]?.modifierText, "+(85—99) to maximum Life");
	const db = new DatabaseSync(":memory:");
	try {
		assert.equal(importEssencePage(db, url, ESSENCE_SAMPLE), 1);
		assert.equal(importEssencePage(db, url, ESSENCE_SAMPLE), 1);
		assert.equal(
			(db.prepare("SELECT COUNT(*) n FROM essence_modifiers").get() as { n: number }).n,
			1,
		);
	} finally {
		db.close();
	}
});

test("ordinary queries enforce eligibility and preserve special records", () => {
	assert.equal(isInitialCraftingSection("normal"), true);
	assert.equal(isInitialCraftingSection("bonded"), false);
	assert.equal(isInitialCraftingSection("orb_of_sacrifice"), false);
	const db = new DatabaseSync(":memory:");
	try {
		importPage(db, "https://poe2db.tw/us/Gloves_str", SAMPLE);
		const rows = queryModifiers(db, {
			base: "Gloves_str",
			action: "ordinary",
			itemLevel: 60,
			generation: "Prefix",
			probabilities: true,
		});
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.probability, 1);
		assert.equal(
			queryModifiers(db, {
				base: "Gloves_str",
				action: "ordinary",
				itemLevel: 60,
				existingFamilies: ["IncreasedLife"],
			}).length,
			0,
		);
	} finally {
		db.close();
	}
});
