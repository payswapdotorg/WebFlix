/**
 * @wfx/app-web — the truthful WEB capability bundle (R07).
 *
 * The platform-adapter half of the frozen remediation layering law:
 *
 *     Experience Core -> Shared Client Runtime -> Platform Adapter -> Web
 *
 * `createWebPlatformCapabilities` constructs the ONE `PlatformCapabilities`
 * bundle the web adapter hands to `createRuntime`. The adapter owns
 * lifecycle, storage, browser embedding, notifications, background work,
 * and sharing for the WEB platform — nothing else (the runtime owns every
 * product semantic; this module constructs ports, never business logic).
 *
 * CAPABILITY TRUTH (the R01 law this module keeps):
 *
 * - `storage: "browser"` — the web storage kinds (localStorage kv +
 *   IndexedDB blobs where present; honest process-limited fallbacks where
 *   the boot context has no browser storage — see `storage.ts`).
 * - `browserHost: "contained"` — the web platform truthfully hosts a
 *   contained, cookie-isolated iframe surface (see `browser-host.ts` for
 *   the security boundary).
 * - `nativeMedia: "none"` — browsers cannot host the native media service.
 *   Authorized native/torrent acquisition is Desktop-only; the runtime
 *   produces honest `unsupported-capability` states from this declaration
 *   and NEVER boots on a bundle that lies about it.
 * - `backgroundWork: "none"` — browser tabs suspend; there is no truthful
 *   background acquisition on this platform (see `background-work.ts`).
 * - `sharing` — the Web Share API WHEN THE ENVIRONMENT HAS IT. A boot
 *   context without `navigator.share` (a server render pass) declares
 *   `false` and provides NO port — an honest absence, never a stub.
 * - `notifications` — the Web Notifications API when the environment has
 *   it; permission-gated per call, never fabricating delivery.
 *
 * The bundle is ENVIRONMENT-DRIVEN: the same adapter code probes (once, at
 * construction) whether the boot context actually provides each facility
 * and declares exactly that. The runtime NEVER probes — it consumes this
 * declaration; and `createRuntime` re-runs `checkCapabilityTruth` on the
 * bundle, so a bundle whose declared levels and provided ports disagree
 * cannot boot. This module runs the SAME check eagerly at construction and
 * throws the typed construction error rather than returning a lying bundle.
 */

import type {
  CapabilityArea,
  NotificationPort,
  PlatformCapabilities,
  SharingPort,
} from "@wfx/platform-contracts";
import { checkCapabilityTruth } from "@wfx/platform-contracts";
import type { RuntimeClock } from "@wfx/client-runtime";

import type { WebEnvironment } from "./environment";
import { detectWebEnvironment, snapshotWebEnvironment } from "./environment";
import type { WebLifecyclePort } from "./lifecycle";
import { createWebLifecyclePort } from "./lifecycle";
import type { WebStoragePort } from "./storage";
import { createWebStoragePort } from "./storage";
import type { WebBrowserHostPort } from "./browser-host";
import { createWebBrowserHostPort } from "./browser-host";
import { createWebNotificationPort } from "./notifications";
import { createWebSharingPort } from "./sharing";
import { WEB_BACKGROUND_WORK_LIMITATION } from "./background-work";

/** The stable adapter identity of the Web platform adapter. */
export const WEB_ADAPTER_ID = "wfx-web-adapter";

/** The adapter version (mirrors apps/web/package.json — one law, one place). */
export const WEB_ADAPTER_VERSION = "0.1.0";

/** The honest per-area limitation reasons the Web descriptor carries. */
export const WEB_CAPABILITY_LIMITATIONS: Readonly<Partial<Record<CapabilityArea, string>>> = {
  nativeMedia:
    "browsers cannot host the WebFlix native media service — authorized native/torrent acquisition is Desktop-only; Web renders honest unsupported states",
  backgroundWork: WEB_BACKGROUND_WORK_LIMITATION,
  storage:
    "browser storage is quota-bounded and origin-scoped; the adapter enforces typed quota-exceeded failures instead of silent drops",
  browserHost:
    "the contained surface is a sandboxed iframe: provider pages stay provider-owned, cookies/storage are isolated, and WebFlix never injects scripts or captures credentials",
};

/** Options for {@link createWebPlatformCapabilities}. */
export interface WebPlatformCapabilitiesOptions {
  /** The environment to construct from (default: the real detected one). */
  readonly environment?: WebEnvironment;
  /** The clock the lifecycle/browser-host ports stamp observation events with. */
  readonly clock?: RuntimeClock;
  /** The kv byte bound the storage port enforces (default 4 MiB). */
  readonly kvBytesBound?: number;
  /** The blob byte bound the storage port enforces (default 8 MiB). */
  readonly blobBytesBound?: number;
}

/** The constructed web bundle: the frozen bundle plus the web port handles. */
export interface WebPlatformBundle extends PlatformCapabilities {
  readonly ports: PlatformCapabilities["ports"] & {
    readonly lifecycle: WebLifecyclePort;
    readonly storage: WebStoragePort;
    readonly browserHost: WebBrowserHostPort;
    readonly notifications: NotificationPort | null;
    readonly sharing: SharingPort | null;
  };
  /** The probe snapshot the levels were derived from (inspectable truth). */
  readonly environmentSnapshot: ReturnType<typeof snapshotWebEnvironment>;
}

/**
 * The typed construction error of a bundle that fails the truth check. The
 * runtime re-checks at `createRuntime` (never boots on a lying adapter);
 * this eager check names the incoherence at its source.
 */
export class WebCapabilityError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`web platform capability bundle is incoherent: ${issues.join("; ")}`);
    this.name = "WebCapabilityError";
    this.issues = [...issues];
  }
}

/**
 * Construct the truthful Web capability bundle from the (real or injected)
 * environment. ENVIRONMENT-DRIVEN truth:
 *
 * - sharing: `true` + a real Web Share port iff `navigator.share` exists;
 * - notifications: `true` + a real permission-gated port iff the
 *   Notification API exists;
 * - storage always present (browser kinds; the kv/blob backends degrade
 *   honestly per `storage.ts` when the boot context lacks the facility);
 * - the contained browser host always present (its `open()` answers the
 *   typed `unavailable` failure in a context with no DOM — honest).
 *
 * @throws {@link WebCapabilityError} if the constructed bundle would fail
 * `checkCapabilityTruth` (a programming error in this adapter — never
 * shipped).
 */
export function createWebPlatformCapabilities(
  options: WebPlatformCapabilitiesOptions = {},
): WebPlatformBundle {
  // The environment probe happens at CONSTRUCTION time (never at import
  // time), so importing this module has no side effects on globals.
  const environment = options.environment ?? detectWebEnvironment();
  const snapshot = snapshotWebEnvironment(environment);
  const clock = options.clock;

  const lifecycle = createWebLifecyclePort({ environment, ...(clock !== undefined ? { clock } : {}) });
  const storage = createWebStoragePort({
    environment,
    ...(options.kvBytesBound !== undefined ? { kvBytesBound: options.kvBytesBound } : {}),
    ...(options.blobBytesBound !== undefined ? { blobBytesBound: options.blobBytesBound } : {}),
  });
  const browserHost = createWebBrowserHostPort({
    environment,
    ...(clock !== undefined ? { clock } : {}),
  });
  const notifications = snapshot.hasNotificationApi
    ? createWebNotificationPort({ environment })
    : null;
  const sharing = snapshot.hasWebShare ? createWebSharingPort({ environment }) : null;

  const bundle: WebPlatformBundle = {
    platform: "web",
    storage: "browser",
    browserHost: "contained",
    nativeMedia: "none",
    backgroundWork: "none",
    sharing: snapshot.hasWebShare,
    notifications: snapshot.hasNotificationApi,
    descriptor: {
      platform: "web",
      adapterId: WEB_ADAPTER_ID,
      adapterVersion: WEB_ADAPTER_VERSION,
      limitations: WEB_CAPABILITY_LIMITATIONS,
    },
    ports: {
      lifecycle,
      storage,
      browserHost,
      nativeMedia: null,
      backgroundWork: null,
      notifications,
      sharing,
    },
    environmentSnapshot: snapshot,
  };

  const issues = checkCapabilityTruth(bundle);
  if (issues.length > 0) {
    throw new WebCapabilityError(issues.map((issue) => issue.detail));
  }
  return bundle;
}
