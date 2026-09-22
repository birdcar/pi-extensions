import js from "@eslint/js";
import tseslint from "typescript-eslint";

const bunImportMessage = "Production packages must not import or re-export Bun modules.";
const bunGlobalMessage = "Production packages must not use the Bun global.";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
      ".pi-tests/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["packages/*/src/**/*.ts", "tests/pi/**/*.ts", "tests/fixtures/services/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", { name: "Bun", message: bunGlobalMessage }],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "bun", message: bunImportMessage },
            { name: "bun:test", message: bunImportMessage },
            { name: "bun:sqlite", message: bunImportMessage },
          ],
          patterns: [{ group: ["bun", "bun:*"], message: bunImportMessage }],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression > Literal[value=/^bun(:.*)?$/]",
          message: bunImportMessage,
        },
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/^bun(:.*)?$/]",
          message: bunImportMessage,
        },
      ],
    },
  },
);
