/**
 * R11 — the committed fixture test data.
 *
 * The fixtures are the deterministic metainfo files the ingestion tests
 * parse: committed as `.torrent` binaries under tests/fixtures/, generated
 * by tests/fixtures/generate.ts from the specs in tests/helpers/fixtures.ts.
 * This suite proves (a) the committed files match a fresh derivation (no
 * drift — regeneration is byte-stable), and (b) the REAL mature-library
 * parser (parse-torrent, webtorrent's own) accepts every committed file
 * with the exact expected geometry.
 */

import { describe, expect, it } from "bun:test";

/** The parse-torrent result shape these fixtures assert on (test-local). */
interface RawParsed {
  infoHash?: string;
  name?: string;
  pieceLength?: number;
  length?: number;
  private?: boolean;
  files?: { path: string; name: string; length: number }[];
  announce?: string[];
}
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_FIXTURES,
  fixtureInfoHash,
  fixtureMagnetUri,
  fixtureTorrentBytes,
  type FixtureSpec,
} from "./helpers/fixtures";

const FIXTURES_DIR = import.meta.dir;

function committedBytes(spec: FixtureSpec): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, "fixtures", `${spec.key}.torrent`)));
}

describe("R11 — the committed fixture metainfo files", () => {
  it("every spec's committed .torrent file matches fresh deterministic regeneration (no drift)", () => {
    for (const spec of ALL_FIXTURES) {
      const committed = committedBytes(spec);
      const regenerated = fixtureTorrentBytes(spec);
      expect(committed.byteLength).toBeGreaterThan(0);
      expect(Buffer.from(committed).equals(Buffer.from(regenerated))).toBe(true);
    }
  });

  it("the REAL mature-library parser (parse-torrent) decodes every committed file exactly", async () => {
    const parseTorrent = (await import("parse-torrent")).default as unknown as (
      input: string | Uint8Array,
    ) => Promise<RawParsed>;
    for (const spec of ALL_FIXTURES) {
      const parsed = await parseTorrent(committedBytes(spec));
      expect(parsed.infoHash).toBe(fixtureInfoHash(spec));
      expect(parsed.name).toBe(spec.name);
      expect(parsed.pieceLength).toBe(spec.pieceLengthBytes);
      const totalBytes = spec.files.reduce((sum, f) => sum + f.sizeBytes, 0);
      expect(parsed.length).toBe(totalBytes);
      expect(parsed.files?.length).toBe(spec.files.length);
      for (let i = 0; i < spec.files.length; i += 1) {
        const file = parsed.files?.[i];
        const expected = spec.files[i];
        expect(file?.length).toBe(expected?.sizeBytes);
      }
      expect(parsed.private).toBe(spec.isPrivate ? true : undefined);
    }
  });

  it("the fixture magnet URIs carry the fixture infohashes (round-trip through the real parser)", async () => {
    const parseTorrent = (await import("parse-torrent")).default as unknown as (
      input: string | Uint8Array,
    ) => Promise<RawParsed>;
    for (const spec of ALL_FIXTURES) {
      const magnet = fixtureMagnetUri(spec);
      expect(magnet.startsWith("magnet:?xt=urn:btih:")).toBe(true);
      const parsed = await parseTorrent(magnet);
      expect(parsed.infoHash).toBe(fixtureInfoHash(spec));
      expect(parsed.name).toBe(spec.name);
    }
  });
});
