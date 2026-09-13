/**
 * @wfx/experience — library use-case (WFX-005, Lane C).
 *
 * Library access goes through the OPTIONAL port methods (`readLibrary` /
 * `writeLibrary`), gated by the connector's declared capability truth:
 * a connector without `libraryRead` / `libraryWrite` — or one that declares
 * the capability but does not expose the method — answers a TYPED
 * unsupported result (`{ ok: false, reason: "unsupported", ... }`,
 * mirroring the WFX-003 `ConnectorResult` convention). Never a thrown
 * crash, never an empty fake success.
 *
 * Write commands use the frozen `LibraryCommand` extension type; the
 * returned `ActionReceipt` is the source's own typed answer (its `status`
 * vocabulary — confirmed / local-only / unsupported / failed — carries the
 * source's truth; the experience result's `ok` reflects whether the
 * experience operation completed: capability present, command delivered).
 * A port that rejects or returns a malformed value/receipt/entry is typed
 * `port-failed` — caught, never crashed.
 */

import type { ActionReceipt, LibraryCommand, LibraryEntry } from "@wfx/domain";
import { isIso8601, isRecord, previewValue } from "@wfx/domain";

import {
  ExperienceError,
  assertValidExperienceContext,
  connectorHas,
  describeThrown,
  isUsableReceipt,
  type ExperienceContext,
  type ExperienceResult,
  type Ports,
} from "../ports";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for `saveToLibrary` (the `op: "add"` library command). */
export interface SaveToLibraryInput {
  externalRef: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

/** Input for `removeFromLibrary` (the `op: "remove"` library command). */
export interface RemoveFromLibraryInput {
  externalRef: string;
}

// ---------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The typed unsupported result for a missing library capability or method.
 * `capability` names what is missing; `detail` says which of the two gates
 * failed, so the answer is actionable.
 */
function unsupportedLibrary(
  ports: Ports,
  capability: "libraryRead" | "libraryWrite",
  method: "readLibrary" | "writeLibrary",
): ExperienceResult<never> {
  const id = ports.connector.descriptor().id;
  const declared = connectorHas(ports.connector, capability);
  return {
    ok: false,
    reason: "unsupported",
    capability,
    detail: declared
      ? `connector '${id}' declares '${capability}' but does not expose ${method}()`
      : `connector '${id}' does not declare '${capability}'`,
  };
}

/** Runtime shape check for one library entry; malformed entries are dropped. */
function isUsableLibraryEntry(value: unknown): value is LibraryEntry {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.connectorId)) return false;
  if (!isNonEmptyString(value.externalRef)) return false;
  if (typeof value.title !== "string" || value.title.length === 0) return false;
  if (value.addedAt !== undefined && !isIso8601(value.addedAt)) return false;
  if (value.metadata !== undefined && !isRecord(value.metadata)) return false;
  return true;
}

function assertValidExternalRefInput(input: unknown, kind: string): void {
  if (!isRecord(input)) {
    throw new ExperienceError(`input: expected a ${kind} object`);
  }
  if (!isNonEmptyString(input.externalRef)) {
    throw new ExperienceError(
      `input.externalRef: expected a non-empty string (after trim), got ${previewValue(input.externalRef)}`,
    );
  }
}

function assertValidSaveInput(input: SaveToLibraryInput): void {
  assertValidExternalRefInput(input, "SaveToLibraryInput");
  const problems: string[] = [];
  if (input.title !== undefined && typeof input.title !== "string") {
    problems.push(`input.title: expected a string when present, got ${previewValue(input.title)}`);
  }
  if (input.metadata !== undefined && !isRecord(input.metadata)) {
    problems.push(
      `input.metadata: expected an object when present, got ${previewValue(input.metadata)}`,
    );
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// getLibrary
// ---------------------------------------------------------------------------

/**
 * Read the connector-side library through the optional `readLibrary` port
 * method. A connector without the `libraryRead` capability (or without the
 * method) answers a typed unsupported result — never a thrown crash, never
 * an empty fake success. Malformed entries are dropped, never fabricated.
 */
export async function getLibrary(
  ports: Ports,
  ctx: ExperienceContext,
): Promise<ExperienceResult<LibraryEntry[]>> {
  assertValidExperienceContext(ctx);
  const connector = ports.connector;
  if (!connectorHas(connector, "libraryRead") || typeof connector.readLibrary !== "function") {
    return unsupportedLibrary(ports, "libraryRead", "readLibrary");
  }

  let entries: LibraryEntry[];
  try {
    entries = await connector.readLibrary(ctx);
  } catch (thrown) {
    return { ok: false, reason: "port-failed", operation: "readLibrary", detail: describeThrown(thrown) };
  }
  if (!Array.isArray(entries)) {
    return {
      ok: false,
      reason: "port-failed",
      operation: "readLibrary",
      detail: `readLibrary returned ${previewValue(entries)} (expected an array of LibraryEntry)`,
    };
  }
  return { ok: true, value: entries.filter(isUsableLibraryEntry) };
}

// ---------------------------------------------------------------------------
// saveToLibrary / removeFromLibrary
// ---------------------------------------------------------------------------

/**
 * Save an external item to the connector-side library (an
 * `op: "add"` `LibraryCommand` through `writeLibrary`). Same unsupported
 * semantics as `getLibrary`; the receipt is returned as the value — its
 * `status` carries the source's own answer.
 */
export async function saveToLibrary(
  ports: Ports,
  ctx: ExperienceContext,
  input: SaveToLibraryInput,
): Promise<ExperienceResult<ActionReceipt>> {
  assertValidExperienceContext(ctx);
  assertValidSaveInput(input);
  const connector = ports.connector;
  if (!connectorHas(connector, "libraryWrite") || typeof connector.writeLibrary !== "function") {
    return unsupportedLibrary(ports, "libraryWrite", "writeLibrary");
  }

  const command: LibraryCommand = { op: "add", externalRef: input.externalRef.trim() };
  if (input.title !== undefined) command.title = input.title;
  if (input.metadata !== undefined) command.metadata = input.metadata;

  let receipt: ActionReceipt;
  try {
    receipt = await connector.writeLibrary(ctx, command);
  } catch (thrown) {
    return { ok: false, reason: "port-failed", operation: "writeLibrary", detail: describeThrown(thrown) };
  }
  if (!isUsableReceipt(receipt)) {
    return {
      ok: false,
      reason: "port-failed",
      operation: "writeLibrary",
      detail: `writeLibrary returned ${previewValue(receipt)} (expected an ActionReceipt)`,
    };
  }
  return { ok: true, value: receipt };
}

/**
 * Remove an external item from the connector-side library (an
 * `op: "remove"` `LibraryCommand` through `writeLibrary`). Same semantics
 * as `saveToLibrary`.
 */
export async function removeFromLibrary(
  ports: Ports,
  ctx: ExperienceContext,
  input: RemoveFromLibraryInput,
): Promise<ExperienceResult<ActionReceipt>> {
  assertValidExperienceContext(ctx);
  assertValidExternalRefInput(input, "RemoveFromLibraryInput");
  const connector = ports.connector;
  if (!connectorHas(connector, "libraryWrite") || typeof connector.writeLibrary !== "function") {
    return unsupportedLibrary(ports, "libraryWrite", "writeLibrary");
  }

  const command: LibraryCommand = { op: "remove", externalRef: input.externalRef.trim() };

  let receipt: ActionReceipt;
  try {
    receipt = await connector.writeLibrary(ctx, command);
  } catch (thrown) {
    return { ok: false, reason: "port-failed", operation: "writeLibrary", detail: describeThrown(thrown) };
  }
  if (!isUsableReceipt(receipt)) {
    return {
      ok: false,
      reason: "port-failed",
      operation: "writeLibrary",
      detail: `writeLibrary returned ${previewValue(receipt)} (expected an ActionReceipt)`,
    };
  }
  return { ok: true, value: receipt };
}
