# WebFlix Journey-Driven Product Discoverability & Capability Surface Plan (R21)

> Purpose: turn the architecture's already-defined capabilities into an easily discoverable product experience by validating the major user journeys as a user, not merely as an engineer.
>
> Predecessor: R19 release acceptance and R20 Bring Your Own Feed. R21 does not reopen the frozen product boundaries; it closes the gap between implemented/runtime capability and user-visible product surface.

## Why R21 exists

A live production journey simulation exposed a repeatable failure mode: a capability can exist in shared runtime contracts, tests, and architecture documents while the normal user path still cannot discover or use it.

Observed examples from the running Web product and actual source:

- The primary shell exposes Home / Watch / Shorts / Search / Library / Settings, but identity/profile entry is only described as something that will arrive later.
- Settings > Sources can surface a missing readSources transport instead of a usable connection flow.
- Settings > Model & AI can still render “arrive with R06” language even though R06 is a completed architecture lane.
- Home and Watch can still describe recommendation behavior as “seeded until personal ranking ships — R05” even though R05 is complete.
- Item detail exposes Play, Like, Save, source capability diagnostics, and an offline explanation, but does not make the major product decisions discoverable: where to watch, recommendation intent, attention mode, AI transformations, feed mode, or an actionable native/offline path.
- Shorts exposes like/save/share and navigation, but no obvious intent/attention/recommendation controls.
- Expected standalone product routes for profile, sources, intent, recommendation controls, model/AI, transformations, BYOF/feed, following, download, and torrent management are not present in the Web adapter route surface.
- The architecture therefore appears richer than the product's visible information architecture.

R21 treats capability emergence as an acceptance property. A capability is not complete from the user's perspective merely because its contract or backend exists.

## Frozen UX law

The product keeps the existing primary surface vocabulary:

Home / Watch / Shorts / Search / Library / Settings

R21 does not introduce a competing second navigation system or an architecture dashboard.

Instead:

1. Contextual controls surface product capabilities where the user needs them.
2. Settings remains the detailed management center, but must not be the only way to discover important everyday actions.
3. The user should understand WebFlix through product concepts — what to watch, why it is shown, where it can play, what can be saved/offlined/transformed — not connector/protocol terminology.
4. Engineering diagnostics remain secondary. Capability truth is visible, but raw protocol/transport details are progressive disclosure.
5. Every important architecture capability gets at least one normal user entry point and one recovery path.
6. No stale “arrives in R0x” wording may survive a completed lane.
7. Web/Desktop/Mobile expose the same product semantics while respecting platform capability limits.
8. Unsupported is not undiscoverable. A user should be able to discover the capability and then learn why the current platform cannot execute it.

## Capability-to-surface map

| Architecture capability | Primary discovery surface | Contextual entry | Detailed management |
|---|---|---|---|
| Identity/profile | session menu | onboarding/home | Settings |
| Connected sources | Home/source strip | empty-state CTA, item availability | Settings > Sources |
| Following / BYOF | Home feed-mode control | Sources/import CTA | Settings > Sources |
| Recommendation policy | Home Personalize control | Watch + Shorts feed controls | Settings |
| Explicit intent | Home + Watch/Shorts feed control | temporary/session intent control | Settings |
| Attention mode | Home + Watch/Shorts feed control | current session | Settings |
| Recommendation feedback | item cards, item detail, Shorts | More/Not interested/etc. | Settings/history controls |
| Model/BYOM/local model | Settings > Model & AI | AI action tray from player/item | Settings |
| AI transformations | player + item detail | subtitles/translate/transcribe/dub/commentary tray | Model & AI |
| Source realization choice | item detail | player Where to watch / source switch | Settings > Sources |
| Browser/Embed/External fallback | player | playback failure/recovery | advanced playback detail |
| Native/offline acquisition | item detail | player/offline status + Library | Desktop settings |
| Torrent/native recovery | acquisition panel + Library | failed/preparing/buffering/completing state | advanced diagnostics |
| Canonical identity/availability | item detail + search | Where available source row | source configuration |
| Library/history/continuity | Library + Home Continue Watching | player resume | Settings/profile |
| Feed freshness/provenance | Home/BYOF feed header | source/feed status | Settings > Sources |

## Major journey simulation findings that become implementation requirements

### Discovery hierarchy

A first-time user should be able to infer, without reading documentation:

- WebFlix is a universal viewer across sources;
- they can connect sources or bring an existing feed;
- WebFlix can personalize the feed using explicit intent and attention policy;
- playback may stay inside WebFlix or hand off when necessary;
- Desktop adds local/offline/native capabilities;
- AI actions are part of the viewing experience;
- Library is source-neutral.

### Identity

The session/avatar area must be a real product entry point. Signed-out users need a discoverable sign-in/create-profile path. Signed-in users need profile switching and identity-scoped personalization.

The UI must never show “identity arrives later” after R02 has been accepted.

### Home

Home becomes the product's orientation surface:

- current feed mode: For you / Following / BYOF / Hybrid;
- Personalize affordance for intent + attention mode + exploration controls;
- Connect sources and Bring your feed entry points;
- Continue Watching;
- contextual recommendation feedback;
- a clear indication of why a row exists without exposing model internals.

### Watch and Shorts

Both discovery surfaces must provide lightweight, reversible controls for:

- current feed mode;
- current intent;
- attention mode;
- recommendation feedback;
- source/following/BYOF context where applicable.

The controls should not force the user into Settings for ordinary session changes.

### Search

Search remains source-neutral, but results should help users answer “where can I watch this?” without opening multiple unrelated pages.

Search/result cards should expose canonical identity and, where available, a compact availability/source summary. Filters or grouping may be progressive disclosure rather than permanent chrome.

### Item detail

Item detail becomes the decision hub:

Play / Where to watch / Save / Like / Personalize / AI / Make available offline

The user sees one canonical title first and source realizations second.

Raw connector capability badges remain available but secondary.

### Player

The player must make the active realization understandable:

- playing via source/realization;
- switch to another supported realization when one exists;
- captions/subtitles/translation/AI actions;
- feedback controls;
- recovery/fallback when playback fails;
- offline/native continuation where supported.

The precedence trace is a diagnostics affordance, not the main viewing experience.

### Library

Library must make its three important states immediately legible:

Watchlist / History / Offline

The Offline section should not feel like an afterthought, especially for Desktop where it is a first-class capability.

### Settings

Settings should become a management hub, not a capability graveyard.

Expected sections:

- Profile & identity
- Sources
- Feeds / Following / BYOF
- Recommendation & intent
- Model & AI
- Playback & platform
- General

Each section must contain real controls or an explicit platform/source limitation — not “arrives later” text.

### Desktop

Desktop should surface its extra powers at the moment they become useful:

- Make available offline from item detail;
- acquisition status in player;
- background completion in an unobtrusive status surface;
- native local playback from Library;
- file/import entry where supported;
- BYOF official-export/file import;
- clear Web-vs-Desktop capability differences.

### Web

Web must make native-only capabilities discoverable without pretending they are executable.

Example product copy:

“Available offline in the Desktop app”

is useful; a generic “Not available on Web” with no next step is not.

### BYOF

R20 feed import must be reachable from the normal product flow:

Home -> Bring your feed
or
Settings -> Feeds -> Bring your feed

After import, users must understand whether they are viewing:

- source-native order;
- WebFlix-ranked results;
- hybrid mode.

The imported relationship's freshness/provenance must remain visible without dominating the normal viewing experience.

## Work split for three concurrent workers

### Worker 1 — Shared capability/view-model wiring

#### R21-A — Capability discovery matrix and shared control contract

Freeze a typed product-surface matrix connecting architecture capabilities to contextual entry points and recovery paths.

Add only shared contract/view-model changes required to expose those controls. Do not create platform-specific business rules.

Affected concepts:

- identity/session;
- source/feed mode;
- intent/recommendation policy;
- model policy;
- realization/source selection;
- AI operations;
- acquisition/offline state.

#### R21-B — Identity/source/feed/controls transport completion

Inspect and complete the actual production transport/service wiring required by the Web/Desktop surfaces.

Specifically reject architecture-says-complete, transport-says-unavailable mismatches.

Acceptance includes:

- real profile/session read/write path;
- real source read path;
- real intent/policy read/write path;
- real model policy read/write path where already contracted;
- real BYOF entry path after R20;
- typed failures and recovery hints.

#### R21-C — Contextual recommendation/model/playback read models

Expose the existing shared semantics to UI-ready view models without moving product policy into adapters.

No new recommendation algorithm is introduced here. This lane makes existing R05/R06/R09/R14 semantics visible to the product surfaces.

### Worker 2 — Web product surface

#### R21-D — Web information architecture and discovery controls

Implement the contextual discovery layer across Home / Watch / Shorts / Search / Library / Settings / session menu.

Requirements:

- no new architecture/dashboard route;
- mobile and desktop Web layouts remain coherent;
- everyday controls are available in context;
- Settings holds detailed management;
- all important empty/error states contain the next useful action.

#### R21-E — Web item/player capability surfaces

Implement:

- canonical identity + availability summary;
- Where to watch / realization choice;
- AI action tray;
- recommendation/intent/attention entry;
- Desktop/offline affordance from Web;
- playback recovery/fallback entry;
- progressive-disclosure diagnostics.

#### R21-F — Journey evidence

Extend the golden journey suite with R21-specific discoverability checks and run them against the running Web product using the required browser evidence process.

### Worker 3 — Desktop/native product surface

#### R21-G — Desktop discoverability parity

Bind the shared controls to Desktop and surface platform-specific capabilities at the moment of use.

#### R21-H — Desktop acquisition/feed/AI discovery

Ensure:

- offline acquisition is reachable from content;
- acquisition state is visible during/after playback;
- verified offline assets are easy to find in Library;
- BYOF file/export flows are discoverable;
- native/browser playback differences are understandable.

### Lead

#### R21-I — Integration + production capability parity gate

The Lead must perform a fresh journey simulation after all worker integration.

Release is blocked by:

- stale R0x “not yet shipped” copy for accepted capabilities;
- routes or controls that exist in tests but cannot be reached from normal user flows;
- production Web transport that remains unavailable for an accepted feature;
- capability controls that only appear in diagnostics;
- Web/Desktop semantics diverging without an explicit platform capability reason;
- browser errors/console errors in affected journeys.

## Dependency graph

R20 -> R21-A

R21-A -> R21-B -> R21-C
R21-A -> R21-D
R21-C -> R21-E
R21-D -> R21-F

R21-A -> R21-G -> R21-H

R21-E + R21-F + R21-H -> R21-I
R21-B -> R21-I
R21-I -> J34 + J35 acceptance

Workers may start independent implementation after R21-A is ratified:

- Worker 1: R21-B, then R21-C
- Worker 2: R21-D, then R21-E; R21-F after the Web controls are stable
- Worker 3: R21-G, then R21-H

## New acceptance journeys

### J34 — Capability discoverability

A fresh user can start at Home and, without documentation:

1. reach identity/profile;
2. connect a source;
3. bring an existing feed;
4. switch between WebFlix / Following / BYOF feed modes;
5. set a temporary intent;
6. change attention mode;
7. give recommendation feedback;
8. find Model/BYOM/local-model controls;
9. launch an AI media action from content/player;
10. understand where the current item will play;
11. find the Desktop/offline path;
12. find Watchlist/History/Offline Library.

Acceptance target: every task is reachable from a contextual product entry point with no architecture terminology required.

### J35 — Production capability parity

Run the same discovery sweep against the production deployment.

The live product must not regress into stale “arrives later” states when the repository marks the capability complete.

Required checks include:

- R02 identity surface;
- R03 source read/connect surface;
- R05 recommendation/intent controls;
- R06 model/AI controls;
- R09 playback/realization choice;
- R14 native/offline discovery;
- R20 BYOF entry and feed-mode truth.

## Definition of done

R21 is complete only when:

- the capability-to-surface matrix is frozen;
- every important accepted capability has a normal user entry point;
- every important failure state has a useful recovery/next action;
- stale completion copy is removed;
- Web production transport matches the accepted runtime capability;
- Web/Desktop preserve shared product semantics;
- J34 and J35 pass with fresh browser evidence;
- affected existing journeys J01-J33 are rerun where their discoverability changed;
- no architecture-specific diagnostics are required to discover normal product actions;
- the final production deployment is smoke-tested from the user perspective.

## Evidence law

Architecture/contracts/tests establish that a capability exists.

Journey evidence establishes that a user can actually discover and use it.

Both are required.
