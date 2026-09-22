/**
 * @wfx/platform-contracts — the capability-AVAILABILITY contract (R26-W1).
 *
 * THE LAW THIS MODULE FREEZES (the R26 corrective takeover's first ask —
 * the production capability-truth law):
 *
 *   A capability whose production transport is unavailable must NEVER
 *   render as usable — it is either UNAVAILABLE BEFORE INTERACTION, or
 *   it carries an HONEST NEXT ACTION. Never a dead control, never a
 *   fake success, never "accepted in fixtures, silent in production".
 *
 * This is the adapter-side companion of the frozen capability-truth law
 * (`capabilities.ts` — what a PLATFORM can do): this module types what
 * the LIVE TRANSPORT SERVES. The two truths are orthogonal and both are
 * required for an honest surface:
 *
 * - `PlatformCapabilities` (frozen) — the device/adapter truth (Web has
 *   no native media; Desktop does). Static per platform.
 * - `CapabilityAvailabilityReport` (this module) — the per-process
 *   transport truth (is the semantic-search transport serving on THIS
 *   host? is the realtime bridge up? does the live catalog carry real
 *   source artwork?). Derived from the live binding, re-read per boot,
 *   never hardcoded, never guessed.
 *
 * The canonical capability kinds (the closed vocabulary — Web, Desktop
 * and future Mobile render from the SAME list; adding a kind is a
 * lead-ratified contract change):
 *
 * - `semantic-search`        — natural-language search-by-meaning over
 *                              the derived semantic index;
 * - `moment-retrieval`       — moment search + transcript/chapter/moment
 *                              reads with jump-to-timestamp paths;
 * - `multimodal-intelligence`— the per-item intelligence surfaces
 *                              (transcript/chapters/moments/provenance
 *                              beyond a single query);
 * - `realization-availability`— the Where-to-watch truth (provider /
 *                              authorized-peer / external realizations)
 *                              reflecting the live resolve transport;
 * - `realtime-bridge`        — the realtime translation bridge's health
 *                              (the R25 lane's WebSocket transport);
 * - `artwork`                — real source artwork (thumbnails/posters)
 *                              flowing through the shared content model.
 *
 * DETERMINISM: this module is PURE types + pure derivations. No clock,
 * no fetching, no environment reads — the host-layer binding derives
 * the report from its live seams.
 */

// ---------------------------------------------------------------------------
// The capability vocabulary (the closed union)
// ---------------------------------------------------------------------------

/**
 * One capability the live transport may serve — the closed canonical
 * vocabulary. The union is the machine-checked law: a surface may only
 * bind a capability truth for a kind in this list, so Web/Desktop/Mobile
 * can never drift into per-platform capability names.
 */
export type ServedCapabilityKind =
  | "semantic-search"
  | "moment-retrieval"
  | "multimodal-intelligence"
  | "realization-availability"
  | "realtime-bridge"
  | "artwork";

/** Every value of {@link ServedCapabilityKind}, in canonical order. */
export const SERVED_CAPABILITY_KINDS: readonly ServedCapabilityKind[] = [
  "semantic-search",
  "moment-retrieval",
  "multimodal-intelligence",
  "realization-availability",
  "realtime-bridge",
  "artwork",
] as const;

/** Runtime membership check against the capability union. */
export function isServedCapabilityKind(x: unknown): x is ServedCapabilityKind {
  return (
    typeof x === "string" &&
    (SERVED_CAPABILITY_KINDS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The typed serving truth
// ---------------------------------------------------------------------------

/**
 * The honest next action a not-served truth carries (the law: an
 * unavailable capability either renders unavailable BEFORE interaction,
 * or carries THIS — never a dead control). `label` is the product
 * sentence; `href` the optional in-product path; `detail` the optional
 * one-line explanation. The action must be REAL — a fabricated link is
 * a fake success by another name.
 */
export interface CapabilityNextAction {
  /** The primary action sentence (product vocabulary — concise). */
  readonly label: string;
  /** The optional in-product path the action opens. */
  readonly href?: string;
  /** The optional one-line detail under the action. */
  readonly detail?: string;
}

/**
 * ONE capability's serving truth through the LIVE transport. `kind`
 * discriminates:
 *
 * - `"served"` — the transport serves this capability on THIS host
 *   right now; `detail` names the serving transport honestly (e.g.
 *   "the dev fixture index" in the loud dev badge — a fixture is
 *   labeled a fixture, invariant 10).
 * - `"not-served"` — the transport does NOT serve it; `detail` is the
 *   honest reason naming WHAT is missing, and `nextAction` is present
 *   whenever a real product path exists (the law above).
 *
 * There is deliberately NO "partially-served" middle state: per-item
 * truth (a specific title lacking artwork, a specific item lacking a
 * transcript) belongs to the per-item reads, not this host-level
 * report. The report answers exactly one question — can a user who
 * reaches for this capability on this host be served by the live
 * transport at all?
 */
export type CapabilityServingTruth =
  | {
      readonly kind: "served";
      /** The transport that serves it (honest naming — fixtures say fixtures). */
      readonly transport: string;
      /** The one-sentence truth of what is served. */
      readonly detail: string;
    }
  | {
      readonly kind: "not-served";
      /** The transport that was probed (honest naming). */
      readonly transport: string;
      /** The honest reason — WHAT dependency is missing, never a euphemism. */
      readonly detail: string;
      /** The real next action when one exists (the law above). */
      readonly nextAction?: CapabilityNextAction;
    };

// ---------------------------------------------------------------------------
// The report (the UI-bindable truth)
// ---------------------------------------------------------------------------

/** One report row: a capability + its live serving truth. */
export interface CapabilityAvailabilityEntry {
  readonly capability: ServedCapabilityKind;
  readonly truth: CapabilityServingTruth;
}

/**
 * The host's capability-availability report — the ONE truth the UI binds
 * (every surface that renders a capability-first control consults the
 * entry for that capability; a not-served entry renders the unavailable
 * state or the next action, NEVER a usable control).
 */
export interface CapabilityAvailabilityReport {
  readonly entries: readonly CapabilityAvailabilityEntry[];
}

/** Structural guard for a claimed next action. */
export function isCapabilityNextAction(
  x: unknown,
): x is CapabilityNextAction {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (typeof record.label !== "string" || record.label.length === 0) {
    return false;
  }
  if (
    record.href !== undefined &&
    (typeof record.href !== "string" || record.href.length === 0)
  ) {
    return false;
  }
  if (
    record.detail !== undefined &&
    (typeof record.detail !== "string" || record.detail.length === 0)
  ) {
    return false;
  }
  return true;
}

/** Structural guard for a claimed serving truth. */
export function isCapabilityServingTruth(
  x: unknown,
): x is CapabilityServingTruth {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (typeof record.transport !== "string" || record.transport.length === 0) {
    return false;
  }
  if (typeof record.detail !== "string" || record.detail.length === 0) {
    return false;
  }
  if (record.kind === "served") return record.nextAction === undefined;
  if (record.kind === "not-served") {
    return record.nextAction === undefined || isCapabilityNextAction(record.nextAction);
  }
  return false;
}

/** Structural guard for one report row. */
export function isCapabilityAvailabilityEntry(
  x: unknown,
): x is CapabilityAvailabilityEntry {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  return (
    isServedCapabilityKind(record.capability) &&
    isCapabilityServingTruth(record.truth)
  );
}

/** Structural guard for a whole claimed report. */
export function isCapabilityAvailabilityReport(
  x: unknown,
): x is CapabilityAvailabilityReport {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (!Array.isArray(record.entries)) return false;
  return record.entries.every((entry) => isCapabilityAvailabilityEntry(entry));
}

// ---------------------------------------------------------------------------
// Pure derivations (the report fold the UI binding uses)
// ---------------------------------------------------------------------------

/**
 * Fold entries into a report, REJECTING unknown capabilities (the closed
 * vocabulary is the law — an entry naming an unlisted capability is
 * drift, and drift is an error, never a silent drop).
 */
export function capabilityAvailabilityReportOf(
  entries: readonly CapabilityAvailabilityEntry[],
): CapabilityAvailabilityReport {
  for (const entry of entries) {
    if (!isCapabilityAvailabilityEntry(entry)) {
      throw new Error(
        `capability-availability: an entry is not a truthful row (${JSON.stringify(
          entry,
        ).slice(0, 200)})`,
      );
    }
  }
  return { entries: [...entries] };
}

/** Read one capability's truth from a report (the UI binding's read). */
export function capabilityTruthOf(
  report: CapabilityAvailabilityReport,
  capability: ServedCapabilityKind,
): CapabilityServingTruth | null {
  const entry = report.entries.find((row) => row.capability === capability);
  return entry === undefined ? null : entry.truth;
}

/**
 * THE RENDER LAW, as a pure derivation the UI binding applies: whether
 * the capability may render as USABLE on this host. `served` ⇒ true;
 * `not-served` ⇒ false — the surface renders the unavailable state or
 * the truth's next action instead. A `null` (capability absent from the
 * report) is also FALSE: a capability the host did not even report is
 * not usable by construction.
 */
export function capabilityMayRenderAsUsable(
  report: CapabilityAvailabilityReport,
  capability: ServedCapabilityKind,
): boolean {
  const truth = capabilityTruthOf(report, capability);
  return truth !== null && truth.kind === "served";
}
