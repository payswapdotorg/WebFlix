/**
 * @wfx/experience — user action use-case (WFX-005, Lane C).
 *
 * `runUserAction` executes a `UserAction` through the port's
 * `executeAction` and returns the typed `ActionReceipt` as the value — the
 * receipt's `status` is the source's own answer (confirmed / local-only /
 * unsupported / failed; product-boundaries: "The UI distinguishes local
 * WebFlix state from confirmed external synchronization").
 *
 * Capability pre-check: when the connector does not DECLARE the capability
 * for the action's own type (`UserAction.type` is a member of the frozen
 * `Capability` union), the action never reaches the port — the caller gets a
 * typed, actionable unsupported result naming the capability.
 *
 * Event mirror: when the connector CONFIRMS the action, it is mirrored as
 * the matching frozen `EntertainmentEvent` through the EventSink. The mirror
 * map is CLOSED by the frozen event vocabulary: `like → "like"` and
 * `save → "save"` exist; `follow`, `comment`, `download`, and `transform`
 * have NO frozen event types, so those actions return receipts but are NOT
 * mirrored — inventing event types would be frozen-contract drift.
 *
 * The canonical `itemId`: a mirror-able action request MUST carry the
 * canonical entertainment-item ID it targets — the frozen engagement event
 * cannot exist without the canonical item identity (the action's
 * `externalRef` is source-external and cannot stand in for it).
 */

import type { ActionReceipt, EntertainmentEvent, UserAction } from "@wfx/domain";
import { isEntertainmentItemId, isRecord, previewValue } from "@wfx/domain";

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
import { composeExperienceEvent } from "./events";

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/** The closed `UserAction.type` vocabulary (runtime mirror of the frozen union). */
export const USER_ACTION_TYPES = [
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
] as const satisfies readonly UserAction["type"][];

const USER_ACTION_TYPE_SET: ReadonlySet<string> = new Set(USER_ACTION_TYPES);

/**
 * The closed action→event mirror map. Only `like` and `save` have matching
 * frozen `EntertainmentEvent` types; `follow` / `comment` / `download` /
 * `transform` are intentionally absent (no frozen event type exists — see
 * module docs). Extend only when the frozen contract does.
 */
export const ACTION_EVENT_MIRRORS: Readonly<
  Partial<Record<UserAction["type"], EntertainmentEvent["type"]>>
> = {
  like: "like",
  save: "save",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A user action bound to the canonical item it targets. `itemId` is REQUIRED
 * for mirror-able actions (`like`, `save`) — the frozen engagement event
 * cannot exist without the canonical item identity — and unnecessary for
 * the others (no frozen event type to mirror).
 */
export interface ActionRequest extends UserAction {
  itemId?: string;
}

// ---------------------------------------------------------------------------
// Input validation (caller misuse — typed throw)
// ---------------------------------------------------------------------------

function assertValidActionRequest(action: ActionRequest, portConnectorId: string): void {
  if (!isRecord(action)) {
    throw new ExperienceError("action: expected an ActionRequest object");
  }
  const problems: string[] = [];
  const typeKnown = typeof action.type === "string" && USER_ACTION_TYPE_SET.has(action.type);
  if (!typeKnown) {
    problems.push(
      `action.type: expected one of ${USER_ACTION_TYPES.join(" | ")}, got ${previewValue(action.type)}`,
    );
  }
  if (typeof action.connectorId !== "string" || action.connectorId.trim().length === 0) {
    problems.push(
      `action.connectorId: expected a non-empty string, got ${previewValue(action.connectorId)}`,
    );
  } else if (action.connectorId !== portConnectorId) {
    // The SDK's validation map: an action is bound to its own connector.
    problems.push(
      `action targets connector '${action.connectorId}' but the port is '${portConnectorId}'`,
    );
  }
  if (typeof action.externalRef !== "string" || action.externalRef.trim().length === 0) {
    problems.push(
      `action.externalRef: expected a non-empty string, got ${previewValue(action.externalRef)}`,
    );
  }
  if (action.payload !== undefined && !isRecord(action.payload)) {
    problems.push(
      `action.payload: expected an object when present, got ${previewValue(action.payload)}`,
    );
  }

  if (typeKnown) {
    const mirror = ACTION_EVENT_MIRRORS[action.type as UserAction["type"]];
    if (mirror !== undefined && !isEntertainmentItemId(action.itemId)) {
      problems.push(
        `action.itemId: required for '${String(action.type)}' actions (the engagement event mirror needs the canonical item identity) — expected a canonical entertainment-item ID (wfxitm_ prefix + 26-char Crockford Base32 ULID body), got ${previewValue(action.itemId)}`,
      );
    }
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

// ---------------------------------------------------------------------------
// runUserAction
// ---------------------------------------------------------------------------

/**
 * Execute one user action through the port and return the typed receipt.
 *
 * - Capability pre-check: the connector must declare the action type's own
 *   capability, otherwise a typed `unsupported` result naming the
 *   capability is returned — the port is never called.
 * - The receipt is returned as the value under `ok: true`; its `status`
 *   carries the source's answer (including "unsupported"/"failed" when the
 *   capability is declared but the source declines at runtime).
 * - When the connector CONFIRMS a mirror-able action (like/save), the
 *   matching frozen engagement event is emitted through the EventSink.
 *   Local-only receipts are NOT mirrored (only connector confirmation is,
 *   per the task contract; WFX-022 owns the local/external sync story).
 * - A port that rejects or returns a malformed receipt is typed
 *   `port-failed` — caught, never crashed.
 */
export async function runUserAction(
  ports: Ports,
  ctx: ExperienceContext,
  action: ActionRequest,
): Promise<ExperienceResult<ActionReceipt>> {
  assertValidExperienceContext(ctx);
  assertValidActionRequest(action, ports.connector.descriptor().id);

  const connector = ports.connector;
  if (!connectorHas(connector, action.type)) {
    return {
      ok: false,
      reason: "unsupported",
      capability: action.type,
      detail: `connector '${connector.descriptor().id}' does not declare '${action.type}'`,
    };
  }

  let receipt: ActionReceipt;
  try {
    receipt = await connector.executeAction(ctx, action);
  } catch (thrown) {
    return {
      ok: false,
      reason: "port-failed",
      operation: "executeAction",
      detail: describeThrown(thrown),
    };
  }
  if (!isUsableReceipt(receipt)) {
    return {
      ok: false,
      reason: "port-failed",
      operation: "executeAction",
      detail: `executeAction returned ${previewValue(receipt)} (expected an ActionReceipt)`,
    };
  }

  const mirror = ACTION_EVENT_MIRRORS[action.type];
  const itemId = action.itemId;
  if (receipt.status === "confirmed" && mirror !== undefined && itemId !== undefined) {
    await ports.events.emit(
      composeExperienceEvent(ports.clock, ctx, {
        itemId,
        type: mirror,
      }),
    );
  }
  return { ok: true, value: receipt };
}
