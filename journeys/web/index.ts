/**
 * @wfx/journeys — the encoded journey registry (R16).
 *
 * Every encoded Web journey, in catalog order (J01–J33). The registry
 * is the single source the runner consumes; the NOT-RUN entries
 * (journeys this configuration cannot execute) are declared here too —
 * with their exact reason and procedure — so the manifest lists them
 * explicitly (never a silent skip).
 *
 * THE ENCODING LAW: every entry's `run` asserts the doc's expected
 * states and THROWS on regression. A journey that cannot fail is not a
 * check; nothing here is theater.
 */

import type { Journey } from "../lib/journeys";

import { j01FirstLaunch } from "./j01-first-launch";
import { j02HomeDiscovery } from "./j02-home-discovery";
import { j03WatchBrowsing } from "./j03-watch-browsing";
import { j04Shorts } from "./j04-shorts";
import { j05UnifiedSearch } from "./j05-unified-search";
import { j06ItemDetail } from "./j06-item-detail";
import { j07EmbedPlayback } from "./j07-embed-playback";
import { j08BrowserPlayback } from "./j08-browser-playback";
import { j09ExternalFallback } from "./j09-external-fallback";
import { j10ActionSyncTruth } from "./j10-action-sync-truth";
import { j11Library } from "./j11-library";
import { j12CrossDeviceResume } from "./j12-cross-device-resume";
import { j13IdentityLifecycle } from "./j13-identity-lifecycle";
import { j14SourceManagement } from "./j14-source-management";
import { j15RecommendationFeedback } from "./j15-recommendation-feedback";
import { j16AntiTunnel } from "./j16-anti-tunnel";
import { j17ExplicitIntent } from "./j17-explicit-intent";
import { j18AttentionModes } from "./j18-attention-modes";
import { j19ModelPolicy } from "./j19-model-policy";
import { j20AiTransforms } from "./j20-ai-transforms";
import { j21AuthorizedAcquisition } from "./j21-authorized-acquisition";
import { j22MetadataFileSelection } from "./j22-metadata-file-selection";
import { j23PlaybackBeforeCompletion } from "./j23-playback-before-completion";
import { j24BackgroundCompletion } from "./j24-background-completion";
import { j25InterruptionRecovery } from "./j25-interruption-recovery";
import { j26VerifiedAssetInLibrary } from "./j26-verified-asset-in-library";
import { j27NativePlayback } from "./j27-native-playback";
import { j28CredentialExpiry } from "./j28-credential-expiry";
import { j29NetworkLossRecovery } from "./j29-network-loss-recovery";
import { j30CapabilityHonesty } from "./j30-capability-honesty";
import { j31CrossPlatformParity } from "./j31-cross-platform-parity";
import { j32SourceNeutralIdentity } from "./j32-source-neutral-identity";
import { j33BringYourOwnFeed } from "./j33-bring-your-own-feed";
import { j34CapabilityDiscoverability } from "./j34-capability-discoverability";
import { j36MajorJourneyCompletion } from "./j36-major-journey-completion";

/** The encoded journeys in catalog order. */
export const WEB_JOURNEYS: readonly Journey[] = [
  j01FirstLaunch,
  j02HomeDiscovery,
  j03WatchBrowsing,
  j04Shorts,
  j05UnifiedSearch,
  j06ItemDetail,
  j07EmbedPlayback,
  j08BrowserPlayback,
  j09ExternalFallback,
  j10ActionSyncTruth,
  j11Library,
  j12CrossDeviceResume,
  j13IdentityLifecycle,
  j14SourceManagement,
  j15RecommendationFeedback,
  j16AntiTunnel,
  j17ExplicitIntent,
  j18AttentionModes,
  j19ModelPolicy,
  j20AiTransforms,
  j21AuthorizedAcquisition,
  j22MetadataFileSelection,
  j23PlaybackBeforeCompletion,
  j24BackgroundCompletion,
  j25InterruptionRecovery,
  j26VerifiedAssetInLibrary,
  j27NativePlayback,
  // R17 — J28 (credential expiry/recovery) is now ENCODED over the
  // fixtures' scripted source-auth lifecycle (the R14/R16 scripted-feed
  // pattern): expiry → the named expired state → the typed unauthorized
  // read → reauthorize → recovery. The REAL provider OAuth round trips
  // remain the service-mode local-only procedure (listed below).
  j28CredentialExpiry,
  j29NetworkLossRecovery,
  j30CapabilityHonesty,
  j31CrossPlatformParity,
  j32SourceNeutralIdentity,
  // R20-E — J33 (Bring Your Own Feed) is encoded over the REAL shared
  // composition the fixtures boot wires (the FeedImportService + the
  // real YouTube connector answering importFeedResult from its recorded
  // API fixtures — the same seam the persistence integration proves).
  // The REAL provider round trips (a live Google OAuth consent dance
  // against the live Data API) are the service-mode local-only procedure
  // (listed below).
  j33BringYourOwnFeed,
  j34CapabilityDiscoverability,
  j36MajorJourneyCompletion,
];

import type { LimitationRecord } from "../lib/report";

/**
 * The NOT-RUN + reach-limit declarations (the honesty law: a journey
 * that cannot be automated — or cannot run fully in this configuration
 * — is explicitly listed with its procedure, never silently skipped).
 */
export const JOURNEY_LIMITATIONS: readonly LimitationRecord[] = [
  {
    journeyId: "J36",
    kind: "configuration-limit",
    note: "The R22-G encoding runs the full J36 completion walk over the deterministic fixtures boot: the register round trip uses the scripted dev persona (the loud dev badge — the REAL /api/auth/register transport's email-taken/validation round trips are service-mode, proven at the contract level by packages/client-runtime/tests/account-creation.test.ts); the source chooser's connected truth and the BYOF import ride the fixture connectors (the REAL provider OAuth dance is J14/J28's service-side procedure); the Shorts like/save typed absence is the fixture source's own capability truth (the hydration law is asserted as capability-truth, not blanket presence).",
    procedure: "LEAD (the production sweep): deploy the integrated tree, run this journey with --base-url against the deployed service-mode boot (real register transport, a real connectable connector, a source that declares like/save), and capture the evidence under evidence/r22/ — the J35 production-parity sweep covers the same deployment.",
  },
  {
    journeyId: "J28",
    kind: "local-only",
    note: "The R17 encoding covers the credential-expiry LIFECYCLE over the fixtures' scripted source-auth feed (expiry → the named expired state → the typed unauthorized read → reauthorize → recovery — the same browser-validation pattern as J21-J26's scripted acquisitions). The REAL provider OAuth round trips (a real consent dance, real token exchange, a real expiry) are the service-side source-management lane and remain local-only.",
    procedure: "LOCAL-ONLY: boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY), boot apps/web in service mode (WFX_API_BASE), drive the /sources connect flow with a stub-OAuth connector (the apps/api test boots' SourceAuthWiring pattern), let the token expire, observe the typed unauthorized degradation in the web surfaces, reauthorize, and capture screenshots per state under evidence/<run>/ — then run this runner with --base-url against that service boot.",
  },
  {
    journeyId: "J09",
    kind: "configuration-limit",
    note: "The external-rung WIN (the visible external handoff with its return-context link) requires an item whose only realization is external — the fixture catalog carries none (every item resolves embed or browser first). The fallback DECISION trace and the typed failure states are encoded; the handoff itself is not reachable in this configuration.",
    procedure: "LOCAL-ONLY: boot the service-mode configuration with a source that declares an external-only realization (or a realization whose embed/browser URLs the provider restricts), open its player, and capture the data-wfx-player-mode=\"external\" handoff + the return-context link under evidence/<run>/.",
  },
  {
    journeyId: "J12",
    kind: "configuration-limit",
    note: "Cross-DEVICE resume continuity requires the server-side identity/profile state (the service-mode boot over the shared profile); the fixtures boot is one anonymous session. Additionally, the Turbopack dev server compiles routes as separate module graphs, so the /api/events watch-state fold does not cross pages in the dev boot (documented in apps/web/src/host/acquisition-fixtures.ts).",
    procedure: "LOCAL-ONLY: boot the service-mode configuration (api+web), watch an item on one browser profile, sign in on a second profile with the same identity, and verify Continue Watching/resume under evidence/<run>/ (the single-bundle service boot folds the watch state across routes).",
  },
  {
    journeyId: "J14",
    kind: "local-only",
    note: "The R17 encoding asserts the scripted source's authorization-state truth (the signed-in card, the Connected chip, the typed action vocabulary; the expiry → reauthorize round trip is J28's encoding). The REAL provider connect/reauthorize/disconnect round trips (a real OAuth dance over the durable connector-account store) are the service-side source-management lane and remain local-only.",
    procedure: "LOCAL-ONLY: the service-mode boot (see J28's procedure) + drive /settings sources connect → capability truth → reauthorize → disconnect against the real service routes, capturing each state.",
  },
  {
    journeyId: "J15",
    kind: "local-only",
    note: "The full reversible feedback vocabulary (More-like-this / Not-interested / creator-source suppression / Already-watched) is R05's service-side policy surface (apps/api /experience/feedback + /experience/policy routes). The web adapter ships the session re-rank explainability + the typed-absent feedback grammar (both encoded).",
    procedure: "LOCAL-ONLY: the service-mode boot + apply each feedback control through the API routes, verify the policy composition change, and capture the affected surfaces.",
  },
  {
    journeyId: "J16",
    kind: "local-only",
    note: "Profile-LEVEL anti-tunnel (a concentrated watch history not permanently dominating the profile) is R05's service-side recommendation policy; the web fixtures session has no persistent profile. The feed-level exploration mechanics (kept runway, multi-item composition) are encoded.",
    procedure: "LOCAL-ONLY: the service-mode boot + a concentrated watch history through /experience/history, then verify the recommendation composition retains exploration (the R05 policy tests' scenario) with captured evidence.",
  },
  {
    journeyId: "J17",
    kind: "local-only",
    note: "The explicit intent VOCABULARY (learn/happier/surprise/tonight/friend-taste) is the service-side intent submission (apps/api /experience/intents — session-scoped by design). The web session's query-intent mechanics (state/retain/replace, no preference corruption) are encoded.",
    procedure: "LOCAL-ONLY: the service-mode boot + submit each intent kind through /experience/intents, verify the session-scoped composition and the untouched long-term policy, and capture the affected feed surfaces.",
  },
  {
    journeyId: "J18",
    kind: "local-only",
    note: "SWITCHING attention modes (mindful=3-swipe / immersive=none / custom) is the service-side policy submission (apps/api /experience/policy). The web session boots the balanced default; its observable threshold behavior (no re-rank below 5, re-rank at 5) is encoded.",
    procedure: "LOCAL-ONLY: the service-mode boot + set each attention mode through /experience/policy, then drive the short feed and capture the mode-specific re-rank behavior (mindful fires at 3 swipes; immersive does not auto re-rank).",
  },
  {
    journeyId: "J19",
    kind: "local-only",
    note: "R21-B/R21-C: the web transport implements the R06 reads (model-policy, model-providers, BYOM, transforms) and the Model & AI section renders the REAL provider registry + per-task policy truth over them (the fixtures persona answers the service shapes). The real service-backed policy WRITES and BYOM key bindings run against the configured service (apps/api /experience/model-policy, /model-providers, BYOM routes) — the fixtures boot exercises the shapes deterministically.",
    procedure: "LOCAL-ONLY: the service-mode boot + exercise the model-policy/provider routes (BYOM key binding, local-model policy, privacy constraints), capturing the policy surfaces.",
  },
  {
    journeyId: "J20",
    kind: "local-only",
    note: "R21-E: the AI ACTION TRAY is the web surface of the completed transforms transport (the R21-B/R21-C model-controls seam — the fixtures persona answers the service shapes deterministically): the five frozen actions, the model-class truth, the named preconditions, and the typed queued/cancelled operation states are encoded. The full pipeline's running→succeeded transitions (real progress + result payloads) are the service-side fabric (apps/api /experience/transforms).",
    procedure: "LOCAL-ONLY: the service-mode boot + start each transformation operation through the tray (or /experience/transforms), capture the explicit running and completed states with results.",
  },
  {
    journeyId: "J34",
    kind: "local-only",
    note: "R21-F: the twelve-task discoverability walk is encoded over the deterministic web-fixture boot (the same product surfaces, the same controls — fresh Home state, normal product paths only). The PRODUCTION parity sweep (J35) is the lead's journey against the live deployment.",
    procedure: "LEAD (J35): run the same discoverability sweep against the production deployment and verify the R02/R03/R05/R06/R09/R14/R20 truths on the live surface.",
  },
  {
    journeyId: "J21",
    kind: "desktop-procedure",
    note: "The native ACQUISITION protocol path (real magnet/.torrent ingestion through the torrent engine) is the Desktop native-media lane. The web journey encodes the limited-status lifecycle UX over the deterministic scripted feed (the R14 surface); the native protocol path is the Desktop equivalent procedure.",
    procedure: "DESKTOP (journeys/desktop/README.md): run the Desktop app with the native-media engine against an authorized source, drive the real acquisition lifecycle, and capture per-state screenshots + the same manifest format via agent-browser attached to the desktop webview (or the platform's instrumentation).",
  },
  {
    journeyId: "J23",
    kind: "desktop-procedure",
    note: "Native playback-before-completion (real verified-range streaming from an in-progress torrent session) is the Desktop path. The web encodes the honest status sequence (buffering → playing with runway → deadline-risk demotion).",
    procedure: "DESKTOP (journeys/desktop/README.md): start an authorized acquisition, begin playback before completion, and capture the buffering/playing/rebuffer states with the real scheduler evidence.",
  },
  {
    journeyId: "J24",
    kind: "desktop-procedure",
    note: "Native background completion with real integrity verification is the Desktop path. The web encodes the completing/verifying/ready-offline status sequence and the earned-verdict grammar.",
    procedure: "DESKTOP (journeys/desktop/README.md): let the acquisition complete in the background (app unfocused), capture the verification and Ready-offline states, and the Library exposure.",
  },
  {
    journeyId: "J25",
    kind: "desktop-procedure",
    note: "Native interruption/restart with persistent session recovery (crash-safe journals, piece-map reuse) is the Desktop path. The web encodes the recoverable-failure/retry/resuming-status grammar.",
    procedure: "DESKTOP (journeys/desktop/README.md): interrupt an in-progress acquisition (kill the engine), restart the app, capture the resumed-not-fresh evidence (retained progress, no false completion), then complete it.",
  },
  {
    journeyId: "J27",
    kind: "desktop-procedure",
    note: "Native local media playback (the local range gateway + verified asset replay) is the Desktop path. The web encodes the constrained capability truth (settings table + the desktop-elsewhere note).",
    procedure: "DESKTOP (journeys/desktop/README.md): play a verified offline asset from the Library through the native media engine, capture the playback + replay states.",
  },
  {
    journeyId: "J31",
    kind: "configuration-limit",
    note: "The parity COMPARISON (Web vs Desktop semantically equivalent outcomes) requires both adapters running against the same server-side state. The web-side parity anchors (canonical identity, library state, intent, session state) are encoded; the desktop-side comparison is the lead's procedure.",
    procedure: "LEAD (the parity run): boot the service-mode api+web and the Desktop adapter against the SAME profile state, run the parity anchor set on both (item identity, library sections, intent composition), and capture both adapters' evidence side by side under evidence/<run>/.",
  },
  {
    journeyId: "J05",
    kind: "known-defect",
    note: "FOUND BY THIS HARNESS (reported for an apps/web fix — outside R16's allowed paths): opening /search with NO query throws a typed RuntimeError (invalid-input: empty query) before the empty-query state can render — apps/web/src/app/search/page.tsx calls loadSearchView unguarded. The SearchSurface's data-wfx-search-state=\"empty-query\" branch is currently unreachable. The encoded J05 asserts the reachable states (results/no-results/intent retention) and does NOT encode the crash as pass.",
    procedure: "FIX (apps/web lane): guard the empty query in the search page (render the empty-query state without calling the runtime), then re-run `bun run journeys:web` — J05's limitation entry can be removed and the empty-query state added to the encoded assertions.",
  },
  {
    journeyId: "J33",
    kind: "local-only",
    note: "The R20-E encoding runs the FULL J33 flow (choose source → connect → preview → confirm → feed appears → sync → reauthorization gap → recovery → disconnect → explicit delete) over the REAL shared composition the fixtures boot wires: the FeedImportService (R20-C) running the real reconciliation and the REAL YouTube connector (R20-B) answering importFeedResult from its documented recorded API fixtures (the same recorded-shape determinism the connectors' and persistence's own integration tests use — no fixture-only production claim: the code path IS the shipped composition). The REAL provider round trips — a live Google OAuth consent, live Data API quota, a real Takeout export — require provisioned credentials and the service-mode boot; they remain local-only.",
    procedure: "LOCAL-ONLY: provision YOUTUBE_* credentials (the frozen .env names), boot apps/api over a PostgreSQL database (DATABASE_URL + APP_ENCRYPTION_KEY) with the YouTube connector wired to its fetch transport, boot apps/web in service mode (WFX_API_BASE) once the feed-import service routes are wired (the lead's R20-H integration step), drive the /settings sources connect flow with a real Google account, and capture each BYOF state under evidence/<run>/ — then run this runner with --base-url against that service boot.",
  },
];
