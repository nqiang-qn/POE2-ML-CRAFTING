/** Checks source modules and public declarations for required documentation. */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import console from "node:console";
import process from "node:process";
import ts from "typescript";

const ROOTS = ["packages", "experiments", "scripts", "tests"];

function filesBelow(path) {
	return readdirSync(path).flatMap((name) => {
		const child = join(path, name);
		return statSync(child).isDirectory() ? filesBelow(child) : [child];
	});
}

function hasLeadingDocumentation(source, node) {
	const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? [];
	return ranges.some((range) => source.text.slice(range.pos, range.end).startsWith("/**"));
}

function isExported(node) {
	return (
		node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
	);
}

function declarationName(node) {
	if ("name" in node && node.name && ts.isIdentifier(node.name)) return node.name.text;
	if (ts.isVariableStatement(node)) {
		return node.declarationList.declarations
			.map((declaration) => declaration.name.getText())
			.join(", ");
	}
	return ts.SyntaxKind[node.kind];
}

function checkTypeScript(path, failures) {
	const text = readFileSync(path, "utf8");
	if (!text.trimStart().startsWith("/**")) failures.push(`${path}: missing module description`);
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	for (const statement of source.statements) {
		if (
			isExported(statement) &&
			!ts.isExportDeclaration(statement) &&
			!hasLeadingDocumentation(source, statement)
		) {
			failures.push(`${path}: exported ${declarationName(statement)} lacks TSDoc`);
		}
	}
}

function checkPython(path, failures) {
	const lines = readFileSync(path, "utf8").split(/\r?\n/);
	const first = lines.find((line) => line.trim());
	if (!first?.trimStart().startsWith('"""')) failures.push(`${path}: missing module docstring`);
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^(def|class) ([A-Za-z][A-Za-z0-9_]*)/.exec(lines[index] ?? "");
		if (!match || match[2]?.startsWith("_")) continue;
		let next = index;
		while (next < lines.length && !(lines[next] ?? "").trimEnd().endsWith(":")) next += 1;
		next += 1;
		while (next < lines.length && !(lines[next] ?? "").trim()) next += 1;
		if (!(lines[next] ?? "").trimStart().startsWith('"""')) {
			failures.push(`${path}:${index + 1}: public ${match[1]} ${match[2]} lacks docstring`);
		}
	}
}

const failures = [];
for (const root of ROOTS) {
	for (const path of filesBelow(root)) {
		const parts = path.split(/[\\/]/);
		if (parts.includes("dist") || parts.includes("__pycache__")) continue;
		if (extname(path) === ".ts") checkTypeScript(path, failures);
		else if (extname(path) === ".py") checkPython(path, failures);
	}
}
if (failures.length) {
	console.error(failures.map((failure) => `- ${relative(".", failure)}`).join("\n"));
	process.exitCode = 1;
} else {
	console.log("Source documentation checks passed");
}
