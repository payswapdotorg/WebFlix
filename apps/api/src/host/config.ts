/**
 * @wfx/app-api — service boot configuration (WFX-055A, THE law).
 *
 * The env contract of the Experience API service (the service lane's twin
 * of the web host's WFX-050 `host/config.ts`):
 *
 * - `DATABASE_URL`       — REQUIRED. Neon PostgreSQL pooled endpoint (the
 *   052-verified database; `bootPersistence` connects + migrates it).
 * - `APP_ENCRYPTION_KEY` — REQUIRED. 32-byte secret (base64/hex) for the
 *   052 AES-256-GCM envelope encryption. Deep validation (decoding) happens
 *   in `readPersistenceEnv` at boot — exactly like the 052 split, where the
 *   web/config layer checks presence and the persistence layer decodes.
 * - `YOUTUBE_API_KEY` / `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` —
 *   OPTIONAL. Provisioning ANY of them wires the `youtube` secondary source
 *   (WFX-054 connector). Without credentials the secondary is simply not
 *   wired: its calls would degrade typed (`unauthorized` reads → no hits),
 *   so not wiring it is the honest cheaper equivalent. The OAuth pair must
 *   be complete: one without the other is a typed configuration crime.
 * - `CRON_SECRET` — OPTIONAL. When set, `GET|POST /api/relay` (the outbox
 *   drain path) requires `Authorization: Bearer <CRON_SECRET>` — the Vercel
 *   cron convention (Vercel sends exactly that header when the env var is
 *   set on the project). In production (`NODE_ENV=production`) an UNSET
 *   `CRON_SECRET` is a typed error at relay time: the relay is a protected
 *   route and must not drift open. In non-production it may be unset (local
 *   draining without a secret).
 * - `WFX_INTELLIGENCE_MODEL_ENDPOINT` — OPTIONAL (R26-W4). The
 *   operator-provisioned open-model runtime endpoint (absolute http(s)
 *   URL — the self-hosted/HF-endpoint execution locations the R23-J
 *   catalog declares). When set, the media-intelligence derivation
 *   pipeline's model routes bind the REAL HTTP executor over it (the
 *   `OpenModelExecutorPort` seam — no provider SDK anywhere in shared
 *   logic); when unset the model-gated derivation stages record their
 *   honest not-provisioned truths and the intelligence route answers the
 *   typed `no-derived-artifacts` states — never a fake success.
 * - `WFX_INTELLIGENCE_DERIVATION_LIMIT` — OPTIONAL (R26-W4). A positive
 *   integer bounding the boot-time derivation convergence (how many
 *   catalog items the boot pass derives). Default: the whole catalog
 *   (57 rows today — the metadata-fold stages are pure code; the
 *   model-gated stages are bounded by the endpoint's own capacity and
 *   their failures never fail the boot).
 *
 * Loudness law (mirrors 050/052): a missing or malformed required variable
 * is a TYPED error (`ApiConfigError`) naming every offending variable — the
 * error surface a deployer (WFX-055B) or operator reads first. A
 * misconfigured service boot must crash visibly (HTTP 500 with the typed
 * detail in the server log), never serve fabricated content.
 *
 * THE FIXTURE LAW OF THE SERVICE LANE: `WFX_DEV_FIXTURES` must NOT exist on
 * this service — not in any mode, not with any value. Fixtures are a web
 * host dev affordance (`WFX_DEV_FIXTURES=1` + `NODE_ENV≠production`); the
 * service lane serves REAL data from REAL ports or fails typed. There is no
 * fixture code anywhere in this app's closure — this module makes the flag
 * itself a configuration crime so the two lanes can never be confused.
 *
 * Determinism: this module reads ONLY its injected `env` argument (default
 * `process.env`). No `Date.now()`, no `Math.random()`, no globals. Values
 * are never logged, echoed, or embedded in error messages — only variable
 * NAMES (the 052 env law).
 */

/** The environment this service reads. Keys are the canonical `.env.example` names. */
export type ApiEnv = Record<string, string | undefined>;

/**
 * Typed boot-configuration error — the loud failure channel of the service.
 *
 * Thrown when the environment cannot honestly boot the service: missing
 * required variables, malformed values, an incomplete OAuth pair, or the
 * fixture flag invading the service lane. `missing`/`invalid` name the
 * offending variables so the message is actionable without reading source.
 */
export class ApiConfigError extends Error {
  readonly kind = "api-config" as const;
  /** Variables that were required but absent. */
  readonly missing: readonly string[];
  /** Variables that were present but malformed (or forbidden). */
  readonly invalid: readonly string[];
  /** The full human-readable detail (also the `message`). */
  readonly detail: string;

  constructor(detail: string, missing: readonly string[] = [], invalid: readonly string[] = []) {
    super(`webflix api service misconfigured: ${detail}`);
    this.name = "ApiConfigError";
    this.missing = [...missing];
    this.invalid = [...invalid];
    this.detail = detail;
  }
}

/** The optional YouTube wiring (present only when the operator provisioned it). */
export interface YouTubeEnv {
  /** `YOUTUBE_API_KEY` — powers public-data operations for tokenless users. */
  readonly apiKey?: string;
  /** `YOUTUBE_CLIENT_ID` — OAuth client (rotation of user tokens). */
  readonly clientId?: string;
  /** `YOUTUBE_CLIENT_SECRET` — OAuth client (rotation of user tokens). */
  readonly clientSecret?: string;
  /**
   * R03: `YOUTUBE_REDIRECT_URI` — the operator-registered OAuth redirect
   * (absolute http(s) URL; the Google Cloud console's authorized redirect
   * URI, e.g. `https://<api-host>/sources/callback/{state}` routed by the
   * deployment's gateway). OPTIONAL: the connector's token ROTATION needs
   * only the client pair; the R03 connect FLOW needs the full triple —
   * with the pair but no redirect URI the source is honestly listed as
   * not connectable (typed `flow-missing`), never an invented URL.
   */
  readonly redirectUri?: string;
}

/** The resolved service configuration. */
export interface ApiConfig {
  /** The validated, trimmed PostgreSQL connection string (pooled Neon endpoint). */
  readonly databaseUrl: string;
  /** The raw APP_ENCRYPTION_KEY value (base64 or hex) — decoded at persistence boot. */
  readonly encryptionKey: string;
  /**
   * The YouTube wiring — `null` when no `YOUTUBE_*` variable is provisioned
   * (the secondary source is then simply not wired: honest absence, not a
   * broken connector).
   */
  readonly youtube: YouTubeEnv | null;
  /**
   * The relay-route bearer secret (`CRON_SECRET`) — `null` when unset
   * (allowed outside production only; the relay handler enforces the law).
   */
  readonly cronSecret: string | null;
  /**
   * R26-W4: the operator-provisioned open-model runtime endpoint
   * (`WFX_INTELLIGENCE_MODEL_ENDPOINT`, absolute http(s) URL) — `null` when
   * unset (the model-gated derivation stages then record their honest
   * not-provisioned truths; the pipeline never fabricates model output).
   */
  readonly intelligenceModelEndpoint: string | null;
  /**
   * R26-W4: the boot-time derivation bound (`WFX_INTELLIGENCE_DERIVATION_LIMIT`,
   * a positive integer) — `undefined` when unset (the default: derive the
   * whole catalog; the catalog is small and per-item failures never fail
   * the boot).
   */
  readonly intelligenceDerivationLimit: number | undefined;
}

/** Read and normalize one variable (undefined for absent/whitespace-only). */
function readVar(env: ApiEnv, name: string): string | undefined {
  const raw = env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Validate a PostgreSQL connection-string scheme (postgres:// or postgresql://). */
function assertPostgresUrl(url: string): void {
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new ApiConfigError(
      "DATABASE_URL must be a PostgreSQL connection string starting with postgres:// or postgresql:// " +
        "(got a value with a different scheme — values are never logged)",
      [],
      ["DATABASE_URL"],
    );
  }
}

/**
 * Resolve the service boot configuration from the environment.
 *
 * @throws {@link ApiConfigError} when the environment cannot honestly boot
 * the service — the error names every offending variable.
 */
export function resolveApiConfig(env: ApiEnv = process.env): ApiConfig {
  // Law 0: THE FIXTURE LAW. WFX_DEV_FIXTURES must not exist on the service
  // lane — any value, in any mode, is a typed configuration crime. The
  // service serves real data or fails typed; there is no third outcome.
  const fixtureFlag = readVar(env, "WFX_DEV_FIXTURES");
  if (fixtureFlag !== undefined) {
    throw new ApiConfigError(
      "WFX_DEV_FIXTURES is set — the Experience API service has NO fixture mode (it serves real data or fails typed). " +
        "WFX_DEV_FIXTURES is a web-host dev affordance only; unset it here",
      [],
      ["WFX_DEV_FIXTURES"],
    );
  }

  // Required variables — collected together so one round fixes everything.
  const missing: string[] = [];
  const databaseUrl = readVar(env, "DATABASE_URL");
  if (databaseUrl === undefined) missing.push("DATABASE_URL");
  const encryptionKey = readVar(env, "APP_ENCRYPTION_KEY");
  if (encryptionKey === undefined) missing.push("APP_ENCRYPTION_KEY");
  if (missing.length > 0) {
    throw new ApiConfigError(
      `missing required service environment variables: ${missing.join(", ")}. ` +
        "The Experience API boots the real persistence layer (Neon pooled endpoint + 32-byte " +
        "credential-encryption key); there is no fixture fallback in the service lane " +
        "(see docs/infrastructure/environment-inventory.md)",
      missing,
    );
  }
  // Both required variables are present here (the missing-collect block
  // above threw otherwise); the casts only narrow the type for the
  // compiler — the same convention as the 052 `readPersistenceEnv`.
  assertPostgresUrl(databaseUrl as string);

  // Optional YouTube wiring. ANY provisioned variable wires the secondary
  // source; the OAuth pair must be complete when it appears at all.
  const apiKey = readVar(env, "YOUTUBE_API_KEY");
  const clientId = readVar(env, "YOUTUBE_CLIENT_ID");
  const clientSecret = readVar(env, "YOUTUBE_CLIENT_SECRET");
  const redirectUri = readVar(env, "YOUTUBE_REDIRECT_URI");
  const hasClientHalf = clientId !== undefined || clientSecret !== undefined;
  if (hasClientHalf && (clientId === undefined || clientSecret === undefined)) {
    throw new ApiConfigError(
      "YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must be provisioned together " +
        "(an OAuth client with only one half cannot rotate tokens) — set both or neither",
      [],
      clientId === undefined ? ["YOUTUBE_CLIENT_ID"] : ["YOUTUBE_CLIENT_SECRET"],
    );
  }
  // R03: the redirect URI is optional (rotation works without it), but when
  // present it must be an absolute http(s) URL — a malformed one is a typed
  // config crime, never silently dropped (the connect flow would build
  // broken authorization URLs).
  if (redirectUri !== undefined && !/^https?:\/\//.test(redirectUri)) {
    throw new ApiConfigError(
      "YOUTUBE_REDIRECT_URI must be an absolute http(s) URL (the OAuth redirect the operator registered with the provider)",
      [],
      ["YOUTUBE_REDIRECT_URI"],
    );
  }
  const hasAnyYoutube = apiKey !== undefined || hasClientHalf || redirectUri !== undefined;
  let youtube: YouTubeEnv | null = null;
  if (hasAnyYoutube) {
    youtube = {
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(clientId !== undefined && clientSecret !== undefined
        ? { clientId, clientSecret }
        : {}),
      ...(redirectUri !== undefined ? { redirectUri } : {}),
    };
  }

  const cronSecret = readVar(env, "CRON_SECRET") ?? null;

  // R26-W4 — the intelligence derivation wiring. The model-runtime endpoint
  // is OPTIONAL: unset means the model-gated stages record their honest
  // not-provisioned truths (the route then answers the typed
  // no-derived-artifacts states — never a fabricated artifact). When present
  // it must be an absolute http(s) URL (the operator's self-hosted or
  // HF-endpoint model runtime the executor binds).
  const intelligenceModelEndpointRaw = readVar(env, "WFX_INTELLIGENCE_MODEL_ENDPOINT");
  if (intelligenceModelEndpointRaw !== undefined && !/^https?:\/\//.test(intelligenceModelEndpointRaw)) {
    throw new ApiConfigError(
      "WFX_INTELLIGENCE_MODEL_ENDPOINT must be an absolute http(s) URL (the operator-provisioned open-model runtime endpoint)",
      [],
      ["WFX_INTELLIGENCE_MODEL_ENDPOINT"],
    );
  }
  const intelligenceModelEndpoint = intelligenceModelEndpointRaw ?? null;

  // The derivation bound: a positive integer when present (garbage is a
  // typed config crime, never silently ignored).
  const derivationLimitRaw = readVar(env, "WFX_INTELLIGENCE_DERIVATION_LIMIT");
  let intelligenceDerivationLimit: number | undefined;
  if (derivationLimitRaw !== undefined) {
    const parsed = Number(derivationLimitRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ApiConfigError(
        "WFX_INTELLIGENCE_DERIVATION_LIMIT must be a positive integer (the boot-time derivation bound)",
        [],
        ["WFX_INTELLIGENCE_DERIVATION_LIMIT"],
      );
    }
    intelligenceDerivationLimit = parsed;
  }

  return {
    databaseUrl: databaseUrl as string,
    encryptionKey: encryptionKey as string,
    youtube,
    cronSecret,
    intelligenceModelEndpoint,
    intelligenceDerivationLimit,
  };
}
