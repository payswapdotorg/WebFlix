/**
 * TEST-ONLY bencode ENCODER for deterministic fixture generation (R11).
 *
 * This is NOT a protocol implementation (invariant 6 is not touched — the
 * DECODING/protocol path in product code belongs entirely to the mature
 * library, webtorrent/parse-torrent). This encoder exists to BUILD the
 * committed `.torrent` fixture files from known content: deterministic
 * bytes in, byte-stable bencoded metainfo out. The fixtures' VALIDITY is
 * proven by round-tripping them through the REAL parse-torrent in the
 * test suite (tests/fixtures.test.ts).
 *
 * Encoding rules (the bencode spec): integers `i<n>e`, byte strings
 * `<len>:<bytes>`, lists `l<...>e`, dicts `d<key1><val1>...e` (keys in
 * the FIXED order the caller provides — determinism is the point).
 */

export type BencodeValue =
  | number
  | Uint8Array
  | string
  | BencodeValue[]
  | { readonly [key: string]: BencodeValue };

/** Encode one bencode value. Throws on unsupported shapes. */
export function bencode(value: BencodeValue): Uint8Array {
  const chunks: Uint8Array[] = [];
  encodeInto(value, chunks);
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function encodeInto(value: BencodeValue, chunks: Uint8Array[]): void {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`bencode: cannot encode non-integer number ${String(value)}`);
    }
    chunks.push(new TextEncoder().encode(`i${value}e`));
    return;
  }
  if (typeof value === "string") {
    encodeInto(new TextEncoder().encode(value), chunks);
    return;
  }
  if (value instanceof Uint8Array) {
    chunks.push(new TextEncoder().encode(`${value.byteLength}:`));
    chunks.push(value);
    return;
  }
  if (Array.isArray(value)) {
    chunks.push(new TextEncoder().encode("l"));
    for (const item of value) encodeInto(item, chunks);
    chunks.push(new TextEncoder().encode("e"));
    return;
  }
  if (typeof value === "object" && value !== null) {
    chunks.push(new TextEncoder().encode("d"));
    for (const [key, item] of Object.entries(value)) {
      encodeInto(key, chunks);
      encodeInto(item, chunks);
    }
    chunks.push(new TextEncoder().encode("e"));
    return;
  }
  throw new Error(`bencode: unsupported value ${String(value)}`);
}

/** SHA-1 hex of a byte buffer (fixture piece hashing + infohash derivation). */
export function sha1Hex(data: Uint8Array): string {
  return Bun.CryptoHasher.hash("sha1", data, "hex");
}
