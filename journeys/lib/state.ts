/**
 * @wfx/journeys — the product's stable state grammar, parsed (R16).
 *
 * The Web adapter renders its truthful state through the stable
 * `data-wfx-*` attribute grammar (the same hooks the app's own
 * composition tests bind to). This module parses that grammar from a
 * captured HTML fragment into TYPED observations the journeys assert
 * against — so the assertions bind to STATE (labels, modes, sync
 * vocabularies), never to layout or styling.
 *
 * PURE FUNCTIONS over strings: every parser is unit-tested with the
 * real fixture-surface HTML shapes. No browser, no network, no imports
 * from the product (the harness consumes the product as a user).
 */

// ---------------------------------------------------------------------------
// Acquisition (J21–J26) — the lifecycle vocabulary
// ---------------------------------------------------------------------------

/** One parsed acquisition panel observation. */
export interface AcquisitionObservation {
  /** `data-wfx-acquisition-state` (null when the panel is the none/elsewhere note). */
  readonly state: string | null;
  /** The state label's text ("Preparing", "Ready offline", …). */
  readonly label: string | null;
  /** The detail sentence. */
  readonly detail: string | null;
  /** The truthful percent (null when honestly unknown — no fake bar). */
  readonly percent: number | null;
  /** The paused modifier. */
  readonly paused: boolean;
  /** The J25 resuming badge. */
  readonly resuming: boolean;
  /** The recoverable marker of a typed failure ("true"/"false"). */
  readonly recoverable: string | null;
  /** `data-wfx-acquisition-failure` cause. */
  readonly failureCause: string | null;
  /** The J23 runway seconds label ("92s buffered ahead"). */
  readonly runway: string | null;
  /** The earned-offline size note ("87 kB · verified offline"). */
  readonly offlineSize: string | null;
  /** The limited-status note (no panel state — the J21/J22 web truth). */
  readonly elsewhere: boolean;
  /** The dev-drive action buttons present (fixtures mode only). */
  readonly actions: readonly string[];
}

/** Extract the value of one `data-wfx-*="value"` attribute from HTML. */
function attrValue(html: string, name: string): string | null {
  const quoted = html.match(new RegExp(`${name}="([^"]*)"`));
  if (quoted !== null) return decodeEntities(quoted[1] ?? null);
  const bare = html.match(new RegExp(`${name}(?=[\\s>])`));
  return bare !== null ? "true" : null;
}

/**
 * Decode the standard HTML entities the serializer emits inside
 * attribute values and text (e.g. `&amp;` in
 * `data-wfx-capability="native media &amp; torrent acquisition"`).
 */
function decodeEntities(text: string | null): string | null {
  if (text === null) return null;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Parse the acquisition panel's HTML into the typed observation. */
export function parseAcquisition(html: string): AcquisitionObservation {
  const actions = [...html.matchAll(/data-wfx-acquisition-action="([a-z-]+)"/g)].map(
    (match) => match[1] ?? "",
  );
  return {
    state: attrValue(html, "data-wfx-acquisition-state"),
    label: textOf(html, "data-wfx-acquisition-label"),
    detail: textOf(html, "data-wfx-acquisition-detail"),
    percent: numberOrNull(textOf(html, "data-wfx-acquisition-percent")),
    paused: textOf(html, "data-wfx-acquisition-label") === "Paused",
    resuming: attrValue(html, "data-wfx-acquisition-resuming") !== null,
    recoverable: attrValue(html, "data-wfx-acquisition-recoverable"),
    failureCause: attrValue(html, "data-wfx-acquisition-failure"),
    runway: textOf(html, "data-wfx-acquisition-runway"),
    offlineSize: textOf(html, "data-wfx-acquisition-size"),
    elsewhere: attrValue(html, "data-wfx-acquisition-elsewhere") !== null,
    actions,
  };
}

// ---------------------------------------------------------------------------
// Player (J07–J09) — surface mode, phase, precedence trace
// ---------------------------------------------------------------------------

/** One parsed player surface observation. */
export interface PlayerObservation {
  /** `data-wfx-player-mode` (embed | browser | external | native | failed | …). */
  readonly mode: string | null;
  /** The mode label ("Playing via embed — buffering"). */
  readonly modeLabel: string | null;
  /** The honest playback phase line. */
  readonly phase: string | null;
  /** The resume line ("Resumed at 1:00"). */
  readonly resume: string | null;
  /** The embed attestation ("official" | "unofficial" | null). */
  readonly attestation: string | null;
  /** The precedence trace, one line per rung, in frozen order. */
  readonly precedenceLines: readonly string[];
  /** The sandbox attribute of the contained iframe (containment law). */
  readonly iframeSandbox: string | null;
  /** The referrer policy of the contained iframe. */
  readonly iframeReferrerPolicy: string | null;
}

/** Parse the player surface's HTML into the typed observation. */
export function parsePlayer(html: string): PlayerObservation {
  const precedenceLines = [...html.matchAll(/data-wfx-precedence-line="\d+"[^>]*>([^<]*)</g)]
    .map((match) => (match[1] ?? "").trim())
    .filter((line) => line.length > 0);
  return {
    mode: attrValue(html, "data-wfx-player-mode"),
    modeLabel: textOf(html, "data-wfx-player-mode-label"),
    phase: textOf(html, "data-wfx-player-phase"),
    resume: textOf(html, "data-wfx-player-resume"),
    attestation: attrValue(html, "data-wfx-embed-attestation"),
    precedenceLines,
    iframeSandbox: attrValue(html, "sandbox"),
    iframeReferrerPolicy: attrValue(html, "referrerpolicy"),
  };
}

// ---------------------------------------------------------------------------
// Actions (J10, R15) — the sync-truth vocabulary
// ---------------------------------------------------------------------------

/** One parsed action-bar observation. */
export interface ActionbarObservation {
  /** Action kinds rendered as typed ABSENT ("like", "save" — never fake success). */
  readonly absent: readonly string[];
  /** The settled action states present (`data-wfx-action-state`). */
  readonly settledStates: readonly { readonly kind: string; readonly state: string }[];
}

/** Parse the action bar's HTML into the typed observation. */
export function parseActionbar(html: string): ActionbarObservation {
  const absent = [...html.matchAll(/data-wfx-action-absent="([a-z]+)"/g)].map((m) => m[1] ?? "");
  const settledStates = [
    ...html.matchAll(/data-wfx-action-kind="([a-z]+)"[^>]*data-wfx-action-state="([a-z-]+)"/g),
  ].map((m) => ({ kind: m[1] ?? "", state: m[2] ?? "" }));
  return { absent, settledStates };
}

// ---------------------------------------------------------------------------
// Search (J05)
// ---------------------------------------------------------------------------

/** One parsed search surface observation. */
export interface SearchObservation {
  /** `data-wfx-search-state` (results | no-results | empty-query | error). */
  readonly state: string | null;
  /** The query echo ("3 results for “rain”"). */
  readonly queryEcho: string | null;
  /** The number of result cards. */
  readonly resultCards: number;
}

/** Parse the search surface's HTML into the typed observation. */
export function parseSearch(html: string): SearchObservation {
  const cardMatches = html.match(/data-wfx-card="wfxitm_[A-Z0-9]+"/g);
  return {
    state: attrValue(html, "data-wfx-search-state"),
    queryEcho: textOf(html, "data-wfx-search-query"),
    resultCards: cardMatches === null ? 0 : cardMatches.length,
  };
}

// ---------------------------------------------------------------------------
// Library (J11, J26)
// ---------------------------------------------------------------------------

/** One parsed library surface observation. */
export interface LibraryObservation {
  /** Watchlist empty-state present. */
  readonly watchlistEmpty: boolean;
  /** History empty-state present. */
  readonly historyEmpty: boolean;
  /** Offline-and-verified entry ids. */
  readonly offlineEntries: readonly string[];
  /** The offline status labels (`data-wfx-offline-status` texts). */
  readonly offlineStatuses: readonly string[];
}

/** Parse the library surface's HTML into the typed observation. */
export function parseLibrary(html: string): LibraryObservation {
  const offlineEntries = [...html.matchAll(/data-wfx-offline-entry="(wfxitm_[A-Z0-9]+)"/g)].map(
    (m) => m[1] ?? "",
  );
  const offlineStatuses = [...html.matchAll(/data-wfx-offline-status="wfxitm_[A-Z0-9]+"[^>]*>([^<]*)</g)]
    .map((m) => decodeEntities(m[1] ?? "")?.trim() ?? "")
    .filter((text) => text.length > 0);
  const watchlistSection = sectionOf(html, "data-wfx-library-watchlist");
  const historySection = sectionOf(html, "data-wfx-library-history");
  return {
    watchlistEmpty: watchlistSection.includes('data-wfx-empty="true"'),
    historyEmpty: historySection.includes('data-wfx-empty="true"'),
    offlineEntries,
    offlineStatuses,
  };
}

// ---------------------------------------------------------------------------
// Shorts (J04, J15–J18)
// ---------------------------------------------------------------------------

/** One parsed shorts feed observation. */
export interface ShortsObservation {
  /** The position label ("1 / 3"). */
  readonly position: string | null;
  /** The current card's title. */
  readonly currentTitle: string | null;
  /** Like/save action buttons present (the R15 feedback vocabulary). */
  readonly actionKinds: readonly string[];
  /** The rerank explainability note (the R05 policy surface). */
  readonly rerankNote: string | null;
}

/** Parse the shorts feed's HTML into the typed observation. */
export function parseShorts(html: string): ShortsObservation {
  const actionKinds = [...html.matchAll(/data-wfx-shorts-action="([a-z]+)"/g)].map((m) => m[1] ?? "");
  const currentTitle = textOf(html, "data-wfx-shorts-card=\"current\"");
  return {
    position: textOf(html, "data-wfx-shorts-position"),
    // `get text` on the container works when the selector targets the card;
    // fallback extracts the heading under the current card role.
    currentTitle: currentTitle ?? headingOf(html, 'data-wfx-shorts-card="current"'),
    actionKinds,
    rerankNote: textOf(html, "data-wfx-shorts-rerank"),
  };
}

// ---------------------------------------------------------------------------
// Settings (J13, J14, J19, J27, J30)
// ---------------------------------------------------------------------------

/** One capability row of the settings truth table. */
export interface CapabilityRow {
  /** `data-wfx-capability` (the area key). */
  readonly area: string;
  /** Whether the row renders the supported chip. */
  readonly supported: boolean;
  /** Whether the row renders the unsupported chip. */
  readonly unsupported: boolean;
}

/** One parsed settings surface observation. */
export interface SettingsObservation {
  /** The session label ("Signed out …"). */
  readonly sessionLabel: string | null;
  /** The sources section honest-empty note present. */
  readonly sourcesEmpty: boolean;
  /** The model section honest-empty note present. */
  readonly modelEmpty: boolean;
  /** The capability truth rows. */
  readonly capabilityRows: readonly CapabilityRow[];
}

/** Parse the settings surface's HTML into the typed observation. */
export function parseSettings(html: string): SettingsObservation {
  const rows: CapabilityRow[] = [];
  for (const match of html.matchAll(/<li[^>]*data-wfx-capability="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)) {
    const area = decodeEntities(match[1] ?? "") ?? "";
    const body = match[2] ?? "";
    rows.push({
      area,
      supported: attrValue(body, "data-wfx-capability-supported") !== null,
      unsupported: attrValue(body, "data-wfx-capability-unsupported") !== null,
    });
  }
  return {
    sessionLabel: textOf(html, "data-wfx-session-label"),
    sourcesEmpty: attrValue(html, "data-wfx-sources-empty") !== null,
    modelEmpty: attrValue(html, "data-wfx-model-empty") !== null,
    capabilityRows: rows,
  };
}

// ---------------------------------------------------------------------------
// Shared extraction helpers
// ---------------------------------------------------------------------------

/** The inner text of the element carrying one `data-wfx-*` hook. */
function textOf(html: string, hook: string): string | null {
  const match = html.match(new RegExp(`${hook}(?:="[^"]*")?[^>]*>([^<]*)<`));
  if (match === null) return null;
  const text = (decodeEntities(match[1] ?? "") ?? "").trim();
  return text.length === 0 ? null : text;
}

/** The first heading text inside the element carrying one hook. */
function headingOf(html: string, hook: string): string | null {
  const match = html.match(new RegExp(`${hook}(?:="[^"]*")?[^>]*>[\\s\\S]*?<h2[^>]*>([^<]*)<`));
  if (match === null) return null;
  const text = (decodeEntities(match[1] ?? "") ?? "").trim();
  return text.length === 0 ? null : text;
}

/** The HTML fragment of the section carrying one hook (empty when absent). */
function sectionOf(html: string, hook: string): string {
  const match = html.match(new RegExp(`${hook}(?:="[^"]*")?[^>]*>([\\s\\S]*?)<\\/section>`));
  return match === null ? "" : (match[1] ?? "");
}

/** Parse an integer or null. */
function numberOrNull(text: string | null): number | null {
  if (text === null) return null;
  const parsed = Number.parseInt(text.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}
