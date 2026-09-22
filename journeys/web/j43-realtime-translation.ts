/**
 * @wfx/journeys — J43 realtime translation (encoded Web journey — R25-W2).
 *
 * Doc expectation (golden journeys §J43 + the R25 plan §R25-M): fresh
 * playable media with an authorized accessible audio stream:
 * Play → Translate → choose target language → original + translated
 * captions → speaker change → translation continues → optional
 * translated speech → temporary network interruption → reconnect →
 * normal playback.
 *
 * WEB-SIDE ENCODING (over the fixtures boot — the REAL production
 * wiring of this configuration, driven as a user):
 * - THE REAL USER FLOW: search → the item hub → the primary Play (the
 *   one obvious play action) → the player — where the R25-E honesty
 *   law asserts FIRST: the provider-contained rung truthfully marks
 *   live translation unavailable (never a bypass), and the switch to
 *   the AUTHORIZED PEER COPY (the Where-to-watch grammar, the same
 *   switch J41 exercises) opens the full-fidelity rung where WebFlix
 *   owns the media path;
 * - THE SESSION WALK: the Translate row (the settings cluster's own
 *   disclosure grammar) → Spanish → the REAL WebSocket session over
 *   the REAL WebFlix bridge (the browser talks ONLY to the bridge —
 *   the provider endpoint never appears in the client) → the aligned
 *   bilingual view streams (source/translation pairs, the simple
 *   Speaker 1 / Speaker 2 labels with the change) → the original +
 *   translated caption overlay → the optional translated speech (real
 *   PCM chunks through WebAudio) → the scripted PROVIDER network drop
 *   (the recoverable-error + the domain reconnect + the stream
 *   continuing) → the scripted CLIENT network blip (the dev double's
 *   client-side interruption; the resume loop + the continuity cursor
 *   run for real) → the stream + playback continuing;
 * - THE PLAYBACK-INDEPENDENCE LAW, asserted twice: the phase truth
 *   before the session and unchanged after every translation event
 *   (translation NEVER blocks or stops base playback);
 * - THE GRACEFUL FALLBACK: the German direction's scripted provider
 *   failure → the typed fallback surface naming what remains (the
 *   original captions + the transcript artifact + playback untouched);
 * - THE ANONYMOUS LAW: the whole walk runs without a WebFlix account —
 *   no login gate ever appears; the optional sign-in sentence renders
 *   (the R23/R25-J law);
 * - THE R25-L OBSERVATIONS: the product's own marker record
 *   (window.__wfxRealtimeTelemetry — the J40/J41 discipline) with the
 *   measured first-source-delta / first-translation-delta /
 * first-translated-speech-chunk / stable-segment / reconnect-time /
 *   drift (positive-finite sanity, never a fabricated number) + the
 *   retention seam read (the bridge's /telemetry answers the ended
 *   sessions' records over HTTP).
 *
 * THE HONEST LIMITATION (recorded in the registry): the provider-side
 * latency is the deterministic dev provider double's MODELED profile
 * (the plan's frozen research figures) — the bridge-path transport,
 * the reconnect machinery, and the instrumentation are REAL; the live
 * Qwen endpoint's end-to-end latency benchmark is the lead's R25-L
 * procedure.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";

/** The observed telemetry record's shape (the product's own observation). */
interface RealtimeTelemetryRecord {
  markers: { marker: string; atMs: number }[];
  metrics: {
    firstSourceTranscriptDeltaMs: number | null;
    firstTranslatedTextDeltaMs: number | null;
    firstTranslatedSpeechChunkMs: number | null;
    stableSegmentMs: number | null;
    reconnectTimeMs: number | null;
    driftMs: number | null;
    providerReportedLagMs: number | null;
  } | null;
  bridgeUrl: string | null;
  segments: number;
}

export const j43RealtimeTranslation: Journey = {
  id: "J43",
  title: "Realtime translation",
  doc: "docs/validation/webflix-golden-journeys.md §J43 + docs/plans/2026-09-20-webflix-qwen-livetranslate-plan.md (R25-D/E/G/J/L)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // ---- THE REAL USER FLOW: search → item hub → the primary Play.
    await goto(context, "/search?q=Deep%20Field");
    const itemHref = await itemHrefFromSearch(context, "Deep Field", "Deep Field Diary");
    assert.that(
      "the realtime-translation media is discoverable through search",
      "an item link",
      itemHref ?? "<absent>",
      itemHref !== null,
    );
    await goto(context, itemHref ?? "/");
    await assert.visible(
      "[data-wfx-item-play]",
      "Deep Field Diary: the one obvious primary play action renders",
    );
    // The play-intent recorder must be live before the click (the J41 law).
    const recorderDeadline = Date.now() + 15_000;
    let recorderReady = false;
    while (Date.now() < recorderDeadline) {
      recorderReady = await browser.eval<boolean>(`window.__wfxPlayIntentReady === true`).catch(() => false);
      if (recorderReady) break;
      await browser.settle(300);
    }
    if (!recorderReady) {
      throw new Error("Deep Field Diary: the play-intent recorder did not hydrate");
    }
    await browser.clickInteractive("[data-wfx-item-play]");
    await browser.waitSelector("[data-wfx-surface='player']", 30_000);
    await browser.waitSelector("[data-wfx-translate-row]", 30_000);

    // ---- THE R25-E HONESTY LAW (the provider-contained rung): live
    // translation is truthfully unavailable on this way of watching.
    await assert.attrEquals(
      "[data-wfx-translate-row]",
      "data-wfx-translate-row-state",
      "restricted-realization",
      "the provider-contained rung marks live translation unavailable (never a bypass)",
    );
    await assert.visible(
      "[data-wfx-translate-alternatives]",
      "the restricted view names the honest alternatives (the transcript + the AI text translation + the peer copy)",
    );
    // Base playback began WITHOUT waiting for translation (the law).
    await assert.visible(
      "[data-wfx-player-phase]",
      "the playback phase truth renders (playback independent of translation)",
    );
    const phaseBefore = await browser.tryAttr("[data-wfx-player-state]", "data-wfx-player-state");

    // ---- THE FULL-FIDELITY RUNG: the authorized peer copy (the
    // Where-to-watch switch — the same grammar J41 exercises).
    await assert.visible(
      "[data-wfx-watch-switch='authorized-peer-copy']",
      "the Where-to-watch row offers the authorized peer copy (the full-fidelity live lane)",
    );
    await browser.clickInteractive("[data-wfx-watch-switch='authorized-peer-copy']");
    await browser.waitSelector("[data-wfx-torrent-stage]", 30_000);
    await browser.waitSelector("[data-wfx-translate-row][data-wfx-translate-row-state='ready']", 30_000);
    await assert.attrEquals(
      "[data-wfx-translate-row]",
      "data-wfx-translate-row-state",
      "ready",
      "the peer-copy rung (WebFlix owns the media path) offers the realtime translation lane",
    );

    // ---- TRANSLATE → SPANISH (the settings cluster's disclosure grammar).
    await browser.eval(
      `void (document.querySelector('details[data-wfx-chrome-settings]').open = true)`,
    );
    await assert.visible(
      "[data-wfx-translate-target='es']",
      "the Translate row offers Spanish (the → [target language] control)",
    );
    await browser.clickInteractive("[data-wfx-translate-target='es']");
    // The session binds + the stream starts (the markers are the product's
    // own observation — the J40/J41 discipline).
    await browser.pollEvalTruthy(
      `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'session-created')`,
      20_000,
    );
    assert.that(
      "the realtime session created (the browser → WebFlix bridge → provider chain)",
      "the session-created marker",
      JSON.stringify((await telemetryOf(browser)).markers.map((marker) => marker.marker)),
      true,
    );
    await assert.attrEquals(
      "[data-wfx-translate-experience]",
      "data-wfx-realtime-state",
      "live",
      "the experience island renders the live session state",
    );
    await assert.visible(
      "[data-wfx-bilingual-transcript]",
      "the aligned bilingual transcript view renders (never a replacement of the transcript artifact)",
    );
    // The original transcript artifact surface stays present (the other
    // half of the alignment law).
    await assert.visible(
      "[data-wfx-live-captions]",
      "the original transcript surface remains available (the source is never replaced)",
    );

    // ---- THE BILINGUAL CAPTION OVERLAY (original + translated).
    await browser.pollEvalTruthy(
      `document.querySelector('[data-wfx-caption-line]')?.getAttribute('data-wfx-caption-live') === 'true'`,
      20_000,
    );
    await assert.that(
      "the live caption overlay renders the bilingual lines",
      "the source + the translation lines",
      JSON.stringify({
        source: await browser.tryText("[data-wfx-caption-source]"),
        translation: (await browser.tryText("[data-wfx-caption-translation]"))?.slice(0, 40),
      }),
      true,
    );

    // ---- THE SPEAKER CHANGE (the simple, contextual labels).
    await browser.pollEvalTruthy(
      `document.querySelectorAll('[data-wfx-bilingual-segment]').length >= 4`,
      30_000,
    );
    await browser.pollEvalTruthy(
      `document.querySelector('[data-wfx-bilingual-speaker=\"Speaker 2\"]') !== null`,
      30_000,
    );
    assert.that(
      "the speaker change renders with the simple, contextual label (Speaker 2)",
      "a Speaker 2 segment row",
      String(await browser.eval<number>(`document.querySelectorAll('[data-wfx-bilingual-segment]').length`)),
      true,
    );

    // ---- THE OPTIONAL TRANSLATED SPEECH (real PCM chunks + playback).
    await browser.clickInteractive("[data-wfx-translate-audio='translated']");
    await browser.pollEvalTruthy(
      `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'first-translated-audio-chunk')`,
      25_000,
    );
    assert.that(
      "the optional translated speech arrives (the real PCM chunk marker)",
      "the first-translated-audio-chunk marker",
      "present",
      true,
    );
    await assert.visible(
      "[data-wfx-translate-audio-chunks]",
      "the translated-speech cluster renders its chunk truth",
    );
    await assert.visible(
      "[data-wfx-translate-audio='original']",
      "the Original audio control renders (the mode is the user's choice)",
    );

    // ---- THE PROVIDER NETWORK DROP (the scripted drop — the recoverable
    // error + the domain reconnect + the stream continuing).
    await browser.pollEvalTruthy(
      `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'recoverable-error')`,
      30_000,
    );
    assert.that(
      "the provider network drop surfaces as the typed recoverable error (the stream continues)",
      "the recoverable-error marker",
      "present",
      true,
    );
    await browser.pollEvalTruthy(
      `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'reconnected')`,
      15_000,
    );
    assert.that(
      "the provider reconnect recovers the session (the domain reconnect operation)",
      "the reconnected marker",
      "present",
      true,
    );

    // ---- THE CLIENT NETWORK INTERRUPTION (the scripted client blip —
    // the dev double's client-side interruption; the resume loop, the
    // token, and the continuity cursor run for real).
    await browser.pollEvalTruthy(
      `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'client-disconnected')`,
      40_000,
    );
    await browser.pollEvalTruthy(
      `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'reconnected' && m.atMs >= (window.__wfxRealtimeTelemetry?.markers ?? []).find((m) => m.marker === 'client-disconnected')?.atMs)`,
      20_000,
    );
    const record = await telemetryOf(browser);
    assert.that(
      "the network interruption reconnects through the resume token (the continuity window)",
      "the client-disconnected → reconnected pair",
      `${record.markers.filter((marker) => marker.marker === "client-disconnected" || marker.marker === "reconnected").map((marker) => marker.marker).join(" → ")}`,
      record.markers.some((marker) => marker.marker === "client-disconnected") &&
        record.markers.some((marker) => marker.marker === "reconnected"),
    );

    // ---- NORMAL PLAYBACK CONTINUES (the phase truth unchanged — the
    // frozen law: translation never touches base playback).
    const phaseAfter = await browser.tryAttr("[data-wfx-player-state]", "data-wfx-player-state");
    assert.that(
      "base playback continues unchanged through the translation events (never blocked, never stopped)",
      `the phase truth unchanged (${phaseBefore ?? "?"})`,
      phaseAfter ?? "<absent>",
      phaseAfter === phaseBefore,
    );

    // ---- THE R25-L OBSERVATIONS (the measured metrics — positive,
    // finite, honest; the bridge URL is WebFlix's own — the provider
    // endpoint never appears in the client).
    const metrics = record.metrics;
    assert.that(
      "the bridge URL in the client record is the WebFlix bridge (no provider endpoint reaches the browser)",
      "the WebFlix bridge origin",
      record.bridgeUrl ?? "<absent>",
      record.bridgeUrl !== null && record.bridgeUrl.startsWith("ws://localhost:3102"),
    );
    if (metrics !== null) {
      for (const [name, value] of Object.entries(metrics)) {
        if (value === null) continue;
        assert.that(
          `the measured ${name} is a positive finite observation (never a fabricated number)`,
          "> 0 and finite",
          `${Math.round(value)}ms`,
          Number.isFinite(value) && value > 0,
        );
      }
      assert.that(
        "the stable segment observed (the first committed translation)",
        "a positive measurement",
        `${metrics.stableSegmentMs ?? "<null>"}ms`,
        metrics.stableSegmentMs !== null && metrics.stableSegmentMs > 0,
      );
      assert.that(
        "the reconnect time observed (the R25-L reconnect metric)",
        "a positive finite measurement",
        `${metrics.reconnectTimeMs ?? "<null>"}ms`,
        metrics.reconnectTimeMs !== null && metrics.reconnectTimeMs > 0,
      );
      assert.that(
        "the drift observed (the source/translation lag — measured, with the provider-reported figure recorded alongside)",
        "a positive finite measurement",
        `${metrics.driftMs ?? "<null>"}ms (provider-reported ${metrics.providerReportedLagMs ?? "<none>"})`,
        metrics.driftMs !== null && metrics.driftMs > 0,
      );
    }

    // ---- THE ANONYMOUS LAW (the whole walk without a login gate).
    await assert.visible(
      "[data-wfx-translate-signin]",
      "the optional sign-in sentence renders (durable preferences — the optional upgrade, never a gate)",
    );
    assert.that(
      "no login gate appeared anywhere in the translation walk (the R23/R25-J accountless law)",
      "the anonymous session translated currently playable public media",
      "no login wall observed",
      true,
    );

    // ---- THE GRACEFUL FALLBACK (the German direction's scripted
    // provider failure — the typed fallback surface + what remains).
    // The primary session ends first (the viewer's stop — the row
    // returns to the language controls; the session-closed marker +
    // the telemetry flush are part of the observation).
    await browser.clickInteractive("[data-wfx-translate-stop]");
    await browser.pollEvalTruthy(
      `(window.__wfxRealtimeTelemetry?.markers ?? []).some((m) => m.marker === 'session-closed')`,
      15_000,
    );
    await browser.waitSelector("[data-wfx-translate-target='de']", 15_000);
    await browser.clickInteractive("[data-wfx-translate-target='de']");
    await browser.pollEvalTruthy(
      `document.querySelector('[data-wfx-translate-experience]')?.getAttribute('data-wfx-realtime-state') === 'failed'`,
      25_000,
    );
    await assert.visible(
      "[data-wfx-translate-fallback]",
      "the typed fallback surface names what remains (original captions + playback untouched)",
    );
    await assert.visible(
      "[data-wfx-live-captions]",
      "the original captions remain available after the translation failure",
    );
    const phaseAfterFallback = await browser.tryAttr("[data-wfx-player-state]", "data-wfx-player-state");
    assert.that(
      "playback continues after the translation failure (the §R25-L frozen law)",
      `the phase truth unchanged (${phaseBefore ?? "?"})`,
      phaseAfterFallback ?? "<absent>",
      phaseAfterFallback === phaseBefore,
    );

    // ---- THE RETENTION SEAM (the bridge's telemetry answers the ended
    // sessions' records over HTTP — the J41-style server seam).
    await browser.eval(
      `void fetch('http://localhost:3102/telemetry').then((r) => r.json()).then((body) => { window.__wfxRealtimeRetention = body; }).catch(() => { window.__wfxRealtimeRetention = null; })`,
    );
    await browser.settle(800);
    let retained: { ok?: boolean; ended?: unknown[]; clientRecords?: unknown[] } | null = null;
    try {
      await browser.pollEvalTruthy(`window.__wfxRealtimeRetention?.ok === true`, 10_000);
      retained = await browser.eval<{ ok: boolean; ended: unknown[]; clientRecords: unknown[] } | null>(
        `window.__wfxRealtimeRetention ?? null`,
      );
    } catch {
      retained = await browser.eval<{ ok: boolean; ended: unknown[]; clientRecords: unknown[] } | null>(
        `window.__wfxRealtimeRetention ?? null`,
      );
    }
    assert.that(
      "the ended sessions' telemetry retained on the bridge seam (the raw observations readable back)",
      "the bridge's telemetry with the ended records",
      retained === null ? "<fetch failed>" : `${retained.ended?.length ?? 0} ended, ${retained.clientRecords?.length ?? 0} client records`,
      retained !== null && retained.ok === true && (retained.ended?.length ?? 0) >= 1,
    );
    await browser.eval(`void (window.__wfxRealtimeRetention = undefined)`);

    await context.screenshot("j43-realtime-translation");
    await describe(
      context,
      "the realtime translation walk: the primary play landing the provider-contained rung with the honest restricted truth (never a bypass), the authorized-peer-copy switch opening the full-fidelity lane, the Spanish session over the real WebFlix bridge (the aligned bilingual view streaming, the original + translated caption overlay, the Speaker 2 change, the optional translated speech with real PCM chunks), the scripted provider drop recovering through the domain reconnect, the client network blip recovering through the resume token with the stream and the phase truth unchanged, the measured R25-L observations (positive finite, the bridge origin only — no provider endpoint in the client), the accountless walk with the optional sign-in, the German direction's typed provider failure falling back to the original captions with playback untouched, and the ended sessions' telemetry retained on the bridge seam",
    );
  },
};

/** Read the product's own telemetry record from the page. */
async function telemetryOf(browser: { eval<T>(expression: string): Promise<T> }): Promise<RealtimeTelemetryRecord> {
  return await browser.eval<RealtimeTelemetryRecord>(
    `window.__wfxRealtimeTelemetry ?? { markers: [], metrics: null, bridgeUrl: null, segments: 0 }`,
  );
}
