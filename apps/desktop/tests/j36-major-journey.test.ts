/**
 * R22-J — the J36 Desktop major-journey evidence (the J21-J25 doctrine).
 *
 * THE JOURNEY (docs/validation/webflix-golden-journeys.md J36 + the plan's
 * R22-J): the same semantic journey as the Web lane, driven through the
 * Desktop composition over the deterministic shell simulator — then the
 * Desktop extension: local-model truth, the authorized acquisition/offline
 * path, the verified asset in Library, and the interruption/recovery truth.
 *
 * ```text
 * fresh boot → honest anonymous state
 *   → create account (R22-B) → keychain persistence → downstream choose-profile
 *   → RESTART (boot 2) → restoreSession VERIFIED (authenticated profile continuity)
 *   → source catalog (R22-A) → choose the connector → the native connect flow
 *   → Connected truth → BYOF prerequisite OPENS (the F3 bridge, never a dead end)
 *   → BYOF import path (OS dialog → preview → confirm → source-native feed)
 *   → BYOM/local-model management truth (R22-C: bind → fail-closed truth →
 *     policy flip → local rows → remove; the secret law)
 *   → Make available offline → executeAcquire → Preparing → Completing
 *   → [INTERRUPTION: the app restarts mid-transfer]
 *   → RESTART (boot 3) → continuity holds → the journaled recovery →
 *     RESUMING with retained progress (never a fresh start, never a false
 *     completion) → resume → verifying → completed → the earned exposure
 *   → Ready offline → the verified asset in Library (+ the player truth)
 *   → sign out → the honest anonymous state (the keychain cleared)
 * ```
 *
 * THE EVIDENCE VEHICLE (journeys/desktop/README.md — the J21-J25
 * doctrine): this sandbox has no native toolchain, so the journey runs the
 * REAL TypeScript composition (every surface the Desktop app projects —
 * composed exactly as `createDesktopApp` composes them, with the
 * acquisition SOURCE exposed so the acquire recipe can perform the
 * composition root's ingestion+bind wiring) over the deterministic shell
 * simulator + the scripted service transport + the R20 FeedPort double.
 * The native halves (the real engine binary, the real OS keychain, the
 * real OS dialog, the real provider OAuth dance) are the LEAD's
 * real-toolchain procedure — recorded as explicit limitations in the
 * evidence manifest, never silently skipped.
 *
 * Every observed state is recorded into the journey log; when
 * `WFX_J36_EVIDENCE_DIR` is set, the final step writes the machine-
 * generated evidence record (manifest + narration + summary) from THIS
 * run — no hand-authored evidence.
 */

import { describe, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  FixedClock,
  InMemoryServerPort,
  SequentialIdGen,
  assertAccountCreationModelSecretFree,
  createRuntime,
  isStaleCompletionCopy,
  makeDesktopCapabilities,
} from "@wfx/client-runtime";
import type { AcquisitionStatusView, ClientRuntime } from "@wfx/client-runtime";
import type { OfflineReadyEntry, TorrentRecoveryReport } from "@wfx/torrent-engine";

import { SimShell, SimEngineProcess } from "./shell-simulator";
import {
  ScriptedEngine,
  StubFetch,
  engineStatus,
  engineTruth,
  jsonResponse,
} from "./discoverability-harness";
import { createFeedPortDouble, testExportArtifact } from "./feed-port-double";
import {
  makeProviderRow,
  makeSession,
  makeSource,
  sourcesEnvelope,
} from "./r22-fixtures";

import { createDesktopApp } from "../src/main";
import { createDesktopServerPort } from "../src/platform/server-port";
import { createDesktopAuthTransport } from "../src/platform/auth-transport";
import { createShellAuthSessionStore } from "../src/platform/auth-session-store";
import { createDesktopAcquisitionSource } from "../src/platform/acquisition-source";
import type { AcquisitionIdentity } from "../src/platform/acquisition-source";
import { createShellStoragePort } from "../src/platform/storage";
import { createDesktopAcquisitionSurface } from "../src/surface/acquisition-surface";
import { createDesktopFeedSurface } from "../src/surface/feed-surface";
import { createDesktopFirstRunSurface } from "../src/surface/first-run-surface";
import { createDesktopModelManagementSurface } from "../src/surface/model-management-surface";
import { createOfflineDiscoverySurface } from "../src/surface/offline-discovery-surface";
import type { DesktopAcquireRecipe } from "../src/surface/offline-discovery-surface";
import {
  DESKTOP_LOCAL_MODEL_PLATFORM_NOTE,
  modelManagementCopyStrings,
} from "../src/surface/model-management-surface";
import { firstRunCopyStrings } from "../src/surface/first-run-surface";

// ---------------------------------------------------------------------------
// The journey's deterministic world
// ---------------------------------------------------------------------------

const J36_T0 = Date.parse("2026-09-20T09:30:00.000Z");
const J36_API_BASE = new URL("https://experience.webflix.invalid/api");
const J36_CONTEXT = { userId: "wfx-desktop-j36", sessionId: "wfx-desktop-j36-session", locale: "en" };
const J36_TOKEN = "wfxsess_r22j36token0000000000000000";
/** The authenticated profile's key (the acquisition + feed identity). */
const J36_PROFILE = "wfxusr_r22test:wfxprof_main";
const J36_USER = "wfxusr_r22test";
const J36_ITEM = "wfxitm_0000000000000000000000J36A";
const J36_SESSION = "s-j36-1";
const NOW = (): string => new Date(J36_T0).toISOString();

/** The authorized acquisition's provenance (user-owned — the frozen law). */
const J36_PROVENANCE = { sourceId: "vault:family-media", basis: "user-owned" as const };

/** The journey's acquisition identity (the composition root's binding). */
const J36_IDENTITY: AcquisitionIdentity = {
  profileKey: J36_PROFILE,
  canonicalItemId: J36_ITEM,
  title: "Family Archive Feature Presentation",
};

// ---------------------------------------------------------------------------
// The journey log + the assertion recorder (the evidence primitives)
// ---------------------------------------------------------------------------

interface JourneyStep {
  readonly step: string;
  readonly observed: string;
}

const J36_LOG: JourneyStep[] = [];
const J36_ASSERTIONS: { readonly step: string; readonly description: string }[] = [];
const J36_STARTED_AT = new Date().toISOString();

/** Record one observed journey truth (the narration the evidence carries). */
function record(step: string, observed: string): void {
  J36_LOG.push({ step, observed });
}

/** One recorded assertion: honest throw on failure, recorded on pass. */
function ok(step: string, description: string, condition: boolean): void {
  if (!condition) {
    throw new Error(`J36 [${step}] ${description}`);
  }
  J36_ASSERTIONS.push({ step, description });
}

// ---------------------------------------------------------------------------
// The journey composition (mirrors main.ts; the acquisition source exposed)
// ---------------------------------------------------------------------------

/**
 * One Desktop "app boot" for the journey: every surface the real
 * composition root projects, composed exactly as `createDesktopApp`
 * composes them (R22-H first-run + R22-I model management + R20-G feed +
 * R14 acquisition + R21-H offline discovery over ONE shared runtime) —
 * with the acquisition SOURCE exposed so the acquire recipe performs the
 * composition root's ingestion + `bindSession` wiring (the wiring the
 * production composition owns; see main.ts's `offlineDiscovery.acquire`).
 *
 * The shell is SHARED across boots (the OS keychain — the continuity
 * seam); everything else is per-boot (an honest app restart).
 */
function bootJourney(shell: SimShell) {
  const stub = new StubFetch();
  const engine = new ScriptedEngine();
  const feedDouble = createFeedPortDouble({
    profileId: J36_PROFILE,
    userId: J36_USER,
    now: NOW,
    nextId: (() => {
      let counter = 0;
      return () => `j36-${(counter += 1).toString().padStart(4, "0")}`;
    })(),
  });
  const runtime: ClientRuntime = createRuntime(makeDesktopCapabilities(), new InMemoryServerPort(), {
    context: J36_CONTEXT,
    clock: new FixedClock(J36_T0),
    ids: new SequentialIdGen(),
  });
  const transport = createDesktopAuthTransport({ apiBase: J36_API_BASE, fetchImpl: stub.fetch, timeoutMs: 0 });
  const sessionStore = createShellAuthSessionStore({ shell, now: NOW });
  const source = createDesktopAcquisitionSource({ engine, adapter: engine.adapter, runtime });
  const acquisition = createDesktopAcquisitionSurface(runtime, source);
  const feed = createDesktopFeedSurface({
    shell,
    feedPort: feedDouble.port,
    storage: createShellStoragePort(shell),
    now: NOW,
  });
  const firstRun = createDesktopFirstRunSurface({
    runtime,
    transport,
    sessionStore,
    feed,
    shell,
    now: NOW,
  });
  const modelManagement = createDesktopModelManagementSurface({
    transport,
    token: () => firstRun.currentToken(),
  });
  // The composition root's acquisition-START recipe (the authorized
  // ingestion + session + bindSession flow — the documented wiring shape).
  const acquire: DesktopAcquireRecipe = async (itemId: string) => {
    engine.script(
      J36_SESSION,
      engineStatus({
        sessionId: J36_SESSION,
        state: "discovering-metadata",
        files: [],
        // The honest no-selection progress: nothing is chosen yet, so the
        // lifecycle's progress is unknown (never a fabricated 0%).
        progress: {
          selectedPieces: 0,
          verifiedSelectedPieces: 0,
          selectedBytes: 0,
          verifiedSelectedBytes: 0,
          fraction: 0,
        },
        provenance: J36_PROVENANCE,
      }),
      "idle",
      engineTruth(),
    );
    source.bindSession(J36_SESSION, { ...J36_IDENTITY, canonicalItemId: itemId });
    return { ok: true, value: { sessionId: J36_SESSION } };
  };
  const offlineDiscovery = createOfflineDiscoverySurface({
    runtime,
    capabilities: makeDesktopCapabilities(),
    acquisition,
    feed,
    acquire,
  });
  return {
    shell,
    stub,
    engine,
    feedDouble,
    runtime,
    source,
    acquisition,
    feed,
    firstRun,
    modelManagement,
    offlineDiscovery,
  };
}

type JourneyBoot = ReturnType<typeof bootJourney>;

// ---------------------------------------------------------------------------
// The scripted service world (the deterministic Experience API)
// ---------------------------------------------------------------------------

function scriptRegister(stub: StubFetch): void {
  stub.script(
    (url) => url.endsWith("/auth/register"),
    () => jsonResponse({ token: J36_TOKEN, session: makeSession() }),
  );
}

function scriptSessionRead(stub: StubFetch): void {
  stub.script((url) => url.endsWith("/auth/me"), () => jsonResponse(makeSession()));
}

function scriptLogout(stub: StubFetch): void {
  stub.script((url) => url.endsWith("/auth/logout"), () => jsonResponse({ revoked: true }));
}

function scriptSources(stub: StubFetch, sources: readonly ReturnType<typeof makeSource>[]): void {
  stub.script((url) => url.endsWith("/sources"), () => jsonResponse(sourcesEnvelope(sources)));
}

function scriptOauthConnect(stub: StubFetch): void {
  stub.script(
    (url) => url.endsWith("/sources/youtube/connect"),
    () =>
      jsonResponse({
        kind: "oauth",
        connectorId: "youtube",
        authorizationUrl: "https://provider.example/authorize?state=j36state",
        state: "j36state",
        expiresAt: new Date(J36_T0 + 600_000).toISOString(),
      }),
  );
}

const MODEL_TASK_IDS: readonly string[] = [
  "recommendation",
  "ranking",
  "summary",
  "translation",
  "transcription",
  "speechToText",
  "textToSpeech",
  "dubbing",
  "commentary",
];

function scriptModelProviders(
  stub: StubFetch,
  rows: readonly ReturnType<typeof makeProviderRow>[],
): void {
  stub.script(
    (url) => url.endsWith("/experience/model-providers"),
    () => jsonResponse(rows),
  );
}

function scriptModelPolicies(stub: StubFetch, policyOf: (task: string) => unknown): void {
  for (const task of MODEL_TASK_IDS) {
    stub.script(
      (url) => url === `${J36_API_BASE.toString()}/experience/model-policy?task=${task}`,
      () => jsonResponse(policyOf(task)),
    );
  }
}

function scriptByomBind(stub: StubFetch): void {
  stub.script(
    (url) => url.endsWith("/experience/model-providers/byom/my-openai"),
    () =>
      jsonResponse({
        id: "wfxbyom_j36",
        providerId: "my-openai",
        endpointUrl: "http://localhost:11434",
        keyId: "key-j36",
        metadata: null,
        createdAt: NOW(),
        updatedAt: NOW(),
      }),
  );
}

function scriptByomRemove(stub: StubFetch): void {
  stub.script(
    (url) => url.endsWith("/experience/model-providers/byom/my-openai"),
    () => jsonResponse({ revoked: true }),
  );
}

function scriptPolicyWrite(stub: StubFetch): void {
  stub.script(
    (url) => url === `${J36_API_BASE.toString()}/experience/model-policy`,
    () => jsonResponse({ written: true }),
  );
}

// ---------------------------------------------------------------------------
// The deterministic settle helper (the flow's async completion)
// ---------------------------------------------------------------------------

/** Spin until the connector's flow reaches a terminal state (bounded). */
async function settleSourceFlow(
  firstRun: JourneyBoot["firstRun"],
  connectorId: string,
): Promise<{ state: string; row: ReturnType<typeof makeSource> | null }> {
  for (let spin = 0; spin < 100; spin += 1) {
    const view = firstRun.sourceFlow(connectorId);
    if (
      view !== null &&
      (view.state === "completed" || view.state === "failed" || view.state === "dismissed" || view.state === "expired")
    ) {
      return { state: view.state, row: view.row };
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`J36: the '${connectorId}' connect flow never settled`);
}

// ---------------------------------------------------------------------------
// The journey's offline-ready exposure + recovery shapes
// ---------------------------------------------------------------------------

function j36OfflineEntry(sessionId: string): OfflineReadyEntry {
  return {
    key: `canonical:${J36_PROFILE}::${J36_ITEM}`,
    library: { profileKey: J36_PROFILE, canonicalItemId: J36_ITEM },
    sessionId,
    infoHash: "0123456789abcdef0123456789abcdef01234567",
    provenance: J36_PROVENANCE,
    assets: [
      {
        assetId: "asset-j36-1",
        sourcePath: "feature-presentation.mkv",
        contentPath: "/tmp/scripted-j36/store/asset-j36-1/content",
        sizeBytes: 88_912,
        sha256: "a".repeat(64),
        contentType: "video/x-matroska",
        integrity: "verified",
        sizeOnDisk: 88_912,
      },
    ],
    exposedAt: J36_T0,
  };
}

const J36_RECOVERY: TorrentRecoveryReport = {
  recovered: [
    {
      sessionId: J36_SESSION,
      state: "seeding-paused",
      resumeTarget: "downloading",
      verifiedPieces: 4,
      diskVerifiedPieces: 4,
      pieceMapReused: true,
    },
  ],
  terminal: [],
  failed: [],
  skipped: [],
  rearmed: [],
  rearmRefused: [],
};

// ---------------------------------------------------------------------------
// The shared journey world (ONE shell across the three boots)
// ---------------------------------------------------------------------------

const J36_SHELL = new SimShell(); // the OS keychain lives here across restarts
let BOOT1: JourneyBoot | null = null;
let BOOT2: JourneyBoot | null = null;
let BOOT3: JourneyBoot | null = null;

function boot1(): JourneyBoot {
  if (BOOT1 === null) BOOT1 = bootJourney(J36_SHELL);
  return BOOT1;
}

function boot2(): JourneyBoot {
  if (BOOT2 === null) BOOT2 = bootJourney(J36_SHELL);
  return BOOT2;
}

function boot3(): JourneyBoot {
  if (BOOT3 === null) BOOT3 = bootJourney(J36_SHELL);
  return BOOT3;
}

// ---------------------------------------------------------------------------
// THE JOURNEY
// ---------------------------------------------------------------------------

describe("R22-J — the J36 Desktop major journey (the J21-J25 evidence doctrine)", () => {
  it("J36-D1 — the fresh boot answers the honest anonymous truth (never a fabricated session)", async () => {
    const { firstRun } = boot1();
    const account = firstRun.accountState();
    ok("D1", "the fresh boot is anonymous", account.state === "anonymous");
    ok("D1", "no session view is fabricated", account.session === null);
    ok("D1", "no token exists", firstRun.currentToken() === null);
    ok("D1", "the create-account entry is a first-class label", account.createAccountLabel === "Create account");
    record("D1 fresh boot", `account=${account.state}; entries=Sign in + Create account; token=null`);

    // The anonymous catalog carries the sign-in prerequisite (never an
    // empty dead end) and BYOF carries its bridge into the chooser.
    await firstRun.refreshSources();
    const catalog = firstRun.sourceCatalog();
    ok("D1", "the anonymous catalog carries the sign-in prerequisite", catalog.prerequisite?.kind === "sign-in");
    const byof = firstRun.byofPrerequisite();
    ok("D1", "BYOF answers the connect-source bridge (the F3 law)", byof.nextAction.kind === "connect-source");
    ok("D1", "the bridge names the next action", byof.nextAction.label === "Connect a source first");
    record(
      "D1 anonymous prerequisites",
      `catalog.prerequisite=${catalog.prerequisite?.kind ?? "none"}; byof.nextAction=${byof.nextAction.kind} ("${byof.nextAction.label}")`,
    );
  });

  it("J36-D2 — create account: auto-login + the keychain persistence + the downstream choose-profile", async () => {
    const { firstRun, shell, stub } = boot1();
    scriptRegister(stub);
    const result = await firstRun.createAccount({
      email: "viewer@example.com",
      password: "correct horse battery",
    });
    ok("D2", "the account is created through the shared R22-B journey", result.ok === true);
    if (!result.ok) throw new Error("J36 [D2] createAccount failed");
    ok("D2", "the journey model reached created", result.value.model.state === "created");
    ok(
      "D2",
      "the next action is the DOWNSTREAM choose-profile step",
      result.value.model.nextAction.kind === "choose-profile",
    );
    ok("D2", "the one-time token persisted through the OS keychain", result.value.persisted === true);

    const account = firstRun.accountState();
    ok("D2", "the view turned signed-in", account.state === "signed-in");
    ok("D2", "the profile list is present", account.profiles.length === 1);
    ok("D2", "the active profile is the session's", account.activeProfileId === "wfxprof_main");
    ok("D2", "the token serves the composition", firstRun.currentToken() === J36_TOKEN);
    const stored = await shell.authStoreGet();
    ok("D2", "the keychain carries the token", stored !== null && stored.payload.includes(J36_TOKEN));

    // The secret law (machine-checked over the shared model).
    assertAccountCreationModelSecretFree(result.value.model);
    J36_ASSERTIONS.push({ step: "D2", description: "the R22-B model is secret-free (machine-checked)" });
    record(
      "D2 create account",
      `created → signed-in (profile=wfxprof_main); keychain=persisted; nextAction=${result.value.model.nextAction.kind}`,
    );
  });

  it("J36-D3 — RESTART: the authenticated profile continuity (the keychain → the verified session)", async () => {
    // A real app restart: boot 2 shares ONLY the OS keychain with boot 1.
    const { firstRun, stub } = boot2();
    scriptSessionRead(stub);
    const restored = await firstRun.restoreSession();
    ok("D3", "the stored session VERIFIED against the service", restored.verified === true);
    ok("D3", "the restored state is signed-in", restored.state.state === "signed-in");
    ok("D3", "the same profile survived the restart", restored.state.activeProfileId === "wfxprof_main");
    ok("D3", "the restored token serves the session-scoped reads", firstRun.currentToken() === J36_TOKEN);
    ok("D3", "no store failure occurred", restored.storeFailure === null);
    record(
      "D3 restart continuity",
      `restoreSession → verified=true; signed-in (profile=${restored.state.activeProfileId ?? "none"}); token retained`,
    );
  });

  it("J36-D4 — the first-connect journey: catalog → choose the connector → the native flow → Connected", async () => {
    const { firstRun, stub, shell } = boot2();
    // The signed-in catalog: the connector is selectable, not a dead anchor.
    scriptSources(stub, [makeSource({ connectorId: "youtube", authState: "signedOut" })]);
    await firstRun.refreshSources();
    const catalog = firstRun.sourceCatalog();
    const youtube = catalog.entries.find((entry) => entry.connectorId === "youtube");
    ok("D4", "the catalog exposes the connector entry", youtube !== undefined);
    ok("D4", "the entry's state is not-connected", youtube?.state === "not-connected");
    ok("D4", "the typed action is connect", youtube?.action.kind === "connect");
    ok("D4", "the connection method is user vocabulary", youtube?.method.label === "Sign in on the provider's website");
    record(
      "D4 catalog selection",
      `youtube entry: state=${youtube?.state}; action=${youtube?.action.kind}; method="${youtube?.method.label}"`,
    );

    // The adapter-owned native OAuth flow over the contained surface.
    scriptOauthConnect(stub);
    const opened: unknown[] = [];
    const originalOpen = shell.surfaceOpen.bind(shell);
    shell.surfaceOpen = async (request) => {
      opened.push(request);
      return originalOpen(request);
    };
    // The completing verification read answers the CONNECTED row (LIFO).
    scriptSources(stub, [
      makeSource({ connectorId: "youtube", authState: "signedIn", connected: true, accountId: "acct-j36" }),
    ]);

    const started = await firstRun.connect({ connectorId: "youtube" });
    ok("D4", "the connect flow started", started.ok === true);
    if (!started.ok || !("view" in started)) throw new Error("J36 [D4] connect start failed");
    ok("D4", "the flow opened the authorization surface", started.view.state === "authorization-surface");
    ok(
      "D4",
      "the authorization surface is cookie-isolated + purpose-scoped (the browser-host law)",
      opened.length === 1 &&
        (opened[0] as { restrictCookies?: string; purpose?: string }).restrictCookies === "isolate" &&
        (opened[0] as { purpose?: string }).purpose === "authorization",
    );

    // The provider redirects the surface to the service's callback (the
    // adapter OBSERVES the navigation — never steers it).
    await shell.surfaceNavigate(
      started.view.surfaceId!,
      `${J36_API_BASE.toString()}/sources/callback/j36state?code=the-code&state=j36state`,
    );
    const settled = await settleSourceFlow(firstRun, "youtube");
    ok("D4", "the flow completed on the callback navigation", settled.state === "completed");
    ok("D4", "the completion was VERIFIED through the fresh management read", settled.row?.authState === "signedIn");

    // The connected truth reports into the runtime's observed state.
    const observed = firstRun.sourceCatalog().entries.find((entry) => entry.connectorId === "youtube");
    ok("D4", "the catalog entry turned Connected", observed?.state === "connected");
    record(
      "D4 connect flow",
      `oauth flow → authorization-surface → callback observed → completed (verified row authState=${settled.row?.authState ?? "none"}); catalog: youtube=${observed?.state}`,
    );

    // THE F3 BRIDGE: BYOF opens exactly when the connected source declares feedImport.
    const byof = firstRun.byofPrerequisite();
    ok("D4", "the BYOF prerequisite is satisfied", byof.ready === true);
    ok("D4", "the feed-import source is the connected one", JSON.stringify(byof.feedImportSourceIds) === JSON.stringify(["youtube"]));
    ok("D4", "the next action is the import entry", byof.nextAction.kind === "import-feed");
    ok("D4", "the import entry is Bring Your Feed", byof.nextAction.label === "Bring Your Feed");
    record("D4 BYOF transition", `ready=${byof.ready}; nextAction=${byof.nextAction.kind} ("${byof.nextAction.label}")`);
  });

  it("J36-D5 — the BYOF import path: OS dialog → preview → confirm → the source-native feed", async () => {
    const { feed, feedDouble, shell } = boot2();
    // The discovery truth first (the J34 entry points + the dialog truth).
    const discovery = await boot2().offlineDiscovery.feedImportDiscovery();
    ok("D5", "the import discovery answers a usable feed capability", discovery.capability.kind === "usable");
    ok("D5", "the shell's native file dialog is present", discovery.fileImport?.supported === true);
    ok("D5", "the file methods are the frozen file subset", discovery.fileMethods.includes("official-export"));
    record(
      "D5 import discovery",
      `capability=${discovery.capability.kind}; dialog=${discovery.fileImport?.supported === true}; methods=${discovery.fileMethods.join("/")}`,
    );

    // The native import: the OS dialog picks the export file.
    const artifact = testExportArtifact({
      continuousSync: false,
      sourceRef: "PL_j36",
      items: [
        { externalRef: "vidA", relationship: "playlist" as const, sourceOrder: 0, title: "Alpha" },
        { externalRef: "vidB", relationship: "playlist" as const, sourceOrder: 1, title: "Beta" },
        { externalRef: "chan1", relationship: "follow" as const, sourceOrder: 0 },
      ],
    });
    shell.scriptFile("/home/user/exports/feed.json", artifact);
    shell.nextFilePickOutcome = { picked: true, path: "/home/user/exports/feed.json" };

    const preview = await feed.importFromFile({ connectorId: "youtube", method: "official-export" });
    ok("D5", "the native import answered a preview", preview.outcome === "preview");
    if (preview.outcome !== "preview") throw new Error("J36 [D5] no preview");
    ok("D5", "the preview reports the honest counts", preview.preview.itemCount === 3);
    ok(
      "D5",
      "the preview reports the relationship counts",
      JSON.stringify(preview.preview.relationshipCounts) === JSON.stringify({ playlist: 2, follow: 1 }),
    );
    ok("D5", "the one-time route's freshness is snapshot", preview.preview.freshness === "snapshot");

    const confirmed = await feed.confirmImport(preview.preview.importId);
    ok("D5", "the confirmed import completed", confirmed.status === "complete");
    record(
      "D5 import",
      `dialog→read→preview (items=${preview.preview.itemCount}; ${JSON.stringify(preview.preview.relationshipCounts)}) → confirm → complete`,
    );

    // The imported feed: SOURCE-NATIVE order (never a WebFlix rank).
    const byofView = await feed.feedView({ profileId: J36_PROFILE, mode: "byof" });
    ok("D5", "the byof mode answered a view", byofView.ok === true);
    if (!byofView.ok) throw new Error("J36 [D5] feed view failed");
    ok("D5", "the byof view carries the imported records", byofView.view.records.length === 3);
    ok("D5", "the order semantics is source-native (never a rank in disguise)", byofView.view.orderSemantics === "source-native");
    ok(
      "D5",
      "the records keep the source's own order",
      byofView.view.records
        .filter((r) => r.provenance.relationship === "playlist")
        .map((r) => r.provenance.sourceOrder)
        .join(",") === "0,1",
    );

    // The WebFlix mode truth: imported records are never re-labeled.
    const webflixView = await feed.feedView({ profileId: J36_PROFILE, mode: "webflix" });
    ok("D5", "the webflix mode is empty of imported records", webflixView.ok === true && webflixView.view.records.length === 0);
    ok("D5", "the webflix mode states its note", webflixView.ok === true && webflixView.view.note !== null);
    record(
      "D5 feed truth",
      `byof: ${byofView.view.records.length} records, order=${byofView.view.orderSemantics}; webflix: 0 records (the mode-truth note)`,
    );

    // IDEMPOTENT re-import (the same file twice — the UNIQUE import-key law).
    shell.nextFilePickOutcome = { picked: true, path: "/home/user/exports/feed.json" };
    const second = await feed.importFromFile({ connectorId: "youtube", method: "official-export" });
    ok("D5", "the re-import answered a preview", second.outcome === "preview");
    if (second.outcome === "preview") {
      const reconfirmed = await feed.confirmImport(second.preview.importId);
      ok("D5", "the re-import confirmed", reconfirmed.status === "complete");
    }
    ok("D5", "the record count is UNCHANGED (idempotency)", feedDouble.recordCount() === 3);

    // The background sync task registry (the Desktop envelope).
    const sync = await feed.scheduleSync({ importId: preview.preview.importId });
    ok("D5", "the background sync task was scheduled", sync.accepted === true);
    const syncOutcome = await feed.runSync({ importId: preview.preview.importId });
    ok("D5", "the sync pass completed", syncOutcome.outcome === "synced");
    const syncStatus = await feed.syncStatus(preview.preview.importId);
    ok("D5", "the task registry reports completed", syncStatus?.state === "completed");
    record(
      "D5 idempotency + sync",
      `re-import → recordCount=${feedDouble.recordCount()} (unchanged); sync task → ${syncStatus?.state ?? "none"}`,
    );
  });

  it("J36-D6 — the BYOM/local-model management truth (R22-C parity: bind → truth → policy → remove)", async () => {
    const { modelManagement, stub } = boot2();
    // The honest empty state first.
    scriptModelProviders(stub, [makeProviderRow()]);
    scriptModelPolicies(stub, () => null);
    let view = await modelManagement.refreshManagement();
    ok("D6", "the refreshed view answers the honest empty state", view.bound.length === 0 && view.emptyDetail !== null);
    ok("D6", "the single frozen ADD action is present", view.addAction.kind === "add" && view.addAction.label === "Add your model provider");
    record("D6 empty state", `bound=0; emptyDetail="${view.emptyDetail ?? ""}"; addAction="${view.addAction.label}"`);

    // ADD/BIND: the key is the secret ON ITS WAY IN.
    scriptByomBind(stub);
    scriptModelProviders(stub, [
      makeProviderRow(),
      makeProviderRow({
        id: "my-openai",
        privacy: "cloud",
        capabilities: ["translation", "summary"],
        byomBound: true,
        costs: { translation: 4 },
      }),
    ]);
    const added = await modelManagement.addProvider({
      providerId: "my-openai",
      endpointUrl: "http://localhost:11434",
      key: "sk-the-j36-secret",
      capabilities: ["translation", "summary"],
      costPerCall: 4,
    });
    ok("D6", "the provider bound through the transport", added.ok === true);
    if (added.ok) ok("D6", "the answer is the secret-free handle", added.value.providerId === "my-openai");

    view = modelManagement.managementView();
    ok("D6", "the refreshed view carries the binding", JSON.stringify(view.bound.map((entry) => entry.providerId)) === JSON.stringify(["my-openai"]));
    const bound = view.bound[0]!;
    ok("D6", "the fail-closed truth: a bound cloud provider is NOT in use until the policy admits it", bound.stateLabel === "Added — not in use");
    const translation = bound.taskUsability.find((row) => row.task === "translation")!;
    ok("D6", "the unusable reason names the privacy class", translation.usable === false && (translation.unusableReason ?? "").includes("only uses local models"));
    record(
      "D6 bind",
      `my-openai bound; stateLabel="${bound.stateLabel}"; translation.usable=${translation.usable} (fail-closed)`,
    );

    // The per-task privacy write flips the derived truth.
    scriptPolicyWrite(stub);
    scriptModelPolicies(stub, (task) =>
      task === "translation"
        ? {
            task,
            preferredProvider: "my-openai",
            fallbackProviders: ["wfx-first-party"],
            privacy: "any-cloud",
          }
        : null,
    );
    const policy = await modelManagement.setTaskPolicy("translation", {
      task: "translation",
      preferredProvider: "my-openai",
      fallbackProviders: ["wfx-first-party"],
      privacy: "any-cloud",
    });
    ok("D6", "the task policy write landed", policy.ok === true);
    view = modelManagement.managementView();
    const flipped = view.bound[0]!.taskUsability.find((row) => row.task === "translation")!;
    ok("D6", "the usability truth flipped with the stored policy", flipped.usable === true);
    const policyRow = view.taskPolicies.find((row) => row.task === "translation")!;
    ok("D6", "the effective privacy is the stored class", policyRow.effectivePrivacy === "any-cloud");
    record(
      "D6 policy",
      `translation policy=any-cloud → usable=${flipped.usable}; effectivePrivacy=${policyRow.effectivePrivacy}`,
    );

    // THE LOCAL-MODEL TRUTH (the Desktop extension's first leg).
    const truth = modelManagement.localModelTruth();
    ok("D6", "a first-party local model is available", truth.available === true);
    ok("D6", "the local row is the registry's own", JSON.stringify(truth.rows.map((row) => row.providerId)) === JSON.stringify(["wfx-first-party"]));
    ok("D6", "the local row's privacy label is the device truth", truth.rows[0]?.privacyLabel === "Runs on this device");
    ok("D6", "the frozen platform note rides the truth", truth.platformNote === DESKTOP_LOCAL_MODEL_PLATFORM_NOTE);
    const hints = modelManagement.localEndpointHints();
    ok(
      "D6",
      "the endpoint hints are input suggestions (never capability claims)",
      hints.length > 0 && hints.every((hint) => hint.detail.includes("edit") && hint.detail.includes("checks what actually answers")),
    );
    record(
      "D6 local model",
      `available=${truth.available}; row=wfx-first-party ("${truth.rows[0]?.privacyLabel}"); hints=${hints.length} (suggestions)`,
    );

    // REMOVE/UNBIND (the delete discipline).
    scriptByomRemove(stub);
    scriptModelProviders(stub, [makeProviderRow()]);
    scriptModelPolicies(stub, () => null);
    const removed = await modelManagement.removeProvider("my-openai");
    ok("D6", "the provider unbound", removed.ok === true);
    ok("D6", "the view lost the binding (the honest empty state returned)", modelManagement.managementView().bound.length === 0);
    record("D6 remove", "my-openai unbound; bound=0 (empty state returned)");
  });

  it("J36-D7 — the authorized acquisition/offline path: Make available offline → Preparing → Completing", async () => {
    const { offlineDiscovery, acquisition } = boot2();
    // The from-content affordance on an unknown item: the offer, discoverable.
    const offer = offlineDiscovery.makeAvailableOffline(J36_ITEM);
    ok("D7", "the affordance offers Make available offline", offer.headline === "Make available offline");
    ok("D7", "the capability standing is usable", offer.capability.kind === "usable");
    ok(
      "D7",
      "the acquire action carries the SHARED label",
      offer.actions.length === 1 && offer.actions[0]!.action.kind === "acquire" && offer.actions[0]!.label === "Make available offline",
    );
    record("D7 affordance", `headline="${offer.headline}"; action="${offer.actions[0]?.label ?? "none"}" (shared vocabulary)`);

    // The composition root's recipe: the authorized ingestion + bind.
    const started = await offlineDiscovery.executeAcquire(J36_ITEM);
    ok("D7", "the acquisition started through the recipe", started.ok === true);
    acquisition.refreshAcquisition();
    let status: AcquisitionStatusView | null = boot2().runtime.acquisition.view(J36_ITEM);
    ok("D7", "the lifecycle surfaced Preparing", status?.state === "preparing");
    ok("D7", "the preparing progress is honestly unknown (never fabricated)", status?.progress === null);
    record("D7 preparing", `state=${status?.state}; label=${status?.label}; progress=null (honest)`);

    // The plain download path: Completing with truthful progress.
    boot2().engine.script(
      J36_SESSION,
      engineStatus({
        sessionId: J36_SESSION,
        state: "downloading",
        progress: {
          selectedPieces: 6,
          verifiedSelectedPieces: 2,
          selectedBytes: 98_304,
          verifiedSelectedBytes: 32_768,
          fraction: 2 / 6,
        },
        provenance: J36_PROVENANCE,
      }),
      "idle",
      engineTruth(),
    );
    acquisition.refreshAcquisition();
    status = boot2().runtime.acquisition.view(J36_ITEM);
    ok("D7", "the lifecycle surfaced Completing", status?.state === "completing");
    ok("D7", "the progress is the measured fraction", status?.progress !== null && Math.abs((status?.progress ?? 0) - 2 / 6) < 1e-9);
    const background = offlineDiscovery.backgroundCompletion();
    ok("D7", "the background surface carries the completing work", background.some((view) => view.itemId === J36_ITEM && view.state === "completing"));
    record(
      "D7 completing",
      `state=completing; progress=${((status?.progress ?? 0) * 100).toFixed(0)}%; backgroundCompletion carries the work`,
    );

    // Mid-transfer at 4/6 — the moment the interruption will strike.
    boot2().engine.script(
      J36_SESSION,
      engineStatus({
        sessionId: J36_SESSION,
        state: "downloading",
        progress: {
          selectedPieces: 6,
          verifiedSelectedPieces: 4,
          selectedBytes: 98_304,
          verifiedSelectedBytes: 65_536,
          fraction: 4 / 6,
        },
        provenance: J36_PROVENANCE,
      }),
      "idle",
      engineTruth(),
    );
    acquisition.refreshAcquisition();
    status = boot2().runtime.acquisition.view(J36_ITEM);
    ok("D7", "the transfer reached 4/6 verified", status?.state === "completing" && Math.abs((status?.progress ?? 0) - 4 / 6) < 1e-9);
    record("D7 mid-transfer", `state=completing; progress=${((status?.progress ?? 0) * 100).toFixed(0)}% — the interruption strikes here`);
  });

  it("J36-D8 — the interruption + RESTART: the journaled recovery RESUMES with retained progress", async () => {
    // The app restarted mid-transfer: boot 3 shares only the keychain with
    // boot 2 — the acquisition state must come back from the ENGINE's
    // journal (the recovery report), never from a fabricated memory.
    const { firstRun, stub } = boot3();
    scriptSessionRead(stub);
    const restored = await firstRun.restoreSession();
    ok("D8", "the session continuity held through the interruption restart", restored.verified === true && restored.state.state === "signed-in");
    record("D8 restart continuity", `restoreSession → verified=${restored.verified}; signed-in retained`);

    // The engine's journaled truth after the interruption: the session
    // restored paused at its control point (4/6 verified, piece map reused).
    // The composition root's recovery wiring re-binds the journaled session
    // (the same bindSession the acquire recipe performs), then the recovery
    // report re-arms the runtime's acquisition truth from the journal.
    boot3().engine.script(
      J36_SESSION,
      engineStatus({
        sessionId: J36_SESSION,
        state: "seeding-paused",
        progress: {
          selectedPieces: 6,
          verifiedSelectedPieces: 4,
          selectedBytes: 98_304,
          verifiedSelectedBytes: 65_536,
          fraction: 4 / 6,
        },
        provenance: J36_PROVENANCE,
      }),
      "idle",
      engineTruth({ schedulerState: "idle", runway: undefined }),
    );
    boot3().source.bindSession(J36_SESSION, J36_IDENTITY);
    const recovered = boot3().acquisition.refreshAcquisition(J36_RECOVERY);
    ok("D8", "the recovery refresh answered ok", recovered.ok === true);
    const status = boot3().runtime.acquisition.view(J36_ITEM);
    ok("D8", "the acquisition RESUMED (never a fresh restart)", status?.resumed === true);
    ok("D8", "the restored session is paused at its control point", status?.paused === true);
    ok("D8", "the retained progress is the journaled fraction", Math.abs((status?.retainedFraction ?? 0) - 4 / 6) < 1e-9);
    ok("D8", "the detail names the resume truth", (status?.detail ?? "").includes("Resuming where it left off"));
    ok(
      "D8",
      "the explicit resume-or-restart choice is offered",
      JSON.stringify(status?.actions.map((action) => action.kind)) === JSON.stringify(["resume", "restart"]),
    );
    ok(
      "D8",
      "NO false completion (the honesty law)",
      status?.state !== "ready-offline",
    );
    record(
      "D8 resuming",
      `resumed=${status?.resumed}; paused=${status?.paused}; retained=${((status?.retainedFraction ?? 0) * 100).toFixed(0)}%; actions=resume|restart; NO false completion`,
    );

    // The user resumes: the SAME lifecycle continues with the retained
    // proof still named — then verifies, completes, and the exposure lands.
    boot3().engine.script(
      J36_SESSION,
      engineStatus({
        sessionId: J36_SESSION,
        state: "downloading",
        progress: {
          selectedPieces: 6,
          verifiedSelectedPieces: 5,
          selectedBytes: 98_304,
          verifiedSelectedBytes: 81_920,
          fraction: 5 / 6,
        },
        provenance: J36_PROVENANCE,
      }),
      "idle",
      engineTruth(),
    );
    boot3().acquisition.refreshAcquisition();
    let view = boot3().runtime.acquisition.view(J36_ITEM);
    ok("D8", "the resumed lifecycle continued (never a fresh start)", view?.state === "completing" && view?.resumed === true && view?.paused === false);
    record("D8 resumed", `state=${view?.state}; resumed=${view?.resumed}; paused=false`);

    // Verifying (the integrity gate before any Ready-offline claim).
    boot3().engine.script(
      J36_SESSION,
      engineStatus({
        sessionId: J36_SESSION,
        state: "verifying",
        progress: {
          selectedPieces: 6,
          verifiedSelectedPieces: 6,
          selectedBytes: 98_304,
          verifiedSelectedBytes: 98_304,
          fraction: 1,
        },
        provenance: J36_PROVENANCE,
      }),
      "idle",
      engineTruth(),
    );
    boot3().acquisition.refreshAcquisition();
    view = boot3().runtime.acquisition.view(J36_ITEM);
    ok("D8", "the verification phase surfaced", view?.state === "completing" && (view?.detail ?? "").includes("Checking the finished files"));
    record("D8 verifying", `state=${view?.state}; detail carries the checking truth`);

    // Completed WITHOUT the exposure: still completing (the earned arrival
    // is the exposure verdict — never the bare completion).
    boot3().engine.script(
      J36_SESSION,
      engineStatus({
        sessionId: J36_SESSION,
        state: "completed",
        integrity: "verified",
        progress: {
          selectedPieces: 6,
          verifiedSelectedPieces: 6,
          selectedBytes: 98_304,
          verifiedSelectedBytes: 98_304,
          fraction: 1,
        },
        digests: [{ path: "feature-presentation.mkv", sizeBytes: 88_912, sha256: "a".repeat(64) }],
        provenance: J36_PROVENANCE,
      }),
      "idle",
      engineTruth(),
    );
    boot3().acquisition.refreshAcquisition();
    view = boot3().runtime.acquisition.view(J36_ITEM);
    ok("D8", "a bare completion never claims Ready offline", view?.state === "completing");

    // THE EARNED ARRIVAL: the verified exposure lands (J26).
    boot3().engine.scriptOfflineReady([j36OfflineEntry(J36_SESSION)]);
    boot3().acquisition.refreshAcquisition();
    view = boot3().runtime.acquisition.view(J36_ITEM);
    ok("D8", "the verified exposure earned Ready offline", view?.state === "ready-offline");
    ok("D8", "the offline truth carries the asset facts", view?.offline?.assetCount === 1 && view?.offline?.sizeBytes === 88_912);
    ok(
      "D8",
      "the earned actions are play-offline + reverify",
      JSON.stringify(view?.actions.map((action) => action.kind)) === JSON.stringify(["play-offline", "reverify-offline"]),
    );
    record(
      "D8 ready-offline",
      `state=ready-offline (EARNED); offline=${JSON.stringify(view?.offline)}; actions=play-offline|reverify-offline`,
    );
  });

  it("J36-D9 — the verified asset is findable in Library (+ the player's offline truth)", async () => {
    const { offlineDiscovery } = boot3();
    const section = offlineDiscovery.libraryOfflineSection();
    ok("D9", "the Library Offline section answers the usable capability", section.capability.kind === "usable");
    ok("D9", "the verified asset is in the readyOffline group", JSON.stringify(section.readyOffline.map((view) => view.itemId)) === JSON.stringify([J36_ITEM]));
    ok("D9", "the ready entry offers Play offline copy", section.readyOffline[0]?.actions.some((action) => action.kind === "play-offline") === true);
    ok("D9", "no failed entries exist", section.failed.length === 0);
    ok("D9", "no empty state is fabricated", section.emptyState === null);
    record(
      "D9 Library",
      `readyOffline=[${section.readyOffline.map((view) => view.itemId).join(",")}]; play-offline offered; failed=0`,
    );

    const player = offlineDiscovery.playerOfflineStatus(J36_ITEM);
    ok("D9", "the player truth: playback can continue without a connection", player.offlinePlaybackReady === true);
    ok("D9", "the player headline names Ready offline", (player.headline ?? "").includes("Ready offline"));
    ok("D9", "the Library next step is stated", player.libraryNextStep === "Find it any time in Library, under Offline.");
    record(
      "D9 player",
      `offlinePlaybackReady=${player.offlinePlaybackReady}; libraryNextStep="${player.libraryNextStep ?? ""}"`,
    );
  });

  it("J36-D10 — sign out: the honest anonymous state (the keychain cleared)", async () => {
    const { firstRun, stub } = boot3();
    scriptLogout(stub);
    const outcome = await firstRun.signOut();
    ok("D10", "the sign-out revoked the session", outcome.ok === true);
    if (outcome.ok) ok("D10", "the service confirmed the revocation", outcome.value.revoked === true);
    const account = firstRun.accountState();
    ok("D10", "the view answered the honest anonymous state", account.state === "anonymous");
    ok("D10", "no token survives", firstRun.currentToken() === null);
    ok("D10", "the keychain was cleared", (await J36_SHELL.authStoreGet()) === null);
    ok("D10", "the catalog prerequisite returned", firstRun.sourceCatalog().prerequisite?.kind === "sign-in");
    const byof = firstRun.byofPrerequisite();
    ok("D10", "BYOF returned to its bridge (never a fabricated offer)", byof.ready === false && byof.nextAction.kind === "connect-source");
    record(
      "D10 sign out",
      `revoked=true; account=anonymous; keychain=cleared; catalog.prerequisite=sign-in; byof=bridge`,
    );
  });

  it("J36-D11 — the journey-wide copy law (no stale completion copy on any projected string)", () => {
    const firstRunStrings = firstRunCopyStrings({
      sources: [
        makeSource({ connectorId: "youtube", authState: "signedIn", connected: true, accountId: "acct-j36" }),
        makeSource({ connectorId: "unwired", authMode: "oauth", connectable: false }),
      ],
      authenticated: true,
    });
    const modelStrings = modelManagementCopyStrings({
      providers: [
        makeProviderRow(),
        makeProviderRow({
          id: "my-openai",
          privacy: "cloud",
          capabilities: ["translation"],
          byomBound: true,
          costs: { translation: 4 },
        }),
      ],
    });
    const all = [...firstRunStrings, ...modelStrings];
    ok("D11", "the surfaces project a meaningful copy set", all.length > 18);
    for (const text of all) {
      if (isStaleCompletionCopy(text)) {
        throw new Error(`J36 [D11] stale completion copy returned: "${text}"`);
      }
    }
    J36_ASSERTIONS.push({ step: "D11", description: `every projected string passes the frozen stale-copy sweep (${all.length} strings)` });
    record("D11 copy law", `${all.length} projected strings swept — zero stale completion copy`);
  });

  it("J36-D12 — the REAL composition root binds every block the journey drove", () => {
    // The journey composition above mirrors main.ts with the acquisition
    // source exposed; THIS check proves `createDesktopApp` itself binds
    // the same blocks (the composition root is the production wiring).
    const stub = new StubFetch();
    const engine = new ScriptedEngine();
    const feedDouble = createFeedPortDouble({
      profileId: J36_PROFILE,
      userId: J36_USER,
      now: NOW,
      nextId: (() => {
        let counter = 0;
        return () => `j36c-${(counter += 1).toString().padStart(4, "0")}`;
      })(),
    });
    const app = createDesktopApp({
      shell: new SimShell(),
      server: createDesktopServerPort({ apiBase: J36_API_BASE, context: J36_CONTEXT, fetchImpl: stub.fetch }),
      session: {
        context: J36_CONTEXT,
        clock: new FixedClock(J36_T0),
        ids: new SequentialIdGen(),
      },
      engine: {
        config: { cacheDir: "/sim/app-data/wfx-desktop/engine-cache", maxCacheBytes: 64 * 1024 * 1024 },
        process: new SimEngineProcess(),
      },
      acquisition: { engine, adapter: engine.adapter },
      feed: { port: feedDouble.port },
      firstRun: { apiBase: J36_API_BASE, fetchImpl: stub.fetch, timeoutMs: 0 },
      offlineDiscovery: {
        acquire: async () => ({ ok: true, value: { sessionId: "s-j36-composition" } }),
      },
    });
    ok("D12", "the first-run block is bound", app.firstRun.bound === true);
    ok("D12", "the model-management block is bound", app.modelManagement.bound === true);
    ok("D12", "the feed block is bound", app.feed.bound === true);
    ok("D12", "the acquisition block is bound", app.acquisition.bound === true);
    ok(
      "D12",
      "the offline-discovery affordance answers the usable standing",
      app.offlineDiscovery.makeAvailableOffline(J36_ITEM).capability.kind === "usable",
    );
    app.dispose();
    record(
      "D12 composition root",
      "createDesktopApp: firstRun+modelManagement+feed+acquisition+offlineDiscovery all bound (usable)",
    );
  });

  it("J36-D13 — the evidence record (the journey narration integrity + the optional manifest write)", () => {
    // The narration must carry every leg of the documented journey.
    const steps = J36_LOG.map((entry) => entry.step);
    const expectedLegs = [
      "D1 fresh boot",
      "D1 anonymous prerequisites",
      "D2 create account",
      "D3 restart continuity",
      "D4 catalog selection",
      "D4 connect flow",
      "D4 BYOF transition",
      "D5 import discovery",
      "D5 import",
      "D5 feed truth",
      "D5 idempotency + sync",
      "D6 empty state",
      "D6 bind",
      "D6 policy",
      "D6 local model",
      "D6 remove",
      "D7 affordance",
      "D7 preparing",
      "D7 completing",
      "D7 mid-transfer",
      "D8 restart continuity",
      "D8 resuming",
      "D8 resumed",
      "D8 verifying",
      "D8 ready-offline",
      "D9 Library",
      "D9 player",
      "D10 sign out",
      "D11 copy law",
      "D12 composition root",
    ];
    ok(
      "D13",
      `the narration carries every journey leg (${steps.length} steps)`,
      JSON.stringify(steps) === JSON.stringify(expectedLegs),
    );
    ok("D13", "the journey recorded real assertions", J36_ASSERTIONS.length > 60);
    record("D13 narration", `${steps.length} steps; ${J36_ASSERTIONS.length} recorded assertions`);

    // The machine-generated evidence record (NEVER hand-authored): written
    // only when the evidence directory is named — the normal test battery
    // never touches the repository.
    const evidenceDir = process.env.WFX_J36_EVIDENCE_DIR;
    if (evidenceDir !== undefined && evidenceDir !== "") {
      const commit = process.env.WFX_J36_COMMIT ?? "uncommitted";
      const branch = process.env.WFX_J36_BRANCH ?? "wfx/r22/desktop";
      const finishedAt = new Date().toISOString();
      const narration = [
        "# J36 — the Desktop major-journey narration (machine-generated by apps/desktop/tests/j36-major-journey.test.ts)",
        "",
        `- commit: ${commit}`,
        `- branch: ${branch}`,
        `- window: ${J36_STARTED_AT} → ${finishedAt}`,
        `- assertions recorded: ${J36_ASSERTIONS.length}`,
        "",
        ...J36_LOG.map((entry) => `## ${entry.step}\n${entry.observed}\n`),
      ].join("\n");
      const manifest = {
        schema: "wfx-journey-manifest/1",
        commit,
        branch,
        environment: {
          mode: "desktop-composition-simulator",
          webUrl: "",
          ci: false,
          startedAt: J36_STARTED_AT,
          finishedAt,
          determinism: [
            "the REAL Desktop surface composition (mirroring createDesktopApp's wiring, the acquisition source exposed for the acquire recipe's bindSession — the composition root's own wiring shape)",
            "the deterministic shell simulator (SimShell — the OS keychain/dialog/task seams; no I/O, no network)",
            "the scripted service transport (StubFetch over the documented account/source/model routes; LIFO scripting)",
            "the scripted torrent-engine facade (the R11-R13 public shapes; authorized user-owned provenance)",
            "the R20 FeedPort double (the shared domain engine semantics; the REAL store is proven by feed-parity.test.ts over PGlite)",
            "one SimShell shared across the three boots (the OS keychain is the only cross-restart state)",
            "the fixed clock (every stamp is 2026-09-20T09:30:00.000Z)",
          ],
        },
        summary: { total: 1, encoded: 1, passed: 1, failed: 0, notRun: 0 },
        journeys: [
          {
            id: "J36",
            title: "Major user journey completion / no dead-end discovery (Desktop extension)",
            status: "pass",
            reason: null,
            failure: null,
            assertions: J36_ASSERTIONS,
            artifacts: ["j36-desktop-narration.txt", "summary.md"],
            pageErrors: [],
            durationMs: Date.now() - Date.parse(J36_STARTED_AT),
          },
        ],
        limitations: [
          {
            journeyId: "J36",
            kind: "desktop-procedure",
            note: "The NATIVE halves (the real engine binary behind createShellEngineProcess, the real OS keychain, the real OS file dialog, the real provider OAuth dance, the real background tray) cannot execute in this sandbox — no native toolchain.",
            procedure:
              "LEAD (journeys/desktop/README.md): run the real Desktop product (apps/desktop over the Tauri shell with createShellEngineProcess, the engine binary from packages/native-media, a real authorized source) and drive the same journey — the state grammar this run pinned (preparing → completing → resuming-with-retained-progress → verifying → ready-offline → Library) is the acceptance vocabulary; capture per-state screenshots and the same manifest under evidence/<run>/.",
          },
          {
            journeyId: "J36",
            kind: "configuration-limit",
            note: "The BYOF feed records live in the R20 FeedPort double (the shared domain semantics); the REAL server-side store is exercised by apps/desktop/tests/feed-parity.test.ts over PGlite (the documented parity path), not re-driven here.",
            procedure:
              "The PGlite parity suite (feed-parity.test.ts) is the repository's evidence for the real-store UNIQUE/import-key/mode-truth laws; the production service store is the R20 api lane's own coverage.",
          },
        ],
      };
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, "j36-desktop-narration.txt"), narration + "\n");
      writeFileSync(join(evidenceDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      writeFileSync(
        join(evidenceDir, "summary.md"),
        [
          "# WebFlix J36 Desktop Journey Run — Evidence Summary",
          "",
          `- commit: \`${commit}\``,
          `- branch: \`${branch}\``,
          `- environment: desktop-composition-simulator (the J21-J25 doctrine; the shell simulator + the scripted service/engine doubles)`,
          `- window: ${J36_STARTED_AT} → ${finishedAt}`,
          "",
          "**1 passed · 0 failed · 0 not-run (the native halves listed with procedures) · 1 total**",
          "",
          `The journey: ${J36_LOG.length} recorded steps, ${J36_ASSERTIONS.length} recorded assertions — see \`j36-desktop-narration.txt\` for the full state grammar.`,
          "",
          "## Explicit limitations (never silent skips)",
          "",
          "- **J36** (desktop-procedure): the native halves (real engine binary, real OS keychain/dialog, real OAuth dance) are the lead's real-toolchain procedure per journeys/desktop/README.md.",
          "- **J36** (configuration-limit): the BYOF records ride the R20 FeedPort double here; the REAL store's parity evidence is feed-parity.test.ts over PGlite.",
          "",
        ].join("\n"),
      );
      record("D13 evidence", `manifest + narration + summary written to ${evidenceDir} (machine-generated)`);
    }
  });
});
