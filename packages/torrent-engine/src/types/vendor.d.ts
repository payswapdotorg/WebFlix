/**
 * @wfx/torrent-engine — minimal vendor type shims.
 *
 * Neither webtorrent@3.0.21 nor parse-torrent@11.0.24 ships its own type
 * declarations, and adding @types/* packages would be NEW dependencies
 * beyond the evaluated mature library (the drift rule escalates those).
 * This shim declares exactly the surface this package consumes — the
 * binding (src/library/webtorrent.ts) defines its own structural
 * interfaces for everything past the constructor, and the tests cast
 * through their own shapes, so `unknown` is the honest type here: nothing
 * about the wrapped library's internals is trusted at compile time.
 */

declare module "webtorrent" {
  const WebTorrent: new (options: Record<string, unknown>) => unknown;
  export default WebTorrent;
}

declare module "parse-torrent" {
  export default function parseTorrent(
    input: string | Uint8Array,
  ): Promise<unknown>;
  export function toMagnetURI(input: unknown): string;
  export function toTorrentFile(input: unknown): Uint8Array;
}
