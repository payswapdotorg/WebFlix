/**
 * @wfx/app-web — the R25-L WEB LATENCY BENCHMARK HARNESS (Worker 2's
 * Web lane; `bun apps/web/scripts/r25-web-latency.ts`).
 *
 * THE PRODUCT LAW THIS HARNESS MEASURES (docs/plans/
 * 2026-09-20-webflix-qwen-livetranslate-plan.md — §R25-L; J43 in
 * docs/validation/webflix-golden-journeys.md):
 *
 * "WebFlix must benchmark end-to-end latency rather than treating the
 * provider's reported figure as guaranteed UI latency" — and the
 * acceptance laws: translation starts without delaying playback;
 * translated text begins promptly; reconnect does not restart the
 * media item; source captions remain available if translation fails;
 * translation failure never stops base playback.
 *
 * WHAT THIS HARNESS DOES (the honest shape):
 * 1. Boots the REAL product (the fixtures boot — the same composition
 *    the J43 journey consumes: the real runtime, the real WebFlix
 *    WebSocket bridge (ws, 3102) started by the dev boot's
 *    instrumentation, the provider session seam with the deterministic
 *    dev provider double behind it (a REAL second WebSocket hop, 3103));
 * 2. Drives the REAL user flow per pass on a FRESH agent-browser
 *    session: the peer-copy player (WebFlix owns the media path) →
 *    Translate → Spanish → the bilingual stream → the optional
 *    translated speech → the scripted provider drop + recovery → the
 *    scripted client network blip + the resume — the SAME walk J43
 *    encodes, with the product's own observation record
 *    (window.__wfxRealtimeTelemetry) as the measurement source;
 * 3. Derives the R25-L web metric set (first source transcript delta,
 *    first translated text delta, first translated speech chunk, stable
 *    segment, reconnect time, drift — plus the provider-REPORTED lag
 *    recorded alongside, honest provenance) and aggregates
 *    min/median/max across the passes;
 * 4. Runs the graceful-fallback probe (the German direction's scripted
 *    provider failure → the typed fallback + the phase truth unchanged);
 * 5. RETAINS the raw observations (per-pass markers + metrics + the
 *    bridge's server-side telemetry + screenshots + the dev log) under
 *    evidence/r25-w2/latency/.
 *
 * WHAT THIS HARNESS IS NOT: a live-provider measurement. The
 * provider-side latency is the dev double's MODELED profile (the plan's
 * frozen research figures); the bridge-path transport, the reconnect
 * machinery, and the instrumentation are REAL. The live Qwen endpoint's
 * end-to-end benchmark — real credentials, the production WebSocket
 * deployment — is the lead's R25-L procedure (the run record carries
 * this provenance verbatim; the number is never presented as the live
 * provider's).
 */

/* eslint-disable no-console */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The repo root. */
const REPO_ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "../../..");

/** The evidence directory (the R25-W2 lane's latency record). */
const EVIDENCE_DIR = join(REPO_ROOT, "evidence/r25-w2/latency");

/** The web adapter's fixed dev port. */
const BASE_URL = "http://localhost:3101";

/** The bridge's fixed dev port (the telemetry seam's HTTP read). */
const BRIDGE_TELEMETRY_URL = "http://localhost:3102/telemetry";

/** The benchmark media (the peer-copy player deep link — WebFlix owns the media path). */
const PLAYER_URL = `${BASE_URL}/player?connector=fake-source&ref=fake%3Avideo-1&title=Deep%20Field%20Diary&type=video&realization=torrent`;

/** The number of measured passes (fresh browser sessions — fresh WS sessions). */
const PASSES = 3;

// ---------------------------------------------------------------------------
// The agent-browser driver (lean — the same shape as the r24 harness)
// ---------------------------------------------------------------------------

/** One CLI invocation bound to a session's environment. */
async function agentBrowser(
  session: string,
  args: readonly string[],
  timeoutMs = 30_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["agent-browser", ...args], {
    env: { ...process.env, AGENT_BROWSER_SESSION: session, AGENT_BROWSER_IDLE_TIMEOUT_MS: "3600000" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

/** Run one command, throwing on nonzero exit. */
async function ab(session: string, args: readonly string[], timeoutMs?: number): Promise<string> {
  const result = await agentBrowser(session, args, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(`agent-browser ${args.join(" ")} failed (${result.exitCode}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Evaluate an expression in the page (JSON-decoded when possible). */
async function evalInPage<T>(session: string, expression: string): Promise<T> {
  const out = await ab(session, ["eval", expression], 6_000);
  try {
    return JSON.parse(out.trim()) as T;
  } catch {
    return out.trim() as unknown as T;
  }
}

/** Poll a predicate over the page until true (bounded, self-healing). */
async function pollPage(
  session: string,
  description: string,
  predicate: string,
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastPollError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const ok = await evalInPage<boolean>(session, predicate);
      if (ok === true) return;
    } catch (thrown) {
      lastPollError = thrown instanceof Error ? thrown.message : String(thrown);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `benchmark: timed out waiting for ${description}${lastPollError === null ? "" : `; last poll error: ${lastPollError.slice(0, 200)}`}`,
  );
}

// ---------------------------------------------------------------------------
// The product boot (the deterministic fixtures mode — the r24 harness's shape)
// ---------------------------------------------------------------------------

/** A running product handle. */
interface ProductHandle {
  stop(): Promise<void>;
}

/** Boot the web adapter in its deterministic fixtures mode (port 3101). */
async function bootProduct(logFile: string): Promise<ProductHandle> {
  const probe = await fetch(`${BASE_URL}/`, { method: "GET", redirect: "manual" }).catch(() => null);
  if (probe !== null && probe.status < 500) {
    throw new Error(
      `benchmark: port 3101 is already serving — stop the existing web dev server first (the benchmark needs the deterministic fresh boot)`,
    );
  }
  const log = Bun.file(logFile);
  const writer = log.writer();
  const proc = Bun.spawn(["bun", "run", "dev"], {
    cwd: join(REPO_ROOT, "apps/web"),
    env: { ...process.env, WFX_DEV_FIXTURES: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const drain = (stream: ReadableStream<Uint8Array>): void => {
    void (async () => {
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value !== undefined) await writer.write(value);
        }
      } catch {
        // the log tee is best-effort
      }
    })();
  };
  drain(proc.stdout);
  drain(proc.stderr);
  const startedAt = Date.now();
  let lastError = "the server never answered";
  while (Date.now() - startedAt < 180_000) {
    try {
      const response = await fetch(`${BASE_URL}/`, { redirect: "manual" });
      if (response.status < 500) {
        // The bridge must be up too (the instrumentation's boot).
        const bridge = await fetch("http://localhost:3102/health").catch(() => null);
        if (bridge !== null && bridge.ok) {
          return {
            stop: async () => {
              proc.kill();
              try {
                await writer.end();
              } catch {
                // the log tee is best-effort
              }
              await Promise.resolve(proc.exited).catch(() => undefined);
            },
          };
        }
        lastError = "the web server answered but the realtime bridge did not";
      } else {
        lastError = `the server answered HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  proc.kill();
  throw new Error(`benchmark: the product did not become ready within 180s (${lastError})`);
}

// ---------------------------------------------------------------------------
// The observed record's shapes
// ---------------------------------------------------------------------------

/** The product's own telemetry record (the observation source). */
interface RealtimeTelemetryRecord {
  readonly markers: { readonly marker: string; readonly atMs: number }[];
  readonly metrics: {
    readonly firstSourceTranscriptDeltaMs: number | null;
    readonly firstTranslatedTextDeltaMs: number | null;
    readonly firstTranslatedSpeechChunkMs: number | null;
    readonly stableSegmentMs: number | null;
    readonly reconnectTimeMs: number | null;
    readonly driftMs: number | null;
    readonly providerReportedLagMs: number | null;
  } | null;
  readonly bridgeUrl: string | null;
  readonly segments: number;
}

/** One benchmark pass's record. */
interface PassRecord {
  readonly pass: number;
  readonly browserSession: string;
  readonly metrics: RealtimeTelemetryRecord["metrics"];
  readonly markers: { readonly marker: string; readonly atMs: number }[];
  readonly segments: number;
  readonly screenshot: string;
  readonly durationMs: number;
}

/** The full run record (the typed evidence artifact). */
interface LatencyRunRecord {
  readonly kind: "r25-web-latency";
  readonly commit: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly bootMode: "web-fixtures";
  readonly bridgeUrl: string;
  readonly provider: { readonly id: string; readonly detail: string; readonly reportedAverageLagMs: number };
  readonly provenance: string;
  readonly passes: readonly PassRecord[];
  readonly aggregate: {
    readonly metric: string;
    readonly min: number | null;
    readonly median: number | null;
    readonly max: number | null;
  }[];
  readonly fallbackWalk: {
    readonly terminalErrorKind: string;
    readonly playbackPhaseAfter: string;
    readonly captionsRemain: boolean;
    readonly fallbackSentenceRendered: boolean;
  } | null;
  readonly bridgeTelemetryAtEnd: {
    readonly ended: number;
    readonly clientRecords: number;
    readonly sampleUsage: Record<string, number> | null;
    readonly sampleDerivedCostUsd: number | null;
  };
}

// ---------------------------------------------------------------------------
// The benchmark walk (one pass)
// ---------------------------------------------------------------------------

/** Walk one measured pass on a fresh browser session. */
async function walkPass(pass: number): Promise<PassRecord> {
  const session = `wfx-r25-latency-${pass}-${Date.now()}`;
  const startedAt = Date.now();
  await ab(session, ["open"]);
  await ab(session, ["set", "viewport", "1280", "800"]);
  await ab(session, ["open", PLAYER_URL], 40_000);
  await ab(session, ["wait", "--load", "networkidle"], 40_000);
  await pollPage(
    session,
    "the translate row's ready state",
    `document.querySelector('[data-wfx-translate-row]')?.getAttribute('data-wfx-translate-row-state') === 'ready'`,
    30_000,
  );
  // The playback phase truth BEFORE the session (the independence law).
  const phaseBefore = await evalInPage<string | null>(
    session,
    `document.querySelector('[data-wfx-player-state]')?.getAttribute('data-wfx-player-state') ?? null`,
  );
  void phaseBefore;

  // TRANSLATE → SPANISH (the session start).
  await ab(session, ["eval", `void (document.querySelector('details[data-wfx-chrome-settings]').open = true)`]);
  await ab(session, ["click", "[data-wfx-translate-target='es']"]);
  await pollPage(
    session,
    "the session-created marker",
    `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'session-created')`,
    20_000,
  );
  await pollPage(
    session,
    "the stable segment (the first committed translation)",
    `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'first-stable-segment')`,
    20_000,
  );
  // The speaker change (the stream continues past the first segment).
  await pollPage(
    session,
    "the Speaker 2 change",
    `document.querySelector('[data-wfx-bilingual-speaker=\"Speaker 2\"]') !== null`,
    30_000,
  );
  // The optional translated speech (the audio marker).
  await ab(session, ["click", "[data-wfx-translate-audio='translated']"]);
  await pollPage(
    session,
    "the first translated-audio-chunk marker",
    `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'first-translated-audio-chunk')`,
    30_000,
  );
  // The scripted provider drop + the recovery.
  await pollPage(
    session,
    "the provider drop's recoverable error",
    `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'recoverable-error')`,
    30_000,
  );
  await pollPage(
    session,
    "the provider reconnect",
    `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'reconnected')`,
    15_000,
  );
  // The scripted client network blip + the resume (the reconnect-time metric).
  await pollPage(
    session,
    "the client network interruption",
    `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'client-disconnected')`,
    40_000,
  );
  await pollPage(
    session,
    "the client reconnect",
    `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'reconnected' && m.atMs >= (window.__wfxRealtimeTelemetry?.markers ?? []).find((m) => m.marker === 'client-disconnected')?.atMs)`,
    20_000,
  );

  const record = await evalInPage<RealtimeTelemetryRecord>(
    session,
    `window.__wfxRealtimeTelemetry ?? { markers: [], metrics: null, bridgeUrl: null, segments: 0 }`,
  );
  const phaseAfter = await evalInPage<string | null>(
    session,
    `document.querySelector('[data-wfx-player-state]')?.getAttribute('data-wfx-player-state') ?? null`,
  );
  if (phaseBefore !== phaseAfter) {
    throw new Error(
      `benchmark pass ${pass}: the playback phase changed during the translation walk (${phaseBefore} → ${phaseAfter}) — the never-block-playback law failed`,
    );
  }
  // Stop the session (the clean end for the pass).
  await ab(session, ["click", "[data-wfx-translate-stop]"], 15_000).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 1_200));

  const screenshot = `pass-${pass}.png`;
  await ab(session, ["screenshot", join(EVIDENCE_DIR, screenshot)], 30_000);
  await agentBrowser(session, ["close"]).catch(() => undefined);
  return {
    pass,
    browserSession: session,
    metrics: record.metrics,
    markers: record.markers,
    segments: record.segments,
    screenshot,
    durationMs: Date.now() - startedAt,
  };
}

/** The graceful-fallback probe (the German direction's scripted failure). */
async function walkFallback(): Promise<LatencyRunRecord["fallbackWalk"]> {
  const session = `wfx-r25-fallback-${Date.now()}`;
  await ab(session, ["open"]);
  await ab(session, ["set", "viewport", "1280", "800"]);
  await ab(session, ["open", PLAYER_URL], 40_000);
  await ab(session, ["wait", "--load", "networkidle"], 40_000);
  await pollPage(
    session,
    "the translate row's ready state",
    `document.querySelector('[data-wfx-translate-row]')?.getAttribute('data-wfx-translate-row-state') === 'ready'`,
    30_000,
  );
  const phaseBefore = await evalInPage<string | null>(
    session,
    `document.querySelector('[data-wfx-player-state]')?.getAttribute('data-wfx-player-state') ?? null`,
  );
  await ab(session, ["eval", `void (document.querySelector('details[data-wfx-chrome-settings]').open = true)`]);
  await ab(session, ["click", "[data-wfx-translate-target='de']"]);
  await pollPage(
    session,
    "the typed fallback surface",
    `document.querySelector('[data-wfx-translate-experience]')?.getAttribute('data-wfx-realtime-state') === 'failed'`,
    25_000,
  );
  const errorKind = await evalInPage<string | null>(
    session,
    `document.querySelector('[data-wfx-translate-failed]')?.getAttribute('data-wfx-translate-error-kind') ?? null`,
  );
  const phaseAfter = await evalInPage<string | null>(
    session,
    `document.querySelector('[data-wfx-player-state]')?.getAttribute('data-wfx-player-state') ?? null`,
  );
  const captionsRemain = await evalInPage<boolean>(
    session,
    `document.querySelector('[data-wfx-live-captions]') !== null`,
  );
  const fallbackSentenceRendered = await evalInPage<boolean>(
    session,
    `document.querySelector('[data-wfx-translate-fallback]') !== null`,
  );
  await ab(session, ["screenshot", join(EVIDENCE_DIR, "fallback.png")], 30_000);
  await agentBrowser(session, ["close"]).catch(() => undefined);
  if (phaseBefore !== phaseAfter) {
    throw new Error(
      `benchmark fallback: the playback phase changed on the translation failure (${phaseBefore} → ${phaseAfter}) — the graceful-fallback law failed`,
    );
  }
  return {
    terminalErrorKind: errorKind ?? "<absent>",
    playbackPhaseAfter: phaseAfter ?? "<absent>",
    captionsRemain,
    fallbackSentenceRendered,
  };
}

// ---------------------------------------------------------------------------
// The aggregate + the record
// ---------------------------------------------------------------------------

/** The metric fields aggregated across the passes. */
const AGGREGATED_METRICS: readonly (keyof NonNullable<RealtimeTelemetryRecord["metrics"]>)[] = [
  "firstSourceTranscriptDeltaMs",
  "firstTranslatedTextDeltaMs",
  "firstTranslatedSpeechChunkMs",
  "stableSegmentMs",
  "reconnectTimeMs",
  "driftMs",
];

/** Aggregate one metric across the passes (min/median/max — null-safe). */
function aggregateOf(
  passes: readonly PassRecord[],
  metric: keyof NonNullable<RealtimeTelemetryRecord["metrics"]>,
): { min: number | null; median: number | null; max: number | null } {
  const values = passes
    .map((pass) => pass.metrics?.[metric] ?? null)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (values.length === 0) return { min: null, median: null, max: null };
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 1 ? values[mid]! : Math.round((values[mid - 1]! + values[mid]!) / 2);
  return { min: values[0]!, median, max: values[values.length - 1]! };
}

/** The run's summary (the human-readable evidence record). */
function renderSummary(record: LatencyRunRecord): string {
  const lines: string[] = [];
  lines.push("# R25-W2 — the web realtime-translation latency record");
  lines.push("");
  lines.push(`- commit: \`${record.commit}\``);
  lines.push(`- boot: ${record.bootMode} (the deterministic fixtures composition — the same boot the J43 journey consumes)`);
  lines.push(`- bridge: ${record.bridgeUrl} (the WebFlix WebSocket bridge; the provider session seam behind it)`);
  lines.push(`- provider: ${record.provider.id} — ${record.provider.detail}`);
  lines.push(`- reported average lag: ~${record.provider.reportedAverageLagMs} ms (the provider-REPORTED figure, recorded never promised)`);
  lines.push(`- passes: ${record.passes.length} (fresh browser sessions — fresh WS sessions)`);
  lines.push(`- provenance: ${record.provenance}`);
  lines.push("");
  lines.push("## The R25-L web metric set (measured over the passes)");
  lines.push("");
  lines.push("| metric | min | median | max |");
  lines.push("|---|---:|---:|---:|");
  for (const entry of record.aggregate) {
    lines.push(
      `| ${entry.metric} | ${entry.min === null ? "—" : `${entry.min} ms`} | ${entry.median === null ? "—" : `${entry.median} ms`} | ${entry.max === null ? "—" : `${entry.max} ms`} |`,
    );
  }
  lines.push("");
  if (record.fallbackWalk !== null) {
    lines.push("## The graceful-fallback probe");
    lines.push("");
    lines.push(`- terminal error kind: \`${record.fallbackWalk.terminalErrorKind}\``);
    lines.push(`- playback phase after the failure: \`${record.fallbackWalk.playbackPhaseAfter}\` (unchanged — the never-block-playback law)`);
    lines.push(`- original captions remain: ${record.fallbackWalk.captionsRemain}`);
    lines.push(`- the fallback sentence rendered: ${record.fallbackWalk.fallbackSentenceRendered}`);
    lines.push("");
  }
  lines.push("## The bridge's server-side telemetry at the end");
  lines.push("");
  lines.push(`- ended sessions retained: ${record.bridgeTelemetryAtEnd.ended}`);
  lines.push(`- client marker records flushed: ${record.bridgeTelemetryAtEnd.clientRecords}`);
  if (record.bridgeTelemetryAtEnd.sampleUsage !== null) {
    lines.push(
      `- sample usage (one ended session): ${JSON.stringify(record.bridgeTelemetryAtEnd.sampleUsage)} → derived cost $${record.bridgeTelemetryAtEnd.sampleDerivedCostUsd ?? "?"}`,
    );
  }
  lines.push("");
  lines.push("## The raw observations");
  lines.push("");
  for (const pass of record.passes) {
    lines.push(`- pass ${pass.pass} (${pass.durationMs} ms, ${pass.segments} segments, screenshot ${pass.screenshot}):`);
    for (const marker of pass.markers) {
      lines.push(`  - ${marker.marker} @ ${marker.atMs}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The entry
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: REPO_ROOT }).stdout.toString().trim();
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const serverLogFile = join(EVIDENCE_DIR, "web-dev-server.log");
  console.log(`r25 web latency: booting the product (the fixtures composition)…`);
  const product = await bootProduct(serverLogFile);
  try {
    const health = (await (await fetch("http://localhost:3102/health")).json()) as {
      provider: { id: string; detail: string } | null;
    };
    const passes: PassRecord[] = [];
    for (let pass = 1; pass <= PASSES; pass += 1) {
      console.log(`r25 web latency: pass ${pass}/${PASSES} — the realtime walk…`);
      passes.push(await walkPass(pass));
      console.log(
        `r25 web latency: pass ${pass} done (${passes[passes.length - 1]!.durationMs} ms, ${passes[passes.length - 1]!.segments} segments)`,
      );
    }
    console.log(`r25 web latency: the graceful-fallback probe…`);
    const fallbackWalk = await walkFallback();
    const bridgeTelemetry = (await (await fetch(BRIDGE_TELEMETRY_URL)).json()) as {
      ended: { usage: Record<string, number>; derivedCostUsd: number }[];
      clientRecords: unknown[];
    };
    const record: LatencyRunRecord = {
      kind: "r25-web-latency",
      commit,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      bootMode: "web-fixtures",
      bridgeUrl: "ws://localhost:3102",
      provider: {
        id: health.provider?.id ?? "unknown",
        detail: health.provider?.detail ?? "",
        reportedAverageLagMs: 2_300,
      },
      provenance:
        "the deterministic dev realtime provider's MODELED profile (the plan's frozen research figures) — the bridge-path transport, the reconnect machinery, the cost-policy verdicts, and the instrumentation are the REAL production wiring of this configuration; the LIVE Qwen endpoint's end-to-end latency benchmark is the lead's R25-L procedure (never presented as the live provider's number)",
      passes,
      aggregate: AGGREGATED_METRICS.map((metric) => ({ metric, ...aggregateOf(passes, metric) })),
      fallbackWalk,
      bridgeTelemetryAtEnd: {
        ended: bridgeTelemetry.ended.length,
        clientRecords: bridgeTelemetry.clientRecords.length,
        sampleUsage: bridgeTelemetry.ended[0]?.usage ?? null,
        sampleDerivedCostUsd: bridgeTelemetry.ended[0]?.derivedCostUsd ?? null,
      },
    };
    writeFileSync(join(EVIDENCE_DIR, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(join(EVIDENCE_DIR, "summary.md"), renderSummary(record));
    console.log(`r25 web latency: the record → evidence/r25-w2/latency/ (record.json + summary.md + ${PASSES} pass screenshots + the dev log)`);
    console.log("");
    console.log(renderSummary(record));
    return 0;
  } finally {
    await product.stop();
  }
}

try {
  process.exitCode = await main();
} catch (thrown) {
  console.error(`r25 web latency: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  process.exitCode = 1;
}
