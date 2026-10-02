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
  {
    // WFX-050: Next.js hosting artifacts — the generated tsconfig shim and
    // the build output (at any workspace depth) are never lint targets.
    // evidence/** — archived recon/journey evidence packets (rNN convention: committed
  // probe scripts + manifests + screenshots). The r28/r29 recon probes carry `any`
  // types by design (frozen historical evidence; the R29 ledger escalated this as
  // "lint debt" for the lead). They are artifacts, never build inputs: nothing under
  // evidence/ is imported by app/packages/journeys code (lane-check enforces the
  // boundary). Closing the debt by scoping lint to the living trees.
  ignores: ["node_modules/**", "dist/**", "**/.next/**", "apps/web/next-env.d.ts", "evidence/**"],
  },
];
