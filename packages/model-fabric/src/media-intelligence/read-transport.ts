/**
 * @wfx/model-fabric — the intelligence READ TRANSPORT contract (R26-W1).
 *
 * THE LAW THIS MODULE BINDS (the R26 corrective takeover's third ask —
 * "restore the semantic/moment-search transport"):
 *
 *   The intelligence/semantic lane is served by a TRANSPORT, never by a
 *   host-mode fixture gate. Every read answers the typed SERVED /
 *   NOT-SERVED truth: a transport that cannot serve names the exact
 *   missing dependency — never an approximation, never a fake result,
 *   never "accepted in fixtures, silently off in production".
 *
 * THE HISTORICAL DEFECT THIS CONTRACT CLOSES: the web host served
 * semantic search / moment retrieval / item intelligence ONLY when
 * `host.mode === "fixtures"` (dev-only by law — fixtures must never
 * boot in production), so production service mode answered the honest
 * empty state while R23's completion claims said "production-verified
 * semantic search". The defect was structural: the READ was gated on a
 * MODE instead of bound to a TRANSPORT. This module is the canonical
 * seam the hosts bind instead:
 *
 * - FIXTURES boot binds the fixture transport (the deterministic dev
 *   index — loudly a fixture, invariant 10);
 * - SERVICE boot binds the HTTP transport over the Experience API
 *   (`GET {base}/experience/intelligence?q=|item=` — the wire contract
 *   below), which answers the SAME typed outcome. The service-side
 *   route is the one dependency this transport names honestly when it
 *   is absent (the API lane owns implementing it — the web host lights
 *   up with zero host changes the day it lands, because the wire
 *   vocabulary is ONE contract).
 *
 * THE R23-F OWNERSHIP LAW (carried verbatim): search results carry
 * contributing-model PROVENANCE, never authority; the Recommendation
 * OS owns user policy. The R23-K anonymous boundary: these reads are
 * LOW-COST — they serve anonymous viewers with typed states, never a
 * login wall.
 *
 * DETERMINISM: pure types + pure guards. No clock, no fetching, no
 * environment — the transports own the effects; this contract owns the
 * vocabulary both sides must speak.
 */

import type { ArtifactModelMetadata, MediaIntelligenceArtifacts } from "./artifacts";

// ---------------------------------------------------------------------------
// The typed read outcome (the served / not-served envelope)
// ---------------------------------------------------------------------------

/**
 * The closed not-served reason vocabulary — WHAT is missing, honestly:
 *
 * - `"transport-unavailable"` — the transport binding itself cannot
 *   serve (the service route is absent, the host is offline, the boot
 *   never wired the seam). The capability renders unavailable BEFORE
 *   interaction — or carries the honest next action.
 * - `"no-derived-artifacts"` — the transport serves, but THIS item has
 *   no derived intelligence yet (the per-item honest absence — the
 *   R23-H prerequisite law territory, preserved as a typed state).
 */
export type IntelligenceReadNotServedReason =
  | "transport-unavailable"
  | "no-derived-artifacts";

/** The honest next action a not-served read carries (the product path). */
export interface IntelligenceReadNextAction {
  /** The primary action sentence (product vocabulary — concise). */
  readonly label: string;
  /** The optional in-product path the action opens. */
  readonly href?: string;
  /** The optional one-line detail under the action. */
  readonly detail?: string;
}

/**
 * ONE not-served outcome: the reason, the honest sentence, the exact
 * missing DEPENDENCY (what a deployer/lead must land to turn this
 * served), and the real next action when one exists.
 */
export interface IntelligenceReadNotServed {
  readonly kind: "not-served";
  readonly reason: IntelligenceReadNotServedReason;
  /** The honest one-sentence truth (rendered verbatim by surfaces). */
  readonly detail: string;
  /**
   * The exact missing dependency, named for the person who can land it
   * (e.g. "the Experience API transport does not expose
   * /experience/intelligence yet — the service-side route is the
   * missing dependency"). Never a euphemism.
   */
  readonly dependency: string;
  /** The real next action when one exists (never fabricated). */
  readonly nextAction?: IntelligenceReadNextAction;
}

/** The served outcome (the typed value rides verbatim). */
export interface IntelligenceReadServed<T> {
  readonly kind: "served";
  readonly value: T;
}

/**
 * The read envelope every intelligence read answers — the SAME shape
 * over every transport (fixture, HTTP, future native). A caller NEVER
 * has to know which transport served.
 */
export type IntelligenceReadOutcome<T> =
  | IntelligenceReadServed<T>
  | IntelligenceReadNotServed;

// ---------------------------------------------------------------------------
// The search read (search-by-meaning + moment search — the R23-H reads)
// ---------------------------------------------------------------------------

/** One title-level semantic search result row (the contract shape). */
export interface IntelligenceSearchResultRow {
  /** The canonical item the row resolves to. */
  readonly itemId: string;
  /** The source connector of the matched item. */
  readonly connectorId: string;
  /** The item's external reference at that connector. */
  readonly externalRef: string;
  /** The item's title (display). */
  readonly title: string;
  /** The best-matching index entry's text (why this title matched). */
  readonly matchedText: string;
  /** The relevance score in [0, 1] (the scorer's own scale, carried honestly). */
  readonly score: number;
}

/** One moment-level search result row (the jump-to-timestamp truth). */
export interface IntelligenceMomentResultRow {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  /** The moment's span (the jump path's target). */
  readonly startMs: number;
  readonly endMs: number;
  /** What the moment IS (the description the index carries). */
  readonly description: string;
  /** The matched transcript text when one backed the match (honest absence otherwise). */
  readonly matchedText: string | null;
  readonly score: number;
}

/**
 * The search-by-meaning read: the meaning rows, the moment rows, the
 * honest contributing-model provenance (every model that produced the
 * matched signals — R23-H's ownership law), and the prerequisite truth
 * (whether search-by-meaning prerequisites exist for the indexed set).
 */
export interface IntelligenceSearchRead {
  readonly meaning: readonly IntelligenceSearchResultRow[];
  readonly moments: readonly IntelligenceMomentResultRow[];
  /** The honest provenance of the matched signals (contributing models). */
  readonly provenance: readonly ArtifactModelMetadata[];
  /** Whether search-by-meaning ran (its prerequisite truth per item). */
  readonly meaningSearchAvailable: boolean;
}

// ---------------------------------------------------------------------------
// The item read (transcript / chapters / moments / features per item)
// ---------------------------------------------------------------------------

/**
 * One item's intelligence read: the artifact set (the R23-F typed
 * shapes, carried verbatim) plus the item-level legal-audio truth
 * (R23-G's gate — whether an audio stream is lawfully reachable; the
 * realtime lane consults the same truth).
 */
export interface IntelligenceItemRead {
  readonly artifacts: MediaIntelligenceArtifacts;
  /** The item's legal-audio truth (fail-closed; never guessed). */
  readonly audioStreamLegallyAvailable: boolean;
}

// ---------------------------------------------------------------------------
// The transport port (the ONE seam the hosts bind)
// ---------------------------------------------------------------------------

/**
 * The transport's own serving truth — the capability contract's read.
 * `"serving"` names the transport honestly (a fixture says fixture);
 * `"not-serving"` names the exact missing dependency. Determined by the
 * transport binding at boot/first read — never hardcoded per surface.
 */
export type IntelligenceTransportReadiness =
  | {
      readonly kind: "serving";
      /** The honest transport name (e.g. "dev-fixture-index", "experience-api-http"). */
      readonly transport: string;
      readonly detail: string;
    }
  | {
      readonly kind: "not-serving";
      readonly transport: string;
      readonly detail: string;
      /** The exact missing dependency (the escalation sentence). */
      readonly dependency: string;
    };

/**
 * The provider-neutral intelligence READ transport — the canonical seam
 * (fixture double, Experience-API HTTP binding, future native binding).
 * The web host, the desktop host, and the service side all speak THIS
 * interface; no host branches on its own boot mode to decide whether
 * intelligence exists.
 */
export interface IntelligenceReadTransport {
  /** The honest transport identity (rendered in diagnostics/provenance). */
  readonly transportId: string;
  /** The transport's own serving truth (the capability report's read). */
  readiness(): IntelligenceTransportReadiness;
  /** Search by meaning + moments over the served index. */
  searchByMeaning(query: string): Promise<IntelligenceReadOutcome<IntelligenceSearchRead>>;
  /** One item's derived artifacts + legal-audio truth. */
  itemArtifacts(externalRef: string): Promise<IntelligenceReadOutcome<IntelligenceItemRead>>;
}

// ---------------------------------------------------------------------------
// The HTTP wire vocabulary (the Experience API's intelligence route)
// ---------------------------------------------------------------------------

/**
 * THE WIRE CONTRACT (the service-side route this transport consumes —
 * the dependency the API lane lands):
 *
 * | Read             | HTTP                                     | Query              |
 * |------------------|------------------------------------------|--------------------|
 * | search-by-meaning| `GET {base}/experience/intelligence`     | `?q=<query>`       |
 * | item artifacts   | `GET {base}/experience/intelligence`     | `?item=<extRef>`   |
 *
 * The 200 body is the JSON of {@link IntelligenceReadOutcome} —
 * `{ kind: "served", value }` or `{ kind: "not-served", reason, detail,
 * dependency, nextAction? }`. A 404/405 (route absent on the deployed
 * service) is the transport's typed `transport-unavailable` outcome
 * with the dependency named; 5xx/4xx are typed outcomes too; non-JSON
 * or wrong-shaped bodies are REJECTED as `transport-unavailable`
 * (malformed payloads never fabricate a served read — drift is
 * rejected, never coerced).
 */
export const INTELLIGENCE_READ_ROUTE_PATH = "/experience/intelligence" as const;

/** The query parameter carrying the semantic query (`?q=`). */
export const INTELLIGENCE_READ_QUERY_PARAM = "q" as const;

/** The query parameter carrying the item reference (`?item=`). */
export const INTELLIGENCE_READ_ITEM_PARAM = "item" as const;

// ---------------------------------------------------------------------------
// Wire guards (untyped HTTP bodies never become contract data)
// ---------------------------------------------------------------------------

/** Guard: a claimed not-served outcome over the wire. */
export function isIntelligenceReadNotServedWire(
  x: unknown,
): x is IntelligenceReadNotServed {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (record.kind !== "not-served") return false;
  if (
    record.reason !== "transport-unavailable" &&
    record.reason !== "no-derived-artifacts"
  ) {
    return false;
  }
  if (typeof record.detail !== "string" || record.detail.length === 0) return false;
  if (typeof record.dependency !== "string" || record.dependency.length === 0) {
    return false;
  }
  const nextAction = record.nextAction;
  if (nextAction === undefined) return true;
  if (typeof nextAction !== "object" || nextAction === null) return false;
  const action = nextAction as Record<string, unknown>;
  if (typeof action.label !== "string" || action.label.length === 0) return false;
  if (action.href !== undefined && typeof action.href !== "string") return false;
  if (action.detail !== undefined && typeof action.detail !== "string") return false;
  return true;
}

/** Guard: a claimed served search read over the wire. */
export function isIntelligenceSearchReadWire(
  x: unknown,
): x is IntelligenceSearchRead {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (!Array.isArray(record.meaning) || !Array.isArray(record.moments)) {
    return false;
  }
  if (typeof record.meaningSearchAvailable !== "boolean") return false;
  if (!Array.isArray(record.provenance)) return false;
  const rowShape = (row: unknown): boolean => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return (
      typeof r.itemId === "string" &&
      typeof r.connectorId === "string" &&
      typeof r.externalRef === "string" &&
      typeof r.title === "string" &&
      typeof r.score === "number" &&
      Number.isFinite(r.score)
    );
  };
  const meaningOk = record.meaning.every((row) => {
    if (!rowShape(row)) return false;
    const r = row as Record<string, unknown>;
    return typeof r.matchedText === "string";
  });
  if (!meaningOk) return false;
  const momentsOk = record.moments.every((row) => {
    if (!rowShape(row)) return false;
    const r = row as Record<string, unknown>;
    return (
      typeof r.startMs === "number" &&
      typeof r.endMs === "number" &&
      typeof r.description === "string" &&
      (r.matchedText === null || typeof r.matchedText === "string")
    );
  });
  return momentsOk;
}

/** Guard: a claimed served item read over the wire (the artifacts must pass the R23-F validation shapes). */
export function isIntelligenceItemReadWire(
  x: unknown,
): x is IntelligenceItemRead {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (typeof record.audioStreamLegallyAvailable !== "boolean") return false;
  const artifacts = record.artifacts;
  if (typeof artifacts !== "object" || artifacts === null) return false;
  const a = artifacts as Record<string, unknown>;
  if (typeof a.itemId !== "string" || a.itemId.length === 0) return false;
  // Every PRESENT artifact must pass its honest-provenance shape; absent
  // artifacts are absent (the R23-F law). The full per-artifact
  // validation stays the artifacts module's own guard set; the transport
  // requires the envelope + itemId and rejects non-record artifacts.
  const artifactKeys = [
    "transcript",
    "speechEvents",
    "chaptersScenes",
    "visualConcepts",
    "videoEmbedding",
    "textEmbedding",
    "searchableMoments",
    "semanticIndex",
  ] as const;
  for (const key of artifactKeys) {
    const value = a[key];
    if (value === undefined) continue;
    if (typeof value !== "object" || value === null) return false;
  }
  return true;
}
