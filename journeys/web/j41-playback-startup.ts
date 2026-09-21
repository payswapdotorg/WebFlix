/**
 * @wfx/journeys — J41 YouTube-equivalent playback startup (encoded Web
 * journey — R24-E, the web side).
 *
 * Doc expectation (golden journeys §J41): for benchmark content where
 * possible, the same browser/device/network profile in cold and
 * warm-cache modes; measure navigation-to-player-visible,
 * click-to-first-frame, click-to-audible, time-to-playable, startup
 * failure, first-60s rebuffer ratio, seek response, control response,
 * transient recovery, realization-switch time. Acceptance: the R24-E
 * thresholds vs the same-content YouTube baseline; no serial WebFlix
 * API chain blocks startup; no AI/recommendation work blocks playback;
 * torrent authorized peer playback starts from verified playable data
 * where supported; transient failures recover with a useful next
 * action.
 *
 * WEB-SIDE ENCODING (over the fixtures boot — the REAL production
 * wiring of this configuration, driven as a user):
 * - THE REAL USER FLOW per benchmark title: search → the item hub →
 *   the primary Play click → the player. The R24-E instrumentation
 *   (the in-page trace the product's own boot marker + stage observer
 *   + chrome command seams record) answers the measured startup path;
 * - THE METRIC MARKER COMPLETENESS: every assertable pair for this
 *   configuration records — play-clicked (the click-bridged trace),
 *   navigation-start, player-surface-visible (the streamed shell's
 *   parse), playable-declared (the phase truth at render),
 *   first-frame-rendered (the contained surface's load — the honest
 *   observation boundary the record names), seek-requested/confirmed
 *   (the J keyboard seek through the real command route),
 *   control-invoked/confirmed (the transport's play/pause round trip);
 * - THE STARTUP ARCHITECTURE LAWS, MEASURED: the first frame PRECEDES
 *   the nonessential enrichment sections' mounts (the streamed-shell
 *   law — window.__wfxStartupObservations is the product's own
 *   observation), and the position anchor moves ONLY on the accepted
 *   seek (never a fake-buffering tick);
 * - THE RETENTION SEAM: the trace flushes to /api/playback/telemetry
 *   (the raw observations readable back over HTTP from the running
 *   product).
 *
 * The YouTube COMPARATIVE baseline is honestly OUT OF SCOPE in this
 * configuration: the fixture catalog's content is WebFlix-internal (no
 * identical public YouTube content), and this sandbox has no route to
 * the public YouTube product. The limitation entry declares the lead's
 * protocol (the plan's lead-owned comparative procedure) and the
 * WebFlix-internal benchmark record (evidence/r24-w2/benchmark/ — the
 * harness's own fresh-session cold/warm battery) as the honest record
 * of this lane.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";

/** One benchmark title's web-side walk (the assertable pair set). */
interface StartupWalk {
  readonly searchQuery: string;
  readonly titleFragment: string;
  readonly realization: string;
}

/** The benchmark titles (the web rungs this configuration plays). */
const BENCHMARK_TITLES: readonly StartupWalk[] = [
  { searchQuery: "Deep Field", titleFragment: "Deep Field Diary", realization: "browser" },
  { searchQuery: "Desert Rain", titleFragment: "Desert Rain Doc", realization: "embed" },
];

export const j41PlaybackStartup: Journey = {
  id: "J41",
  title: "YouTube-equivalent playback startup",
  doc: "docs/validation/webflix-golden-journeys.md §J41 + docs/validation/youtube-parity-lab.md (the playback-performance lab)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    for (const benchmark of BENCHMARK_TITLES) {
      // ---- THE REAL USER FLOW: search → item hub → the primary Play.
      await goto(context, `/search?q=${encodeURIComponent(benchmark.searchQuery)}`);
      const itemHref = await itemHrefFromSearch(context, benchmark.searchQuery, benchmark.titleFragment);
      assert.that(
        `the benchmark title '${benchmark.titleFragment}' is discoverable through search`,
        "an item link",
        itemHref ?? "<absent>",
        itemHref !== null,
      );
      await goto(context, itemHref ?? "/");
      await assert.visible(
        "[data-wfx-item-play]",
        `${benchmark.titleFragment}: the one obvious primary play action renders`,
      );
      // The play-intent recorder's listener must be LIVE before the
      // click (its own deterministic hydration signal — a pre-hydration
      // click would navigate but never bridge the click onto the trace).
      // Wall-clock bounded + LOUD on timeout (never a silent proceed
      // that would click without the listener).
      const recorderDeadline = Date.now() + 15_000;
      let recorderReady = false;
      while (Date.now() < recorderDeadline) {
        recorderReady = await browser
          .eval<boolean>(`window.__wfxPlayIntentReady === true`)
          .catch(() => false);
        if (recorderReady) break;
        await browser.settle(300);
      }
      if (!recorderReady) {
        throw new Error(
          `${benchmark.titleFragment}: the play-intent recorder did not hydrate (the click listener is not live — the intent bridge cannot record)`,
        );
      }
      await browser.clickInteractive("[data-wfx-item-play]");

      // ---- THE SHELL + THE FIRST FRAME (the streamed startup path).
      // The play click is a FULL PAGE NAVIGATION — wait for the player.
      await browser.waitSelector("[data-wfx-surface='player']", 30_000);
      await assert.visible(
        "[data-wfx-surface='player']",
        `${benchmark.titleFragment}: the play click lands in the player`,
      );
      await assert.visible(
        "[data-wfx-player-frame]",
        `${benchmark.titleFragment}: the playback stage renders (the contained surface)`,
      );
      // The first-frame marker (the product's own observation — the
      // contained surface's load event, the honest boundary). The
      // observer attaches at hydration; an already-loaded surface
      // records on attach — poll bounded for the marker.
      await browser.pollTextContains("[data-wfx-player-phase]", "Playback phase", 5_000);
      let firstFrame = false;
      for (let attempt = 0; attempt < 12 && !firstFrame; attempt += 1) {
        firstFrame = await browser.eval<boolean>(
          `(window.__wfxPlaybackTelemetry?.markers ?? []).some((m) => m.marker === 'first-frame-rendered')`,
        );
        if (!firstFrame) await browser.settle(250);
      }
      assert.that(
        `${benchmark.titleFragment}: the first frame records (the stage observer's marker)`,
        "the first-frame-rendered marker present",
        String(firstFrame),
        firstFrame === true,
      );

      // ---- THE METRIC MARKER COMPLETENESS (the assertable pair set).
      const trace = await browser.eval<{
        fromPlayClick: boolean;
        realization: string;
        markers: { marker: string; offsetMs: number }[];
      } | null>(`window.__wfxPlaybackTelemetry ?? null`);
      assert.that(
        `${benchmark.titleFragment}: the in-page startup trace exists`,
        "the trace object",
        trace === null ? "<absent>" : `${trace.markers.length} markers`,
        trace !== null && trace.markers.length > 0,
      );
      if (trace !== null) {
        const markerKinds = trace.markers.map((marker) => marker.marker);
        for (const required of [
          "play-clicked",
          "navigation-start",
          "player-surface-visible",
          "playable-declared",
          "first-frame-rendered",
        ]) {
          assert.that(
            `${benchmark.titleFragment}: the '${required}' marker records (the pair set the metric derivation consumes)`,
            "present in the trace",
            markerKinds.join(", ").slice(0, 160),
            markerKinds.includes(required),
          );
        }
        // The trace binds THIS realization (the rung's label).
        assert.that(
          `${benchmark.titleFragment}: the trace binds the realization`,
          benchmark.realization,
          trace.realization,
          trace.realization === benchmark.realization,
        );
        // THE CLICK BRIDGE: the play-clicked marker at offset 0 (the
        // trace origin IS the click — the cross-document wall-clock
        // bridge the recorder records).
        const playClicked = trace.markers.find((marker) => marker.marker === "play-clicked");
        assert.that(
          `${benchmark.titleFragment}: the play click bridges onto the trace (the click-to-first-frame origin)`,
          "offset 0 (the trace origin is the click)",
          playClicked === undefined ? "<absent>" : `${playClicked.offsetMs}ms`,
          playClicked !== undefined && playClicked.offsetMs === 0 && trace.fromPlayClick === true,
        );
        // THE TTFF SANITY (positive, finite — a real measurement).
        const firstFrameMarker = trace.markers.find((marker) => marker.marker === "first-frame-rendered");
        if (playClicked !== undefined && firstFrameMarker !== undefined) {
          const ttff = firstFrameMarker.offsetMs - playClicked.offsetMs;
          assert.that(
            `${benchmark.titleFragment}: click-to-first-frame is a positive finite measurement`,
            "> 0 and finite",
            `${Math.round(ttff)}ms`,
            Number.isFinite(ttff) && ttff > 0,
          );
        }
        // THE STARTUP-LAW MEASUREMENT: the first frame PRECEDES the
        // nonessential sections' mounts (the streamed-shell law, from
        // the product's own observations).
        const observations = await browser.eval<{ enrichmentMountedAtMs: Record<string, number> } | null>(
          `window.__wfxStartupObservations ?? null`,
        );
        const mounts = observations?.enrichmentMountedAtMs ?? {};
        for (const [section, mountOffset] of Object.entries(mounts)) {
          assert.that(
            `${benchmark.titleFragment}: the enrichment section '${section}' mounts AFTER the first frame (no nonessential work blocks playback)`,
            `first frame ≤ ${Math.round(mountOffset)}ms`,
            firstFrameMarker === undefined
              ? "<no first frame>"
              : `${Math.round(firstFrameMarker.offsetMs)}ms`,
            firstFrameMarker !== undefined && firstFrameMarker.offsetMs <= mountOffset,
          );
        }
      }

      // ---- THE NO-FAKE-BUFFERING LAW (the position anchor moves only
      // on the accepted seek).
      const anchorBefore = await browser.tryText("[data-wfx-chrome-position]");
      await browser.settle(600);
      const anchorIdle = await browser.tryText("[data-wfx-chrome-position]");
      assert.that(
        `${benchmark.titleFragment}: the position anchor stays evidence-anchored while idle (never a fake-buffering tick)`,
        "the readout unchanged without a command",
        `${anchorBefore ?? "?"} vs ${anchorIdle ?? "?"}`,
        (anchorIdle ?? "") === (anchorBefore ?? ""),
      );

      // ---- THE SEEK PAIR (the J keyboard seek through the real route).
      // The confirm marker rides the async command round trip — a bounded
      // poll (the R24-W2 play-click hardening pattern), never a single
      // fixed-settle read (which races on loaded boxes).
      await browser.clickInteractive("[data-wfx-chrome]");
      await browser.press("j");
      let seekConfirmed = false;
      try {
        await browser.pollEvalTruthy(
          `(window.__wfxPlaybackTelemetry?.markers ?? []).some((m) => m.marker === 'seek-confirmed')`,
        );
        seekConfirmed = true;
      } catch {
        seekConfirmed = false;
      }
      assert.that(
        `${benchmark.titleFragment}: the keyboard seek records its request/confirm pair (the real command round trip)`,
        "seek-confirmed present",
        String(seekConfirmed),
        seekConfirmed === true,
      );

      // ---- THE CONTROL PAIR (the transport's play/pause round trip).
      // Same bounded-poll hardening as the seek pair.
      await browser.clickInteractive("[data-wfx-chrome-play]");
      let controlConfirmed = false;
      try {
        await browser.pollEvalTruthy(
          `(window.__wfxPlaybackTelemetry?.markers ?? []).some((m) => m.marker === 'control-confirmed')`,
        );
        controlConfirmed = true;
      } catch {
        controlConfirmed = false;
      }
      assert.that(
        `${benchmark.titleFragment}: the play/pause control records its invoked/confirm pair`,
        "control-confirmed present",
        String(controlConfirmed),
        controlConfirmed === true,
      );

      // ---- THE RETENTION SEAM (the trace flushes; the raw observations
      // read back over HTTP from the running product).
      await browser.eval(
        `void window.dispatchEvent(new Event('pagehide'))`,
      );
      await browser.eval(
        `void fetch('/api/playback/telemetry').then((response) => response.json()).then((body) => { window.__wfxRetentionCheck = body; }).catch(() => { window.__wfxRetentionCheck = null; })`,
      );
      await browser.settle(500);
      let retained: { ok: boolean; count: number } | null = null;
      try {
        await browser.pollEvalTruthy(`window.__wfxRetentionCheck?.ok === true`, 15_000);
        retained = await browser.eval<{ ok: boolean; count: number } | null>(
          `window.__wfxRetentionCheck ?? null`,
        );
      } catch {
        retained = await browser.eval<{ ok: boolean; count: number } | null>(
          `window.__wfxRetentionCheck ?? null`,
        );
      }
      assert.that(
        "the flushed traces retain on the server seam (the raw observations readable back)",
        "the store answers with the retained count",
        retained === null ? "<fetch failed>" : `${retained.count} trace(s)`,
        retained !== null && retained.ok === true && retained.count > 0,
      );
      await browser.eval(`void (window.__wfxRetentionCheck = undefined)`);
    }

    // ---- THE REALIZATION-SWITCH MEASUREMENT (the Where-to-watch
    // switch: Deep Field Diary's peer copy — the request/confirm pair).
    await goto(context, "/search?q=Deep%20Field");
    const diaryHref = await itemHrefFromSearch(context, "Deep Field", "Deep Field Diary");
    await goto(context, diaryHref ?? "/");
    await assert.visible(
      "[data-wfx-watch-switch='authorized-peer-copy']",
      "the Where-to-watch row offers the authorized peer copy ('Play this way' — the switch intent)",
    );
    await browser.clickInteractive("[data-wfx-watch-switch='authorized-peer-copy']");
    await browser.waitSelector("[data-wfx-torrent-stage], [data-wfx-player-mode='torrent-desktop-next-step']", 30_000);
    await assert.visible(
      "[data-wfx-torrent-stage]",
      "the switch lands on the peer-copy stage (the first-class torrent realization)",
    );
    const switchTrace = await browser.eval<{ markers: { marker: string; offsetMs: number }[] } | null>(
      `window.__wfxPlaybackTelemetry ?? null`,
    );
    const switchRequested = switchTrace?.markers.find((marker) => marker.marker === "realization-switch-requested");
    assert.that(
      "the realization-switch request records (the switch intent on the player trace)",
      "realization-switch-requested at the click origin",
      switchRequested === undefined ? "<absent>" : `${switchRequested.offsetMs}ms`,
      switchRequested !== undefined && switchRequested.offsetMs === 0,
    );
    // The peer-copy rung's honest truth (the WebRTC-capable browser
    // rung or the Desktop next step — never a fabricated stage).
    await assert.visible(
      "[data-wfx-torrent-rung-detail]",
      "the peer-copy stage names its rung truth (plays here or the honest Desktop next step)",
    );

    await context.screenshot("j41-playback-startup");
    await describe(
      context,
      "the startup benchmark walk: both benchmark titles started through the real user flow (search → item → the one obvious play click) with the complete marker set recording — the click-bridged trace origin, the streamed shell's parse, the phase declaration, the first frame at the contained-surface boundary — the first frame preceding every enrichment mount (the streamed-shell law measured), the position anchor staying evidence-anchored while idle, the J-seek and the play/pause control recording their request/confirm pairs through the real route, the traces retained on the server seam, and the authorized-peer-copy switch recording its request at the click origin with the honest rung truth on the stage",
    );
  },
};
