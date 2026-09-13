import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "warn",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { sourceType: "module" },
  },
  {
    files: ["**/*.test.ts", "tests/**"],
    rules: { "no-console": "off" },
  },
  { ignores: ["node_modules/**", "dist/**", ".next/**"] },
];
