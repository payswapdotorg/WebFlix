/**
 * @wfx/connectors — the reference read-only connector (WFX-013).
 *
 * The golden-path implementation of the Connector SDK: a COMPLETE,
 * DETERMINISTIC, READ-ONLY connector over the bundled fixture catalog
 * (data.ts). It demonstrates every contract behavior a new connector
 * author should copy:
 *
 * - SUBCLASS `BaseConnector` and pass a strictly-validated descriptor to
 *   `super(...)`. The SDK's result surface then enforces — for free and in
 *   canonical guard order — the lifecycle assertion, `ConnectorContext`
 *   validation (typed `invalid-input`), and capability gating (typed
 *   `unsupported`), before any hook below runs.
 * - Implement the read hooks over pure fixture data: no network, no clock,
 *   no randomness.
 * - Be HONEST about the optional write surface: the descriptor does not
 *   declare `libraryWrite`, so `onWriteLibrary` is NOT implemented — the
 *   capability gate answers `writeLibraryResult` with a typed `unsupported`
 *   error and the inherited frozen-contract shim degrades it into a receipt
 *   with `status: "unsupported"` (never a fake success).
 * - Answer every mutating user action with a typed `unsupported` result:
 *   this connector is read-only BY DESIGN.
 *
 * Miss paths are typed successes, never throws:
 * - search with no matching tokens → ok, `[]`;
 * - unknown metadata ref → ok, `null`;
 * - unknown resolve ref → ok, `[]`.
 * (A truly empty/whitespace query is rejected by the SDK's canonical input
 * guard as `invalid-input` — see base.ts; a non-empty query that TOKENIZES
 * to nothing, e.g. "?!?", is the typed ok-empty path.)
 */

import type {
  ActionReceipt,
  ConnectorContext,
  LibraryEntry,
  PlaybackRealization,
  SearchResult,
  SourceItem,
  UserAction,
} from "@wfx/domain";

import { BaseConnector, type AsyncConnectorResultInput } from "../base";
import { unsupported } from "../result";

import {
  byReferencePrecedence,
  findReferenceCatalogEntry,
  REFERENCE_CATALOG,
  REFERENCE_LIBRARY,
  REFERENCE_SEARCH_INDEX,
  tokenize,
} from "./data";
import { REFERENCE_CONNECTOR_DESCRIPTOR } from "./descriptor";

// ---------------------------------------------------------------------------
// Deterministic search (tokenized title + topics, case-insensitive)
// ---------------------------------------------------------------------------

/** Weight of a query token matching a TITLE token. */
const TITLE_TOKEN_WEIGHT = 2;
/** Weight of a query token matching a TOPIC token. */
const TOPIC_TOKEN_WEIGHT = 1;

/** Remove duplicate tokens while preserving first-seen order. */
function dedupeTokens(tokens: readonly string[]): string[] {
  return [...new Set(tokens)];
}

/** Score one search document against the (deduplicated) query tokens. */
function scoreDocument(
  document: { readonly titleTokens: readonly string[]; readonly topicTokens: readonly string[] },
  queryTokens: readonly string[],
): number {
  let score = 0;
  for (const token of queryTokens) {
    if (document.titleTokens.includes(token)) score += TITLE_TOKEN_WEIGHT;
    else if (document.topicTokens.includes(token)) score += TOPIC_TOKEN_WEIGHT;
  }
  return score;
}

/** Map a catalog item to its search-result shape, carrying a 1-based rank. */
function toSearchResult(item: SourceItem, rank: number): SearchResult {
  const result: SearchResult = {
    connectorId: item.connectorId,
    externalRef: item.externalRef,
    title: item.title,
    metadata: { rank },
  };
  if (item.canonicalType !== undefined) result.canonicalType = item.canonicalType;
  if (item.durationMs !== undefined) result.durationMs = item.durationMs;
  if (item.orientation !== undefined) result.orientation = item.orientation;
  return result;
}

/**
 * Deterministic catalog search:
 * 1. tokenize + dedupe the query (case-insensitive);
 * 2. score every item (title token = 2, topic token = 1);
 * 3. keep items with score > 0, ordered by score DESC then stable catalog
 *    order ASC — a total order, so the result list and its ranks are
 *    identical for identical queries on any connector instance;
 * 4. rank = 1-based position, exposed in `metadata.rank`.
 *
 * A query with no usable tokens returns ok-empty — a miss, not an error.
 */
function searchCatalog(query: string): SearchResult[] {
  const queryTokens = dedupeTokens(tokenize(query));
  if (queryTokens.length === 0) return [];

  const hits: { catalogIndex: number; item: SourceItem; score: number }[] = [];
  REFERENCE_CATALOG.forEach((entry, catalogIndex) => {
    const document = REFERENCE_SEARCH_INDEX[catalogIndex];
    if (document === undefined) return; // unreachable: index is derived 1:1
    const score = scoreDocument(document, queryTokens);
    if (score > 0) hits.push({ catalogIndex, item: entry.item, score });
  });

  hits.sort((a, b) => b.score - a.score || a.catalogIndex - b.catalogIndex);
  return hits.map((hit, position) => toSearchResult(hit.item, position + 1));
}

// ---------------------------------------------------------------------------
// The reference connector
// ---------------------------------------------------------------------------

/**
 * Reason carried by every typed `unsupported` error this connector returns
 * for a mutating user action. The BaseConnector capability gate already
 * answers unsupported BEFORE any hook runs (the descriptor declares no
 * action capability); the hook restates it defensively so the read-only
 * guarantee survives even a future descriptor regression.
 */
const READ_ONLY_DETAIL =
  "the reference connector is read-only by design: user actions are never executed against fixture data";

/**
 * The reference read-only connector.
 *
 * Returned by `createReferenceConnector()` in the `registered` state — call
 * `initialize()` before use (the lifecycle demo shows the full FSM walk).
 * The typed result surface (`searchResult`, `metadataResult`, ...) is the
 * primary API; the frozen plain surface (`search`, `metadata`, ...) remains
 * available for contract compatibility and degrades typed errors honestly.
 */
export class ReferenceConnector extends BaseConnector {
  constructor() {
    // The descriptor is pre-validated + frozen by defineDescriptor at module
    // load; super() re-validates it strictly (defense in depth).
    super(REFERENCE_CONNECTOR_DESCRIPTOR);
  }

  /** Deterministic tokenized search over the fixture index. */
  protected override onSearch(
    _ctx: ConnectorContext,
    query: string,
  ): AsyncConnectorResultInput<SearchResult[]> {
    return searchCatalog(query);
  }

  /** Known ref → the frozen fixture item; unknown ref → null (never a throw). */
  protected override onMetadata(
    _ctx: ConnectorContext,
    ref: string,
  ): AsyncConnectorResultInput<SourceItem | null> {
    return findReferenceCatalogEntry(ref)?.item ?? null;
  }

  /**
   * Realizations for a ref, ordered by the frozen precedence hint
   * (embed before browser before external; native is undeclared and
   * therefore ABSENT). Unknown ref → [] (never a throw).
   *
   * The returned array is a fresh, precedence-sorted copy: callers may
   * reorder it freely without corrupting the fixture or later calls.
   * Realization objects themselves are shared frozen fixtures.
   */
  protected override onResolve(
    _ctx: ConnectorContext,
    ref: string,
  ): AsyncConnectorResultInput<PlaybackRealization[]> {
    const entry = findReferenceCatalogEntry(ref);
    if (entry === undefined) return [];
    return [...entry.realizations].sort(byReferencePrecedence);
  }

  /**
   * Read-only enforcement. Unreachable in practice — the descriptor declares
   * no action capability, so the result surface answers `unsupported` before
   * this hook runs — but kept explicit and defensive: every user action
   * (like / save / follow / comment / download / transform) is unsupported
   * with a clear reason string.
   */
  protected override onExecuteAction(
    _ctx: ConnectorContext,
    action: UserAction,
  ): AsyncConnectorResultInput<ActionReceipt> {
    return unsupported(action.type, READ_ONLY_DETAIL);
  }

  /**
   * Library READ over the deterministic fixture "saved" list.
   * (onWriteLibrary is deliberately NOT implemented: `libraryWrite` is
   * undeclared, so `writeLibraryResult` is gated to typed `unsupported`.)
   */
  protected override onReadLibrary(
    _ctx: ConnectorContext,
  ): AsyncConnectorResultInput<LibraryEntry[]> {
    return [...REFERENCE_LIBRARY];
  }
}

/**
 * Create the reference read-only connector (id `wfx-reference`).
 *
 * The return type is the concrete class so callers keep access to the
 * lifecycle (`initialize()` / `dispose()`) and the typed result surface
 * without casts; a `ReferenceConnector` is assignable to the frozen
 * `SourceConnector` contract everywhere (e.g. `ConnectorRegistry.register`).
 * Returned in the `registered` state — the caller drives the FSM.
 */
export function createReferenceConnector(): ReferenceConnector {
  return new ReferenceConnector();
}
