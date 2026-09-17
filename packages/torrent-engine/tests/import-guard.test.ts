/**
 * R11 — the import guard (the boundary law).
 *
 * The adapter (src/adapter.ts) is the ONLY module in
 * `packages/torrent-engine/src/` that imports from `@wfx/native-media`.
 * Every OTHER module must NOT import from `@wfx/native-media` — the
 * native-media surface is unreachable from torrent-engine outside the
 * adapter. This test enforces the boundary LINT-VISIBLY, mirroring the
 * R10 production-import-guard pattern.
 *
 * The lane checker (scripts/check-lanes.mjs) enforces the cross-package
 * import law (no deep paths, only public entries); this test enforces
 * the torrent-engine-LOCAL boundary law.
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

/** Every .ts file under src/ (recursive). */
function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) {
      out.push(...tsFilesUnder(path));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

/** The forbidden native-media import specifiers (the boundary law). */
const FORBIDDEN_NATIVE_MEDIA = [
  "@wfx/native-media",
];

/** The adapter (the ONLY module permitted to import from native-media). */
const ADAPTER_PATH = join(SRC, "adapter.ts");

describe("R11 — the import guard (the native-media boundary law)", () => {
  it("src/ exists and contains .ts files", () => {
    const files = tsFilesUnder(SRC);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain(ADAPTER_PATH);
  });

  it("the adapter imports from @wfx/native-media (the seam is real)", () => {
    const source = readFileSync(ADAPTER_PATH, "utf8");
    expect(source).toContain('from "@wfx/native-media"');
  });

  it("NO non-adapter module imports from @wfx/native-media (the boundary)", () => {
    const files = tsFilesUnder(SRC);
    const violations: string[] = [];
    for (const file of files) {
      if (file === ADAPTER_PATH) continue;
      const source = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN_NATIVE_MEDIA) {
        if (source.includes(`from "${forbidden}"`) || source.includes(`from '${forbidden}'`)) {
          violations.push(`${file}: imports "${forbidden}"`);
        }
        // Deep-path escapes to native-media (the lane checker also enforces
        // this; this test is the torrent-engine-LOCAL mirror).
        if (/from\s+["']@wfx\/native-media\/[^"']+["']/.test(source)) {
          violations.push(`${file}: imports a native-media deep path`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the package entry exports the adapter (the seam is reachable)", () => {
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    expect(index).toContain("./adapter");
  });

  it("NO module imports the loopback backend from outside the engine/tests", () => {
    // The loopback backend is the TEST/DEV default; production code paths
    // must not import it directly (the production backend is injected
    // through createTorrentEngine's options.backend). This test enforces
    // that the loopback is only imported by the engine + tests.
    const files = tsFilesUnder(SRC);
    const violations: string[] = [];
    for (const file of files) {
      // The backend.ts file DEFINES the loopback — it is the only place
      // that mentions it (other than engine.ts which uses the backend
      // interface, not the loopback class directly).
      const basename = file.split("/").pop();
      // backend.ts: defines the loopback (allowed).
      // index.ts: re-exports the backend module (the public surface; allowed).
      // engine.ts: consumes the BitTorrentBackend interface (allowed —
      //   the loopback class is not imported, only the interface is used).
      if (basename === "backend.ts" || basename === "index.ts" || basename === "engine.ts") {
        continue;
      }
      const source = readFileSync(file, "utf8");
      // Look for explicit loopback imports outside the permitted modules.
      if (/from\s+["']\.\/backend["']/.test(source) && /LoopbackBitTorrentBackend/.test(source)) {
        violations.push(`${file}: imports LoopbackBitTorrentBackend directly`);
      }
    }
    expect(violations).toEqual([]);
  });
});
