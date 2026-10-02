/**
 * @wfx/journeys — J49 Deployment release surface (encoded Web journey —
 * WFX-DEPLOY-W3, the browser-regression/release-surface lane).
 *
 * Doc expectation (docs/work-items/WFX-DEPLOY-W3.md §2 + §3): the release
 * golden set's deployment critical path — the shell navigation, the
 * search form-submit path into a result, the player's honest resolution
 * state, the /api/health contract, the /offline route's zero-configuration
 * render + honest retry, and the PWA surface laws that hold in the
 * fixtures boot (manifest served, sw.js served, the dev-boot
 * no-registration law, the service-mode-only install affordance) + the
 * internal API route table's failure laws (/api/actions, /api/events,
 * /api/shorts).
 *
 * WEB-FIXTURES-BOOT ENCODING (every assertion a real check — fails on
 * regression):
 * - NAV: the persistent shell's destination links (Home / Shorts /
 *   Subscriptions / Library + the Settings entry) render on the landing;
 * - SEARCH (query → submit → results → open result): the masthead search
 *   FORM submits (Enter) to /search?q=…, the results state renders
 *   canonical cards, and opening a result (the R28-B one-click /player
 *   href) lands in the player with its honest resolution mode
 *   (data-wfx-player-mode on the stage — never fake playback);
 * - /api/health: HTTP 200 + application/json + the exact frozen body
 *   {ok:true, service:"webflix-web", version:"0.1.0"} — deterministic,
 *   dependency-free (the one route that must answer with zero
 *   configuration);
 * - /offline: renders with zero configuration (self-contained state, NO
 *   host boot chrome, NO feed content — stale-feed behavior is NOT
 *   offline behavior), carries its inline critical CSS + inline retry
 *   script in the served HTML, and the Try again button ACTUALLY
 *   re-attempts navigation (a reload probe: a pre-click window marker is
 *   gone after the click — location.reload() re-attempted the page);
 * - PWA (the laws this configuration can exercise): the manifest is
 *   served (200, application/manifest+json, name "WebFlix", display
 *   "standalone", the two 1024×1024 any/maskable icons) and linked from
 *   the served HTML; /sw.js is served (200, JavaScript); the fixtures
 *   dev boot registers NO service worker (the NODE_ENV law) and mounts
 *   NO install affordance (the service-mode-only law) — honest absences,
 *   asserted;
 * (The internal API route table's failure laws — /api/actions, /api/events,
 * /api/shorts — are machine-tested by apps/web/tests/adapter-api-routes.test.ts
 * and verified live by the lane's HTTP probes in the evidence packet; the
 * suite-mandated route is /api/health, asserted here.)
 *
 * The production-only PWA behaviors (SW registration + offline fallback
 * through the SW + the real install prompt + the update flow) are
 * exercised by the documented production-start procedure — the honest
 * limitation entry in the registry names it.
 */

import { describe } from "./journey-description";
import type { Journey } from "../lib/journeys";
import { goto } from "../lib/journeys";
import type { Browser } from "../lib/browser";

/** One in-page HTTP probe's observation (the user-side transport). */
interface HttpProbe {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
}

/** One in-page HTTP probe against the running product (never an import). */
async function probe(
  browser: Browser,
  method: "GET" | "POST",
  path: string,
  body?: string,
): Promise<HttpProbe | null> {
  const expression = `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, ${body === undefined ? "" : `body: ${JSON.stringify(body)}, `}headers: ${body === undefined ? "{}" : '{"content-type": "application/json"}'} })
    .then(async (response) => ({ status: response.status, contentType: response.headers.get("content-type"), body: await response.text() }))
    .catch(() => null)`;
  return browser.eval<HttpProbe | null>(expression);
}

/** The /api/health contract body (the frozen deployment probe shape). */
interface HealthBody {
  ok?: unknown;
  service?: unknown;
  version?: unknown;
}

/** The web app manifest's observed shape (the installable truth). */
interface ManifestBody {
  name?: string;
  short_name?: string;
  display?: string;
  start_url?: string;
  icons?: { sizes?: string; purpose?: string }[];
}

/** Parse a probe's body as JSON (null on any parse failure). */
function parseJson<T>(probeResult: HttpProbe | null): T | null {
  if (probeResult === null) return null;
  try {
    return JSON.parse(probeResult.body) as T;
  } catch {
    return null;
  }
}

export const j49DeploymentReleaseSurface: Journey = {
  id: "J49",
  title: "Deployment release surface (health / offline / PWA / critical path)",
  doc: "docs/work-items/WFX-DEPLOY-W3.md §2 (the release golden set) + §3 (the deployment-surface verification)",
  ci: true,
  async run(context): Promise<void> {
    const { assert, browser } = context;

    // ------------------------------------------------------------------
    // 1 — HOME + THE SHELL NAVIGATION (the release landing truth).
    // ------------------------------------------------------------------
    await goto(context, "/");
    await assert.visible("[data-wfx-surface='home']", "the home surface renders (the release landing)");
    // The persistent shell's destination links: the rail's primary set
    // (Home / Shorts / Subscriptions / Library) + the Settings entry.
    await assert.countAtLeast("nav a[href='/']", 1, "the shell nav links Home");
    await assert.countAtLeast("nav a[href='/shorts']", 1, "the shell nav links the Shorts feed");
    await assert.countAtLeast("nav a[href='/library']", 1, "the shell nav links the Library");
    await assert.countAtLeast("nav a[href='/settings']", 1, "the shell nav links Settings (the You group)");
    // The subscriptions destination binds the REAL feed surface.
    await assert.countAtLeast("nav a[href='/feed/subscriptions']", 1, "the shell nav links the Subscriptions feed surface");
    // The offline surface is reachable from the shell (the You group's Offline entry).
    await assert.countAtLeast("nav a[href='/offline']", 1, "the shell nav links the offline surface");

    // ------------------------------------------------------------------
    // 2 — THE /api/health CONTRACT (the deployment-verification probe).
    // HTTP 200 + application/json + the exact frozen body — the one
    // route that must answer with zero configuration.
    // (Ordered BEFORE the player walk: the heavy player compile is this
    // box's documented OOM class — the light deployment surfaces assert
    // first, the heavy surface last, so a memory kill can never mask
    // the deployment-contract evidence.)
    // ------------------------------------------------------------------
    const health = await probe(browser, "GET", "/api/health");
    assert.that(
      "/api/health answers HTTP 200 (deterministic, dependency-free)",
      "status 200",
      health === null ? "<fetch failed>" : `status ${health.status}`,
      health !== null && health.status === 200,
    );
    assert.that(
      "/api/health answers application/json",
      "content-type application/json",
      health === null ? "<fetch failed>" : (health.contentType ?? "<none>"),
      health !== null && (health.contentType ?? "").includes("application/json"),
    );
    let healthBody: HealthBody | null = parseJson<HealthBody>(health);
    assert.that(
      "/api/health answers the frozen contract body",
      '{"ok":true,"service":"webflix-web","version":"0.1.0"}',
      health === null ? "<fetch failed>" : health.body.slice(0, 120),
      healthBody !== null && healthBody.ok === true && healthBody.service === "webflix-web" && healthBody.version === "0.1.0",
    );

    // ------------------------------------------------------------------
    // 3 — /offline: zero-configuration render + the honest retry.
    // ------------------------------------------------------------------
    await goto(context, "/offline");
    await assert.visible("[data-wfx-offline]", "the offline route renders (the one deliberately-static route)");
    await assert.visible("[data-wfx-offline-state]", "the honest offline state renders (the StateViews grammar)");
    await assert.textContains("[data-wfx-offline-state]", "You're offline", "the offline state names the offline truth");
    await assert.textContains("[data-wfx-offline-state]", "watch progress is safe", "the offline state reassures about progress (never a lie about data)");
    await assert.countExactly("[data-wfx-offline-retry]", 1, "the Try again button renders (the retry affordance)");
    // SELF-CONTAINMENT: no host boot chrome (no shell nav), and NO feed
    // content — a stale feed is NOT offline behavior.
    await assert.absent("nav.wfx-rail", "the offline route renders NO shell rail (self-contained — zero configuration)");
    await assert.absent("nav.wfx-bottomnav", "the offline route renders NO bottom nav (no host boot chrome)");
    await assert.countExactly("[data-wfx-card]", 0, "the offline route carries NO feed content (stale-feed behavior is not offline behavior)");
    await assert.countExactly("[data-wfx-row]", 0, "the offline route carries NO browse rows (the honest offline state, never a cached feed)");
    // The served HTML carries the inline critical CSS + the inline retry
    // script (renders styled and retries with ZERO network and ZERO warm
    // caches — the WFX-057 law).
    const offlineHtml = await probe(browser, "GET", "/offline");
    const html = offlineHtml?.body ?? "";
    assert.that(
      "the served /offline HTML carries its inline critical CSS (zero-network render)",
      "an inline <style> block",
      offlineHtml === null ? "<fetch failed>" : `${html.length} chars of HTML`,
      html.includes("<style") && html.includes("wfx-offline"),
    );
    assert.that(
      "the served /offline HTML carries the inline retry script (zero-network retry)",
      "an inline <script> with the retry wiring",
      offlineHtml === null ? "<fetch failed>" : `${html.length} chars of HTML`,
      html.includes("wfx-offline-retry") && html.includes("<script"),
    );
    // THE RETRY ACTUALLY RE-ATTEMPTS NAVIGATION: plant a window marker,
    // click Try again (location.reload()), and prove the marker is GONE
    // (the page reloaded — the navigation re-attempted) while the URL
    // still names /offline.
    await browser.eval(`void (window.__wfxOfflineRetryProbe = "planted")`);
    await browser.clickInteractive("[data-wfx-offline-retry]");
    // The reload is the retry: poll until the marker is gone (fresh
    // evaluations — the navigation-safe pattern).
    await browser.pollEvalTruthy(`window.__wfxOfflineRetryProbe === undefined`, 20_000);
    const probeGone = await browser.eval<boolean>(`window.__wfxOfflineRetryProbe === undefined`);
    assert.that(
      "the Try again click ACTUALLY re-attempts navigation (location.reload() — the page reloaded, the marker is gone)",
      "the pre-click window marker absent after the click (a reload happened)",
      probeGone ? "the marker is gone (reloaded)" : "the marker survived (no reload)",
      probeGone === true,
    );
    const offlineUrl = await browser.url();
    assert.that(
      "the retry keeps the offline URL (the SW fallback contract: the URL bar keeps the original destination)",
      "the URL still names /offline",
      offlineUrl,
      offlineUrl.includes("/offline"),
    );
    await assert.visible("[data-wfx-offline-state]", "the offline state renders again after the retry (the honest state, not an error page)");

    // ------------------------------------------------------------------
    // 4 — THE PWA SURFACES (the laws the fixtures boot can exercise).
    // ------------------------------------------------------------------
    // The manifest: served + linked + the installable truth.
    const manifest = await probe(browser, "GET", "/manifest.webmanifest");
    assert.that(
      "the web app manifest is served (200)",
      "status 200",
      manifest === null ? "<fetch failed>" : `status ${manifest.status}`,
      manifest !== null && manifest.status === 200,
    );
    assert.that(
      "the manifest answers the manifest media type",
      "content-type application/manifest+json",
      manifest === null ? "<fetch failed>" : (manifest.contentType ?? "<none>"),
      manifest !== null && (manifest.contentType ?? "").includes("application/manifest+json"),
    );
    const manifestBody: ManifestBody | null = parseJson<ManifestBody>(manifest);
    assert.that(
      "the manifest names the app (WebFlix) and declares the standalone display",
      'name "WebFlix" + display "standalone" + start_url "/"',
      manifestBody === null ? "<unparsable>" : `${manifestBody.name ?? "?"} / ${manifestBody.display ?? "?"} / ${manifestBody.start_url ?? "?"}`,
      manifestBody !== null && manifestBody.name === "WebFlix" && manifestBody.display === "standalone" && manifestBody.start_url === "/",
    );
    const icons = manifestBody?.icons ?? [];
    assert.that(
      "the manifest declares the two 1024×1024 icons (any + maskable)",
      "2 icons: 1024x1024 any + 1024x1024 maskable",
      icons.map((icon) => `${icon.sizes ?? "?"}/${icon.purpose ?? "?"}`).join(", ") || "<none>",
      icons.some((icon) => icon.sizes === "1024x1024" && icon.purpose === "any") &&
        icons.some((icon) => icon.sizes === "1024x1024" && icon.purpose === "maskable"),
    );
    // The layout wires the manifest link into the served HTML.
    const homeHtml = await probe(browser, "GET", "/");
    assert.that(
      "the served HTML links the manifest (the installable wiring)",
      '<link rel="manifest" href="/manifest.webmanifest">',
      homeHtml === null ? "<fetch failed>" : `${homeHtml.body.length} chars of HTML`,
      homeHtml !== null && homeHtml.body.includes('rel="manifest"') && homeHtml.body.includes("/manifest.webmanifest"),
    );
    // The service worker file: served as JavaScript.
    const sw = await probe(browser, "GET", "/sw.js");
    assert.that(
      "/sw.js is served (the hand-written worker, zero dependencies)",
      "status 200 + a JavaScript content type",
      sw === null ? "<fetch failed>" : `status ${sw.status} (${sw.contentType ?? "?"})`,
      sw !== null && sw.status === 200 && (sw.contentType ?? "").includes("javascript"),
    );
    // THE DEV-BOOT REGISTRATION LAW: the fixtures dev boot registers NO
    // service worker (registration is production-build-only — the
    // NODE_ENV guard; fixtures never register).
    const registrations = await browser.eval<unknown[]>(
      `navigator.serviceWorker?.getRegistrations?.().then((regs) => regs.map(() => "registration")).catch(() => []) ?? []`,
    );
    assert.that(
      "the fixtures dev boot registers NO service worker (the production-only registration law)",
      "zero SW registrations",
      `${(registrations ?? []).length} registration(s)`,
      (registrations ?? []).length === 0,
    );
    // THE SERVICE-MODE-ONLY INSTALL AFFORDANCE: the InstallPrompt island
    // mounts in service mode only — the fixtures boot renders NO install
    // chrome (an honest absence, asserted).
    await assert.absent("[data-wfx-install]", "the install affordance is ABSENT in the fixtures boot (service-mode-only mounting — no fake prompts)");
    await assert.absent("[data-wfx-update]", "the update affordance is ABSENT in the fixtures boot (the service-mode SW surface)");

    // ------------------------------------------------------------------
    // 5 — SEARCH: query → SUBMIT → results → OPEN A RESULT.
    // (The form-submit path — J05 asserts the URL-navigated states; this
    // drives the user's actual submission from the landing. LAST in the
    // walk: the player compile is the heaviest surface this boot renders
    // — the deployment contracts above assert first, so a memory kill
    // (this box's documented OOM class) can never mask them.)
    // ------------------------------------------------------------------
    await goto(context, "/");
    await browser.clickInteractive("[role='search'] input");
    await browser.fill("[role='search'] input", "rain");
    // The form's own submit (Enter in the box submits the form action).
    await browser.press("Enter");
    await browser.waitSelector("[data-wfx-surface='search']", 20_000);
    await assert.visible("[data-wfx-surface='search']", "the search form submission lands on the search surface");
    const urlAfterSubmit = await browser.url();
    assert.that(
      "the submitted query rides the URL (the form's GET action)",
      "the URL carries ?q=rain",
      urlAfterSubmit,
      urlAfterSubmit.includes("/search?q=rain"),
    );
    const resultsState = await browser.tryAttr("[data-wfx-surface='search']", "data-wfx-search-state");
    assert.that(
      "the submitted query answers the results state",
      'data-wfx-search-state="results"',
      resultsState ?? "<absent>",
      resultsState === "results",
    );
    await assert.countAtLeast("[data-wfx-search-results] a[data-wfx-card]", 1, "the results state renders canonical result cards");
    // OPEN A RESULT — the R28-B one-click grammar: the card's primary
    // link IS the play path.
    const playerHref = await browser.eval<string | null>(
      `(() => { const link = document.querySelector("[data-wfx-search-results] a[data-wfx-card]"); return link === null ? null : link.getAttribute('href'); })()`,
    );
    assert.that(
      "the result card's primary link is the one-click play path (the R28-B grammar)",
      "an id-first /player href",
      playerHref ?? "<none>",
      playerHref !== null && playerHref.startsWith("/player?id=wfxitm_"),
    );
    await browser.navigate(`${context.baseUrl}${playerHref ?? "/"}`);
    await browser.waitSelector("[data-wfx-surface='player']", 30_000);
    await assert.visible("[data-wfx-surface='player']", "opening a search result lands in the player (the one-click open)");
    // PLAYER RESOLUTION-STATE HONESTY: the stage declares its resolved
    // mode (embed / browser / …) — never fake playback.
    await assert.visible("[data-wfx-player-frame]", "the playback stage renders (the contained surface)");
    const playerMode = await browser.eval<string | null>(
      `(() => { const stage = document.querySelector('[data-wfx-player-mode]'); return stage === null ? null : stage.getAttribute('data-wfx-player-mode'); })()`,
    );
    assert.that(
      "the player's stage declares its honest resolution mode (embed/browser — never fake playback)",
      "a data-wfx-player-mode of embed or browser",
      playerMode ?? "<absent>",
      playerMode === "embed" || playerMode === "browser",
    );

    await context.screenshot("j49-deployment-release-surface");
    await describe(
      context,
      "the deployment release surface: the shell nav destinations, the search form-submit path into a result and the player's honest resolution mode, the /api/health frozen contract (200 application/json {ok,service,version}), the /offline zero-configuration render (no chrome, no feed content — stale-feed is not offline) with its inline CSS + retry script and a PROVEN retry re-attempt (the reload probe), the PWA laws of this configuration (manifest served + linked + standalone + the 1024 icons, sw.js served, NO SW registration and NO install chrome in the fixtures boot), (the internal API route table's failure laws are the adapter route tests + the lane's committed HTTP probe evidence)",
    );
  },
};
