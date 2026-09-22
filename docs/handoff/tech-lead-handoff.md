# WebFlix Tech Lead Handoff — Remediation Freeze

WebFlix is the **Universal Entertainment OS**. The repository is the source of truth.

## Canonical read order

1. docs/architecture/webflix-remediation-architecture.md
2. docs/architecture/byof-architecture.md
3. docs/architecture/webflix-frozen-architecture.md
4. docs/architecture/contracts.md
5. docs/architecture/product-boundaries.md
6. docs/architecture/dependency-graph.md
7. docs/work-items/index.md
8. docs/plans/2026-09-16-webflix-remediation-plan.md
9. docs/plans/2026-09-20-webflix-major-journey-hardening-plan.md
10. docs/validation/webflix-golden-journeys.md
11. docs/validation/competitor-validation.md
12. docs/plans/2026-09-20-webflix-youtube-parity-performance-plan.md
13. docs/validation/youtube-parity-lab.md
14. Actual source/tests/imports/configuration in the assigned worktree

The 2026-09-16 remediation documents supersede the legacy client/native-media sequencing. Do not infer completion from legacy WFX issues or summaries.

## Mission

Deliver a working product, not merely architecture scaffolding:

- source-neutral entertainment discovery;
- real account/profile identity;
- connected source management;
- Library/history/Continue Watching;
- long-form and Shorts experiences;
- explicit recommendation controls and anti-tunnel behavior;
- WebFlix/BYOM/local model control;
- AI media transformations;
- contained BrowserHost where permitted;
- production Web adapter;
- production Desktop adapter;
- real native media service;
- full authorized torrent engine;
- playback-aware torrent scheduling;
- background completion and recovery;
- one shared runtime that makes future Mobile an adapter rather than a rewrite;
- Bring Your Own Feed, with authorized import/sync of existing external feed relationships.

## Three-worker dispatch

### Worker 1 — Shared Experience/Intelligence

R01-R06, plus assigned R15, R20, R21 and R22 shared work.

Private paths principally include packages/client-runtime/**, packages/platform-contracts/**, packages/experience/**, packages/domain/**, packages/recommendation/**, packages/model-fabric/**, packages/persistence/**, and packages/actions/**.

### Worker 2 — Web

R07, Web portions of R09/R16, R20, R21 and R22.

Private paths principally include apps/web/** and the Web platform adapter.

### Worker 3 — Desktop/Native/Torrent

R08, R10-R14, Desktop portions of R16-R17, R20, R21 and R22.

Private paths principally include apps/desktop/**, packages/native-media/**, packages/torrent-engine/**, and the Desktop/native platform adapter.

### Lead

R00, shared-contract changes, architecture changes, cross-lane dependencies, R16-R19, integration, browser/native validation, security/privacy review, deployment, and final acceptance.

## Critical torrent directive

The torrent engine is a first-class product subsystem.

It must support, through a mature protocol implementation:

authorized magnet/.torrent -> metadata -> file selection -> torrent session -> piece map -> integrity -> playback-aware prioritization -> buffering -> playback -> background completion -> verified local asset -> Library

It must support interruption/restart/recovery. It must not be implemented as a mock, fixture, copied protocol implementation in TypeScript, or an external-download handoff presented as native playback.

The production Desktop path must not use stubEngine().

## Platform rule

Web/Desktop/Mobile are adapters over the shared Client Runtime. The runtime owns product semantics. Platform adapters own storage, browser, lifecycle, native media, notifications, background work, sharing, and other platform capabilities.

No provider SDK calls belong in shared product logic.

## Browser validation rule

UI-affecting work is not complete without agent-browser evidence.

Worker loop:

implement -> run app -> agent-browser journey -> snapshot/screenshot -> inspect -> fix -> test -> report

After navigation or DOM changes, workers must obtain fresh snapshots before using element references. The Lead independently reruns affected journeys after integration.

## Dispatch packet required for every assignment

Include:

- R ID;
- dependency IDs;
- frozen interfaces consumed/produced;
- allowed paths;
- forbidden scope;
- tests required;
- affected golden journey IDs;
- expected evidence;
- integration handoff requirements.

## Reject drift

Reject:

- direct provider SDK calls in shared product/core code;
- duplicated Web/Desktop product rules;
- fixture fallback in production;
- Desktop stubEngine() as production behavior;
- torrent protocol logic escaping packages/torrent-engine;
- unauthorized acquisition;
- DRM/access-control/captcha/anti-bot circumvention;
- source capability claims not backed by real adapter behavior;
- recommendation systems that permanently tunnel on the last topic;
- model-controlled authorization;
- credentials entering AI prompts;
- local storage replacing canonical server persistence;
- external actions reported successful without provider confirmation;
- engineering diagnostics presented as the primary entertainment UX.

## Integration sequence

1. Land R00 governance freeze.
2. Freeze R01 shared runtime/platform contracts.
3. Dispatch Worker 1 R02-R06, Worker 2 R07, Worker 3 R08 concurrently where dependencies permit.
4. Dispatch R09 and R10 once contract seams are frozen.
5. Worker 3 runs the R10 -> R11 -> R12 -> R13 native/torrent chain.
6. Worker 1 + Worker 3 integrate R14 native acquisition UX.
7. Integrate R15 actions.
8. Lead runs R16 browser/golden journey harness against Web and Desktop.
9. Run R17 failure/recovery hardening.
10. Run R18 security/privacy/authorization audit.
11. Run R19 production/release acceptance.

Before declaring any item or phase complete, inspect the actual repository state, tests, imports, persistence, schemas, runtime wiring, platform packaging, and browser/native behavior directly. Worker summaries are evidence of intent, not evidence of completion.

## Post-release R20 — Bring Your Own Feed

Worker 1 owns shared feed/import contract, provider feed capability, reconciliation.
Worker 2 owns Web BYOF onboarding/feed UX and J33 Web evidence.
Worker 3 owns Desktop import/file-picker/background-sync adapter work and J33 Desktop evidence.
Lead owns contract ratification, provider authorization review, integration, and final J33 acceptance.

BYOF must distinguish WebFlix ranking from source-native ordering and must never present a snapshot as live.

## Post-release R21 — Journey-driven product discoverability

R21 implemented contextual discovery while keeping Home / Watch / Shorts / Search / Library / Settings as the primary navigation.

Worker 1 owned R21-A/B/C shared capability/view-model and production transport wiring.
Worker 2 owned R21-D/E/F Web product surfaces and browser evidence.
Worker 3 owned R21-G/H Desktop/native product surfaces.
Lead owned R21-I integration, production parity, stale-copy elimination, and J34/J35 acceptance.

R21 is accepted in the current main branch.

## Post-release R22 — Major user-journey completion + dead-end hardening

### Audit-derived reasons for R22

The fresh production re-audit found three actionable completion gaps:

1. The signed-out identity path says "Sign in / Create a profile", but the actual Service-mode Settings UI only exposes sign-in even though /api/auth/register and authRegister are real.
2. "Connect a source" is discoverable but, in an empty-source state, points back to Settings → Sources without exposing a connector chooser; a first-time user therefore cannot begin the connection journey.
3. Model/BYOM shared operations exist (bind/unbind provider, policy writes, provider registry), but the visible Model & AI surface does not provide a normal add/manage provider control.

The audit also found two areas that should not be rewritten:
- BYOF is correctly contextual and should remain dependent on a supported source being connected.
- Shorts Like/Save/Share semantics already exist in the hydrated ShortsFeed implementation; R22 needs fresh browser evidence, not a second action system.

### Worker 1

R22-A source-discovery/first-connect contract.
R22-B account-creation journey contract.
R22-C BYOM management read model and typed binding management.

### Worker 2

R22-D Web connector chooser/connect/recovery flow.
R22-E Web account creation UX.
R22-F Web Model & AI BYOM management.
R22-G fresh hydrated Web journey evidence.

### Worker 3

R22-H Desktop source/auth parity.
R22-I Desktop Model/BYOM parity.
R22-J Desktop major-journey evidence.

### Lead

R22-K contract ratification.
R22-L cross-lane integration and production verification.
R22-M issue/work-registry reconciliation.

### R22 frozen user-path law

Home -> create/sign in -> connect source -> browse -> Bring Your Feed -> preview/confirm -> feed mode -> Personalize -> Watch/Shorts -> item -> Where to watch -> AI action -> feedback -> Library -> Model & AI management -> sign out.

Desktop adds local-model truth and native/offline continuity.

No new architecture dashboard or conceptual top-level Feed/BYOF navigation is permitted.

### R22 dispatch order

Freeze A/B/C first. Then Worker 2 and Worker 3 may work concurrently. Lead integrates only after G/J evidence is fresh, then reruns J36 plus affected J01-J35 and performs the production sweep.

The canonical detailed plan is docs/plans/2026-09-20-webflix-major-journey-hardening-plan.md.


## Post-release R23 — Open viewing, first-class torrent and AI media intelligence

Canonical plan: docs/plans/2026-09-20-webflix-open-viewing-torrent-ai-plan.md

The product law is now explicit: public viewing is accountless. Login is optional for public read/play and is required only for durable identity, account-scoped personalization, provider authorization or mutations requiring identity. Provider authentication is never conflated with WebFlix authentication.

Torrent is not an offline afterthought. It is a first-class source/realization that participates in canonical identity, Where to watch, playback, resume, AI actions, Library and recovery. The existing Media Surface modes stay platform modes; torrent enters as a realization/source transport and can satisfy native playback on Desktop or a browser-capable rung where the platform truly supports it.

R23 research direction: R2T2/Confucius4-R2T2 for low-latency live ASR; VideoPrism/Qwen2.5-VL/MOSS-Transcribe-Diarize/Whisper/BGE-M3 through Model Fabric; Hugging Face Inference Endpoints for production open-model hosting; Transformers.js/WebGPU for optional private browser-side inference.

New acceptance journeys: J37 Anonymous Viewing, J38 First-Class Torrent Playback, J39 Multimodal Media Intelligence.


## Post-release R24 — YouTube parity + playback performance lab

Canonical plan: docs/plans/2026-09-20-webflix-youtube-parity-performance-plan.md  
Canonical lab contract: docs/validation/youtube-parity-lab.md

R24 is the approved feature/UX/UI parity layer. It is a viewer-focused YouTube reference lab, not a visual clone.

### Worker 1 — shared
Own the complete viewer-feature taxonomy, parity classifications, shared placement/terminology seams, playback performance telemetry and startup contracts.

### Worker 2 — Web
Own the Web YouTube viewer audit, Web parity corrections, player/control/search/Shorts/Library parity, startup benchmark instrumentation and agent-browser evidence.

### Worker 3 — Desktop/native/torrent
Own Desktop parity, native player affordances, torrent-first playback parity, startup/recovery measurements and Desktop evidence.

### Lead
Coordinate the live parity lab with all three workers, verify the current YouTube reference behavior, ratify classifications, reject missing viewer features, integrate the lanes, compare startup metrics and accept J40-J42.

### R24 performance law
"Videos should load just as easily as YouTube" is a measured release requirement. Use the same content/device/browser/network where possible, cold and warm cache, and the R24 thresholds. No nonessential AI/recommendation/indexing work may block first frame.

### R24 UX law
Every WebFlix-only capability remains first-class but should appear where a user would naturally expect it in a mature video platform: contextual, one obvious primary action, stable terminology, progressive disclosure and platform capability truth. No architecture dashboard may be required to use a product capability.

### R24 torrent law
Authorized torrent copies are shown alongside other ways to watch, use the same player semantics, and are evaluated on startup/recovery performance. Torrent must not be reduced to a download-only experience when playback is supported.

UI-affecting R24 work requires fresh agent-browser evidence; the Lead independently reruns J40-J42 plus affected J01-J39 after integration.


## Post-release R25 — Qwen3.8 LiveTranslate realtime media translation

Canonical plan: docs/plans/2026-09-20-webflix-qwen-livetranslate-plan.md

R25 adds a provider-neutral realtime translation session seam because the current batch TransformOperation model is not appropriate for continuous WebSocket media.

Worker 1:
- realtime session contract;
- Model Fabric realtime task/capabilities;
- provider provenance/licensing/service metadata;
- router/cost/privacy policy;
- normalized streaming events.

Worker 2:
- WebSocket bridge;
- player Translate control;
- bilingual subtitles/transcript;
- translated speech controls;
- Web anonymous behavior;
- browser evidence.

Worker 3:
- native audio capture/output;
- torrent/local/live integration;
- translated-audio buffering;
- reconnect/recovery;
- Desktop evidence.

Lead:
- current Qwen API/source verification;
- Vercel realtime deployment verification;
- provider/security/privacy boundary;
- voice-cloning consent gate;
- end-to-end latency/cost benchmarks;
- J43 acceptance.

### R25 non-negotiables

Do not:
- expose Qwen credentials to the browser;
- make Qwen a direct shared-product dependency;
- capture protected provider media by bypassing browser/DRM/access controls;
- block first-frame playback on translation;
- silently clone a speaker's voice.

Qwen3.8 should complement R2T2 for live ASR and the existing batch models for long-form transcription/indexing.


## CURRENT CORRECTIVE TAKEOVER — 2026-09-22

### Lead must treat the current production product as NOT YouTube-parity-complete

A fresh production-first re-audit found a material gap between implementation-lane evidence and the actual consumer product. The prior R24 engineering evidence is useful, but it is **not acceptance evidence** for production UX/playback parity.

Current truth:

- Web production deployment: `main @ 22f9051838ab2deb67f8e228584600916a612a2a`.
- Web production loads, but a representative real item/player route did not independently prove first-frame playback; the live player reported `buffering`.
- Production discovery cards currently use generated gradient/initial artwork rather than source video thumbnails. This is not acceptable for the YouTube parity goal.
- A real item route does resolve a real YouTube embed URL, so the source/playback path is not merely a fixture claim; however, successful end-to-end playback still requires fresh production browser proof.
- Production Search explicitly reports semantic search unavailable on the live transport.
- Production Player exposes Translate/Live Captions, but explicitly reports that the realtime translation bridge is not serving on the current host.
- The current catalog/content encountered did not provide an authorized peer/torrent realization in the normal user flow, so torrent discoverability is not production-proven merely because Desktop evidence is green.
- The current API project has a newer READY R25 integration deployment on `9621e4dbde21b06373520076e2b15a47e3457193`, while the production-target API deployment observed in Vercel is still `7ee847c4e7be3053091a34b8e1f4aaad5919acc6`. Treat Web/API production-version skew as a first-class investigation item before rewriting product logic.

### Hard rebaselining law

Do not close R24 from:

- fixture-only journey evidence;
- synthetic provider/browser doubles;
- route existence;
- rendered capability labels;
- internal benchmark content;
- unit/integration test counts;
- prior acceptance comments.

A capability is green only when a fresh user can use it against the current production deployment.

### R24 acceptance gate is reopened

R24 remains OPEN until all of the following are independently proven:

1. Real source thumbnails render on Home/Watch/Search/related surfaces for representative source-backed media.
2. A fresh anonymous user can open representative public videos from normal discovery surfaces.
3. The video reaches a real first frame and continues playing.
4. Player startup/control/seek/recovery work in production.
5. Home, Watch, Search, cards, Item and Player form a coherent YouTube-like viewer experience rather than a capability/architecture dashboard.
6. WebFlix-only capabilities remain present but are progressively disclosed/contextually placed.
7. An authorized peer/torrent realization is discoverable in the same content decision flow on a known eligible title.
8. The same public video is tested on both YouTube and WebFlix where technically possible, under the same browser/device/network profile.
9. J40/J41/J42 are rerun against production with fresh browser evidence.
10. Affected J01-J39 are rerun after integration.
11. No production capability shown in the UI is backed by an unavailable transport.

### R23 acceptance requires current-production revalidation

R23 remains implementation-complete, but the acceptance record must be revalidated because current production Search reports semantic search unavailable despite the prior R23 acceptance record claiming production multimodal intelligence.

Re-run:

- J39 semantic/moment search;
- J37 anonymous playback;
- J38 first-class torrent on a known torrent-eligible content fixture/catalog item;
- current Web/API deployment parity.

Do not silently rewrite the R23 acceptance record; append a dated revalidation record.

### R25 production completion is also open

The realtime translation implementation is substantial, but current production reports the bridge unavailable.

Before declaring R25 green:

- verify the production Web/API/bridge deployment topology;
- verify Qwen credentials/server environment;
- verify the realtime WebSocket bridge is reachable from the production Web surface;
- run a real-provider benchmark;
- prove Translate -> target language -> streaming bilingual captions -> optional translated audio -> reconnect -> playback continuity;
- keep translation failure non-blocking to base playback.

The deterministic provider double proves architecture ordering only. It does not prove Qwen production readiness.

### Immediate priority order

The Lead must execute in this order:

```text
P0  Freeze + reproduce production failures
    |
    +--> verify Web/API SHA + alias parity
    +--> reproduce one-click-to-play failure
    +--> identify why real thumbnails are absent
    +--> reproduce semantic-search-unavailable
    +--> reproduce realtime-bridge-unavailable
    |
P1  Real playback first
    |
    +--> representative public video catalog
    +--> real thumbnails
    +--> real Play -> first frame -> continuous playback
    +--> recovery / external / embed truth
    |
P2  YouTube viewer UX rebuild
    |
    +--> content-first Home/Watch/Search cards
    +--> real source artwork
    +--> familiar player/page hierarchy
    +--> reduce capability/diagnostic prominence
    +--> preserve WebFlix contextual extensions
    |
P3  First-class source parity
    |
    +--> provider realizations
    +--> eligible authorized peer/torrent realization
    +--> same player semantics
    |
P4  AI production convergence
    |
    +--> semantic search / moment search live
    +--> Qwen realtime translation live
    |
P5  Comparative acceptance
    |
    +--> same-content YouTube benchmark
    +--> J40/J41/J42 production evidence
    +--> affected J01-J43 regression
    +--> final acceptance
```

### Three-worker corrective allocation

#### Worker 1 — Shared/runtime/data

Own:

- production capability truth contracts where the live transport is currently behind;
- catalog/media-artwork metadata contract, ensuring real thumbnail/artwork provenance can flow through the shared runtime;
- playback/realization read-model truth needed by Web;
- semantic-search transport diagnosis and repair;
- R25 realtime route/health contract;
- regression contracts that prevent a UI capability from rendering as available when its transport is unavailable.

Do not change:
- Web visual implementation;
- Desktop native UI;
- provider security boundaries;
- source authorization semantics.

#### Worker 2 — Web/product UX

Own:

- real source thumbnail rendering;
- Home/Watch/Search card redesign;
- content-first information hierarchy;
- real end-to-end public video playback;
- production player startup/first-frame proof;
- YouTube-like watch-page UX;
- progressive disclosure of provenance/diagnostics;
- contextual placement of Where-to-watch, AI, attention and recommendation controls;
- production browser evidence for J40/J41/J42 and affected J01-J39.

Critical rule: do not declare a visual fix complete from screenshots containing fixture/gradient artwork. Evidence must come from representative real source-backed content.

#### Worker 3 — Desktop/native/torrent

Own:

- known torrent-eligible production/demo content path;
- Desktop torrent first-class realization evidence;
- same-title/source-neutral player semantics as Web;
- thumbnail/artwork parity where Desktop owns the catalog surface;
- native playback benchmarking;
- recovery/offline proof;
- Desktop regression after shared/runtime changes.

Do not allow Desktop to become a separate product grammar.

#### Lead

Own:

- P0 production reproduction and Web/API deployment parity;
- assignment/dependency coordination;
- frozen UX laws;
- YouTube reference audit;
- source-thumbnail correctness;
- real same-content YouTube comparison;
- production credentials/environment;
- agent-browser independent reruns;
- acceptance and issue/registry reconciliation.

### UI/product law for this takeover

WebFlix should feel like a world-class consumer video product first.

The following must remain true:

- the content thumbnail is the visual anchor;
- Play is the obvious primary action;
- title/channel/source metadata has a familiar hierarchy;
- recommendation cards are visual and content-led;
- player chrome is familiar without cloning YouTube branding;
- provenance, model, source and capability diagnostics are progressively disclosed;
- WebFlix-only features appear exactly where the user's intent makes them relevant;
- no architecture/status dashboard is required to understand how to watch something.

### Production playback law

The shortest path from a user's decision to watch to the first playable frame is sacred.

The player must not wait for:

- semantic indexing;
- recommendation enrichment;
- AI actions;
- provenance expansion;
- social enrichment;
- analytics;
- Qwen translation.

A failure in any of those systems must leave the underlying public video playable when the realization itself is healthy.

### Fresh evidence required for completion

Each worker must attach:

- current production SHA;
- environment + browser/device;
- representative real-content IDs;
- exact route/realization;
- before/after screenshot;
- browser console/network error status;
- first-frame/startup evidence;
- relevant journey IDs;
- known limitations.

The Lead must independently repeat the final journeys.

### Forbidden completion shortcuts

Reject:

- "39/39 passed" as proof of visual parity;
- generated thumbnails as substitutes for real media artwork;
- route-level 200 as proof of playback;
- iframe presence as proof of video playback;
- fixture provider doubles as proof of production provider health;
- a catalog-only torrent contract as proof of user-facing torrent discoverability;
- an unavailable AI transport represented as an available feature;
- architecture/diagnostic panels presented as the main entertainment UX;
- any YouTube visual clone that copies branding/assets instead of interaction grammar.

### Final takeover acceptance

The Lead may only report the product green when a fresh user can:

```text
Home
 -> see real video artwork
 -> search
 -> open a real public video
 -> press Play
 -> actually see/hear it play
 -> use normal player controls
 -> discover related content
 -> use Shorts
 -> save/share/feedback
 -> see Where to watch
 -> use an eligible authorized peer/torrent realization
 -> use supported AI features
 -> use semantic/moment search
 -> use realtime translation where configured
 -> return to Library
```

and the same journey survives a fresh production browser run with no hidden direct routes or test-only controls.

