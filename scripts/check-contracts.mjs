#!/usr/bin/env node
/**
 * WebFlix contract drift checker (WFX-001, lead-owned).
 *
 * The frozen source of truth for shared contracts is
 * docs/architecture/contracts.md. This script:
 *   1. extracts every ```ts fenced block together with its section name,
 *   2. regenerates packages/domain/src/contracts/frozen.ts verbatim
 *      (plus one managed import line for lane-owned extension types),
 *   3. fails when the committed file differs from the regeneration
 *      (drift: someone edited the generated file OR the doc),
 *   4. fails when referenced-but-undefined extension types are missing.
 *
 * Workers never edit frozen.ts. Contract changes go through the lead,
 * who edits contracts.md and re-runs this script.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docPath = join(root, "docs/architecture/contracts.md");
const frozenDir = join(root, "packages/domain/src/contracts");
const frozenPath = join(frozenDir, "frozen.ts");
const extPath = join(frozenDir, "extensions.ts");

const doc = readFileSync(docPath, "utf8");

// --- extract sections and ts blocks --------------------------------------
const lines = doc.split("\n");
const blocks = [];
let section = "";
let inBlock = false;
let current = [];
for (const line of lines) {
  const heading = line.match(/^(#{1,3})\s+(.*)$/);
  if (heading) section = heading[2].trim();
  if (!inBlock && line.trim() === "```ts") {
    inBlock = true;
    current = [];
    continue;
  }
  if (inBlock && line.trim() === "```") {
    inBlock = false;
    blocks.push({ section, code: current.join("\n") });
    continue;
  }
  if (inBlock) current.push(line);
}

if (blocks.length === 0) {
  console.error("contract-check: no ```ts blocks found in contracts.md");
  process.exit(1);
}

// --- names referenced by frozen blocks but defined by lane extensions ----
const EXTENSION_NAMES = [
  "SearchResult", "SourceItem", "UserAction", "ActionReceipt",
  "LibraryEntry", "LibraryCommand", "EntertainmentCandidate",
];

const header = `// GENERATED from docs/architecture/contracts.md by scripts/check-contracts.mjs
// DO NOT EDIT. Contract changes are lead-owned: edit the doc, then run \`bun run contract-check -- --write\`.
// eslint-disable-next-line
import type { ${EXTENSION_NAMES.join(", ")} } from "./extensions";
`;

const body = blocks
  .map((b) => `// ===== section: ${b.section} =====\n${b.code}`)
  .join("\n\n");

const regenerated = `${header}\n${body}\n`;

if (!existsSync(frozenDir)) mkdirSync(frozenDir, { recursive: true });

if (process.argv.includes("--write")) {
  writeFileSync(frozenPath, regenerated);
  console.log(`contract-check: regenerated ${frozenPath} (${blocks.length} blocks)`);
  process.exit(0);
}

// --- drift check ----------------------------------------------------------
if (!existsSync(frozenPath)) {
  console.error(
    `contract-check: ${frozenPath} is missing. Run \`bun run contract-check -- --write\` once.`,
  );
  process.exit(1);
}
const committed = readFileSync(frozenPath, "utf8");
if (committed !== regenerated) {
  console.error(
    "contract-check: DRIFT detected between docs/architecture/contracts.md and packages/domain/src/contracts/frozen.ts\n" +
      "  - If the DOC changed (lead action): re-run with --write and commit both.\n" +
      "  - If frozen.ts was hand-edited (worker action): revert it; workers may not edit frozen contracts.",
  );
  process.exit(1);
}

// --- extension types present ---------------------------------------------
if (!existsSync(extPath)) {
  console.error(`contract-check: missing ${extPath} (lane-owned extension types).`);
  process.exit(1);
}
const ext = readFileSync(extPath, "utf8");
for (const name of EXTENSION_NAMES) {
  if (!new RegExp(`(interface|type)\\s+${name}\\b`).test(ext)) {
    console.error(`contract-check: extension type ${name} missing from extensions.ts`);
    process.exit(1);
  }
}

console.log(
  `contract-check: OK — ${blocks.length} frozen blocks in sync, ${EXTENSION_NAMES.length} extension types present.`,
);
