/**
 * Ambient declarations for `parse-torrent` (the mature BitTorrent parsing
 * library, MIT, the parsing sub-package of webtorrent). The package ships
 * no `.d.ts`; these declarations cover only the surface the torrent-engine
 * uses (parse, toMagnetURI, toTorrentFile). The runtime values are
 * validated by the runtime guards in metadata.ts — library data is never
 * trusted verbatim.
 */

declare module "parse-torrent" {
  export interface ParsedFile {
    path: string;
    name: string;
    length: number;
    offset?: number;
  }

  export interface ParsedTorrent {
    infoHash?: string;
    infoHashBuffer?: Buffer;
    name?: string;
    announce?: string[];
    urlList?: string[];
    peers?: string[];
    peerAddresses?: string[];
    pieceLength?: number;
    lastPieceLength?: number;
    /** The piece hashes — a concatenated buffer OR an array of hex strings / 20-byte buffers (library-version-dependent). */
    pieces?: Buffer | Uint8Array | Array<string | Buffer | Uint8Array>;
    files?: ParsedFile[];
    length?: number;
    private?: boolean;
    info?: unknown;
    infoBuffer?: Buffer;
    xt?: string;
    dn?: string;
    tr?: string[];
    dht?: boolean;
  }

  /** The default export is an async parse function (magnet URI / Buffer / Uint8Array → ParsedTorrent). */
  export default function parseTorrent(
    input: string | Uint8Array | ArrayBuffer | Buffer,
  ): Promise<ParsedTorrent>;

  export function toMagnetURI(torrent: Partial<ParsedTorrent>): string;
  export function toTorrentFile(torrent: Partial<ParsedTorrent>): Buffer;

  export const remote: (
    input: string | Uint8Array | ArrayBuffer,
    opts?: Record<string, unknown>,
  ) => Promise<ParsedTorrent>;
}
