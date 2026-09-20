/**
 * @wfx/app-web — minimal vendor type shims (the torrent-engine precedent).
 *
 * The web app consumes the SAME pinned vendor stack the production
 * torrent binding documents (webtorrent@3.0.21 browser build +
 * parse-torrent@11.0.24) through the R23-D browser adapter's LAZY
 * dynamic imports. Neither package ships its own type declarations, and
 * adding @types/* packages would be new dependencies beyond the
 * evaluated mature library. This shim (the same law as
 * packages/torrent-engine/src/types/vendor.d.ts) declares exactly the
 * surface the adapter consumes — everything past the constructor is
 * structurally typed at the binding, so `unknown` is the honest type
 * here.
 */

declare module "webtorrent" {
  const WebTorrent: new (options: Record<string, unknown>) => unknown;
  export default WebTorrent;
}

declare module "parse-torrent" {
  export default function parseTorrent(
    input: string | Uint8Array,
  ): Promise<unknown>;
}
