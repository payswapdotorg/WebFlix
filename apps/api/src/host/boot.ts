/**
 * @wfx/app-api — the server-side singleton boot composition (WFX-055A).
 *
 * THE RUNTIME CHOICE (documented per the work packet): the experience
 * package's runtime entry (`createExperienceApi`) is CLIENT-shaped — it
 * bundles the frozen use-cases with an in-memory `PlaybackSessionStore`
 * for a UI host. The SERVICE must not run that layer: the frozen web
 * client (`remote-ports.ts`) already runs the use-cases against its
 * remote `Ports`, and running them again server-side would DOUBLE the
 * use-case semantics (e.g. every confirmed like/save would be mirrored as
 * an engagement event twice — once client-side into
 * `POST /experience/events`, once server-side into the outbox). The
 * split-runtime model therefore composes the service as the PORT
 * IMPLEMENTATION: the routes answer the connector/EventSink calls the
 * frozen contract maps onto HTTP, over REAL ports:
 *
 *   resolveApiConfig                    (the env law — typed loud failures)
 *     → bootPersistence                 (052 one-call boot: env → connect →
 *                                        migrate → DbClient + Ports)
 *     → PostgresCatalogConnector        (PRIMARY source, always wired — the
 *                                        seeded webflix-catalog over Neon)
 *     → [YouTubeConnector]              (SECONDARY source, wired ONLY when
 *                                        the operator provisioned YOUTUBE_*:
 *                                        WFX-054 connector over the real
 *                                        Data API v3)
 *     → createFanOutConnector           (the app-level fan-out behind the
 *                                        single Ports.connector seam)
 *     → Ports { connector, events, clock, ids }
 *
 * - events sink = `PostgresEventSink` — the 052 transactional outbox write
 *   side: one atomic single-statement insert per event, so an event is
 *   DURABLE the very moment the endpoint answers 2xx (the answering
 *   transaction and the enqueue are the same statement).
 * - clock = `SystemClock`, ids = `CryptoUlidIdGen` — the 052
 *   composition-root seams (shared by every port in the bundle: ONE clock
 *   and ONE id source per boot, never per request).
 * - The YouTube credential source is the WFX-054 in-memory per-instance
 *   source — the honest documented stopgap until the OAuth host wiring
 *   lands (tokens never survive an instance; users appear signed-out to
 *   the secondary after a recycle). Public-data operations still work via
 *   `YOUTUBE_API_KEY` when provisioned.
 *
 * SINGLETON LAW: module-level cached promise — every route handler in the
 * App Router shares this module, so the boot runs ONCE per instance,
 * never per request. A SUCCESSFUL boot is cached for the instance's
 * lifetime (the postgres pool is never closed per-request; Vercel freezes
 * and recycles instances around it — the 052 client is built for that).
 * A FAILED boot is NOT cached: transient Neon cold-start failures
 * (the degradation family) self-heal on the next request, and config
 * crimes fail loudly on EVERY request with the typed detail (the 050/052
 * loudness law — no fixture fallback, ever).
 *
 * Determinism: the module reads ONLY the injected env (default
 * `process.env`) through `resolveApiConfig`; no `Date.now`, no
 * `Math.random`, no globals beyond the cached promise. Values are never
 * logged — only variable NAMES (the 052 env law).
 */

import {
  createFetchYouTubeTransport,
  createInMemoryYouTubeCredentialSource,
  createYouTubeConnector,
} from "@wfx/connectors";
import type { ConnectorPort, Ports } from "@wfx/experience";
import {
  bootPersistence,
  CryptoUlidIdGen,
  PostgresEventSink,
  PostgresIdentityService,
  PostgresProfileService,
  PostgresSessionService,
  SystemClock,
  type PersistenceBoot,
} from "@wfx/persistence";

import { resolveApiConfig, type ApiConfig, type ApiEnv } from "./config";
import { createFanOutConnector, type FanOutConnector } from "./fan-out";
import { seedCatalogIfEmpty, type CatalogSeedResult } from "./seed";
import { API_SERVICE_VERSION } from "./version";

/** What a successful service boot assembles. */
export interface ApiBoot {
  /** The resolved, validated service configuration. */
  readonly config: ApiConfig;
  /** The 052 persistence boot (env, DbClient, its own Ports, migrations, close). */
  readonly persistence: PersistenceBoot;
  /** The service's fan-out connector (the `Ports.connector` seam). */
  readonly connector: FanOutConnector;
  /**
   * The catalog-seed convergence step's outcome (the curated
   * webflix-catalog content, applied boot-if-empty — see `host/seed.ts`;
   * diagnostics only, the boot never depends on the catalog being seeded
   * beyond the seed's own typed failure if the seed SQL ever breaks).
   */
  readonly seed: CatalogSeedResult;
  /**
   * The SERVICE `Ports` bundle: fan-out connector + the 052 outbox event
   * sink + the shared clock/id seams. This is the bundle the transport
   * contract's routes answer against.
   */
  readonly ports: Ports;
  /**
   * R02 — the server-side identity services: register/authenticate
   * (scrypt), opaque `wfxsess_` session tokens (hashed at rest), and the
   * profile service (records + the lazy default-profile migration). The
   * auth/profile routes and the session-scoped identity resolver
   * (`host/session-identity.ts`) answer against these.
   */
  readonly identity: PostgresIdentityService;
  readonly sessions: PostgresSessionService;
  readonly profiles: PostgresProfileService;
  /**
   * R02 — the PROFILE-AWARE event sink: `POST /experience/events` with a
   * bearer session attributes the outbox row to the session's active
   * profile (`emitForProfile`), so the relay folds it into THAT profile's
   * watch history instead of the default-profile fallback. Stateless
   * adapter over the same db/clock/ids — safe alongside `ports.events`.
   */
  readonly profileEvents: PostgresEventSink;
}

/** Compose one service boot over the REAL ports. Never called per-request. */
async function bootApi(env: ApiEnv): Promise<ApiBoot> {
  // 1. The env law (throws ApiConfigError — the loud typed failure).
  const config = resolveApiConfig(env);

  // 2. The 052 one-call persistence boot: connect (PgBouncer-safe, one
  //    bounded cold-start retry) → migrate (forward-only, idempotent,
  //    checksummed) → DbClient + Ports. The clock/id seams are SHARED
  //    with everything composed below.
  const clock = new SystemClock();
  const ids = new CryptoUlidIdGen();
  const persistence = await bootPersistence({
    env: {
      DATABASE_URL: config.databaseUrl,
      APP_ENCRYPTION_KEY: config.encryptionKey,
    },
    clock,
    ids,
  });

  // 2.5. The catalog-seed convergence step: every fresh database (Neon,
  //      dev, any harness booting through THIS composition) receives the
  //      curated webflix-catalog content exactly once — idempotent under
  //      concurrent cold starts (see host/seed.ts for the decision record
  //      on why this is app-owned, not a shared migration).
  const seed = await seedCatalogIfEmpty(persistence.db);

  // 2.6. R02 — the server-side identity services over the SAME seams (one
  //      clock, one id source per boot): register/authenticate, session
  //      tokens, profiles, and the profile-aware event sink.
  const identity = new PostgresIdentityService({ db: persistence.db, ids, clock });
  const sessions = new PostgresSessionService({ db: persistence.db, ids, clock });
  const profiles = new PostgresProfileService({ db: persistence.db, ids, clock });
  const profileEvents = new PostgresEventSink({ db: persistence.db, ids, clock });

  // 3. The content sources, in PROBE ORDER (primary first).
  const sources: ConnectorPort[] = [persistence.ports.connector];

  // 4. The secondary YouTube source — wired ONLY when the operator
  //    provisioned YOUTUBE_* (honest absence otherwise: without
  //    credentials its calls would degrade typed `unauthorized`, so not
  //    wiring it is the honest cheaper equivalent).
  if (config.youtube !== null) {
    const youtube = config.youtube;
    const hasOAuthPair =
      youtube.clientId !== undefined && youtube.clientSecret !== undefined;
    sources.push(
      createYouTubeConnector({
        transport: createFetchYouTubeTransport(),
        // In-memory per-instance credential source — the documented
        // stopgap until the OAuth host wiring lands (see module doc).
        credentialSource: createInMemoryYouTubeCredentialSource(),
        clock,
        ...(youtube.apiKey !== undefined ? { apiKey: youtube.apiKey } : {}),
        ...(hasOAuthPair
          ? { oauth: { clientId: youtube.clientId as string, clientSecret: youtube.clientSecret as string } }
          : {}),
      }),
    );
  }

  // 5. The app-level fan-out behind the single Ports.connector seam.
  const connector = createFanOutConnector({
    sources,
    clock,
    version: API_SERVICE_VERSION,
  });

  // 6. The service Ports bundle: the fan-out + the 052 transactional
  //    outbox event sink (PostgresEventSink from the persistence boot)
  //    + the shared seams.
  const ports: Ports = {
    connector,
    events: persistence.ports.events,
    clock,
    ids,
  };

  return { config, persistence, connector, seed, ports, identity, sessions, profiles, profileEvents };
}

/** The module-level singleton slot (see the SINGLETON LAW above). */
let bootPromise: Promise<ApiBoot> | null = null;

/**
 * Get (or start) the service boot singleton. Route handlers share the
 * module, so this boots once per instance.
 *
 * @throws whatever `resolveApiConfig` / `bootPersistence` throw — callers
 * (the route handlers) classify per the loudness/degradation law.
 */
export function getApiBoot(env: ApiEnv = process.env): Promise<ApiBoot> {
  if (bootPromise === null) {
    bootPromise = bootApi(env).catch((thrown: unknown) => {
      // A failed boot is NOT cached: transient cold-starts self-heal on
      // the next request; config crimes keep failing loudly per request.
      bootPromise = null;
      throw thrown;
    });
  }
  return bootPromise;
}

/**
 * TEST-ONLY control of the module-level singleton slot (WFX-055A slice 3).
 *
 * The WFX-CI-FIX testing-export convention (the precedent:
 * `apps/web/src/host/watch-state.ts` exports the narrow
 * `resetWatchStateRecordingForTests`, composed by `host/testing.ts`): the
 * narrow per-module control lives WITH the state it controls, and ONLY the
 * composed seam module (`host/testing.ts`) consumes it — no production path
 * calls it (grep-provable: `host/testing.ts` is imported only by tests).
 * Route handlers stay untouched; production boot behavior is unchanged.
 */
export function setBootSlotForTests(boot: Promise<ApiBoot> | null): void {
  bootPromise = boot;
}
