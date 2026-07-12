import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["node_modules/**", "packages/*/dist/**", "tests/dist/**", "data/**"],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.ts"],
		rules: {
			"@typescript-eslint/consistent-type-imports": "error",
			"@typescript-eslint/no-import-type-side-effects": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
			],
		},
	},
);
