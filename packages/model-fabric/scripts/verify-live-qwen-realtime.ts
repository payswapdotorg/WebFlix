/* eslint-disable no-console */
/**
 * R25-C — LIVE Qwen LiveTranslate realtime verification (run with
 * `bun` when DASHSCOPE_API_KEY is provisioned; NEVER part of `bun
 * test` — it performs real network calls against the provider's
 * documented endpoint).
 *
 * THE GATE LAW (the packet's adapter law #6): live-endpoint
 * integration runs are NOT the adapter lane's gate — no credential
 * exists in CI. This harness is the honest W2 bridge precedent (the
 * connectors' verify-live pattern + the `--base-url` override): every
 * step prints PASS / FAIL / SKIPPED, and without the credential every
 * step prints
 *   "SKIPPED: DASHSCOPE_API_KEY not provisioned"
 * and the script exits 0 — honest absence, never a fabricated result.
 * The LIVE-ENDPOINT BENCHMARK (first transcript delta, first
 * translation delta, first audio chunk, reconnect time — R25-L's
 * measures) stays PENDING THE LEAD'S PROCEDURE: this harness verifies
 * the wiring; the lead owns running it against the production
 * endpoint and recording the benchmark numbers.
 *
 * Usage (the operator env sourced, optionally overriding the endpoint):
 *   cd packages/model-fabric && bun scripts/verify-live-qwen-realtime.ts
 *   cd packages/model-fabric && bun scripts/verify-live-qwen-realtime.ts --base-url wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference
 */

import {
  QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE,
  QWEN_LIVETRANSLATE_WS_ENDPOINT_MODEL_STUDIO_INTERNATIONAL,
  QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD,
  createQwenLiveTranslateSessionFactory,
  createWebSocketQwenTransport,
  readQwenLiveTranslateCredential,
  type QwenAdapterClock,
  type RealtimeTranslationEvent,
} from "../src/index";

interface StepResult {
  readonly name: string;
  readonly status: "PASS" | "FAIL" | "SKIPPED";
  readonly detail: string;
}

const results: StepResult[] = [];

function report(name: string, status: StepResult["status"], detail: string): void {
  results.push({ name, status, detail });
  console.log(`${status}  ${name}${detail.length > 0 ? ` — ${detail}` : ""}`);
}

/** Read one variable; trims and treats empty as absent. Values never printed. */
function env(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return value.trim();
}

/** The live clock seam (a live script reads real time). */
const liveClock: QwenAdapterClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

const SKIP =
  `${QWEN_LIVETRANSLATE_API_KEY_ENV_VARIABLE} not provisioned — no Qwen LiveTranslate credentials are set in this environment (the live benchmark stays pending the lead's procedure)`;

async function main(): Promise<number> {
  const credential = readQwenLiveTranslateCredential(process.env);

  // The --base-url override (the W2 bridge precedent's harness pattern).
  const baseUrlArg = process.argv.find((arg) => arg.startsWith("--base-url="));
  const baseUrl = baseUrlArg !== undefined ? baseUrlArg.slice("--base-url=".length) : undefined;

  // ── 1. env contract ─────────────────────────────────────────────────────
  if (!credential.ok) {
    report("env contract (DASHSCOPE_API_KEY)", "SKIPPED", SKIP);
    report(
      "endpoint truth (QwenCloud MaaS default / Model Studio International alternative / --base-url override)",
      "SKIPPED",
      SKIP,
    );
    report("session open + handshake (session.created → session.update → session.updated)", "SKIPPED", SKIP);
    report("streaming translation (an appended audio chunk; session health)", "SKIPPED", SKIP);
    report("graceful stop (session.finish → session.finished → session-closed with usage)", "SKIPPED", SKIP);
    console.log("\nAll steps SKIPPED — honest absence, never a fabricated result.");
    return 0;
  }
  report("env contract (DASHSCOPE_API_KEY)", "PASS", "provisioned (value never printed)");
  void env;

  // ── 2. endpoint truth ───────────────────────────────────────────────────
  const endpoint = baseUrl ?? QWEN_LIVETRANSLATE_WS_ENDPOINT_QWENCLOUD;
  report(
    "endpoint truth",
    "PASS",
    baseUrl !== undefined
      ? `--base-url override: ${endpoint}`
      : `the documented QwenCloud MaaS endpoint (the Model Studio International alternative is ${QWEN_LIVETRANSLATE_WS_ENDPOINT_MODEL_STUDIO_INTERNATIONAL})`,
  );

  // ── 3. session open + handshake + streaming + stop ──────────────────────
  const { factory } = createQwenLiveTranslateSessionFactory({
    apiKey: credential.apiKey,
    ...(baseUrl !== undefined ? { endpoint } : {}),
    transport: createWebSocketQwenTransport({ connectTimeoutMs: 15_000 }),
    clock: liveClock,
    maxReconnectAttempts: 1,
    connectAckTimeoutMs: 15_000,
    stopAckTimeoutMs: 15_000,
  });

  const inputs = {
    sourceMedia: {
      itemId: "wfx-live-verify",
      connectorId: "wfx-live-verify",
      externalRef: "verify-live-qwen-realtime",
      audioStreamLegallyAvailable: true,
    },
    targetLanguage: "en",
    sourceLanguageHint: "zh",
    outputModality: "text" as const,
    subtitleMode: "bilingual" as const,
    speakerAttribution: "simple-labels" as const,
    visualContextPolicy: "off" as const, // audio-only verification (the never-force law)
    hotwords: [],
    translatedVoicePolicy: "neutral-system-voice" as const,
  };

  const session = await factory.open(inputs);
  const events: RealtimeTranslationEvent[] = [];
  const collector = (async () => {
    for await (const event of session.events()) {
      events.push(event);
    }
  })();

  try {
    await session.start();
    if (session.state !== "streaming") {
      report("session open + handshake", "FAIL", `state is '${session.state}' (expected 'streaming')`);
      return 1;
    }
    const created = events.find((event) => event.kind === "session-created");
    report(
      "session open + handshake (session.created → session.update → session.updated)",
      "PASS",
      created?.kind === "session-created"
        ? `provider session established (model ${created.modelId})`
        : "streaming but no session-created event observed",
    );

    // ── 4. streaming translation: a silence-shaped PCM chunk ───────────────
    // A 100 ms 16 kHz mono PCM chunk of near-silence: the provider's
    // speech detection will not find speech, but the session must stay
    // healthy (the honest expectation is NO transcript events, NOT an
    // error — and no silent drop of the appended chunk).
    const chunk = new Uint8Array(3_200).fill(0x00);
    await session.appendAudio({ audio: chunk });
    await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
    const terminalEarly = events.find((event) => event.kind === "terminal-error");
    if (terminalEarly !== undefined) {
      report(
        "streaming translation",
        "FAIL",
        terminalEarly.kind === "terminal-error"
          ? `terminal error: ${terminalEarly.detail.slice(0, 200)}`
          : "unexpected",
      );
      return 1;
    }
    report(
      "streaming translation (audio appended; session healthy)",
      "PASS",
      events.some((event) => event.kind === "source-transcript-delta")
        ? "transcript deltas observed"
        : "no speech detected in the silence chunk (expected for silence) — the session stayed healthy",
    );

    // ── 5. graceful stop ──────────────────────────────────────────────────
    await session.stop();
    await collector;
    const closed = events.at(-1);
    report(
      "graceful stop (session.finish → session.finished → session-closed)",
      closed?.kind === "session-closed" ? "PASS" : "FAIL",
      closed?.kind === "session-closed"
        ? `closed with reason '${closed.reason}'${
            closed.finalUsage !== undefined
              ? ` and usage {inputAudio ${closed.finalUsage.inputAudioTokens}, textOutput ${closed.finalUsage.textOutputTokens}, outputAudio ${closed.finalUsage.outputAudioTokens}}`
              : ""
          }`
        : `final event was '${String(closed?.kind)}'`,
    );
  } catch (error) {
    report(
      "live verification",
      "FAIL",
      `unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
    await session.close().catch(() => undefined);
    await collector.catch(() => undefined);
    return 1;
  }

  const failures = results.filter((result) => result.status === "FAIL").length;
  console.log(
    `\n${failures === 0 ? "All steps PASS" : `${failures} step(s) FAILED`} — ` +
      "the live-endpoint BENCHMARK (R25-L's first-delta/first-translation/first-audio/reconnect measures) " +
      "remains the lead's procedure; this harness verifies the wiring only.",
  );
  return failures === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
