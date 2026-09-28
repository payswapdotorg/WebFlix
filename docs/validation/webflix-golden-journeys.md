# WebFlix Golden Journeys

**Status:** FROZEN ACCEPTANCE CONTRACT
**Date:** 2026-09-16

These journeys are the product-level acceptance tests for the WebFlix remediation program. Affected UI work is not complete until the worker runs the journey against the running app with agent-browser, captures snapshots/screenshots as evidence, and records pass/fail. The tech lead must independently rerun affected journeys after integration.

## Evidence format

Each run records:

- application build/commit SHA;
- environment (Web or Desktop);
- journey ID;
- preconditions;
- actions performed;
- observed result;
- expected result;
- screenshot/snapshot evidence path;
- network/console error status;
- final pass/fail.

## Journey matrix

| ID | Journey | Web | Desktop | Future Mobile | Primary owner |
|---|---|---:|---:|---:|---|
| J01 | First launch / profile selection / onboarding | Yes | Yes | Yes | Worker 1 |
| J02 | Home discovery / hero / rows / intent entry | Yes | Yes | Yes | Worker 1 + 2/3 |
| J03 | Long-form Watch browsing | Yes | Yes | Yes | Worker 2/3 |
| J04 | Shorts vertical discovery | Yes | Yes | Yes | Worker 2/3 |
| J05 | Unified search | Yes | Yes | Yes | Worker 1 + 2/3 |
| J06 | Item detail / availability / realization choice | Yes | Yes | Yes | Worker 1 + 2/3 |
| J07 | Official embed playback | Yes | Yes | Yes | Worker 2/3 |
| J08 | Contained Browser playback | Yes | Yes | Constrained | Worker 2/3 |
| J09 | External playback fallback / return context | Yes | Yes | Yes | Worker 2/3 |
| J10 | Like/save/action synchronization truth | Yes | Yes | Yes | Worker 1 |
| J11 | Library / watchlist / history | Yes | Yes | Yes | Worker 1 |
| J12 | Cross-device resume | Yes | Yes | Yes | Worker 1 |
| J13 | Account/profile/identity lifecycle | Yes | Yes | Yes | Worker 1 |
| J14 | Source connect / reauthorize / disconnect | Yes | Yes | Yes | Worker 1 |
| J15 | Recommendation feedback controls | Yes | Yes | Yes | Worker 1 |
| J16 | Anti-tunnel / exploration after a single watched topic | Yes | Yes | Yes | Worker 1 |
| J17 | Explicit intent: learn / happier / surprise / tonight / friend taste | Yes | Yes | Yes | Worker 1 |
| J18 | Attention modes: mindful / balanced / immersive / custom | Yes | Yes | Yes | Worker 1 |
| J19 | WebFlix model / BYOM / local model policy | Yes | Yes | Yes | Worker 1 |
| J20 | AI subtitles / translation / transcription / dubbing / commentary | Yes | Yes | Constrained | Worker 1 |
| J21 | Authorized torrent acquisition | Limited status UX | Yes | Future | Worker 3 |
| J22 | Torrent metadata and file selection | Limited status UX | Yes | Future | Worker 3 |
| J23 | Torrent playback before full completion | No native protocol | Yes | Future | Worker 3 |
| J24 | Torrent background completion | No native protocol | Yes | Future | Worker 3 |
| J25 | Torrent interruption / restart / resume | No native protocol | Yes | Future | Worker 3 |
| J26 | Verified local asset appears in Library | Status/read | Yes | Future | Worker 1 + 3 |
| J27 | Native local media playback | Constrained | Yes | Future | Worker 3 |
| J28 | Provider credential expiry/recovery | Yes | Yes | Yes | Worker 1 + lead |
| J29 | Network loss / playback recovery | Yes | Yes | Yes | Worker 2/3 + lead |
| J30 | Unsupported capability honesty | Yes | Yes | Yes | Worker 1 + 2/3 |
| J31 | Cross-platform Web/Desktop parity | Yes | Yes | Future | Lead |
| J32 | Source-neutral identity: same item, multiple realizations | Yes | Yes | Yes | Worker 1 |
| J33 | Bring Your Own Feed: import, preview, confirm, sync, provenance | Yes | Yes | Future | Worker 1 + 2/3 |
| J34 | Capability discoverability from normal product surfaces | Yes | Yes | Yes | Lead + 2/3 |
| J35 | Production capability parity / no stale completion states | Yes | Yes | Future | Lead |
| J36 | Major user journey completion / no dead-end discovery | Yes | Yes | Future | Lead + 1/2/3 |
| J37 | Anonymous public viewing without WebFlix login | Yes | Yes | Yes | Lead + 1/2 |
| J38 | First-class authorized torrent playback | Yes (WebRTC-capable only) | Yes | Future | Worker 3 + Lead |
| J39 | Multimodal media intelligence / semantic moment discovery | Yes | Yes | Yes | Worker 1 + 2/3 |

## Core acceptance details

### J01 — First launch
Expected: user can choose/create the intended profile, understand primary navigation, optionally configure sources, and land in a useful discovery state without implementation diagnostics.

### J02 — Home discovery
Expected: hero, Continue Watching when applicable, personalized/discovery rows, Shorts entry, source-neutral cards, and a direct way to state current intent.

### J04 — Shorts
Expected: vertical feed, stable current card during presentation, forward skip/rerank semantics, like/save/feedback, no fake provider progress, and controls to influence future recommendations.

### J06 — Item detail
Expected: canonical content identity, metadata, availability, realizations, resume state, save/like, and a simple play decision. Raw connector capability diagnostics remain secondary.

### J08 — Browser playback
Expected: provider playback remains inside a WebFlix-owned contained browser surface whenever technically and legally permitted. Provider security and DRM are not bypassed.

### J10 — Actions
Expected: UI differentiates WebFlix-confirmed state from provider-confirmed synchronization. Unsupported provider actions never appear as successful.

### J15 — Recommendation feedback
Expected: More like this, Not interested, Don't recommend creator/source, Already watched, and reversible feedback affect future candidate composition.

### J16 — Anti-tunnel
Expected: after watching a concentrated topic, future recommendations remain capable of exploring adjacent and unrelated interests unless user explicitly requests narrow continuation.

### J17 — Intent
Expected: intent can be temporary/session-scoped without corrupting long-term preferences.

### J18 — Attention
Expected: selected attention mode changes policy behavior; system does not silently optimize for maximum time spent when user selected another mode.

### J21–J25 — Authorized torrent lifecycle
Expected Desktop flow:
authorized source -> magnet/.torrent -> metadata -> choose file -> preparing -> buffering -> playback -> background completion -> integrity verification -> Ready offline -> Library -> replay

Interruption must preserve sufficient persistent state to recover the session without falsely claiming completion.

### J28–J30 — Recovery and capability truth
Expected: failures are specific, recoverable where possible, and honest. A missing credential, unavailable provider, unsupported playback mode, interrupted torrent, or network failure must never look like silent success.

### J33 — Bring Your Own Feed
Expected:
choose Bring Your Feed
-> choose supported source or official export
-> authorize/import
-> preview imported relationships/items
-> confirm
-> persist normalized feed records + provenance
-> show source-native order distinctly from WebFlix-ranked discovery
-> show live/snapshot/stale truth
-> refresh/sync when supported
-> disconnect/re-authorize without deleting WebFlix-local library/history

The journey must prove imported feed data does not silently become permanent recommendation identity. At least one authorized connector/import method must be real, not a fixture-only production claim.

### J31 — Cross-platform parity
The same server-side profile state, library state, intent, and Entertainment Item identity must produce semantically equivalent Web and Desktop outcomes while allowing platform-specific capability differences.

## Browser-validation protocol

When a dev server is available:

agent-browser open <url>
agent-browser wait --load networkidle
agent-browser snapshot -i

After every navigation or DOM-changing interaction, obtain a fresh snapshot before using refs. Capture screenshots for final state and failure state. Desktop validation uses the platform's running UI plus equivalent browser/automation instrumentation where available.

Workers must not mark a journey complete from unit tests alone.

## Release threshold

Release acceptance requires J01–J20, J26, J28–J32 to pass on the Web adapter and corresponding applicable Desktop journeys to pass. J21–J25 and J27 must pass on the production Desktop native-media path before the torrent/native-media milestone is accepted.

R20 release acceptance additionally requires J33 to pass on Web and the corresponding Desktop procedure.

## Journey automation and evidence procedure (R16)

The reusable agent-browser harness lives in journeys/; it imports nothing from any @wfx package and consumes the running product as a user.

Every run records commit, environment, deterministic setup, per-journey status/assertions/artifacts/page-errors and explicit limitations. Workers must not silently skip a journey.

## R20 Journey automation note

J33 uses the same evidence contract as the existing golden journeys: commit SHA, environment, import method, preconditions, actions, observed/expected state, screenshot/snapshot evidence, errors, and final status.

## J34 — Capability discoverability

Starting from a fresh Home state, the user must be able to discover without documentation:
1. identity/profile entry;
2. source connection;
3. Bring Your Own Feed;
4. WebFlix / Following / BYOF feed-mode choice;
5. temporary intent;
6. attention mode;
7. recommendation feedback;
8. Model/BYOM/local-model controls;
9. AI media actions from content/player;
10. current playback realization / Where to watch;
11. Desktop/offline path;
12. Watchlist, History, and Offline Library.

Acceptance is based on the actual visible product path, not a direct URL, test-only control, or documentation link.

## J35 — Production capability parity

Run the same discoverability sweep against the live production deployment.

The production surface must not show stale "arrives later" copy or expose an accepted capability only through an unavailable transport.

At minimum verify R02 identity, R03 source read/connect, R05 recommendation/intent, R06 model/AI, R09 realization choice, R14 native/offline discovery, and R20 BYOF/feed-mode truth.

## J36 — Major user journey completion / no dead-end discovery

Start from fresh Home, with no documentation and no direct route navigation.

Web path:
Home
-> create/sign in
-> connect a source using a supported connector
-> return to source management with Connected truth
-> browse source-backed content
-> Bring Your Feed
-> preview + confirm an authorized import
-> switch among available feed modes
-> set temporary intent
-> change attention mode
-> open an item
-> choose Where to watch
-> use an AI action
-> provide recommendation feedback
-> use Shorts and verify Like/Save/Share after hydration
-> open Library
-> verify Watchlist / History / Imported Feeds / Offline truth
-> open Model & AI management
-> add/remove BYOM where supported
-> sign out
-> verify honest anonymous state

Desktop extension:
repeat shared semantic steps, then verify local-model truth, authorized acquisition/offline flow, verified asset -> Library, and interruption/recovery where applicable.

J36 blocks release when:
- Create Account is not visible/functioning;
- Connect a source loops back to the same empty state;
- BYOF cannot progress once a supported source is connected;
- BYOM is API-only/direct-URL-only;
- hydrated Shorts actions are missing where the source advertises them;
- an important failure has no useful next action;
- Web/Desktop diverge in shared semantics;
- stale accepted-lane completion copy returns.

## Discoverability law

Existing journeys remain acceptance contracts. J34/J35 verify reachability. J36 verifies that the user can actually finish the journey after reaching the capability.

UI work that passes component tests but fails J36 is incomplete.

## ShareNet-inspired visual acceptance

Affected R21/R22 UI journeys must verify the visual language in docs/architecture/webflix-design-language.md: calm warm-light surfaces where appropriate, clear typography hierarchy, restrained semantic state color, single primary actions, comfortable whitespace, progressive disclosure of diagnostics, mobile touch-target quality, and reduced-motion behavior. Visual review must not treat source/protocol diagnostics as the primary entertainment experience.


## J37 — Anonymous Viewing

Fresh browser, no WebFlix account: Home -> Search -> public title -> Play -> continue watching. No login gate may appear solely because the viewer lacks a WebFlix account. Provider-specific authentication remains a separate truth.

## J38 — First-Class Torrent Playback

Authorized torrent realization -> Where to watch -> peer copy -> metadata/file selection -> buffering -> playback before full completion -> resume -> background completion -> verified offline -> Library. Browser validation is limited to WebRTC-capable sources; Desktop validates the complete native path.

## J39 — Multimodal Media Intelligence

Natural-language semantic search -> title/moment result -> transcript/chapters -> visual-event query -> timestamp jump -> AI translation/subtitle action -> model/provenance truth.


## J40 — YouTube viewer parity

Fresh user, no documentation:

Home -> Search -> open video -> Play -> use player controls -> browse adjacent content -> queue/watchlist/playlist -> Shorts -> feedback -> Library/History.

Expected:
- every exercised viewer-facing YouTube behavior has a WebFlix pairing in docs/validation/youtube-parity-lab.md;
- WebFlix-only capabilities encountered during the same journey are contextual and familiar rather than administration-only controls;
- no dead buttons, stale capability copy or placeholder state;
- Web/Desktop semantics remain equivalent where the underlying capability exists.

## J41 — YouTube-equivalent playback startup

For benchmark content available on both systems where possible, run the same browser/device/network profile in cold and warm-cache modes.

Measure:
- navigation-to-player-visible;
- click-to-first-frame;
- click-to-audible;
- time-to-playable;
- startup failure;
- first-60-second rebuffer ratio;
- seek response;
- control response;
- transient recovery;
- realization-switch time.

Acceptance:
- p50 TTFF <= YouTube + 150 ms;
- p75 TTFF <= YouTube + 300 ms;
- p95 TTFF <= YouTube + 750 ms;
- startup failure <= YouTube + 0.5 percentage points;
- first-60-second rebuffer ratio <= YouTube + 0.25 percentage points;
- one obvious play action for supported content;
- no nonessential AI/recommendation/indexing work blocks first frame;
- authorized torrent playback starts from verified playable data where supported.

## J42 — WebFlix extension parity

Exercise canonical identity -> Where to watch -> provider/peer/torrent realization -> BYOF context -> recommendation intent/attention -> AI actions -> semantic moment search -> Library/offline/provenance.

Expected:
- every WebFlix-only capability has a placement decision;
- the placement follows the familiar video interaction grammar;
- no feature requires an architecture dashboard;
- anonymous public viewing remains frictionless;
- torrent remains first-class;
- platform/source capability limits remain honest.

## R24 visual/performance acceptance

Affected R24 UI journeys must include agent-browser snapshots/screenshots plus timing evidence. A visual pass without playback measurements is not sufficient, and a timing pass with a dead-end or unfamiliar interaction is not sufficient.


## J43 — Realtime translation

Fresh playable media with an authorized accessible audio stream:

Play -> Translate -> choose target language -> original + translated captions -> speaker change -> optional translated speech -> temporary network interruption -> reconnect -> normal playback.

Expected:
- base playback begins independently of translation;
- source transcript and translated output stream incrementally;
- source/translation alignment remains understandable;
- speaker attribution is truthful;
- visual context is used only when the media adapter can lawfully provide frames;
- translated speech is optional;
- voice cloning is never enabled without explicit consent/rights;
- translation failure falls back to original playback/captions;
- no provider credential reaches the client;
- Web/Desktop semantics agree on supported paths;
- torrent/local/live playback may use the same realtime session seam.

R25 release acceptance additionally requires latency/cost evidence and fresh agent-browser/native evidence.

## R35b — The journey-suite re-encode to the current product grammar (2026-09-28)

**Additive record (nothing above is reworded).** The R34-C production
sweep (evidence/r34c/) adjudicated 32 of the J01–J39 journey specs as
STALE-GRAMMAR: they bind the pre-R24→R30 product grammar (predominantly
R28-B's home/item/player restructure — one-click `/player` card links,
`/item` demoted to the card kebab's Details deep action, the
ActionButtons/acquisition-panel mounts on `ItemDetailSurface` — and
R29-B/R30-B/R33-B's shell/rail grammar). The R35b lane
(`wfx/r35b/journeys`, base `acff71b8b363`) re-encoded those 32 specs to
the CURRENT grammar without weakening a single journey's check
strength:

- **26 grammar-drift re-encodes** — each changed assertion cites the
  grammar element it now binds (the R28-B one-click `/player` href, the
  `[data-wfx-card-details]` deep path, the R33-B rail set, the R28-B
  chip-bar home composition, the R29-B watch-kebab report rows, the
  R29-B WatchActions split pill). The user-visible intent is preserved
  assertion-for-assertion where the surface still exists.
- **6 production-neutral re-encodes** (J04, J14, J15, J16, J33, J38) —
  the fixtures-catalog/config bindings became boot-neutral: J04's
  position pill binds the `N / M` grammar (not the fixtures page size);
  J14's source card binds the typed per-boot truth through the loud
  mode badge; J15/J16's note predicates bind the frozen
  replacement/kept-runway vocabulary (both boots' wordings); J33's
  determinism drive binds the typed 200-or-refusal truth; J38 binds the
  where-to-watch grouping law + the typed service-mode absences. Each
  cites the R23 production sweep (evidence/r23/production-sweep.md) as
  the production truth of record, and each was verified green on BOTH
  the fixtures boot and the live production surface.
- The honesty proof (evidence/r35b/honesty-proof.md): three
  representative classes failed under exact simulated grammar
  regressions (the mutations and the failing assertions recorded) —
  the re-encoded specs have teeth.

**The honest remaining gap (recorded, never silently skipped):** J40,
J41, and J43 — outside the R34-C sweep's scope and outside R35b's owned
file set — fail on the current fixtures boot with the same R28-B
stale-grammar class (verified byte-identically at the base commit;
evidence/r35b/guards.md §4). A journey-spec update work item for those
three (the same J01-precedent procedure) is the recorded follow-up.

The evidence of record for the re-encode: evidence/r35b/ (the grammar
survey plan.md, the full-suite run manifest, the production-boot
verification, the honesty proof, the guards, the battery summary).

## R38-B — J48 the studio edit + customize round trip (2026-09-28)

**Additive record (nothing above is reworded).** The survey's WAVE R38
studio journey (§1 row 30 + §2 "R38-B (studio surfaces)") is encoded as
**J48** — `journeys/web/j48-studio-edit-customize.ts` — the next free
catalog number after J44 (the survey's "J47" numbering belongs to the
R38-A upload lane and J45/J46 to R37's live lane; neither is at the
R38-B base). The walk, driven as a user over the fixtures boot:

- **The content list** (`/studio`): the studio manages the catalog's
  own channel (the honest binding — the same channel R36's page
  renders); the published rows are the channel's REAL catalog items (9
  on this boot — the same discovery-derived feed); the drafts/scheduled
  rows are this device's own studio records with the honest empty
  states.
- **The draft round trip**: create (the typed saved state) → RELOAD →
  reload-durable → schedule → the scheduled state + the honest publish
  note (publishing into the catalog lands with the upload wave).
- **The details editor**: the catalog's own truth renders (the
  provenance panel) → the title/description/visibility edit saves →
  RELOAD → the composed truth persists with the original named.
- **The comments moderation** (the R28 composition — the ONE store):
  sign in (the scripted persona), post a comment ON THE WATCH SURFACE,
  then in the studio: PIN (the studio's persisted record) → REPLY (a
  real comment — the watch surface renders it) → HOLD (the comment
  LEAVES the watch surface's rendered truth) → APPROVE (it returns).
- **The analytics** (the honest map): the impressions/subscribers/
  demographics panels render their typed absences with the frozen
  sentences (never a fabricated chart); the real local truths render
  their real numbers (the journey's own comment + reply + like).
- **The customization** (the domain-graph seam): the base derived truth
  renders (R36's derivation) → the banner/avatar/handle/description
  edit saves through the graph's channel-profile seam → the composed
  preview → RELOAD → persisted. The channel page still renders the
  DERIVED truth (the byte-compatible read — J44's own assertions; the
  channel page's read-side binding of the customization record is the
  lane's recorded merge-time compose, evidence/r38b/DIVERGENCES.md).
- **The anonymous law**: the studio surfaces never redirect to a
  sign-in wall.

**PASS 71 assertions** on the final fresh boot (the manifest + 9
artifacts: evidence/r38b/journeys/final-run/). The affected-set
verification (J01–J44: 39 PASS, the 3 pre-existing base fails
byte-identical, 1 environmental block proven base-identical, zero new
failures) + the battery gates: evidence/r38b/ (guards.md,
journeys-affected/summary.md).
