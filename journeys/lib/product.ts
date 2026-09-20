/**
 * @wfx/journeys — the deterministic product boot (R16).
 *
 * THE LAYERING LAW, HONORED: journeys consume the RUNNING product as a
 * user — this module boots the product's own documented deterministic
 * dev path (`apps/web`, `WFX_DEV_FIXTURES=1`, port 3101: the 050
 * environment law's fixture mode, the loud dev badge) and never imports
 * a single product module (no `@wfx/*` imports anywhere in `journeys/`).
 *
 * DETERMINISM:
 * - The acquisition fixture drive state (the file the dev server's route
 *   modules share at `$TMPDIR/wfx-dev-acquisition-fixtures.json`) is
 *   DELETED before every run — the scripted acquisitions start at step 0
 *   every time (J21–J26 assert the scripted sequence from its start).
 * - The web dev server is booted fresh per run on its fixed port (3101)
 *   and terminated on teardown; an already-listening port is a loud
 *   error (never a silent second server).
 * - Readiness is polled over HTTP (`/` answering 200) with a generous
 *   bounded timeout — first compile of the dev routes can take tens of
 *   seconds cold.
 *
 * THE HONEST MODE SPLIT (documented, never silent):
 * - web-fixtures (this module): fully deterministic, zero external
 *   network — the CI-feasible configuration.
 * - service mode (`WFX_API_BASE` + the apps/api service over a real
 *   PostgreSQL) is the LOCAL-ONLY configuration for the service-side
 *   journeys (J14 connect flows, J28 credential expiry): the runner
 *   lists those journeys as not-run with the exact local procedure
 *   instead of pretending.
 */

import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startBackgroundProc, type BackgroundProc } from "./proc";

/** The web adapter's fixed dev port (apps/web's own `next dev -p 3101`). */
export const WEB_DEV_PORT = 3101;

/** The shared acquisition fixture drive file (apps/web's documented path). */
export const ACQUISITION_FIXTURE_STATE_FILE = join(
  tmpdir(),
  "wfx-dev-acquisition-fixtures.json",
);

/** The shared source-auth fixture state file (R17 — J28's scripted lifecycle). */
export const SOURCE_AUTH_FIXTURE_STATE_FILE = join(
  tmpdir(),
  "wfx-dev-source-auth-fixtures.json",
);

/**
 * The shared auth fixture state file (R21-B — the scripted identity
 * persona). R22-G: J36 drives the register/login/logout lifecycle, so the
 * runner resets the persona to the pristine signed-out default before
 * every run (the same determinism law the acquisition/source-auth
 * fixtures follow — no journey inherits a stale authenticated identity
 * from a failed prior run).
 */
export const AUTH_FIXTURE_STATE_FILE = join(
  tmpdir(),
  "wfx-dev-auth-fixtures.json",
);

/** A running product handle. */
export interface ProductHandle {
  /** The base URL journeys navigate (http://localhost:3101). */
  readonly baseUrl: string;
  /** The boot mode the journeys consumed (honest evidence). */
  readonly mode: "web-fixtures";
  /** Stop the product (teardown; safe to call twice). */
  stop(): Promise<void>;
  /** The dev-server output captured so far (failure diagnosis). */
  output(): string;
}

/** Options for {@link bootWebFixturesProduct}. */
export interface ProductBootOptions {
  /** The repository root (the runner resolves it). */
  readonly repoRoot: string;
  /** Where to tee the dev-server log. */
  readonly logFile: string;
  /** Extra port override for parallel local runs (default 3101). */
  readonly port?: number;
  /** Readiness timeout in ms (default 180_000 — cold Turbopack compiles). */
  readonly readyTimeoutMs?: number;
}

/**
 * Delete the shared acquisition fixture drive state so every run starts
 * the scripted acquisitions from step 0 (determinism — J21–J26 assert
 * the scripted sequence from its start, never a stale cursor).
 */
export function resetAcquisitionFixtureState(): void {
  try {
    rmSync(ACQUISITION_FIXTURE_STATE_FILE, { force: true });
  } catch {
    // An absent file is already pristine.
  }
}

/**
 * R17 — delete the shared source-auth fixture state so every run starts
 * the scripted source signed IN (determinism — J28 drives expiry →
 * recovery itself, and every later journey reads from a healthy source,
 * never a stale expired cursor).
 */
export function resetSourceAuthFixtureState(): void {
  try {
    rmSync(SOURCE_AUTH_FIXTURE_STATE_FILE, { force: true });
  } catch {
    // An absent file is already pristine (the signed-in default).
  }
}

/**
 * R22-G — delete the shared auth fixture state so every run starts the
 * scripted persona SIGNED OUT (determinism — J36 drives the full
 * register → authenticated → sign-out lifecycle itself; no run inherits
 * a stale authenticated identity from a failed prior run).
 */
export function resetAuthFixtureState(): void {
  try {
    rmSync(AUTH_FIXTURE_STATE_FILE, { force: true });
  } catch {
    // An absent file is already pristine (the signed-out default).
  }
}

/** Whether anything is already listening on the port (a loud pre-flight). */
async function portIsTaken(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/`, {
      method: "GET",
      redirect: "manual",
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * Boot the web adapter in its deterministic fixtures mode and wait for
 * readiness. Throws loudly when the port is occupied or the server
 * never becomes ready (the log is included — never a silent boot).
 */
export async function bootWebFixturesProduct(
  options: ProductBootOptions,
): Promise<ProductHandle> {
  const port = options.port ?? WEB_DEV_PORT;
  const baseUrl = `http://localhost:${port}`;

  if (await portIsTaken(port)) {
    throw new Error(
      `product boot: port ${port} is already serving — stop the existing web dev server first, or pass --base-url to consume it`,
    );
  }

  // Determinism: the scripted acquisition journeys start from step 0,
  // the scripted source-auth lifecycle starts signed in (R17/J28), and
  // the scripted identity persona starts signed out (R22-G/J36).
  resetAcquisitionFixtureState();
  resetSourceAuthFixtureState();
  resetAuthFixtureState();

  const server: BackgroundProc = startBackgroundProc(
    "bun",
    ["run", "dev"],
    {
      cwd: join(options.repoRoot, "apps/web"),
      env: { WFX_DEV_FIXTURES: "1" },
      logFile: options.logFile,
    },
  );

  const readyTimeoutMs = options.readyTimeoutMs ?? 180_000;
  const startedAt = Date.now();
  let lastError = "the server never answered";
  while (Date.now() - startedAt < readyTimeoutMs) {
    if (server.output().includes("EADDRINUSE")) {
      await server.stop();
      throw new Error(`product boot: dev server reported EADDRINUSE on ${port}`);
    }
    try {
      const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
      if (response.status < 500) {
        return {
          baseUrl,
          mode: "web-fixtures",
          stop: async () => {
            await server.stop();
          },
          output: () => server.output(),
        };
      }
      lastError = `the server answered HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  await server.stop();
  throw new Error(
    `product boot: web dev server did not become ready within ${readyTimeoutMs}ms (${lastError}). Log tail:\n${tail(server.output(), 4_000)}`,
  );
}

/** The last N characters of a log (failure diagnosis). */
export function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `…${text.slice(text.length - maxChars)}`;
}

/** Whether the acquisition fixture state file exists (a stale-cursor probe for tests). */
export function acquisitionFixtureStateExists(): boolean {
  return existsSync(ACQUISITION_FIXTURE_STATE_FILE);
}
