/**
 * @wfx/app-web — host boot configuration (WFX-050, THE law).
 *
 * Port selection by environment — the single decision every boot path in
 * this app funnels through (`host/boot.ts`, `host/default-ports.ts`, and
 * the `main.ts` default when ports are omitted):
 *
 * - `WFX_DEV_FIXTURES` set to `1` (or `true`, per
 *   docs/infrastructure/environment-inventory.md) and `NODE_ENV` NOT
 *   `production` → **fixtures mode**: `makeFixturePorts()` from
 *   `@wfx/experience` (deterministic dev content for local UX work).
 * - `WFX_DEV_FIXTURES` unset → **service mode**: the split-runtime service
 *   wiring via `WFX_API_BASE` (the Experience API base URL consumed by the
 *   remote ports in `host/remote-ports.ts`).
 * - Anything else → `HostConfigError`. NEVER a silent fallback to fixtures.
 *
 * Loudness law: a missing or malformed required variable is a TYPED error
 * (`HostConfigError`) that names every offending variable — the error
 * surface a deployer (WFX-056) or operator reads first. A misconfigured
 * production boot must crash visibly (HTTP 500 with the typed detail in the
 * server log), never render fixture content pretending to be production.
 *
 * Guard rails encoded here and machine-tested (`tests/host-boot.test.ts`):
 *
 * - `WFX_DEV_FIXTURES` set while `NODE_ENV === "production"` → typed error
 *   (the flag is dev-only by contract — `.env.example`).
 * - `WFX_DEV_FIXTURES` set to any value other than `1`/`true` → typed
 *   error naming the variable (a typo'd flag must not silently mean
 *   "production", nor silently mean "fixtures").
 * - `WFX_API_BASE` present but not an absolute http(s) URL → typed error
 *   naming the variable.
 *
 * Determinism: this module reads ONLY its injected `env` argument (default
 * `process.env`). No `Date.now()`, no `Math.random()`, no globals.
 */

/** The environment this host reads. Keys are the canonical `.env.example` names. */
export type HostEnv = Record<string, string | undefined>;

/** Values accepted for `WFX_DEV_FIXTURES` (the explicit dev opt-in). */
const FIXTURE_FLAG_VALUES: readonly string[] = ["1", "true"];

/**
 * Typed boot-configuration error — the loud failure channel of the host.
 *
 * Thrown when the environment cannot honestly select a port bundle:
 * missing required variables, malformed values, or a dev-only flag set in
 * production. `missing`/`invalid` name the offending variables so the
 * message is actionable without reading source.
 */
export class HostConfigError extends Error {
  readonly kind = "host-config" as const;
  /** Variables that were required but absent. */
  readonly missing: readonly string[];
  /** Variables that were present but malformed. */
  readonly invalid: readonly string[];
  /** The full human-readable detail (also the `message`). */
  readonly detail: string;

  constructor(detail: string, missing: readonly string[] = [], invalid: readonly string[] = []) {
    super(`webflix web host misconfigured: ${detail}`);
    this.name = "HostConfigError";
    this.missing = [...missing];
    this.invalid = [...invalid];
    this.detail = detail;
  }
}

/** The selected boot mode. */
export type HostMode = "fixtures" | "service";

/** The resolved host configuration. */
export type HostConfig =
  | {
      /** Deterministic dev fixtures (`WFX_DEV_FIXTURES=1`, dev only). */
      readonly mode: "fixtures";
    }
  | {
      /** Split-runtime service consumption via `WFX_API_BASE`. */
      readonly mode: "service";
      /** The validated, trimmed base URL of the Experience API. */
      readonly apiBase: URL;
    };

/** Read and normalize one variable (undefined for absent/whitespace-only). */
function readVar(env: HostEnv, name: string): string | undefined {
  const raw = env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Resolve the host boot configuration from the environment.
 *
 * @throws {@link HostConfigError} when the environment cannot honestly
 * select a mode — the error names every offending variable.
 */
export function resolveHostConfig(env: HostEnv = process.env): HostConfig {
  const flag = readVar(env, "WFX_DEV_FIXTURES");
  const nodeEnv = readVar(env, "NODE_ENV");

  // Law 1: the fixture flag is dev-only. Set in production it is a typed
  // configuration crime, never a downgrade of the production path.
  if (flag !== undefined && nodeEnv === "production") {
    throw new HostConfigError(
      "WFX_DEV_FIXTURES is set but NODE_ENV is 'production' — dev fixtures must never boot in production (unset WFX_DEV_FIXTURES)",
      [],
      ["WFX_DEV_FIXTURES"],
    );
  }

  // Law 2: the flag, when present, must be the explicit opt-in value. A
  // typo'd flag fails loudly instead of silently selecting either mode.
  if (flag !== undefined && !FIXTURE_FLAG_VALUES.includes(flag)) {
    throw new HostConfigError(
      `WFX_DEV_FIXTURES must be '1' (or 'true') or unset — got '${flag}'`,
      [],
      ["WFX_DEV_FIXTURES"],
    );
  }

  if (flag !== undefined) {
    return { mode: "fixtures" };
  }

  // Service mode: WFX_API_BASE is the required production wiring. It is
  // deliberately NOT defaulted: the "same-origin when unset" note in the
  // environment inventory describes the general split-runtime contract,
  // but no Experience API route exists on this origin today (the service
  // side is a later productionization lane) — defaulting would be silent
  // fake wiring. Absent means LOUD.
  const apiBaseRaw = readVar(env, "WFX_API_BASE");
  if (apiBaseRaw === undefined) {
    throw new HostConfigError(
      "service boot requires WFX_API_BASE (the Experience API base URL for split-runtime service consumption) — set WFX_API_BASE, or set WFX_DEV_FIXTURES=1 for local fixture development (never in production)",
      ["WFX_API_BASE"],
    );
  }

  let apiBase: URL;
  try {
    apiBase = new URL(apiBaseRaw);
  } catch {
    throw new HostConfigError(
      `WFX_API_BASE must be an absolute http(s) URL — got '${apiBaseRaw}'`,
      [],
      ["WFX_API_BASE"],
    );
  }
  if (apiBase.protocol !== "http:" && apiBase.protocol !== "https:") {
    throw new HostConfigError(
      `WFX_API_BASE must be an absolute http(s) URL — got '${apiBaseRaw}'`,
      [],
      ["WFX_API_BASE"],
    );
  }
  // Normalize: no trailing slash (endpoint paths append their own "/..." segments).
  const href = apiBase.href.endsWith("/") ? apiBase.href.slice(0, -1) : apiBase.href;

  return { mode: "service", apiBase: new URL(href) };
}
