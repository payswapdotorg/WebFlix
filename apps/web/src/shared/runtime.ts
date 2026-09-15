/**
 * @wfx/app-web — the shared cross-platform client runtime (WFX-040, Lane C).
 *
 * `createClientRuntime(platform, ports)` binds the merged Lane-C Experience
 * surface to ONE platform capability profile:
 *
 * - the WFX-005 Experience API (`createExperienceApi` — feeds, playback
 *   sessions, library, actions, events) — the SAME use-cases on every
 *   platform;
 * - the WFX-025 Media Surface resolver (`resolveSurface`) — driven with the
 *   PLATFORM's `DeviceCapabilities`, so the frozen precedence
 *   (Native → Embed → Browser → External) decides per-device, with the
 *   auditable `precedenceTrace`;
 * - the platform adapter (storage / lifecycle / browser host seams from
 *   `capabilities.ts`).
 *
 * The result is ONE typed façade, `ClientRuntime` — `getFeed`,
 * `startPlayback`, `library`, `actions`, `surface`, `background` — the SAME
 * calls on web, desktop, and mobile; ONLY the capability profile differs.
 * This is the cross-platform parity story made executable: the web client
 * resolves the same fixture to `embed` (native honestly rejected by
 * capability), the desktop client to `native`, the mobile client to
 * `native` — and all three emit IDENTICAL frozen events (see `parity.ts`).
 *
 * Error taxonomy passthrough (typed): the façade invents NO new failure
 * channel. Failures are exactly the `ExperienceResult` arms
 * (`unsupported` / `not-found` / `unresolvable` / `port-failed`); caller
 * misuse throws the typed `ExperienceError` (the repo misuse channel).
 *
 * Capability honesty, engine edition: the desktop profile DECLARES native
 * mode (the reference full-power client), and a runtime may only KEEP that
 * declaration when a native media engine port is bound — an engine-less
 * desktop runtime resolves with native REMOVED from its effective device
 * (the resolver then rejects native with the recorded device reason). The
 * engine port is desktop-only: the web platform is browser-constrained, and
 * mobile native playback uses OS platform media facilities — binding the
 * desktop engine there is rejected as the capability lie it would be.
 *
 * Determinism laws: no `Date.now()`, no `Math.random()`, no hidden state —
 * the decision instant for surface resolution comes EXCLUSIVELY from the
 * injected `Ports.clock`.
 */

import type {
  ActionReceipt,
  Capability,
  DeviceCapabilities,
  EntertainmentItem,
  LibraryEntry,
  NativeMediaEngine,
  PlaybackMode,
  PlaybackRealization,
  PlaybackSession,
} from "@wfx/domain";
import {
  isRecord,
  isSourceRealizationId,
  previewValue,
  validateEntertainmentItem,
  validatePlaybackRealization,
} from "@wfx/domain";

import type {
  ActionRequest,
  ExperienceContext,
  ExperienceResult,
  FeedPage,
  FeedSurface,
  PlaybackIntent,
  Ports,
  SurfacePermissions,
  SurfaceRealization,
  SurfaceResolution,
} from "@wfx/experience";
import {
  ExperienceError,
  assertValidExperienceContext,
  connectorHas,
  createExperienceApi,
  describeThrown,
  resolveSurface,
} from "@wfx/experience";

import type {
  BackgroundDecision,
  MobileBackgroundInputs,
  PlatformAdapter,
  PlatformId,
  PlatformProfile,
} from "./capabilities";
import { assertValidPlatformProfile, decideBackground } from "./capabilities";

// ---------------------------------------------------------------------------
// Client-facing input types
// ---------------------------------------------------------------------------

/**
 * A playback intent addressed to the CLIENT runtime: the canonical item to
 * play (from a feed card) plus either an `externalRef` the port resolves or
 * a caller-chosen realization. The chosen path is still DEVICE-GATED: the
 * runtime runs every candidate (including a caller-chosen one) through the
 * WFX-025 resolver, so a native realization handed to the web client is a
 * typed `unresolvable` with the auditable trace — never a silent pass.
 */
export interface ClientPlaybackIntent {
  /** The canonical item to play (validated with the WFX-002 validator). */
  readonly item: EntertainmentItem;
  /** External reference on the connector; required when no realization is chosen. */
  readonly externalRef?: string;
  /** A chosen playback realization (still capability-gated by the resolver). */
  readonly realization?: PlaybackRealization;
  /** Canonical source-realization ID (`wfxsrc_...`) for event correlation. */
  readonly sourceRealizationId?: string;
  /** Resume position in milliseconds (>= 0); defaults to 0 (start). */
  readonly resumePositionMs?: number;
  /** Per-mode surface permissions (default permissive — WFX-025 semantics). */
  readonly permissions?: SurfacePermissions;
}

/** One surface-resolution request addressed to the client runtime. */
export interface ClientSurfaceInput {
  /** The canonical item to resolve for. */
  readonly item: EntertainmentItem;
  /** Candidate realizations in caller order. */
  readonly realizations: readonly SurfaceRealization[];
  /** Per-mode permissions (default permissive — WFX-025 semantics). */
  readonly permissions?: SurfacePermissions;
}

/**
 * Runtime construction options:
 * - `engine` — the native media engine port (the frozen `NativeMediaEngine`
 *   interface). DESKTOP-ONLY; binding it on web/mobile throws (capability
 *   honesty — see the module doc).
 * - `backgroundInputs` — the injected OS background inputs consumed by
 *   `os-constrained` (mobile) background policies. Web/desktop policies are
 *   input-independent; providing inputs there is harmless and ignored.
 */
export interface ClientRuntimeOptions {
  readonly engine?: NativeMediaEngine;
  readonly backgroundInputs?: MobileBackgroundInputs;
}

// ---------------------------------------------------------------------------
// ClientStartResult — the typed result with the auditable resolution
// ---------------------------------------------------------------------------

/** The failure arms of the Experience result — the passthrough taxonomy. */
export type ExperienceFailure = Extract<ExperienceResult<unknown>, { ok: false }>;

/**
 * The typed `startPlayback` result: on success, the frozen `PlaybackSession`
 * PLUS the resolver's chosen mode and the full precedence trace (the audit
 * of WHY this platform plays it this way); on failure, EXACTLY the
 * Experience failure taxonomy (no new reasons, no fake successes).
 */
export type ClientStartResult =
  | {
      ok: true;
      value: PlaybackSession;
      mode: PlaybackMode;
      precedenceTrace: readonly string[];
    }
  | ExperienceFailure;

// ---------------------------------------------------------------------------
// ClientRuntime — the one façade, identical on every platform
// ---------------------------------------------------------------------------

/**
 * The platform-bound client façade. Identical call surface on web, desktop,
 * and mobile (`parity.ts` machine-checks this); only the capability profile
 * (and thereby resolver outcomes and background decisions) differs.
 */
export interface ClientRuntime {
  /** The platform identity of this runtime. */
  readonly platform: PlatformId;
  /** The bound platform profile (capabilities + adapter). */
  readonly profile: PlatformProfile;
  /**
   * The EFFECTIVE device capabilities driving the resolver: the profile's
   * declaration, with native removed on an engine-less desktop runtime
   * (capability honesty — see the module doc).
   */
  readonly device: Readonly<DeviceCapabilities>;
  /** The platform adapter (storage / lifecycle / browser host seams). */
  readonly adapter: PlatformAdapter;
  /** The bound native media engine port — desktop-only; `undefined` otherwise. */
  readonly engine: NativeMediaEngine | undefined;
  /** The ports bundle this runtime was built on (read access for hosts/tests). */
  readonly ports: Ports;

  /** Assemble one source-neutral feed page (empty page on unsupported/empty/failed search). */
  getFeed(ctx: ExperienceContext, surface: FeedSurface, query: string): Promise<FeedPage>;
  /** Start playback: port-resolve (or accept a chosen realization), device-gate via WFX-025, then the WFX-005 session. */
  startPlayback(ctx: ExperienceContext, intent: ClientPlaybackIntent): Promise<ClientStartResult>;
  /** Read the connector-side library (typed unsupported when the capability is missing). */
  library(ctx: ExperienceContext): Promise<ExperienceResult<LibraryEntry[]>>;
  /** Execute a user action; confirmed like/save actions mirror as frozen events. */
  actions(ctx: ExperienceContext, action: ActionRequest): Promise<ExperienceResult<ActionReceipt>>;
  /** Resolve one playback request through the WFX-025 frozen precedence with this platform's device. */
  surface(input: ClientSurfaceInput): SurfaceResolution;
  /** The typed background-completion decision under this platform's policy. */
  background(): BackgroundDecision;
}

// ---------------------------------------------------------------------------
// Runtime option / port validation (caller misuse — typed throws)
// ---------------------------------------------------------------------------

/** The play-capability mirror of the WFX-005 gate (not exported there). */
const CLIENT_PLAY_CAPABILITIES: readonly Capability[] = [
  "playNative",
  "playEmbed",
  "playBrowser",
  "playExternal",
];

const NETWORK_CLASSES: readonly string[] = ["wifi", "cellular", "offline"];

function assertValidRuntimePorts(ports: Ports): void {
  if (!isRecord(ports)) {
    throw new ExperienceError("ports: expected a Ports object");
  }
  const problems: string[] = [];
  const connector = ports.connector;
  if (
    !isRecord(connector) ||
    typeof connector.descriptor !== "function" ||
    typeof connector.search !== "function" ||
    typeof connector.metadata !== "function" ||
    typeof connector.resolve !== "function" ||
    typeof connector.executeAction !== "function"
  ) {
    problems.push(
      `ports.connector: expected a ConnectorPort object, got ${previewValue(connector)}`,
    );
  }
  if (!isRecord(ports.events) || typeof ports.events.emit !== "function") {
    problems.push(`ports.events: expected an EventSink object, got ${previewValue(ports.events)}`);
  }
  if (!isRecord(ports.clock) || typeof ports.clock.now !== "function") {
    problems.push(`ports.clock: expected a Clock object, got ${previewValue(ports.clock)}`);
  }
  if (!isRecord(ports.ids) || typeof ports.ids.next !== "function") {
    problems.push(`ports.ids: expected an IdGen object, got ${previewValue(ports.ids)}`);
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

function assertValidRuntimeOptions(platform: PlatformId, options: ClientRuntimeOptions): void {
  if (!isRecord(options)) {
    throw new ExperienceError("options: expected a ClientRuntimeOptions object");
  }
  const problems: string[] = [];
  if (options.engine !== undefined) {
    if (platform === "web") {
      problems.push(
        "options.engine: the web platform is browser-constrained — a native media engine port cannot be bound (capability honesty)",
      );
    }
    if (platform === "mobile") {
      problems.push(
        "options.engine: mobile playback uses OS platform media facilities — the NativeMediaEngine port is the desktop seam",
      );
    }
    if (!isRecord(options.engine) || typeof options.engine.open !== "function") {
      problems.push(
        `options.engine: expected a NativeMediaEngine object, got ${previewValue(options.engine)}`,
      );
    }
  }
  const inputs = options.backgroundInputs;
  if (inputs !== undefined) {
    if (
      !isRecord(inputs) ||
      typeof inputs.networkClass !== "string" ||
      !NETWORK_CLASSES.includes(inputs.networkClass) ||
      typeof inputs.charging !== "boolean"
    ) {
      problems.push(
        `options.backgroundInputs: expected { networkClass: 'wifi' | 'cellular' | 'offline', charging: boolean }, got ${previewValue(inputs)}`,
      );
    }
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

function assertValidClientPlaybackIntent(intent: ClientPlaybackIntent): void {
  if (!isRecord(intent)) {
    throw new ExperienceError("intent: expected a ClientPlaybackIntent object");
  }
  const problems: string[] = [];
  const itemCheck = validateEntertainmentItem(intent.item);
  if (!itemCheck.ok) {
    problems.push(...itemCheck.errors.map((message) => `intent.item: ${message}`));
  }
  if (intent.realization === undefined) {
    if (typeof intent.externalRef !== "string" || intent.externalRef.trim().length === 0) {
      problems.push(
        `intent.externalRef: required when no realization is chosen (nothing to resolve), got ${previewValue(intent.externalRef)}`,
      );
    }
  } else {
    if (
      intent.externalRef !== undefined &&
      (typeof intent.externalRef !== "string" || intent.externalRef.trim().length === 0)
    ) {
      problems.push(
        `intent.externalRef: expected a non-empty string when present, got ${previewValue(intent.externalRef)}`,
      );
    }
    const realizationCheck = validatePlaybackRealization(intent.realization);
    if (!realizationCheck.ok) {
      problems.push(
        ...realizationCheck.errors.map((message) => `intent.realization: ${message}`),
      );
    }
  }
  if (
    intent.resumePositionMs !== undefined &&
    (typeof intent.resumePositionMs !== "number" ||
      !Number.isFinite(intent.resumePositionMs) ||
      intent.resumePositionMs < 0)
  ) {
    problems.push(
      `intent.resumePositionMs: expected a finite non-negative number when present, got ${previewValue(intent.resumePositionMs)}`,
    );
  }
  if (intent.sourceRealizationId !== undefined && !isSourceRealizationId(intent.sourceRealizationId)) {
    problems.push(
      `intent.sourceRealizationId: expected a canonical source-realization ID (wfxsrc_ prefix + 26-char Crockford Base32 ULID body) when present, got ${previewValue(intent.sourceRealizationId)}`,
    );
  }
  if (intent.permissions !== undefined && !isRecord(intent.permissions)) {
    problems.push(
      `intent.permissions: expected a SurfacePermissions object when present, got ${previewValue(intent.permissions)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// Candidate collection (port resolution, gated exactly like WFX-005)
// ---------------------------------------------------------------------------

type ClientCandidates =
  | { ok: true; realizations: readonly PlaybackRealization[] }
  | ExperienceFailure;

async function collectCandidates(
  ports: Ports,
  ctx: ExperienceContext,
  intent: ClientPlaybackIntent,
): Promise<ClientCandidates> {
  if (intent.realization !== undefined) {
    // Caller-chosen path: still ONE candidate for the device gate below —
    // the resolver rejects it honestly when this platform cannot realize it.
    return { ok: true, realizations: [intent.realization] };
  }
  const ref = intent.externalRef ?? "";
  if (!CLIENT_PLAY_CAPABILITIES.some((capability) => connectorHas(ports.connector, capability))) {
    return {
      ok: false,
      reason: "unsupported",
      capability: "playNative",
      detail: `connector '${ports.connector.descriptor().id}' declares none of ${CLIENT_PLAY_CAPABILITIES.join(" | ")}`,
    };
  }
  let resolved: unknown;
  try {
    resolved = await ports.connector.resolve(ctx, ref);
  } catch (thrown) {
    return {
      ok: false,
      reason: "port-failed",
      operation: "resolve",
      detail: describeThrown(thrown),
    };
  }
  if (!Array.isArray(resolved)) {
    return {
      ok: false,
      reason: "unresolvable",
      detail: `connector '${ports.connector.descriptor().id}' resolved ${previewValue(resolved)} for '${ref}' (expected an array of PlaybackRealization)`,
    };
  }
  return { ok: true, realizations: resolved as PlaybackRealization[] };
}

// ---------------------------------------------------------------------------
// Effective device (the engine honesty gate)
// ---------------------------------------------------------------------------

/**
 * The effective device for resolution: the profile declaration, minus native
 * on an engine-less DESKTOP runtime. Web and mobile never bind the engine
 * (enforced in the options validation), so their declaration stands as-is.
 */
function effectiveDevice(
  platform: PlatformProfile,
  engine: ClientRuntimeOptions["engine"],
): Readonly<DeviceCapabilities> {
  if (platform.platform === "desktop" && engine === undefined) {
    return {
      ...platform.device,
      playbackModes: platform.device.playbackModes.filter((mode) => mode !== "native"),
    };
  }
  return platform.device;
}

// ---------------------------------------------------------------------------
// createClientRuntime
// ---------------------------------------------------------------------------

/**
 * Bind one platform profile + one ports bundle into a `ClientRuntime`.
 *
 * @param platform the platform capabilities + adapter (validated eagerly).
 * @param ports    the WFX-005 ports (connector / events / clock / ids).
 * @param options  the engine port (desktop) and OS background inputs (mobile).
 * @throws `ExperienceError` for malformed platform/ports/options (misuse).
 */
export function createClientRuntime(
  platform: PlatformProfile,
  ports: Ports,
  options: ClientRuntimeOptions = {},
): ClientRuntime {
  assertValidPlatformProfile(platform);
  assertValidRuntimePorts(ports);
  assertValidRuntimeOptions(platform.platform, options);

  const engine = options.engine;
  const backgroundInputs = options.backgroundInputs;
  const device = effectiveDevice(platform, engine);
  const api = createExperienceApi(ports);

  async function startClientPlayback(
    ctx: ExperienceContext,
    intent: ClientPlaybackIntent,
  ): Promise<ClientStartResult> {
    assertValidExperienceContext(ctx);
    assertValidClientPlaybackIntent(intent);

    const candidates = await collectCandidates(ports, ctx, intent);
    if (!candidates.ok) return candidates;

    const resolution = resolveSurface({
      item: intent.item,
      realizations: candidates.realizations,
      device,
      permissions: intent.permissions ?? {},
      now: new Date(ports.clock.now()).toISOString(),
    });
    if (!resolution.ok) {
      // The resolver's reasons verbatim, prefixed with the caller's source
      // context so the failure is actionable (the WFX-005 detail convention).
      const source =
        intent.realization !== undefined
          ? "the caller-chosen realization"
          : `external ref '${intent.externalRef ?? ""}'`;
      return {
        ok: false,
        reason: "unresolvable",
        detail: `no realizable playback mode for item '${intent.item.id}' (${source}): ${resolution.reasons.join("; ")}`,
      };
    }

    const apiIntent: PlaybackIntent = {
      itemId: intent.item.id,
      realization: resolution.chosen,
      resumePositionMs: intent.resumePositionMs ?? 0,
    };
    if (intent.sourceRealizationId !== undefined) {
      apiIntent.sourceRealizationId = intent.sourceRealizationId;
    }
    const started = await api.startPlayback(ctx, apiIntent);
    if (!started.ok) return started;
    return {
      ok: true,
      value: started.value,
      mode: resolution.mode,
      precedenceTrace: [...resolution.precedenceTrace],
    };
  }

  function resolveClientSurface(input: ClientSurfaceInput): SurfaceResolution {
    if (!isRecord(input)) {
      throw new ExperienceError("input: expected a ClientSurfaceInput object");
    }
    return resolveSurface({
      item: input.item,
      realizations: input.realizations,
      device,
      permissions: input.permissions ?? {},
      now: new Date(ports.clock.now()).toISOString(),
    });
  }

  return {
    platform: platform.platform,
    profile: platform,
    device,
    adapter: platform.adapter,
    engine,
    ports,
    getFeed: (ctx, surface, query) => api.getFeed(ctx, { surface, query }),
    startPlayback: startClientPlayback,
    library: (ctx) => api.getLibrary(ctx),
    actions: (ctx, action) => api.runUserAction(ctx, action),
    surface: resolveClientSurface,
    background: () => decideBackground(platform.background, backgroundInputs),
  };
}
