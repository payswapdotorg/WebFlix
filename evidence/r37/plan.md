# R37 — THE SURFACE SURVEY + THE DESIGN (M1)

Lane: `wfx/r37/live` (base: `main @ 37effa325c5060e14afda7e07db5b7eb61e45d9e` —
the R36 + R35b merges). The work item: the survey's WAVE R37 — live video +
live chat (§1 rows 20/21): the live item designation (LIVE badge + viewer
count, honest backing), the `/live` browse rail, the watch-page live mode
with CURRENT LIVE CHAT over the WS seam, live chat replay on archived live
VODs timed to the playhead, and the chat grammar (member badges, pinned
message, slow mode, emojis). Premieres are DEFERRED to R40 (the task
packet's explicit instruction — the survey's "if the lane has capacity"
clause is NOT exercised).

Every decision below cites the file/line that grounds it.

---

## 0. The baseline (recorded before any edit)

- Battery (`nice -n 19 ionice -c3 bun test --parallel=1`): **5297 tests /
  5296 pass / 1 skip / 0 fail** — 33850 expect() calls, 305 files, 230.10s
  (the task's stated floor exactly; the 1 skip = the R11 webtorrent
  platform issue of record).
- `bun run typecheck` — exit 0 (root + journeys).
- `bun run contract-check` — OK (12 frozen blocks, 7 extension types).
- `bun run lane-check` — OK (962 files).
- `bun run lint` — exit 1 = the SAME pre-existing r28/r29-recon
  evidence-script debt every lane records (see evidence/r36/guards.md step
  3, the same convention); NONE of this lane's files appear in it. The lane
  gate is `bunx eslint` over the lane's own files (the R36 precedent).

See `guards.md` for the full gate table.

---

## 1. The item-designation design (the connector layer)

**THE LIVE-DESIGNATION LAW (the task packet):** "the live truth is encoded
at the connector/fixture + view-model layer (your owned surface) — you do
NOT touch the domain graph. An item is live, or is an archived live VOD,
because its connector metadata says so; the surfaces derive, never guess."

**Grounding.** `SearchResult`/`SourceItem` (both in
`packages/domain/src/contracts/extensions.ts:13-55`) carry
`metadata?: Record<string, unknown>` — the bag R36's channel surfaces
already read item-declared truths from (`host/channel-views.ts:324-341`:
the `publishedAt`/`viewCount` metadata keys, validated before use, absent
→ the typed absence). `contentArtworkOf` (`packages/domain/src/contracts/
artwork.ts`) is the SAME precedent one level up: the connector projects a
source-authorized URL under the well-known `thumbnailUrl` metadata key; a
typed carrier validates and derives. The YouTube connector already projects
live-ish metadata (`packages/connectors/src/youtube/projection.ts` carries
`publishedAt`).

**The design (all NEW files under `packages/connectors/src/live/` —
additive; the barrel `packages/connectors/src/index.ts` grows exactly one
export line, the WFX-054 YouTube precedent recorded in its comment):**

1. `live-designation.ts` — THE METADATA VOCABULARY + THE TYPED PARSER:
   - `LIVE_STATE_METADATA_KEY = "liveState"` — the source-declared live
     state: `"live"` | `"archived-live-vod"` (absent → not live; any other
     value → the honest not-live + the malformed note, never a crash).
   - `LIVE_STARTED_AT_METADATA_KEY = "liveStartedAt"` (ISO instant),
     `LIVE_VIEWER_COUNT_METADATA_KEY = "liveViewerCount"` (the source's
     own reported concurrent viewers — an integer ≥ 0, exactly like
     `viewCount`'s validated read), `LIVE_ENDED_AT_METADATA_KEY =
     "liveEndedAt"` (the archived VOD's ended instant).
   - `LiveDesignation` =
     `{ kind: "live"; startedAt: string | null; viewerCount: number | null }`
     | `{ kind: "archived-live-vod"; startedAt: string | null; endedAt: string | null }`
     | `{ kind: "not-live" }`.
   - `liveDesignationOf(row)` — the pure derivation (validates shape;
     malformed values degrade to the honest absence, the R36
     `declaredInstantOf` law).

2. `live-chat-log.ts` — THE ARCHIVED LIVE-CHAT LOG ARTIFACT (the committed
   data contract — the task: "the chat log artifact for replay is
   committed data, not a stream capture"):
   - `LiveChatLogEntry { offsetMs: number; author: string; authorBadges:
     readonly LiveChatAuthorBadge[]; body: string; you?: boolean }` — the
     offset is the entry's time position in the VOD timeline.
   - `LiveChatLog { kind: "live-chat-log"; version: 1; slowModeMs: number |
     null; pinnedOffsetMs: number | null; entries: readonly
     LiveChatLogEntry[] }` — the session's archived facts (slow mode, the
     pinned message's offset) ride the log header; `you: true` marks the
     viewer's OWN archived message (the honest self-identity).
   - `parseLiveChatLog(value: unknown): LiveChatLog | null` — typed
     validation at the boundary (never a trusted cast — the R25-D wire
     law); malformed = null (the caller renders the typed absence).
   - `liveChatWindowAt(log, positionMs, windowMs)` — THE PLAYHEAD BINDING
     (pure): the entries with `offsetMs` in `(positionMs − windowMs,
     positionMs]`, in time order — the scrub → the chat window follows.
   - `liveChatBadgeLabel`/the emoji vocabulary shared by both surfaces.

3. `packages/connectors/tests/live-designation.test.ts` +
   `live-chat-log.test.ts` — the parser truth tables + the window
   derivation + the malformed-value refusals (fail on main: the module
   does not exist there — the lane-test law, R36's step 11).

**Why the connectors package:** it is the SDK seam where item metadata
flows from source to surface (the base.ts operation-gating map); the CODEOWNERS
lane map (`packages/connectors/` → Lane B) and the task packet both name it
mine to EXTEND ADDITIVELY; the shapes ride the EXISTING `metadata` bag —
no frozen contract is touched (contract-check re-verified green).

---

## 2. The transport design (the livechat bridge — the WS seam)

**THE TRANSPORT LAW (R25-D, adapted):** Browser → WebFlix WebSocket (the
livechat bridge) → the session seam (the deterministic dev double in the
fixtures boot). NEVER browser → any provider with a credential.

**Grounding.** The R25-D precedent, verbatim structure:
`host/realtime/realtime-bridge.ts:641-674` (the `ws` WebSocketServer,
`noServer: true`, the HTTP-server upgrade on `/`, the origin check against
`localhost:3101`), `realtime-wire.ts:225-309` (`parseRealtimeWireClientMessage`
— typed wire validation, never a trusted cast), `realtime-boot.ts:37-99`
(the env gate: `WFX_DEV_FIXTURES=1` boots bridge + double through DYNAMIC
imports; `WFX_REALTIME_BRIDGE=1` boots the bridge alone; anything else
boots NOTHING; `NEXT_PHASE` build passes never start servers; the
globalThis one-boot guard), `instrumentation.ts:28-40` (the register hook),
and `realtime-bridge-state.ts` (the globalThis status the route view
reads). The dev double's loud labeling:
`dev-realtime-provider.ts:60-70` (`DEV_REALTIME_PROVIDER_DETAIL` — "the
deterministic dev realtime provider (the fixtures double…)").

**The design (all NEW files under `apps/web/src/host/livechat/`):**

1. `livechat-wire.ts` — the typed wire:
   - Client ops: `join { op: "join"; externalRef: string }`,
     `send { op: "send"; sessionId; text }`, `leave { op: "leave"; sessionId }`
     — `parseLiveChatWireClientMessage(raw)` (the R25-D validation law:
     JSON → object → op dispatch, malformed → `{ op: "invalid", detail }`).
   - Server messages (the transport envelope + the product events, the
     R25-D split):
     - `chat-joined` (transport ack): `sessionId`, `externalRef`,
       `sourceStream: "scripted-dev-double"`, `doubleBadge` (the loud
       sentence), `viewerCount: number | null` (the double's own reported
       figure at join), `slowModeMs: number | null`, `pinned: null`
       (the pin arrives as an event — the deterministic script).
     - `chat-message` (event): `{ id, author, authorBadges, body, you }`.
     - `chat-pinned` (event): the pinned entry (or null to unpin).
     - `viewer-count` (event): `{ count, provenance }` — the transport's
       own carried figure (the double's scripted report).
     - `chat-left` (transport ack).
     - `refused` (transport): the typed refusals — `unknown-item`,
       `not-live` (an archived VOD has no live chat — the replay is the
       committed log, never a stream), `slow-mode` (with `waitMs`), and
       the wire-level `invalid`.
   - THE HONEST-TRANSPORT LAW (R28, binding): every social number renders
     only what the transport really carries. The viewer count the
     surfaces render IS the number the double reports (provenance
     labeled); the typed-absence state renders when no figure is carried
     (the fixture entry without a declared count).

2. `livechat-dev-double.ts` — THE DETERMINISTIC DEV CHAT DOUBLE (the
   fixtures boot's live-chat session seam):
   - The committed script: a fixed ordered transcript (the members with
     badges — moderator/member/verified-creator; the emoji-bearing
     bodies; the moderator's rules message pinned at a scripted offset;
     the scripted viewer-count figure at join, stepping deterministically
     on a fixed schedule). The transcript itself is COMMITTED in this
     module — `evidence/r37/honesty.md` records it as the deterministic
     transcript of record (the task's proof ask).
   - The emission timeline: derived from the SESSION's elapsed time
     (`Date.now() - joinedAtMs`), so a given observation offset sees a
     deterministic set (the dev-realtime-provider's scripted-timing law:
     the CONTENT and pacing are the double's, never a claimed live
     measurement).
   - Slow mode: declared at join (5s); the double enforces it on `send`
     (the typed refusal with the remaining wait) — a REAL transport
     behavior.

3. `livechat-bridge.ts` — the bridge: an `http.createServer` (routes:
   `/health` — the bridge identity + the double badge + the served
   items; 404 otherwise) + the `ws` upgrade on `/` with the origin check
   (`localhost:3101`/`127.0.0.1:3101`, absent Origin passes — non-browser
   tooling), the session map (`sessionId → { externalRef, socket,
   lastSendAtMs }`), the typed-wire dispatch, and the one-process
   idempotence guard via the boot module. Default port **3104** (the
   R25-D sequence: 3101 dev web, 3102 realtime bridge, 3103 dev realtime
   provider — 3104 is the next free port; overridable
   `WFX_LIVECHAT_BRIDGE_PORT` for parallel local runs, the realtime
   precedent at realtime-boot.ts:25).

4. `livechat-bridge-state.ts` — the globalThis status record
   (`running`, `port`, `provider` — the double's id/badge), the same law
   as realtime-bridge-state.ts (the Turbopack split-module doctrine).

5. `livechat-boot.ts` — `ensureLiveChatBridgeBooted()`: the env gate
   (`WFX_DEV_FIXTURES=1` → bridge + double via dynamic imports;
   `WFX_LIVECHAT_BRIDGE=1` → bridge alone, the honest typed
   no-double gap; otherwise NOTHING); `NEXT_PHASE` never starts servers;
   the globalThis one-boot promise; a failed boot = the honest absent
   state, never a crash (realtime-boot.ts:84-95 verbatim structure).

6. `instrumentation.ts` — EXTEND ADDITIVELY: the existing realtime
   `register()` body is untouched; the livechat boot call is APPENDED
   after it (its own dynamic import + its own try/catch — a failed
   livechat boot never touches the web host or the realtime bridge).

7. Colocated lane tests: `livechat-wire.test.ts` (the parser truth
   table), `livechat-bridge.test.ts` (the REAL bridge + double on a
   private test port — a REAL WebSocket client drives join → messages →
   pin → viewer-count → slow-mode refusal → leave; the
   apps/web/tests/realtime-bridge.test.ts pattern, colocated in the
   owned directory per the task packet).

**What the bridge does NOT do:** no chat retention (nothing persists —
the live chat is a stream, relayed never stored, the R25-D persistence
law); no replay serving (the replay is the committed log artifact read by
the watch surface, never a stream capture); no credentials anywhere.

---

## 3. The fixture truth (M2 — the byof-fixtures additive section)

**Grounding.** The task packet: "`apps/web/src/host/byof/byof-fixtures.ts`
(EXTEND ADDITIVELY ONLY — live fixture entries + archived live VODs with
chat logs, clearly delimited; never reword existing fixture entries)."
The file is the dev-fixtures lane's fixture-data home (its module doc:
"the fixture is the transport + the grant, exactly the layers…"). The
fixtures boot's catalog itself (`packages/experience/src/fixtures.ts`
FIXTURE_CATALOG) is LANE C's — NOT mine — so the live entries live in MY
owned fixture file, imported lazily by my view loaders (the byof-host
closure law at byof-host.ts:83-98: the fixtures-only closure is loaded
through a dynamic import so the service path never evaluates it — my
live view loader follows the same law).

**The design — a clearly-delimited additive section at the END of
byof-fixtures.ts** ("R37 — THE LIVE FIXTURE ENTRIES"), pure data + pure
readers (no PGlite, no service wiring — the section is importable without
any boot):

- `LIVE_FIXTURE_CONNECTOR_ID = "fake-source"` — the entries belong to the
  fixtures' own source identity (FIXTURE_CONNECTOR_ID,
  experience/fixtures.ts:43), so the channel grammar composes (the /live
  cards' channel slots link to the R36 channel page for the same source;
  the sources model's displayName resolves the same way).
- THREE live entries (the /live rail's truth — each carries the SAME
  metadata vocabulary the connector layer defines, i.e. the fixtures
  double a live-reporting source honestly):
  1. `fake:live-1` — "Signal Bloom — the fixture live broadcast":
     `liveState: "live"`, `liveStartedAt`, `liveViewerCount: 1247` (the
     source-reported figure), an embed realization on `fixture.invalid`
     (the reserved-TLD determinism law — journeys assert the DOM
     containment grammar, never provider content).
  2. `fake:live-2` — "Harbor Lights Live — the fixture second stream":
     live, NO declared viewer count (the TYPED-ABSENCE proof — the rail
     renders the honest absent state, never a fabricated number).
  3. `fake:live-vod-1` — "Aurora Nights — the archived live broadcast":
     `liveState: "archived-live-vod"`, startedAt/endedAt, `durationMs:
     780_000` (13 minutes), the embed realization, and the COMMITTED
     CHAT LOG artifact (a 16-entry deterministic script over the
     timeline: member badges, the moderator's pinned message, emojis,
     the archived slow-mode fact `slowModeMs: 5000`, one `you: true`
     entry — the viewer's own archived message).
- Pure readers: `liveFixtureEntries()` (the ordered list),
  `liveFixtureItemOf(externalRef)` (one entry or null),
  `liveFixtureChatLogOf(externalRef)` (the committed log typed through
  the connector-layer parser — the boundary validation).
- The LIVE items' CURRENT-chat script does NOT live here — it is the
  transport double's own script (`livechat-dev-double.ts`), the
  dev-realtime-provider precedent (the script is the double's law). The
  ARCHIVED log is committed DATA (the artifact) — that split is the
  task's own law ("the chat log artifact for replay is committed data,
  not a stream capture").

---

## 4. The /live browse design (M3)

**Grounding.** The presentation-route law: the R36 channel route
(`app/channel/[handle]/page.tsx:56-59` — "A PRESENTATION ROUTE … the
runtime's navigation SurfaceId set is frozen; the page is a content
destination"). The rail grammar: `components/home/HomeSurface.tsx` (the
`wfx-row` anatomy) + `components/cards/ItemCard.tsx` (the card lockup:
art placeholder/monogram, badges, the stretched play link, the channel
slot — read-only imports/grammar, never modified). The typed-absence
family: `host/channel-views.ts:66-96` (AbsentTruth/DeclaredText + the
notes). The honest-empty law: WatchBrowseSurface's EmptyState usage.

**The design:**

- `app/live/page.tsx` — the presentation route `/live` (server
  component, `force-dynamic`, `syncNavigationToRoute(runtime, "/live",
  {})` — the channel-page pattern). Loads the live browse view + the
  account chrome; renders `components/live/LiveBrowseSurface.tsx` inside
  the AppShell (active tab: none — a destination, not a nav state).
- `components/live/live-views.ts` — THE VIEW MODEL (server-only, the
  channel-views.ts pattern — pure derivations + the honest typed
  states):
  - `loadLiveBrowseView(host)`:
    1. THE SEARCH-DERIVED LIVE TRUTH (the general law): the runtime
       search over the discovery seeds (the same composition the home
       view uses, view-models.ts:596-607), filtered to hits whose
       metadata declares a live designation. On both boots today this
       answers ZERO (no catalog carries live metadata) — the honest
       general path a real live-reporting connector would feed (the
       derivation is real; the answer is empty; the empty truth is
       disclosed).
    2. THE FIXTURES-BOOT LIVE ENTRIES (fixtures mode ONLY — the loud
       dev double, dynamically imported per the closure law): the rail's
       live cards + the archived-VOD rail.
    3. The typed states: service mode with no live-declaring sources →
       the honest sentence (never a fabricated rail); the bridge status
       read (is the livechat bridge serving? the watch page's chat
       honesty pre-declared).
  - `loadLiveWatchView(host, { connectorId, externalRef, title,
    canonicalType })` — the watch live mode's view: the designation
    derivation (`liveDesignationOf` over the fixture entry's metadata —
    the surfaces derive, never guess), the stage facts (the embed
    realization + the presentation law), the item identity (title,
    channel = the sources model's displayName, the honest monogram
    art), the chat truth (live → the bridge status + the live-chat
    island mounts; archived → the COMMITTED LOG + the replay grammar),
    and the typed refusals (unknown ref / not-live item → the honest
    states with the player deep link — the no-dead-end law).
- `components/live/LiveBrowseSurface.tsx` — the rail: the LIVE cards
  (the `wfx-card` grammar: the red-dot LIVE badge + the source-reported
  viewer count or the typed-absence note + the title + the channel
  slot linking the channel page — the R36 stretched-link law honored
  with one play anchor per card), the archived live VOD rail (the
  "was live" grammar + the replay truth sentence), the honest states,
  and the loud fixtures-boot disclosure (the dev badge sentence naming
  the scripted entries).
- The card link: `/watch?connector=…&ref=…&title=…&type=video` — the
  LIVE WATCH destination (below). NOT the /player route: the live watch
  mode is THIS lane's composition at the watch surface (the task
  packet's owned surface — app/watch/** + components/watch/**).

---

## 5. The watch live mode design (M3/M4 — the composition at /watch)

**Grounding.** The task packet: "app/watch/** + components/watch/**
(EXTEND — the live mode composition; the default watch surface stays
byte-compatible for non-live items)". The /watch route today:
`app/watch/page.tsx` (the WatchBrowseSurface over the browse view). The
content-destination param grammar: the /item route's `?connector&ref`
(app/item/page.tsx:39-44) + `?title&type` (the href grammar,
app/href.ts:63-88). The stage grammar: EmbedStage's contained iframe +
the embed-presentation law (the opaque-origin sandbox for the
non-YouTube family — fixture.invalid keeps the strictest posture). The
player chrome grammar: PlayerChrome's phase truth + the LiveCaptions
mount pattern (the R25 live-mode composition precedent the task names).

**The design:**

- `app/watch/page.tsx` — EXTENDED (additively): the route reads
  `?connector&ref&title&type` FIRST. With item params:
  `loadLiveWatchView` answers one of —
  1. **A LIVE DESIGNATION (live or archived-live-vod)** → render
     `components/watch/LiveWatchSurface.tsx` (my lane's composition —
     the default browse is not rendered; the live mode is the page).
  2. **A KNOWN-BUT-NOT-LIVE item** (the fixture entry exists but
     declares no live state; or a runtime-search hit with no live
     designation) → the honest typed "not a live item" state with the
     ONE-CLICK player link (`/player?...` — the no-dead-end law; the
     default browse never renders a wrong item).
  3. **An unknown ref** → the honest typed not-found state (the /item
     law: WebFlix does not fabricate watch pages).
  Without item params: the DEFAULT browse renders — byte-compatible
  (J03's assertions hold; the branch is additive before the browse load).
- `components/watch/LiveWatchSurface.tsx` — THE LIVE WATCH COMPOSITION
  (server): the stage column (the contained embed iframe — the
  presentation law imported, never modified; the LIVE MODE CHROME:
  the red-dot LIVE badge + the viewer count (the transport-carried
  figure via the client island, the source-reported figure as the SSR
  fallback) + THE NO-SCRUB TRUTH: a live edge is not scrubbable — no
  seek bar renders; the grammar states what is true ("You are watching
  the live edge — seeking is unavailable on a live stream")) + the
  chat column (LIVE: the LiveChat island; ARCHIVED: the ChatReplay
  island) + the channel row (the fixture source's identity linking the
  R36 channel page — the composability ask) + the honest labels (the
  dev-double badge in the chat panel; the fixtures-boot disclosure).
- `components/live/LiveChat.tsx` (client island) — THE CURRENT LIVE
  CHAT over the bridge:
  - Connects `ws://localhost:3104` (the port from the SERVER-RENDERED
    bridge status — the honest gate: bridge not running → the typed
    "live chat is not serving on this boot" state, never a spinner).
  - The join round trip; the message list (the badge chips — member/
    moderator/verified-creator; the emoji-bearing bodies; the
    viewer's own `you` styling); THE PINNED MESSAGE bar (the pin
    event); THE SLOW-MODE truth (the declared interval; the composer's
    refusal path renders the honest wait state); THE VIEWER COUNT
    (the transport's carried figure + its provenance sentence); the
    emoji insert row (the grammar's emoji affordance — a real control).
  - The send path: the viewer's own message (anonymous — the R23 law:
    no login gate; the accountless chat), the slow-mode refusal
    handling, the echo render.
  - A small `window.__wfxLiveChatState` observation record (the J43
    `window.__wfxRealtimeTelemetry` precedent — the product's own
    observation the journey asserts over: joined/messages/counters).
- `components/watch/ChatReplay.tsx` (client island) — THE CHAT REPLAY
  on the archived live VOD:
  - THE PLAYHEAD BINDING: the surface's own replay position control
    (play/pause + the scrub bar over the VOD's declared durationMs) —
    the fixture embed carries no real position (the honest unbound
    stage truth is disclosed: `data-wfx-live-stage="unbound"` — the
    same honest absence the shorts stage renders when the provider
    never answers), so the REPLAY CLOCK is the surface's own control,
    honestly labeled ("Chat replay — the archived live chat, timed to
    the video position").
  - The window derivation: `liveChatWindowAt(log, positionMs,
    windowMs)` (the connector-layer pure function) — scrub → the window
    follows; play → the clock advances and messages arrive in TIME
    ORDER from the committed log (never a stream).
  - The archived truths: the pinned message (the log's
    `pinnedOffsetMs` — renders pinned from that offset onward), the
    slow-mode archived fact ("Slow mode (5s) was on during this
    stream" — the recorded session fact, honestly past-tense), the
    "archived log, never a live stream" sentence, the peak/live facts
    (startedAt/endedAt).

**Byte-compatibility proof:** the /watch route's default branch loads
exactly the views it loads today (loadWatchBrowseView + discovery +
account) and renders the same WatchBrowseSurface tree; the branch is a
param-gated early return before those loads. J03 (watch browsing) is
re-run green as the affected-journey proof.

---

## 6. The journey sketch (M5)

- **J45** (`journeys/web/j45-live-watch-chat.ts`) — the LIVE watch +
  current-chat round trip: `/live` (the rail asserts: the LIVE badges,
  the source-reported viewer counts, the typed-absence count state on
  the count-less entry, the archived rail's replay truth, the loud
  fixtures disclosure) → click the LIVE card → the live watch mode (the
  stage grammar: the red-dot LIVE badge, the no-scrub truth sentence,
  the absent seek control, the viewer count pill, the channel row) →
  THE CHAT: the join (the bridge URL in the client record is the
  WebFlix bridge — no provider endpoint), the scripted messages arrive
  (badges render, emojis render), THE PINNED MESSAGE (the pin event →
  the pinned bar), THE VIEWER COUNT (the transport-carried figure, the
  double's provenance label), THE SLOW MODE (send inside the window →
  the typed refusal with the wait; after the wait the send round trips
  and the viewer's own message echoes with the `you` styling), the
  anonymous law (no login gate; the accountless chat) —
  `bun journeys/runner.ts --filter J45`.
- **J46** (`journeys/web/j46-chat-replay-scrub.ts`) — the CHAT REPLAY
  SCRUB: `/live` → the archived VOD card → the watch page (the
  archived grammar: the "was live" badge, the duration, the replay
  truth sentence) → the initial window (t=0) → SCRUB to a mid position
  → the window follows (specific entries present, others absent — the
  playhead binding) → scrub near the pinned offset → the pinned
  message renders → PLAY → the clock advances, messages arrive in time
  order → the archived truths (the slow-mode fact, the honest
  "archived log — never a live stream" sentence, the started/ended
  facts) → `--filter J46`.
- Registration: `journeys/web/index.ts` grows the two imports + the two
  array entries (additive only). Docs: ONE dated additive section in
  `docs/validation/webflix-golden-journeys.md` (the J43/R35b section
  precedent). J45/J46 in `JOURNEY_LIMITATIONS`? NOT needed — both are
  fixtures-boot-feasible end to end (the honest note about the dev
  double rides in each journey's header + the registry comment, the
  J43 precedent).
- **Affected existing journeys re-run:** J01 (home), J02 (home
  discovery), J03 (watch browse — the byte-compatibility proof), J04
  (shorts), J05 (search), J06 (item), J11 (library), J37 (anonymous),
  J40/J43 (the player-surface + realtime surfaces my watch composition
  sits beside), J44 (the channel journey — the composability ask: the
  /live cards' channel slots + the channel page's Live-composability).
  The base-vs-lane comparison uses the recorded base verdicts (the
  R35b/R36 honest-divergence convention).

---

## 7. Risks + the named out-of-lane notes

- **The `/watch` live-mode branch** is the one extension to an existing
  route in my surface; the byte-compatibility proof is J03 + the lane
  tests (the browse view untouched; the branch is param-gated).
- **The runtime search path for live items** (the /live view's general
  law) reads the search models through the EXISTING runtime surface —
  no seam change (a real seam change would be a named out-of-lane note;
  none is required).
- **The domain graph**: untouched (the live-designation law). The
  `metadata` bag carries everything — the extensions.ts shapes are
  structural, and contract-check re-verifies.
- **NO new dependencies** (the task's zero-deps law): the bridge uses
  `ws` 8.21.3 (already a dependency of @wfx/app-web, package.json) +
  node:http — exactly the R25-D precedent.
- **Ports**: 3104 (livechat bridge) — no collision with 3101/3102/3103
  (the recorded sequence); the test port 3514 (the realtime tests'
  3512/3513 convention +1).
