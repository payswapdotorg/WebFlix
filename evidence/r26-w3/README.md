# R26-W3 — the corrective peer-watch lane: the re-entry verification + the TRUE-swarm-identity fix

**Lane:** `wfx/r26/desktop` (re-entry — the branch already existed on the remote at `5500b9c`; per the
RE-ENTRY LAW this run is VERIFY-AND-REPORT with surgical fix-forward).
**Verified base:** `5500b9c` on top of `33951f9` (the R26-W2 merged main — main had advanced past the
packet's expected `bf4e75b` because lane 2 landed first; the lane correctly rebased onto the newer main).
**Environment:** this sandbox (bun 1.3.14; the deterministic engine double — the same honest doctrine
`journeys/desktop/README.md` records; the lead's real-toolchain walk is the native half).

## THE RE-ENTRY VERIFICATION (what was reviewed before any fix)

The landed commit `5500b9c` was reviewed file-by-file against the packet's three deliverables:

1. **The peer-watch product journey** — `apps/desktop/src/surface/item-detail-surface.ts` (the
   browse/search → item → Where-to-watch → Authorized peer copy → Select file → Verified playable
   ranges → Playback → Seek → Background completion → Integrity verification → Ready offline →
   Library walk over the REAL `createDesktopApp` composition), machine-checked by
   `apps/desktop/tests/r26-peer-watch-journey.test.ts` (10 tests booted with NO `torrentPlayback`
   block — the corrective default must compose everything itself).
2. **Production discoverability** — `apps/desktop/src/platform/peer-catalog.ts` (four REAL Blender
   Foundation open movies, CC-BY licensed by the rights holder, real `.torrent` metainfo shipped as
   repo assets) + THE COMPOSITION-ROOT FIX in `apps/desktop/src/main.ts` (the R23-C binding, the
   R23-E Where-to-watch surface, and the item detail surface now ALWAYS compose when `acquisition`
   is bound — the peer catalog is the default `realizationOf`/`mintProvenance`/`profileKeyOf`).
3. **Desktop parity** — the shared vocabulary (`TORRENT_REALIZATION_VIEW`,
   `WHERE_TO_WATCH_GROUP_VIEWS`, `isStaleCompletionCopy`) imported from `@wfx/client-runtime` (the
   same constants the Web renders), Worker 1's R26-W1 `ContentArtwork` +
   `CapabilityAvailabilityReport` contracts bound through `platform/capability-availability.ts`,
   and the production engine wiring (`platform/desktop-torrent-engine.ts`).

All of the above STANDS. The re-entry review then executed the golden rule against the one claim
that internal assertions cannot self-certify: **that the shipped `.torrent` assets and the declared
catalog fields name the REAL swarms.**

## THE REAL DEFECT FOUND AND FIXED (fixture assertions were green through it)

**Classification: production data defect — the catalog's magnets named swarms that DO NOT EXIST.**

The original lane minted the four declared "REAL v1 infohashes" through a LOSSY re-encode: its
verification parser (`apps/desktop/tests/peer-catalog.test.ts`) decoded the metainfo into UTF-8 JS
strings and hashed a RE-ENCODED info dict. The re-encode destroys the binary `pieces` field (SHA-1
piece hashes decoded as UTF-8 become U+FFFD-mangled strings), so the hash was of bytes that appear
nowhere in any real torrent. Proof (all four, run over the shipped assets):

```
lossy-reencode(sintel.torrent)      = b6a3752ebf43b27ff5a76661d32bca4df08b0b02  (the declared value)
true sha1(info-dict ORIGINAL bytes) = 08ada5a7a6183aae1e09d831df6748d566095a10  (the REAL swarm)
```

Because the declared values were minted by the same lossy path the fixture used, the
byte-parse assertion `parsed.infoHash === entry.infoHash` stayed GREEN while the production
identity was false — exactly the operator's law: *internal fixture assertions are engineering
evidence, NEVER production acceptance evidence.*

**The production consequence (why this was unacceptable):** the magnet is the native-open wire
input (the v1 JSON engine wire cannot carry bytes — the landed wire-law fix). A real engine (the
pinned webtorrent/parse-torrent) opening the OLD magnet would have tried to join
`btih:b6a3752e…` — a swarm that does not exist — while the engine's torrent-file ingestion of the
shipped asset computes the REAL `08ada5a7…`. Magnet and file named two different swarms; playback
through the magnet lane could never start, and infohash-keyed lookups against real engine reports
would miss. No honest-state rendering can survive a wrong swarm identity.

**The cross-validation (three independent methods agreed before the fix was applied):**

1. A byte-slice parser (locate the info dict's ORIGINAL byte range; sha1 over the slice — the
   canonical derivation every real BitTorrent client uses).
2. The repo's own pinned production library: `parse-torrent@11.0.24` (the exact module
   `packages/torrent-engine`'s webtorrent binding calls in production).
3. Public knowledge: `08ada5a7a6183aae1e09d831df6748d566095a10` is the long-established public
   Sintel swarm; `dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c` the long-established Big Buck Bunny
   swarm (the Blender open-movie torrents the WebRTC tracker ecosystem has seeded for a decade).

**The surgical fix (committed as `R26-W3:` on the lane):**

- `apps/desktop/src/platform/peer-catalog.ts` — the four `infoHash` literals corrected to the TRUE
  swarm identities (the `itemId` and `magnet` re-derive automatically — they are computed from the
  infoHash at module load, and the ids appear nowhere as literals; the lane is unmerged, so the
  re-derivation carries no back-compat surface):

  | title | the TRUE infohash |
  |---|---|
  | Big Buck Bunny | `dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c` |
  | Sintel | `08ada5a7a6183aae1e09d831df6748d566095a10` |
  | Tears of Steel | `209c8226b299b308beaf2b9cd3fb49212dbd13ec` |
  | Cosmos Laundromat: First Cycle | `c9e15763f722f23e98a29decdfae341b98d53056` |

- `apps/desktop/tests/peer-catalog.test.ts` — the parser now hashes the info dict's ORIGINAL byte
  slice (never a re-encode), plus a NEW regression guard (`TRUE_SWARM_IDENTITIES`) asserting the
  four known-true identities as literals against the entries, the magnets, AND the shipped assets —
  a future lossy re-mint fails loudly. The tracker set was verified UNCHANGED (the declared set
  already exactly matched the real announce lists in all four shipped files).

**The one-swarm proof (post-fix, through the production library itself):**

```
Big Buck Bunny:                file=OK magnet=OK byInfoHash=OK magnet-trackers=file-trackers=OK
Sintel:                        file=OK magnet=OK byInfoHash=OK magnet-trackers=file-trackers=OK
Tears of Steel:                file=OK magnet=OK byInfoHash=OK magnet-trackers=file-trackers=OK
Cosmos Laundromat First Cycle: file=OK magnet=OK byInfoHash=OK magnet-trackers=file-trackers=OK
ONE-SWARM IDENTITY PROVEN FOR ALL 4 ENTRIES
```

(bytes, declared entry, magnet, and infohash lookup all name ONE swarm, with the magnet's tracker
set byte-equal to the file's real announce list.)

## THE ACCEPTANCE JOURNEY (the lead's walk — the production-discoverability deliverable)

**The known authorized torrent-eligible content path (all four entries qualify; Sintel is the
canonical walk):**

- **Item:** *Sintel* (2010, Blender Foundation, CC BY 3.0 — `https://durian.blender.org/about/`),
  canonical id `wfxitm_01M336K200AE2X7SQVMJZKQZ00`, real swarm
  `08ada5a7a6183aae1e09d831df6748d566095a10`, shipped metainfo
  `apps/desktop/assets/peer-catalog/sintel.torrent` (11 files, 129,302,391 bytes, one playable
  video `Sintel.mp4`). Also eligible: *Big Buck Bunny*, *Tears of Steel*, *Cosmos Laundromat*.
- **The journey (the normal product surface, no engineering path):**
  1. **Browse** — `app.itemDetail.browse()` → the peer catalog's four titles render as
     first-class discovery rows (real source artwork, `origin: "authorized-peer-copy"`, license
     label) side by side with the server catalog.
  2. **Search** — `app.itemDetail.search("sintel")` → the merged surface: server rows AND the
     peer rows through the SAME card grammar.
  3. **Item** — `app.itemDetail.item({ itemId })` → the content decision hub: canonical identity,
     artwork, the lawful-basis license (progressive disclosure), resume truth.
  4. **Where to watch** — the frozen R23-E grouping: `webflix-source` / `authorized-peer-copy` /
     `other-realizations`; the peer copy is PRIMARY-eligible (with no provider way for this title,
     the peer copy IS the primary: `Play — Authorized peer copy`).
  5. **Authorized peer copy → Select file** — `app.itemDetail.playPeerCopy(itemId)` → the honest
     auto-selection of the REAL metadata (one playable file) or the typed `file-choice-required`
     when the metadata reveals a real choice; the engine's ingestion lane consumes the shipped
     metainfo (metadata-before-network); the native open crosses the real engine wire carrying the
     magnet with the TRUE btih.
  6. **Verified playable ranges → Playback → Seek** — the acquisition lifecycle (Buffering with the
     verified-fraction truth → Playing with runway → the honest seek demotion), the runtime's own
     controller semantics (the same laws every realization uses).
  7. **Background completion → Integrity verification → Ready offline** — `completing` (with
     "Checking the finished files") until the VERIFIED exposure earns `ready-offline` — a bare
     completion never claims Ready offline.
  8. **Library** — the verified copy lands in the Library Offline section; the next play opens the
     VERIFIED local asset (the earned replay, without the swarm).

**Machine check:** `apps/desktop/tests/r26-peer-watch-journey.test.ts` walks this exact journey over
the REAL composition root with the corrective default armed. **The native half:** the sandbox has no
native toolchain for the real webtorrent engine (the R11 skip records this honestly); the lead's
real-toolchain walk (`journeys/desktop/README.md`) boots the production engine over the shipped
assets — with the TRUE identities now in the catalog, the magnet and the file join the SAME real
swarm.

## GATES (all re-run on the fixed tree — see the completion report for the numbers)

`bun install --frozen-lockfile` · `bun run lint` (0 errors) · `bun run typecheck` (clean) ·
`bun test --parallel=1` (0 fail; the battery count in the report) · `bun run contract-check`
(12 frozen blocks in sync) · `bun run lane-check` (no cross-lane private imports).
