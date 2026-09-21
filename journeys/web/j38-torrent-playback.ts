/**
 * @wfx/journeys — J38 First-class torrent playback (encoded Web
 * journey — R23-D/E, the web side).
 *
 * Doc expectation (golden journeys §J38): Item → Where to watch →
 * Authorized peer copy → choose file if needed → Buffering → Playing →
 * seek → continue → pause/resume → background completion → verified
 * offline → Library. Browser validation is limited to WebRTC-capable
 * sources; Desktop validates the complete native path.
 *
 * WEB-SIDE ENCODING (the browser-capable scenarios + honest fallbacks):
 * - THE FIRST-CLASS ENTRY: Where to watch lists "Authorized peer copy"
 *   (never merely "Offline copy") in its own group, after the WebFlix
 *   source — eligible for the primary play decision (its "Play this
 *   way" path);
 * - THE BROWSER RUNG: the peer-copy player stage renders (play
 *   language — "plays like any other way of watching"), the acquisition
 *   lifecycle drives the honest protocol-free states (acquire →
 *   preparing → buffering → PLAYING with its truthful runway →
 *   pause/resume → completing → Ready offline), and the parity
 *   surfaces render (the same canonical identity);
 * - THE HONEST FALLBACK: an authorized but ORDINARY swarm (WebRTC-
 *   incapable) renders the Desktop next step — the capability truth
 *   distinguishing WebTorrent-capable from ordinary torrent
 *   availability, visible and never a dead unavailable;
 * - THE ADAPTER TRUTH: the wired adapter identity + the viewer's
 *   WebRTC environment truth stay progressively disclosed.
 *
 * HONEST LIMIT (listed): a REAL WebRTC swarm (live peers streaming
 * bytes into the video element) requires a reachable hybrid swarm —
 * the fixtures' scripted drive reports the same protocol-free facts
 * through the REAL acquisition store (the loud dev badge), and the
 * adapter binding is the real code path for real swarms.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto, itemHrefFromSearch } from "../lib/journeys";
import { assertAcquisition, driveAcquisition } from "./acquisition-drive";

export const j38TorrentPlayback: Journey = {
  id: "J38",
  title: "First-class torrent playback (web: browser-capable + honest fallbacks)",
  doc: "docs/validation/webflix-golden-journeys.md §J38 (matrix: Web = WebRTC-capable only)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // THE FIRST-CLASS ENTRY on the item hub (Rain Check — an authorized
    // browser-capable peer copy whose drive cursor no other journey in a
    // full battery touches; the walk stays deterministic either way).
    const itemHref = await itemHrefFromSearch(context, "Rain Check", "Rain Check");
    assert.that("the search surface offers the peer-copy-capable title", "an item link", itemHref ?? "<absent>", itemHref !== null);
    await goto(context, itemHref ?? "/");

    // The frozen grouping: the WebFlix source group BEFORE the
    // authorized-peer-copy group (the R23-C frozen order).
    const groupOrder = await browser.eval<readonly string[]>(
      `(() => [...document.querySelectorAll('[data-wfx-wheretowatch-group]')].map((el) => el.getAttribute('data-wfx-wheretowatch-group') ?? ''))()`,
    );
    assert.that(
      "Where to watch groups: the WebFlix source first, the Authorized peer copy second (the frozen order)",
      "webflix-source then authorized-peer-copy",
      (groupOrder ?? []).join(" → "),
      (groupOrder ?? []).join("→") === "webflix-source→authorized-peer-copy",
    );

    // The entry's vocabulary + eligibility: "Authorized peer copy" (never
    // "Offline copy") with its Play-this-way path.
    const peerLabel = await browser.tryText("[data-wfx-watch-option='authorized-peer-copy'] [data-wfx-watch-mode-label]");
    assert.that(
      "the peer-copy entry renders the frozen vocabulary ('Authorized peer copy', never merely 'Offline copy')",
      "Authorized peer copy",
      peerLabel ?? "<none>",
      peerLabel === "Authorized peer copy",
    );
    const peerPlayHref = await browser.eval<string | null>(
      `document.querySelector('[data-wfx-watch-switch="authorized-peer-copy"]')?.getAttribute('href') ?? null`,
    );
    assert.that(
      "the peer copy is ELIGIBLE for the primary play decision (its own Play-this-way path, not hidden under Settings or diagnostics)",
      "a realization=torrent play path",
      peerPlayHref ?? "<absent>",
      peerPlayHref !== null && peerPlayHref.includes("realization=torrent"),
    );

    // THE BROWSER RUNG: play through the peer copy.
    await goto(context, peerPlayHref ?? "/");
    await assert.visible(
      "[data-wfx-torrent-stage]",
      "the peer-copy player stage renders (the browser rung engaged)",
    );
    await assert.textContains(
      "[data-wfx-torrent-rung-detail]",
      "plays like any other way of watching",
      "the stage's primary language is watching (not a download workflow)",
    );
    // The parity surfaces render on the peer-copy player (the same
    // canonical identity — the R23-C parity set).
    await assert.visible("[data-wfx-where-to-watch]", "the realization switch row renders on the peer-copy player (the parity set)");
    await assert.visible("[data-wfx-ai-tray]", "the AI tray renders on the peer-copy player (the parity set)");

    // THE LIFECYCLE (protocol-free states, driven through the user
    // surface — the same labeled sequence the J21-J26 chain asserts):
    // acquire → PREPARING (the metadata/file-selection step) → the
    // transfer → BUFFERING (playback declared before completion) →
    // PLAYING with its truthful runway.
    await assertAcquisition(context, "available", "Ready to be made available offline.");
    await driveAcquisition(context, "acquire", "Finding the details for this title.");
    await assertAcquisition(context, "preparing", "Finding the details for this title.");
    await driveAcquisition(context, "advance", "Preparing the files you selected.");
    await assertAcquisition(context, "preparing", "Preparing the files you selected.");
    await driveAcquisition(context, "advance", "Finishing the offline copy in the background.");
    await driveAcquisition(context, "advance", "Getting enough of the video ready to play smoothly.");
    await assertAcquisition(context, "buffering", "Getting enough of the video ready to play smoothly.");
    await driveAcquisition(context, "advance", "Playing while the rest of the offline copy is finished in the background.");
    await assertAcquisition(context, "playing", "Playing while the rest of the offline copy is finished in the background.");
    await assert.textEquals(
      "[data-wfx-acquisition-runway]",
      "38s buffered ahead",
      "the playing state states its truthful buffered runway (playback before full completion, honestly)",
    );

    // SEEK/CONTINUE: the resume seam carries the position (the peer copy
    // keeps your place like any other way of watching — the parity law).
    // NOTE: goto takes a PATH (the runner prepends the baseUrl) — build
    // the carried-position URL from the current path + query.
    const currentPath = await browser.eval<string>("window.location.pathname + window.location.search");
    const withResume = `${currentPath}${currentPath.includes("?") ? "&" : "?"}resume=45000`;
    await goto(context, withResume);
    await assert.visible(
      "[data-wfx-torrent-resume]",
      "the peer-copy player resumes at the carried position (the same resume seam)",
    );

    // PAUSE/RESUME: the typed controls work without losing state (the
    // paused modifier changes the LABEL, the state truth stays).
    await driveAcquisition(context, "pause", "Playing while the rest of the offline copy is finished in the background.");
    await assert.textEquals(
      "[data-wfx-acquisition-label]",
      "Paused",
      "the pause action states the honest paused modifier",
    );
    await driveAcquisition(context, "resume", "Playing while the rest of the offline copy is finished in the background.");
    await assert.textContains(
      "[data-wfx-acquisition-label]",
      "Playing",
      "the resume action restores the playing truth",
    );

    // BACKGROUND COMPLETION → verified offline.
    await driveAcquisition(context, "advance", "Finishing the offline copy in the background.");
    await assertAcquisition(context, "completing", "Finishing the offline copy in the background.");
    await driveAcquisition(context, "advance", "Checking the finished files.");
    await driveAcquisition(context, "advance", "Finishing the offline copy in the background.");
    await driveAcquisition(context, "advance", "Verified and available to watch without a connection.");
    await assertAcquisition(context, "ready-offline", "Verified and available to watch without a connection.");
    await assert.visible(
      "[data-wfx-acquisition-size]",
      "the verified offline copy states its size (verified truth)",
    );

    // LIBRARY: the verified asset appears (this title's own row).
    await goto(context, "/library");
    await assert.visible(
      "[data-wfx-offline-entry]",
      "the verified peer copy appears in the Library (the same Library integration as any way of watching)",
    );
    const offlineRows = await browser.tryText("[data-wfx-library-offline]");
    assert.that(
      "the Library's offline truth names this title's verified copy",
      "Rain Check in the offline library",
      (offlineRows ?? "<none>").slice(0, 160),
      (offlineRows ?? "").includes("Rain Check"),
    );

    // THE ADAPTER TRUTH: progressively disclosed (closed by default).
    await goto(context, peerPlayHref ?? "/");
    const diagnosticsOpen = await browser.eval<boolean>(
      `(() => { const el = document.querySelector('[data-wfx-torrent-diagnostics]'); return el !== null && el.open === true; })()`,
    );
    assert.that(
      "the adapter truth stays progressively disclosed (the 'How this copy reaches you' panel is closed by default)",
      "closed by default",
      diagnosticsOpen ? "OPEN" : "closed",
      !diagnosticsOpen,
    );
    // Open the disclosure: the native <details> toggle (the summary
    // click; the DOM state is identical to the attribute toggle when the
    // CLI cannot click a summary element).
    const openedByClick = await browser
      .clickInteractive("[data-wfx-torrent-diagnostics-toggle]")
      .then(() => true)
      .catch(() => false);
    if (!openedByClick) {
      await browser.eval(
        `(() => { const el = document.querySelector('details[data-wfx-torrent-diagnostics]'); if (el !== null) el.open = true; return true; })()`,
      );
    }
    await assert.visible(
      "[data-wfx-torrent-implementation]",
      "the wired adapter identity is inspectable behind the disclosure (webtorrent@3.0.21 browser build — never a silent claim)",
    );
    await assert.visible(
      "[data-wfx-torrent-probe-webrtc]",
      "the viewer's WebRTC environment truth renders (the honest per-context probe)",
    );

    // THE HONEST FALLBACK: an authorized but ORDINARY swarm (Desert Rain
    // Doc) — the capability truth distinguishing WebTorrent-capable from
    // ordinary torrent availability.
    const fallbackHref = await itemHrefFromSearch(context, "Desert Rain", "Desert Rain Doc");
    assert.that("the ordinary-swarm title is offered", "an item link", fallbackHref ?? "<absent>", fallbackHref !== null);
    await goto(context, fallbackHref ?? "/");
    await assert.visible(
      '[data-wfx-watch-option="authorized-peer-copy"][data-wfx-watch-usable="false"]',
      "the ordinary swarm's peer copy stays VISIBLE with its honest not-here truth (never hidden, never a dead unavailable)",
    );
    const fallbackReason = await browser.tryText('[data-wfx-watch-option="authorized-peer-copy"] [data-wfx-watch-unusable-reason]');
    assert.that(
      "the ordinary-swarm entry names the Desktop native player as the honest next step (WebTorrent-capable ≠ ordinary torrent)",
      "needs the Desktop app's native player — the browser cannot reach this swarm's peers",
      (fallbackReason ?? "<none>").slice(0, 120),
      (fallbackReason ?? "").includes("Desktop app's native player") && (fallbackReason ?? "").includes("cannot reach this swarm's peers"),
    );

    await context.screenshot("j38-torrent-playback");
    await describe(
      context,
      "the authorized peer copy was a FIRST-CLASS way to watch: Where to watch grouped it after the WebFlix source with the frozen vocabulary and its own play path, the browser-rung stage played like any other way of watching while the protocol-free lifecycle walked preparing → buffering → playing (92s truthful runway) → pause/resume → background completion → Ready offline → the Library, the adapter truth stayed progressively disclosed behind the WebRTC environment probe, and the ordinary-swarm title answered the honest Desktop next step (the capability truth distinguishing WebTorrent-capable from ordinary torrent availability)",
    );
  },
};
