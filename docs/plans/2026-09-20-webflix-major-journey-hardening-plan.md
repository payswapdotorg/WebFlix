
# WebFlix — Major User-Journey Completion & Dead-End Hardening Plan

**Release:** R22  
**Date:** 2026-09-20  
**Status:** IMPLEMENTATION PLAN — frozen for execution after Lead ratification  
**Depends on:** R21 acceptance (9c4a1cd6da8921eda1d652d6c12ac21d546f5431)  
**Primary goal:** close the remaining journey-level gaps found by a fresh production re-audit without reopening the frozen WebFlix architecture or primary navigation.

## 1. Repository-truth baseline

The R21 integrated tree is accepted:

- main: 9c4a1cd6da8921eda1d652d6c12ac21d546f5431
- R21 integration: dc8ce0e52e118aca22e8884e5d9719d0c1eabdfc
- integrated gates: 3860 pass / 1 skip / 0 fail under the documented hardened bun test --parallel=1 run; lint 0 errors / 10 warnings baseline; typecheck clean; contract-check OK; lane-check OK.
- J34: 34/34 green after isolated reruns of the renderer-starvation tail.
- J35: production sweep against https://webflix-steel.vercel.app verified the major contextual discovery surface and stale-copy elimination.

R22 is not a rewrite of R21. It addresses the deeper question: can a new user actually complete the major journeys after discovering the capability?

The fresh re-audit used:
1. current production HTML/SSR from https://webflix-steel.vercel.app;
2. current main-branch source inspection;
3. current R21 acceptance evidence;
4. existing journey contracts.

The available Vercel fetch surface is server-rendered and does not replace an interactive agent-browser run. Therefore this audit treats hydrated client behavior as verified only where the repository implementation or prior journey evidence directly proves it. R22 acceptance must use fresh agent-browser/native evidence.

## 2. Fresh production journey simulation — findings

### F1 — Identity discovery is present, but account creation is not exposed in the normal UI

Observed:

Home -> session menu -> "Sign in / Create a profile" -> Settings -> sign-in form

The service has a real POST /api/auth/register route and a real authRegister transport, but the signed-out SessionControls surface currently exposes only the login form. A user who does not already have an account has no visible Create account action from the normal path.

R22 rule: account creation must be a first-class normal-path action, not merely an implemented API.

### F2 — "Connect a source" is discoverable but currently dead-ends for a first-time source state

The Home source strip offers Connect a source and Settings -> Sources offers the same CTA. The current anchor points back to /settings?section=sources. In the no-source state, there is no provider/connector catalog or first-connect selector exposed on that destination.

The existing /api/sources action path can perform typed connect/reauthorize/disconnect actions for a known connector, but a brand-new user is not given a connector to select.

R22 rule: the first-connect journey must be:

Home
  -> Connect a source
  -> choose a supported connector
  -> authorize/connect
  -> return to source management
  -> source becomes Connected with capability truth

No CTA may terminate by returning the user to the same empty state.

### F3 — BYOF is correctly contextual, but first-connect remains a prerequisite

Home and Library expose Bring Your Feed, and Settings contains the full preview/confirm/provenance flow. The current BYOF panel honestly reports "No feed-import sources yet" until a supported source is connected.

This is correct product semantics. The R22 gap is therefore not a new BYOF navigation page; it is the missing source-onboarding bridge that makes the existing BYOF flow reachable for a first-time user.

### F4 — Feed-mode semantics are surfaced correctly

The live Home/Watch/Shorts surfaces expose:

- For you
- Following
- Your imported feed
- Blend

Unavailable modes explain the missing prerequisite rather than pretending they work. This remains frozen.

R22 must preserve this behavior while making the prerequisite action reachable from the same context when helpful.

### F5 — Recommendation personalization and attention modes are successfully contextualized

The live surfaces expose:

- Personalize
- temporary session intent
- Mindful
- Balanced
- Immersive
- Custom
- exploration dial.

The session intent was previously proven to persist through reload in R21 acceptance.

No architecture change is required.

### F6 — Item/player capability surface is now strong

The live item/player journey exposes:

- canonical item identity;
- Play;
- Like/Save where the source supports them;
- Where to watch;
- realization switching;
- AI tray;
- recommendation feedback;
- Desktop/offline path;
- progressive playback diagnostics.

No R22 rewrite is required. R22 must preserve progressive disclosure.

### F7 — Shorts action semantics exist in the client implementation

The server-rendered HTML does not contain hydrated Like/Save controls, but the current apps/web/src/components/shorts/ShortsFeed.tsx implementation explicitly renders typed Like/Save/Share actions and routes Like/Save through the action/receipt path with rollback on unsupported/failed outcomes.

Therefore do not create a duplicate Shorts action implementation. R22 should only add fresh hydrated browser evidence and fix the surface if interactive evidence proves the controls are visually or behaviorally inaccessible.

### F8 — Model & AI transport is materially present, but BYOM management is not evident in the user-facing settings surface

The live Model & AI page truthfully exposes provider/task-policy state and sends users to the contextual AI tray. The shared runtime already exposes:

- bindByomProvider
- unbindByomProvider
- policy read/write
- provider registry
- transform submit/read/cancel/clear.

However, the current Web Settings Model & AI surface visibly presents the provider registry and task policies without a normal add/manage your provider control. The architecture explicitly supports BYOM, so the management journey must not depend on hidden transport methods.

R22 rule: BYOM is complete only when a user can discover, configure, verify, and remove a provider through normal product surfaces, with secrets kept server-side.

### F9 — Direct conceptual routes remain intentionally absent

/feed and /byof are not primary routes. This is acceptable under the R21 frozen UX law: user capabilities should be contextual, and Settings remains the management center.

R22 must not create an architecture dashboard or duplicate route system merely to make these concepts addressable.

### F10 — Offline/native Web truth remains correct

Web continues to show native media/torrent acquisition as unavailable on Web, with the Desktop path explained. This remains frozen.

### F11 — Repository governance has stale open issue records

The implementation and acceptance evidence say R20 and R21 are complete, while GitHub issues #25 and #26 remain open. This is process drift rather than a product runtime defect.

R22 Lead closeout includes reconciling issue state with repository acceptance truth.

## 3. Frozen R22 product law

R22 must preserve all R21 laws:

- Primary navigation stays Home / Watch / Shorts / Search / Library / Settings.
- Contextual controls are preferred to architecture dashboards.
- Settings is the detailed management center, not the only discovery path.
- Diagnostics remain progressive.
- Unsupported capabilities stay visible with actionable platform truth.
- No stale "arrives later" language for accepted capabilities.
- No provider capability is claimed without a real adapter path.
- Web/Desktop remain adapters over shared Client Runtime semantics.
- BYOF remains authorized-only and provenance-preserving.
- Native/torrent acquisition remains restricted to authorized/user-owned/licensed/public-domain/Creative-Commons or otherwise permitted content; no DRM, CAPTCHA, anti-bot, rate-limit, access-control, or geo circumvention.
- ShareNet-inspired visual language remains the visual authority; do not copy ShareNet structure, branding, copy, or imagery.

## 4. Work split for three concurrent workers

### Worker 1 — Shared contracts, identity, source onboarding, model controls

R22-A — first-connect source catalog contract

Freeze a user-facing source-discovery/read model that can distinguish:

- supported connector;
- not connected;
- connecting/authorizing;
- connected;
- authorization expired;
- failed;
- unsupported in the current platform/boot.

The model must expose a real connector identifier and the typed action required to start connection.

Do not expose raw provider protocol details as the primary UX vocabulary.

R22-B — account creation journey contract

Promote the existing real authRegister transport into a shared product flow:

- typed register command/read model;
- validation and honest failure states;
- auto-login/account-session continuity already provided by the service;
- no secret exposure;
- profile selection remains downstream of successful registration.

Do not invent a second authentication system.

R22-C — BYOM management contract

Expose a UI-ready shared management model over the already-existing runtime operations:

- provider binding summary;
- supported task capabilities;
- privacy mode;
- provider availability;
- add/bind;
- verify/usable;
- remove/unbind;
- typed errors/recovery.

Secret material must never appear in the client read model or rendered UI after submission.

Allowed shared paths:
packages/client-runtime/**, packages/domain/**, packages/platform-contracts/**, packages/model-fabric/**, relevant shared tests.

Forbidden:
No Web-only UI, Desktop-only UI, new recommendation algorithm, new provider SDK in shared code, or architecture/dashboard work.

### Worker 2 — Web first-run completion

R22-D — source onboarding UI

Replace the first-connect dead end with:

Connect a source
  -> connector chooser
  -> authorization/connect action
  -> honest pending/success/failure state
  -> connected source card
  -> browse / import feed

The normal Home path and Settings path must converge on the same shared source state.

R22-E — account creation UX

From the existing signed-out identity entry point provide:

- Sign in;
- Create account;
- honest validation errors;
- post-registration authenticated state;
- return to the originally intended context where appropriate.

Avoid modal sprawl. Keep the primary action singular per state.

R22-F — BYOM management UX

Extend Settings -> Model & AI with a normal provider-management entry point that consumes R22-C.

The contextual title/item/player AI tray remains the place to use AI. Settings remains the place to manage model providers/policies.

R22-G — hydrated journey evidence

Fresh agent-browser evidence must verify:

- source chooser and real connect flow;
- account creation;
- BYOF after connection;
- feed-mode transition after connection;
- Shorts Like/Save/Share visible and usable if the live client surface supports them;
- BYOM add/remove;
- item/player AI actions;
- realization switching;
- Library continuity.

No direct URL navigation may be used to claim discoverability.

Allowed paths:
apps/web/**, Web-specific tests/journey evidence, plus shared artifacts explicitly ratified by Lead.

### Worker 3 — Desktop parity and native product continuity

R22-H — Desktop source/auth parity

Mirror the shared semantics for:

- account creation/sign-in state;
- source connector selection;
- source authorization/recovery;
- BYOF prerequisite transition.

Do not duplicate Web business rules. Use the same shared read models.

R22-I — Desktop Model/BYOM parity

Expose the same model-management semantics in the Desktop management surface, including local-model availability and BYOM management where supported.

The Desktop can add native affordances, but the semantics must remain identical.

R22-J — Desktop major-journey evidence

Prove:

- source connect -> connected;
- BYOF import path;
- authenticated profile continuity;
- BYOM/local model management truth;
- acquisition/offline path;
- verified asset -> Library;
- interruption/recovery where applicable.

The native/torrent production directive remains unchanged: no stubEngine().

Allowed paths:
apps/desktop/**, packages/native-media/**, packages/torrent-engine/**, Desktop/native adapter paths.

## 5. Lead integration

R22-K — contract ratification

Lead reviews A/B/C before Web/Desktop implement against them.

R22-L — cross-lane integration

Merge in this order:

1. R22-A/B/C shared contract/read-model changes.
2. R22-D/E/F Web.
3. R22-H/I Desktop.
4. R22-G/J journey evidence.
5. Lead integration and production verification.

R22-M — stale issue/governance reconciliation

After code and acceptance are green:

- reconcile R20/R21 GitHub issue state with completion truth;
- update the active work-item registry;
- record the final production SHA and evidence paths.

## 6. Dependency graph

R21 accepted
    |
    v
 R22-A  Source-discovery contract
    |\
    | \
    |  +--------------------> R22-D Web source onboarding
    |                               |
    |                               v
    |                         R22-G Web evidence
    |
    +----> R22-H Desktop source/auth parity
    |
 R22-B  Account-creation contract
    |\
    | \
    |  +--------------------> R22-E Web registration UX -> R22-G
    |
    +----> R22-H Desktop auth parity
    |
 R22-C  BYOM management contract
    |\
    | \
    |  +--------------------> R22-F Web BYOM UX -> R22-G
    |
    +----> R22-I Desktop BYOM parity -> R22-J
                                  |
 R22-D + R22-E + R22-F -----------+
                |
                v
         R22-K/R22-L Lead integration
                ^
                |
       R22-G + R22-J
                |
                v
     J36 + rerun affected J01-J35
                |
                v
        production acceptance
                |
                v
             R22-M

Concurrency law:
After R22-A/B/C are frozen, Worker 2 and Worker 3 may proceed concurrently. Within each worker, independent work may proceed in parallel after its shared seam is frozen. No worker may change shared contracts during active parallel implementation without Lead ratification.

## 7. New golden journey — J36

### J36 — Major user journey completion sweep

A fresh user starts from Home and completes the following without documentation or direct route entry:

Home
 -> create/sign in
 -> connect a source
 -> browse source-backed content
 -> Bring Your Feed
 -> preview + confirm import
 -> switch among For You / Following / Imported / Blend as prerequisites allow
 -> set temporary intent
 -> change attention mode
 -> open an item
 -> choose Where to watch
 -> use AI action
 -> provide recommendation feedback
 -> use Shorts and Like/Save/Share
 -> open Library
 -> observe Watchlist / History / Imported Feeds / Offline truth
 -> open Model & AI settings
 -> add/remove BYOM where supported
 -> sign out
 -> confirm honest anonymous state

Desktop extension:
same semantic journey
 -> local-model truth
 -> authorized acquisition/offline path
 -> verified asset in Library
 -> interruption/recovery truth

J36 acceptance laws:

- Every primary action has one obvious next action.
- No discovery CTA lands on an unchanged empty state without providing the next required choice.
- Account creation is actually visible and functional.
- Source connection begins from a selectable connector, not merely a settings anchor.
- BYOF becomes reachable after its source prerequisite is satisfied.
- Source-native order is never mislabeled as WebFlix ranking.
- BYOM management is reachable without direct URLs.
- Shorts actions are present after hydration where capabilities permit.
- Unsupported platform capabilities explain the limitation and the available alternative.
- No raw transport IDs or protocol diagnostics are required to complete the journey.
- All important failures have recovery/next-action affordances.
- Desktop preserves shared semantics while exposing its native capabilities.

## 8. Acceptance battery

Lead must run:

bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test --parallel=1
bun run contract-check
bun run lane-check
bun run journeys:web

Then perform fresh live-production browser verification against the deployed Web app, plus Desktop/native evidence.

Release is blocked if any of these are true:

- source connection CTA still loops to the same empty state;
- no visible Create Account path;
- BYOM can only be configured through a hidden API/direct URL;
- Shorts Like/Save are absent in a hydrated browser where the source advertises them;
- BYOF cannot progress after a supported source is connected;
- any accepted capability reverts to stale R0x language;
- production transport differs from the accepted integrated tree;
- any worker claims completion without executable journey evidence.

## 9. Implementation discipline

Workers must:

- inspect current code before modifying it;
- use the repository as the source of truth;
- run the affected product and agent-browser/native journey after UI changes;
- capture fresh snapshots after every navigation/DOM-changing interaction;
- keep diagnostics progressive;
- avoid creating parallel business logic for Web/Desktop;
- avoid placeholder/mock production wiring;
- verify authorization and secret handling at the actual transport boundary.

Lead must independently reproduce the journey before accepting each lane.

## 10. Definition of Done

R22 is green only when:

1. R22-A/B/C shared contracts and read models are frozen and covered by tests.
2. A first-time user can create an account through a normal Web/Desktop product path.
3. A first-time user can select and connect a real supported source through a normal product path.
4. Existing BYOF flow becomes reachable without direct URL manipulation.
5. BYOM management is a real normal-path UI over the existing typed runtime operations.
6. Shorts action capability is freshly browser-verified.
7. Web/Desktop semantics remain aligned.
8. J36 is green.
9. Affected J01-J35 journeys are rerun where behavior changed.
10. Production smoke verification passes at the final deployment SHA.
11. R20/R21 issue state and the work-item registry are reconciled with acceptance truth.
12. No new architecture/dashboard/navigation drift is introduced.
