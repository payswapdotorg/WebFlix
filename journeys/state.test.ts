/**
 * @wfx/journeys — unit tests: the state-grammar parsers (R16).
 *
 * The parsers bind encoded journeys to the product's stable
 * `data-wfx-*` vocabulary. The fixture HTML below mirrors the REAL
 * rendered shapes (captured from the running surfaces during R16's
 * study phase) — trimmed to the grammar that matters.
 */

import { describe, expect, it } from "bun:test";

import {
  parseAcquisition,
  parseActionbar,
  parseLibrary,
  parsePlayer,
  parseSearch,
  parseSettings,
  parseShorts,
} from "./lib/state";

const ACQUISITION_PREPARING = `
<section data-wfx-acquisition data-wfx-acquisition-state="preparing">
  <h2>Offline copy</h2>
  <div data-wfx-acquisition-item="wfxitm_1">
    <p><span data-wfx-acquisition-label>Preparing</span></p>
    <p data-wfx-acquisition-detail>Finding the details for this title.</p>
    <div data-wfx-acquisition-actions>
      <button data-wfx-acquisition-action="pause">Pause download</button>
      <button data-wfx-acquisition-action="advance">Advance scripted download (dev)</button>
    </div>
  </div>
</section>`;

const ACQUISITION_READY = `
<section data-wfx-acquisition data-wfx-acquisition-state="ready-offline">
  <p><span data-wfx-acquisition-label>Ready offline</span><span data-wfx-acquisition-size>87 kB · verified offline</span></p>
  <p data-wfx-acquisition-detail>Verified and available to watch without a connection.</p>
  <div data-wfx-acquisition-actions>
    <button data-wfx-acquisition-action="play-offline">Play offline copy</button>
    <button data-wfx-acquisition-action="reverify-offline">Re-check the offline copy</button>
  </div>
</section>`;

const ACQUISITION_FAILED = `
<section data-wfx-acquisition data-wfx-acquisition-state="failed">
  <p><span data-wfx-acquisition-label>Couldn't finish</span></p>
  <p data-wfx-acquisition-detail>The download source had a problem. You can try again.</p>
  <p data-wfx-acquisition-failure="source-problem" data-wfx-acquisition-recoverable="true">You can try again.</p>
  <div data-wfx-acquisition-actions>
    <button data-wfx-acquisition-action="retry">Try again</button>
    <button data-wfx-acquisition-action="dismiss">Dismiss</button>
  </div>
</section>`;

const ACQUISITION_RESUMING = `
<section data-wfx-acquisition data-wfx-acquisition-state="completing">
  <p><span data-wfx-acquisition-label>Completing</span><span data-wfx-acquisition-resuming>Resuming</span><span data-wfx-acquisition-percent>62%</span></p>
  <p data-wfx-acquisition-detail>Finishing the offline copy in the background. Resuming where it left off — 55% already saved.</p>
</section>`;

const ACQUISITION_PLAYING = `
<section data-wfx-acquisition data-wfx-acquisition-state="playing">
  <p><span data-wfx-acquisition-label>Playing</span><span data-wfx-acquisition-percent>55%</span><span data-wfx-acquisition-runway>92s buffered ahead</span></p>
</section>`;

const ACQUISITION_ELSEWHERE = `
<section data-wfx-acquisition data-wfx-acquisition-none>
  <h2>Offline copy</h2>
  <p data-wfx-acquisition-elsewhere>You can make this title available offline in the WebFlix desktop app.</p>
</section>`;

describe("journeys/lib/state — parseAcquisition", () => {
  it("parses the preparing state's full grammar", () => {
    const view = parseAcquisition(ACQUISITION_PREPARING);
    expect(view.state).toBe("preparing");
    expect(view.label).toBe("Preparing");
    expect(view.detail).toBe("Finding the details for this title.");
    expect(view.percent).toBeNull();
    expect(view.actions).toEqual(["pause", "advance"]);
  });

  it("parses the earned ready-offline verdict", () => {
    const view = parseAcquisition(ACQUISITION_READY);
    expect(view.state).toBe("ready-offline");
    expect(view.label).toBe("Ready offline");
    expect(view.offlineSize).toBe("87 kB · verified offline");
    expect(view.actions).toEqual(["play-offline", "reverify-offline"]);
  });

  it("parses the recoverable failure grammar", () => {
    const view = parseAcquisition(ACQUISITION_FAILED);
    expect(view.state).toBe("failed");
    expect(view.failureCause).toBe("source-problem");
    expect(view.recoverable).toBe("true");
    expect(view.actions).toContain("retry");
    expect(view.actions).toContain("dismiss");
  });

  it("parses the resuming modifier + retained progress", () => {
    const view = parseAcquisition(ACQUISITION_RESUMING);
    expect(view.state).toBe("completing");
    expect(view.resuming).toBe(true);
    expect(view.percent).toBe(62);
    expect(view.detail).toContain("55% already saved");
  });

  it("parses the playing runway truth", () => {
    const view = parseAcquisition(ACQUISITION_PLAYING);
    expect(view.state).toBe("playing");
    expect(view.runway).toBe("92s buffered ahead");
    expect(view.percent).toBe(55);
  });

  it("parses the web limited-status (elsewhere) note", () => {
    const view = parseAcquisition(ACQUISITION_ELSEWHERE);
    expect(view.state).toBeNull();
    expect(view.elsewhere).toBe(true);
    expect(view.actions).toHaveLength(0);
  });
});

const PLAYER_EMBED = `
<div data-wfx-player-mode="embed" data-wfx-embed-attestation="unofficial">
  <iframe sandbox="allow-scripts allow-forms" referrerpolicy="strict-origin-when-cross-origin" data-wfx-player-frame="true"></iframe>
  <span data-wfx-player-mode-label>Playing via embed — buffering</span>
  <p data-wfx-player-phase>Playback phase: buffering</p>
  <p data-wfx-precedence-trace>
    <p data-wfx-precedence-line="0">native: rejected — device cannot realize native playback</p>
    <p data-wfx-precedence-line="1">embed: accepted — realization #3 from connector 'fake-source'</p>
    <p data-wfx-precedence-line="2">browser: skipped — precedence satisfied by 'embed'</p>
    <p data-wfx-precedence-line="3">external: skipped — precedence satisfied by 'embed'</p>
  </p>
</div>`;

const PLAYER_RESUME = `<span data-wfx-player-resume>Resumed at 1:00</span>`;

describe("journeys/lib/state — parsePlayer", () => {
  it("parses the mode, containment grammar, and precedence trace in order", () => {
    const view = parsePlayer(PLAYER_EMBED);
    expect(view.mode).toBe("embed");
    expect(view.attestation).toBe("unofficial");
    expect(view.modeLabel).toContain("embed");
    expect(view.phase).toContain("buffering");
    expect(view.iframeSandbox).toBe("allow-scripts allow-forms");
    expect(view.iframeReferrerPolicy).toBe("strict-origin-when-cross-origin");
    expect(view.precedenceLines).toHaveLength(4);
    expect(view.precedenceLines[0]).toContain("native:");
    expect(view.precedenceLines[1]).toContain("embed: accepted");
    expect(view.precedenceLines[3]).toContain("external:");
  });

  it("parses the resume line", () => {
    expect(parsePlayer(PLAYER_RESUME).resume).toBe("Resumed at 1:00");
  });
});

const ACTIONBAR = `
<div data-wfx-actions>
  <span data-wfx-action-absent="like">Like: not available on this source</span>
  <span data-wfx-action-absent="save">Save: not available on this source</span>
</div>`;

const ACTIONBAR_SETTLED = `
<button data-wfx-action-kind="like" data-wfx-action-state="confirmed-by-provider">Like</button>`;

describe("journeys/lib/state — parseActionbar", () => {
  it("parses the typed-absent vocabulary", () => {
    const view = parseActionbar(ACTIONBAR);
    expect(view.absent).toEqual(["like", "save"]);
    expect(view.settledStates).toHaveLength(0);
  });

  it("parses settled action states when the source confirms (the J10 differentiation grammar)", () => {
    const view = parseActionbar(ACTIONBAR_SETTLED);
    expect(view.settledStates).toEqual([{ kind: "like", state: "confirmed-by-provider" }]);
  });
});

const SEARCH_RESULTS = `
<div data-wfx-surface="search" data-wfx-search-state="results">
  <p data-wfx-search-query>3 results for “rain”</p>
  <div data-wfx-search-results>
    <a data-wfx-card="wfxitm_A" href="/item?id=wfxitm_A">Neon Rain</a>
    <a data-wfx-card="wfxitm_B" href="/item?id=wfxitm_B">Rain Check</a>
    <a data-wfx-card="wfxitm_C" href="/item?id=wfxitm_C">Desert Rain Doc</a>
  </div>
</div>`;

const SEARCH_NONE = `<div data-wfx-surface="search" data-wfx-search-state="no-results"><p data-wfx-search-query>No results for “zzz”</p></div>`;

describe("journeys/lib/state — parseSearch", () => {
  it("parses the results state, echo, and canonical card count", () => {
    const view = parseSearch(SEARCH_RESULTS);
    expect(view.state).toBe("results");
    expect(view.queryEcho).toContain("rain");
    expect(view.resultCards).toBe(3);
  });

  it("parses the no-results state", () => {
    expect(parseSearch(SEARCH_NONE).state).toBe("no-results");
  });
});

const LIBRARY = `
<div data-wfx-surface="library">
  <section data-wfx-library-watchlist><div data-wfx-empty="true"><p>Nothing saved yet</p></div></section>
  <section data-wfx-library-history><div data-wfx-empty="true"><p>No watch history yet</p></div></section>
  <section data-wfx-library-offline>
    <li data-wfx-offline-entry="wfxitm_A"><p data-wfx-offline-status="wfxitm_A">Ready offline · 87 kB · watchable without a connection</p></li>
    <li data-wfx-offline-entry="wfxitm_B"><p data-wfx-offline-status="wfxitm_B">Ready offline · 1.5 MB · 2 files · watchable without a connection</p></li>
  </section>
</div>`;

describe("journeys/lib/state — parseLibrary", () => {
  it("parses the honest empty states and the offline-and-verified entries", () => {
    const view = parseLibrary(LIBRARY);
    expect(view.watchlistEmpty).toBe(true);
    expect(view.historyEmpty).toBe(true);
    expect(view.offlineEntries).toEqual(["wfxitm_A", "wfxitm_B"]);
    expect(view.offlineStatuses).toHaveLength(2);
    expect(view.offlineStatuses[0]).toContain("Ready offline");
  });
});

const SHORTS = `
<div data-wfx-surface="shorts">
  <span data-wfx-shorts-position>2 / 3</span>
  <article data-wfx-shorts-card="current"><h2>Midnight Scoop</h2></article>
  <button data-wfx-shorts-action="share">Share</button>
  <p data-wfx-shorts-rerank>the fresh page replaced nothing — every slot is kept runway (typed reasons in the plan)</p>
</div>`;

describe("journeys/lib/state — parseShorts", () => {
  it("parses position, current title, actions, and the rerank note", () => {
    const view = parseShorts(SHORTS);
    expect(view.position).toBe("2 / 3");
    expect(view.currentTitle).toBe("Midnight Scoop");
    expect(view.actionKinds).toEqual(["share"]);
    expect(view.rerankNote).toContain("runway");
  });
});

const SETTINGS = `
<div data-wfx-surface="settings">
  <span data-wfx-session-label>Signed out</span>
  <div data-wfx-sources-empty>No sources connected</div>
  <div data-wfx-model-empty>Model controls arrive with the model lane (R06)</div>
  <ul>
    <li data-wfx-capability="storage"><span data-wfx-capability-supported>Available</span></li>
    <li data-wfx-capability="native media & torrent acquisition"><span data-wfx-capability-unsupported>Not available on Web</span></li>
  </ul>
</div>`;

describe("journeys/lib/state — parseSettings", () => {
  it("parses the session label, honest-empty notes, and the capability truth table", () => {
    const view = parseSettings(SETTINGS);
    expect(view.sessionLabel).toBe("Signed out");
    expect(view.sourcesEmpty).toBe(true);
    expect(view.modelEmpty).toBe(true);
    expect(view.capabilityRows).toHaveLength(2);
    expect(view.capabilityRows[0]).toEqual({ area: "storage", supported: true, unsupported: false });
    expect(view.capabilityRows[1]?.area).toBe("native media & torrent acquisition");
    expect(view.capabilityRows[1]?.unsupported).toBe(true);
  });
});
