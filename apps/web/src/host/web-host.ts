/**
 * @wfx/app-web — the R07 web host: the composition root (ONE runtime).
 *
 * THE LAW THIS MODULE KEEPS: ONE runtime instance is constructed at boot
 * per process, with the truthful platform bundle + the ServerPort bound to
 * the resolved session — and the app RENDERS RUNTIME STATE (it owns no
 * product logic). `getWebRuntimeHost()` is the single lazy constructor
 * (the boot promise is cached, so concurrent requests share one boot);
 * every route, API handler, and island consumes the same instance, so the
 * runtime's canonical registry, session watch-state fold, library state,
 * action states, and navigation state machine are the ONE truth this
 * process serves.
 *
 * BOOT LAW (the 050 law, unchanged): the ENVIRONMENT selects the
 * transport — `WFX_DEV_FIXTURES=1` (dev only) boots the fixture-backed
 * ServerPort (`host/dev-fixture-server-port.ts`, loudly a fixture);
 * otherwise the REAL `WFX_API_BASE` ServerPort (`platform/server-port.ts`);
 * neither set throws the typed `HostConfigError` — never a silent fixture
 * fallback. The platform bundle (lifecycle/storage/browser-host/
 * notifications/sharing) is constructed from the real environment: in a
 * server render pass the browser facilities are honestly absent (see
 * `platform/environment.ts`), and in the browser the same code probes and
 * declares them.
 *
 * CANONICAL-IDENTITY SEAM (documented stopgap, the same law the legacy
 * host kept): the runtime's canonical registry mints `wfxitm_` ids on
 * first sight through search/shorts — per runtime instance. Routes carry
 * the id they were linked with (card links carry the registry id), and
 * direct deep links without one are joined through THIS host's per-process
 * map (`canonicalIdFor`). Durable cross-process/cross-source canonical
 * identity is R04's lane (the Entertainment Graph / service-side graph);
 * this seam is the honest bridge until it lands.
 *
 * Determinism: the clock/id seams are real (`WebClock` over `Date.now`,
 * `CryptoUlidGen` over `crypto.getRandomValues`) — the adapter supplying
 * real time and identity, the same law the frozen transport kept. Tests
 * reset the singleton through `host/testing.ts` and inject their own seams
 * through `bootWebRuntimeHost`.
 */

import { createRuntime, type ClientRuntime } from "@wfx/client-runtime";
import type { RuntimeIdGen, ServerPort } from "@wfx/client-runtime";
import { isEntertainmentItemId } from "@wfx/domain";

import type { WebPlatformBundle } from "@/platform/capabilities";
import { createWebPlatformCapabilities } from "@/platform/capabilities";
import type { WebBrowserHostPort } from "@/platform/browser-host";
import { createWebServerPort } from "@/platform/server-port";
import type { WebEnvironment } from "@/platform/environment";
import { WebClock } from "@/platform/lifecycle";

import { createWebSurfaceResolver } from "./media-surface";
import { createFixtureBackedServerPort } from "./dev-fixture-server-port";
import { resetAcquisitionFixturesForTests, seedAcquisitionFixtures } from "./acquisition-fixtures";
import type { HostEnv, HostMode } from "./config";
import { resolveHostConfig } from "./config";
import type { WebSession } from "./session";
import { resolveWebSession } from "./session";

/** The Crockford Base32 alphabet (excludes I, L, O, U) — 32 symbols. */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * The production id seam: cryptographically random 26-char Crockford
 * Base32 ULID bodies (the same generator the frozen transport shipped —
 * one law, moved to the adapter's composition root).
 */
export class CryptoUlidGen implements RuntimeIdGen {
  next(): string {
    const bytes = new Uint8Array(26);
    crypto.getRandomValues(bytes);
    let body = CROCKFORD_ALPHABET[bytes[0]! % 8]!;
    for (let index = 1; index < 26; index += 1) {
      body += CROCKFORD_ALPHABET[bytes[index]! % 32];
    }
    return body;
  }
}

/** The booted web host: the one runtime + everything it was bound to. */
export interface WebRuntimeHost {
  /** The boot mode the environment selected (fixtures / service). */
  readonly mode: HostMode;
  /** The shared client runtime (the ONE instance this process serves). */
  readonly runtime: ClientRuntime;
  /** The session the runtime + transport are bound to. */
  readonly session: WebSession;
  /** The truthful platform bundle (capability truth at the app's disposal). */
  readonly capabilities: WebPlatformBundle;
  /** The ServerPort the runtime consumes (service or dev fixture). */
  readonly serverPort: ServerPort;
  /** The contained-surface port (the player surface renders its sessions). */
  readonly browserHost: WebBrowserHostPort;
}

/** The injectable construction seams (tests supply their own). */
export interface WebRuntimeHostOverrides {
  readonly environment?: WebEnvironment;
  readonly ids?: RuntimeIdGen;
}

// ---------------------------------------------------------------------------
// The singleton (the "one runtime at boot" law)
// ---------------------------------------------------------------------------

let bootPromise: Promise<WebRuntimeHost> | null = null;

/**
 * Boot (or return the already-booting/booted) web runtime host for this
 * process. The first call constructs the platform bundle, resolves the
 * session through the anonymous-mode seam, selects the transport through
 * the 050 environment law, and constructs THE runtime; the boot promise is
 * cached so concurrent requests share one boot and one instance.
 *
 * @throws {@link import("./config").HostConfigError} when the environment
 * cannot honestly select a transport — loudly, on every call, never a
 * silent fixture fallback.
 */
export function getWebRuntimeHost(
  env: HostEnv = process.env,
  overrides: WebRuntimeHostOverrides = {},
): Promise<WebRuntimeHost> {
  if (bootPromise === null) {
    bootPromise = bootWebRuntimeHost(env, overrides);
  }
  return bootPromise;
}

/** Construct a web runtime host (the singleton's builder; tests call it directly). */
export async function bootWebRuntimeHost(
  env: HostEnv = process.env,
  overrides: WebRuntimeHostOverrides = {},
): Promise<WebRuntimeHost> {
  const config = resolveHostConfig(env); // the 050 law (throws the typed error)

  // 1. The truthful platform bundle from the REAL environment.
  const capabilities = createWebPlatformCapabilities({
    ...(overrides.environment !== undefined ? { environment: overrides.environment } : {}),
    clock: new WebClock(),
  });

  // 2. The anonymous-mode session (the R02 seam — see host/session.ts),
  //    persisted through the bundle's OWN storage window (the durability
  //    the port truthfully provides).
  const ids = overrides.ids ?? new CryptoUlidGen();
  const session = await resolveWebSession({
    ids,
    env,
    ...(overrides.environment !== undefined ? { environment: overrides.environment } : {}),
    kv: {
      get: (key) => capabilities.ports.storage.get(key),
      set: (key, value) => capabilities.ports.storage.set(key, value),
    },
    kvDurability:
      capabilities.environmentSnapshot.hasLocalStorage === true
        ? "browser-sessions"
        : "process-lifetime",
  });

  // 3. The transport, selected by the environment law.
  const serverPort: ServerPort =
    config.mode === "fixtures"
      ? createFixtureBackedServerPort({ context: session.context })
      : createWebServerPort({ apiBase: config.apiBase, context: session.context });

  // 4. THE runtime: truth-checked bundle + transport + session (one law,
  //    one instance — `createRuntime` re-runs the capability truth check).
  //    R09: THE FROZEN PRECEDENCE IS WIRED — the Web adapter's Media
  //    Surface resolver seam (the frozen `resolveSurface` over THIS
  //    bundle's truthful device derivation) decides playback resolution;
  //    the answer's precedence trace rides on the playback state.
  const runtime = createRuntime(capabilities, serverPort, {
    context: session.context,
    clock: new WebClock(),
    ids,
  }, {
    surfaceResolver: createWebSurfaceResolver({ capabilities, clock: new WebClock() }),
  });

  // 4b. R14 — fixtures mode ONLY (the loud dev badge): seed the scripted
  //     acquisition feed (the browser-validation harness for J21-J26). In
  //     service mode NOTHING seeds — the acquisition surfaces render their
  //     honest empty states (a fixture is never silently presented as
  //     production capability — invariant 10).
  if (config.mode === "fixtures") {
    await seedAcquisitionFixtures({ mode: config.mode, runtime });
  }

  // 5. The boot-completion signal (the lifecycle's ready event, exactly once).
  capabilities.ports.lifecycle.markReady();

  return {
    mode: config.mode,
    runtime,
    session,
    capabilities,
    serverPort,
    browserHost: capabilities.ports.browserHost,
  };
}

// ---------------------------------------------------------------------------
// The per-process canonical-identity join (the R04 seam — see module doc)
// ---------------------------------------------------------------------------

const canonicalJoin = new Map<string, string>();
let joinCounter = 0;

/**
 * The canonical `wfxitm_` id for a deep-linked source identity — minted on
 * first sight, reused for the process's lifetime (the documented stopgap
 * until R04's durable identity). Links that already carry an id NEVER come
 * through here.
 */
export function canonicalIdFor(connectorId: string, externalRef: string): string {
  const key = `${connectorId}\u0000${externalRef}`;
  const existing = canonicalJoin.get(key);
  if (existing !== undefined) return existing;
  joinCounter += 1;
  // Decimal digits are a subset of Crockford Base32; first char stays in
  // [0-7] — the same valid canonical grammar the legacy join used.
  const id = `wfxitm_${String(joinCounter).padStart(26, "0")}`;
  if (!isEntertainmentItemId(id)) {
    throw new Error(`web-host canonical join: minted invalid item id '${id}'`);
  }
  canonicalJoin.set(key, id);
  return id;
}

// ---------------------------------------------------------------------------
// TEST SEAM (host/testing.ts consumes this — never a production path)
// ---------------------------------------------------------------------------

/**
 * TEST-ONLY: clear the boot promise and the canonical join so the next
 * `getWebRuntimeHost` boots pristine. Consumed exclusively by
 * `host/testing.ts` (the loud test-seam law).
 */
export function resetWebRuntimeHostForTests(): void {
  bootPromise = null;
  canonicalJoin.clear();
  joinCounter = 0;
  resetAcquisitionFixturesForTests();
}
