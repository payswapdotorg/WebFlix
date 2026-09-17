/**
 * TEST-DATA GENERATOR (R11) — regenerate the committed fixture .torrent
 * files under tests/fixtures/.
 *
 * Run: `cd packages/torrent-engine && bun tests/fixtures/generate.ts`
 *
 * Determinism: the generator derives everything from the specs in
 * tests/helpers/fixtures.ts (seeded PRNG content, fixed bencode key
 * order). Regeneration is byte-stable — fixtures.test.ts asserts the
 * committed files match a fresh derivation, so drift is caught by the
 * suite. The generator is TEST SUPPORT ONLY (never imported by src/ —
 * the import-guard test enforces it).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { ALL_FIXTURES, fixtureTorrentBytes } from "../helpers/fixtures";

const OUT_DIR = import.meta.dir;

mkdirSync(OUT_DIR, { recursive: true });
for (const spec of ALL_FIXTURES) {
  const bytes = fixtureTorrentBytes(spec);
  const target = join(OUT_DIR, `${spec.key}.torrent`);
  writeFileSync(target, bytes);
  console.log(
    `wrote ${target} (${bytes.byteLength} bytes, ${spec.files.length} file(s), pieceLength ${spec.pieceLengthBytes})`,
  );
}
console.log("fixture regeneration complete (deterministic — byte-stable)");
