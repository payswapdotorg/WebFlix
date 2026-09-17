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
 * - R03: the YouTube credential source is the connector's PERSISTENCE-backed
 *   adapter over the durable connector-account store (envelope-encrypted,
 *   WFX-052 + migration 0008) — the /sources connect/reauthorize/disconnect
 *   routes write exactly what the connector reads. The WFX-054 in-memory
 *   per-instance stopgap is retired (tokens now survive recycles).
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
  createYouTubeConnector,
  PersistenceYouTubeCredentialSource,
} from "@wfx/connectors";
import type { ConnectorPort, Ports } from "@wfx/experience";
import {
  bootPersistence,
  CryptoUlidIdGen,
  PostgresConnectorAccountStore,
  PostgresEventSink,
  PostgresIdentityService,
  PostgresProfileService,
  PostgresSessionService,
  SystemClock,
  decodeEncryptionKey,
  type PersistenceBoot,
} from "@wfx/persistence";

import { resolveApiConfig, type ApiConfig, type ApiEnv } from "./config";
import { createFanOutConnector, type FanOutAuthGate, type FanOutConnector } from "./fan-out";
import { HistoryHost } from "./history";
import { seedCatalogIfEmpty, type CatalogSeedResult } from "./seed";
import {
  createSourceManagementService,
  createYouTubeSourceWiring,
  deriveAuthState,
  type SourceManagementService,
  type SourceAuthWiring,
} from "./source-management";
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
  /**
   * R03 — the source-management service: the /sources routes (list /
   * connect / reauthorize / disconnect / callback) answer against it, and
   * the fan-out's auth gate derives each account-bound source's CURRENT
   * authorization state through the same account store + derivation.
   */
  readonly sourceManagement: SourceManagementService;
  /**
   * R03 — the durable connector-account store (envelope-encrypted
   * credentials + pending authorizations). Shared by the source-management
   * service and the auth gate; the connector runtime lane (token refresh)
   * reads through `loadAccount` exclusively.
   */
  readonly connectorAccounts: PostgresConnectorAccountStore;
  /**
   * R04 — the history host: the read-model composition over the
   * watch-history projection + the removal/exclusion filters. The
   * `/experience/history/**` routes answer against it; the relay's fold
   * uses the removal store for re-materialization on re-watch.
   */
  readonly history: HistoryHost;
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

  // 3. The R03 durable connector-account store — created BEFORE the
  //    content sources so the YouTube connector's credential seam binds to
  //    the DURABLE store (the connector's own persistence-backed adapter):
  //    a user connected through /sources is a user the connector serves.
  const connectorAccounts = new PostgresConnectorAccountStore({
    db: persistence.db,
    clock,
    key: decodeEncryptionKey(config.encryptionKey),
    ids,
  });

  // 4. The content sources, in PROBE ORDER (primary first).
  const sources: ConnectorPort[] = [persistence.ports.connector];

  // 4.1. The secondary YouTube source — wired ONLY when the operator
  //      provisioned YOUTUBE_* (honest absence otherwise: without
  //      credentials its calls would degrade typed `unauthorized`, so not
  //      wiring it is the honest cheaper equivalent). R03: the credential
  //      source is the connector's PERSISTENCE-backed adapter over the
  //      durable account store — connections made through /sources flow
  //      straight into the connector's auth resolution (the in-memory
  //      per-instance stopgap is retired).
  if (config.youtube !== null) {
    const youtube = config.youtube;
    const hasOAuthPair =
      youtube.clientId !== undefined && youtube.clientSecret !== undefined;
    sources.push(
      createYouTubeConnector({
        transport: createFetchYouTubeTransport(),
        credentialSource: new PersistenceYouTubeCredentialSource(connectorAccounts),
        clock,
        ...(youtube.apiKey !== undefined ? { apiKey: youtube.apiKey } : {}),
        ...(hasOAuthPair
          ? { oauth: { clientId: youtube.clientId as string, clientSecret: youtube.clientSecret as string } }
          : {}),
      }),
    );
  }

  // 4.5. R03 — the per-connector auth-flow wirings (documented provider
  //      facts only; the YouTube OAuth triple comes from the operator's
  //      env, an unwired flow stays honestly flow-missing).
  const wirings = new Map<string, SourceAuthWiring>();
  if (config.youtube?.clientId !== undefined && config.youtube.clientSecret !== undefined) {
    if (config.youtube.redirectUri !== undefined) {
      wirings.set(
        "youtube",
        createYouTubeSourceWiring({
          clientId: config.youtube.clientId,
          clientSecret: config.youtube.clientSecret,
          redirectUri: config.youtube.redirectUri,
        }),
      );
    }
    // Pair without redirect URI: token rotation works (the connector's
    // own wiring), but the connect FLOW is honestly not provisioned — the
    // /sources view reports it not connectable with the note why.
  }

  // 5. The app-level fan-out behind the single Ports.connector seam, now
  //    auth-state aware (R03): account-bound sources are consulted for
  //    their CURRENT authorization state per request; an unauthorized
  //    source is skipped with an honest note, never queried, never an
  //    error.
  const authGate: FanOutAuthGate = {
    async check(source, ctx) {
      if (source.auth === "none" || source.auth === "local") {
        return { verdict: "query" }; // no provider account binding in this deployment
      }
      if (!wirings.has(source.id)) {
        return { verdict: "query" }; // not connectable here: a public-data wiring — the connector degrades typed itself
      }
      let records: Awaited<ReturnType<PostgresConnectorAccountStore["listForUser"]>>;
      let pendings: Awaited<ReturnType<PostgresConnectorAccountStore["listPendingAuthorizationsForUser"]>>;
      try {
        records = await connectorAccounts.listForUser(ctx.userId);
        pendings = await connectorAccounts.listPendingAuthorizationsForUser(ctx.userId);
      } catch {
        return { verdict: "query" }; // a broken gate read degrades to the source's own typed handling
      }
      const row = records.find((record) => record.connectorId === source.id) ?? null;
      const pending = pendings.find((p) => p.connectorId === source.id) ?? null;
      const state = deriveAuthState(row, pending, clock.now());
      switch (state) {
        case "signedIn":
          return { verdict: "query" };
        case "signedOut":
          return {
            verdict: "skip",
            state: "signedOut",
            detail: "the source is signed out — connect it in Settings › Sources to include it",
          };
        case "expired":
          return {
            verdict: "skip",
            state: "expired",
            detail: "the stored authorization expired — reconnect the source to restore it",
          };
        case "authorizing":
          return {
            verdict: "skip",
            state: "authorizing",
            detail: "an authorization handshake is in progress — the source joins once it completes",
          };
        case "failed":
          return {
            verdict: "skip",
            state: "failed",
            detail: "the last authorization failed — reconnect the source to retry",
          };
      }
    },
  };

  const connector = createFanOutConnector({
    sources,
    clock,
    version: API_SERVICE_VERSION,
    authGate,
  });

  const sourceManagement = createSourceManagementService({
    sourceRows: connector.sourceRows(),
    wirings,
    accounts: connectorAccounts,
    clock,
  });

  // R04 — the history host: the read-model composition over the
  // watch-history projection + the removal/exclusion filters. The
  // `/experience/history/**` routes answer against it; the relay's fold
  // uses the removal store for the re-materialization hook (a new watch
  // event clears the removal row).
  const history = new HistoryHost({ db: persistence.db, clock, ids });

  // 6. The service Ports bundle: the fan-out + the 052 transactional
  //    outbox event sink (PostgresEventSink from the persistence boot)
  //    + the shared seams.
  const ports: Ports = {
    connector,
    events: persistence.ports.events,
    clock,
    ids,
  };

  return {
    config,
    persistence,
    connector,
    seed,
    ports,
    identity,
    sessions,
    profiles,
    profileEvents,
    sourceManagement,
    connectorAccounts,
    history,
  };
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
