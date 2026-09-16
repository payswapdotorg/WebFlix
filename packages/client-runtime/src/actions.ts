/**
 * @wfx/client-runtime — action state (R01).
 *
 * The action-state semantics: `requested -> confirmed-locally |
 * confirmed-by-provider | unsupported | failed`. The frozen honesty laws:
 *
 * 1. UNSUPPORTED IS NEVER RENDERED AS SUCCESS — `unsupported` is a TERMINAL
 *    state with its own kind; there is NO transition from it (or `failed`)
 *    to any success-ish state. A fresh dispatch mints a fresh action.
 * 2. PLATFORM CAPABILITY GATING happens BEFORE server dispatch — a
 *    `download` action on a platform that truthfully lacks the native
 *    media/background capabilities settles `unsupported` immediately with
 *    the platform limitation named, never dispatched as theater.
 * 3. RECEIPT HONESTY — the server's frozen `ActionReceipt` maps 1:1:
 *    `confirmed` -> `confirmed-by-provider`, `local-only` ->
 *    `confirmed-locally` (recorded locally only — visibly distinct from
 *    provider confirmation), `unsupported` -> `unsupported`, `failed` ->
 *    `failed`. A transport failure settles `failed` with the failure
 *    detail — never a fabricated success, never a crash.
 * 4. OBSERVABILITY — every state change is subscribable; states are
 *    queryable by action id and item.
 *
 * Determinism: ids from the injected seam; timestamps from the injected
 * clock; no randomness, no globals.
 */

import type { ActionReceipt, UserAction } from "@wfx/domain";
import { isRecord, previewValue } from "@wfx/domain";
import type { PlatformCapabilities, Unsubscribe } from "@wfx/platform-contracts";
import { supportsTorrentAcquisition } from "@wfx/platform-contracts";

import { RuntimeError, serverFailureKind } from "./errors";
import type { RuntimeClock, RuntimeIdGen } from "./runtime-seams";
import type { ServerPort } from "./server-port";

/** The canonical action-id prefix (this package's vocabulary). */
export const ACTION_ID_PREFIX = "wfxact_";

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** The action state status vocabulary (the frozen remediation spec). */
export type ActionStateStatus =
  /** Submitted, awaiting the answer. */
  | "requested"
  /** Recorded locally only (the frozen `local-only` receipt). */
  | "confirmed-locally"
  /** Confirmed by the provider (the frozen `confirmed` receipt). */
  | "confirmed-by-provider"
  /** The capability is absent (platform or provider) — never success. */
  | "unsupported"
  | "failed";

/** Every value of `ActionStateStatus`, in union order. */
export const ACTION_STATE_STATUSES: readonly ActionStateStatus[] = [
  "requested",
  "confirmed-locally",
  "confirmed-by-provider",
  "unsupported",
  "failed",
];

/** The terminal action statuses (no transitions out — law 1). */
export const TERMINAL_ACTION_STATUSES: readonly ActionStateStatus[] = [
  "confirmed-locally",
  "confirmed-by-provider",
  "unsupported",
  "failed",
];

/** One action's state (the observable snapshot). */
export interface ActionState {
  /** Canonical action identity (`wfxact_` + ULID body). */
  readonly actionId: string;
  readonly action: UserAction;
  readonly status: ActionStateStatus;
  /** ISO timestamp of submission. */
  readonly requestedAt: string;
  /** ISO timestamp of settlement (present once terminal). */
  readonly settledAt?: string;
  /** The provider's external id when confirmed by provider. */
  readonly externalId?: string;
  /** Honest detail (failure/unsupported reasons). */
  readonly detail?: string;
  /** Which capability gate rejected it (platform-gated unsupported only). */
  readonly capabilityGate?: string;
}

/** Listener for action state changes. */
export type ActionStateListener = (state: ActionState) => void;

// ---------------------------------------------------------------------------
// Capability gating (law 2 — the platform truth table)
// ---------------------------------------------------------------------------

/**
 * Which platform capabilities each action type REQUIRES before the runtime
 * will dispatch it. `download` is the native-acquisition action: it needs
 * the torrent-capable native path (native media service + background
 * work) — Web truthfully has neither.
 */
export function actionCapabilityGate(
  capabilities: PlatformCapabilities,
  actionType: UserAction["type"],
): { readonly gate: string; readonly reason: string } | null {
  switch (actionType) {
    case "download": {
      if (!supportsTorrentAcquisition(capabilities)) {
        const limitation = capabilities.descriptor.limitations?.nativeMedia;
        const declared = `platform '${capabilities.platform}' declares nativeMedia: '${capabilities.nativeMedia}' and backgroundWork: '${capabilities.backgroundWork}' — authorized native acquisition requires the native-service path`;
        const reason =
          limitation !== undefined ? `${limitation} (${declared})` : declared;
        return { gate: "native-acquisition", reason };
      }
      return null;
    }
    default:
      // like/save/follow/comment/transform: no platform gate in R01 (the
      // provider answers capability truth through the receipt).
      return null;
  }
}

// ---------------------------------------------------------------------------
// Receipt mapping (law 3 — the 1:1 frozen mapping)
// ---------------------------------------------------------------------------

/** Map a frozen `ActionReceipt` status to the runtime action status. 1:1. */
export function receiptStatusToActionStatus(
  receipt: ActionReceipt,
): { status: ActionStateStatus; detail?: string } {
  switch (receipt.status) {
    case "confirmed":
      return { status: "confirmed-by-provider" };
    case "local-only":
      return {
        status: "confirmed-locally",
        detail: receipt.detail ?? "recorded locally only (no provider confirmation)",
      };
    case "unsupported":
      return { status: "unsupported", detail: receipt.detail ?? "the provider cannot perform this action" };
    case "failed":
      return { status: "failed", detail: receipt.detail ?? "the provider reported a failure" };
  }
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** The action operations surface (exposed via the runtime). */
export interface ActionOperations {
  /** One action's current state (undefined when unknown). */
  get(actionId: string): ActionState | undefined;
  /** Every action state for one item's source ref, newest first. */
  byItem(itemId: string): readonly ActionState[];
  /** Every action state, newest first. */
  all(): readonly ActionState[];
  /** Observe action state changes. */
  subscribe(listener: ActionStateListener): Unsubscribe;
}

/**
 * The action-state engine: dispatch, capability-gate, settle, observe.
 * Created by `createRuntime`; usable standalone in tests.
 */
export class ActionEngine {
  private readonly states = new Map<string, ActionState>();
  private readonly bySourceRef = new Map<string, string[]>();
  private readonly listeners = new Set<ActionStateListener>();

  constructor(
    private readonly server: ServerPort,
    private readonly capabilities: PlatformCapabilities,
    private readonly clock: RuntimeClock,
    private readonly ids: RuntimeIdGen,
  ) {}

  /**
   * Dispatch one user action and settle its state honestly. Returns the
   * SETTLED state (the sketch's `Promise<ActionState>`). Invalid input
   * throws the typed `RuntimeError`; every other outcome is an honest
   * in-band state.
   */
  async dispatch(action: UserAction): Promise<ActionState> {
    assertValidUserAction(action);
    const actionId = ACTION_ID_PREFIX + this.ids.next();
    const requestedAt = new Date(this.clock.now()).toISOString();
    let state: ActionState = { actionId, action: { ...action }, status: "requested", requestedAt };
    this.record(state);

    // Law 2: platform capability gating BEFORE dispatch.
    const gate = actionCapabilityGate(this.capabilities, action.type);
    if (gate !== null) {
      state = this.settle(state, "unsupported", gate.reason, gate.gate);
      return state;
    }

    let receipt: ActionReceipt;
    const result = await this.server.executeAction({ ...action });
    if (result.ok) {
      receipt = result.value;
    } else {
      // Law 3: a transport failure settles `failed` with the mapped
      // failure detail — never fabricated success, never a crash.
      return this.settle(
        state,
        "failed",
        `${serverFailureKind(result.failure)}: ${result.failure.detail}`,
      );
    }

    const mapped = receiptStatusToActionStatus(receipt);
    state = this.settle(
      state,
      mapped.status,
      mapped.detail,
      undefined,
      receipt.externalId,
    );
    return state;
  }

  private settle(
    state: ActionState,
    status: ActionStateStatus,
    detail?: string,
    capabilityGate?: string,
    externalId?: string,
  ): ActionState {
    const settled: ActionState = {
      ...state,
      status,
      settledAt: new Date(this.clock.now()).toISOString(),
      ...(detail !== undefined ? { detail } : {}),
      ...(capabilityGate !== undefined ? { capabilityGate } : {}),
      ...(externalId !== undefined ? { externalId } : {}),
    };
    this.record(settled);
    return settled;
  }

  private record(state: ActionState): void {
    this.states.set(state.actionId, state);
    const key = sourceRefKey(state.action);
    const list = this.bySourceRef.get(key) ?? [];
    if (!list.includes(state.actionId)) list.push(state.actionId);
    this.bySourceRef.set(key, list);
    for (const listener of this.listeners) listener(state);
  }

  /** The operations surface (queries + subscription). */
  operations(): ActionOperations {
    return {
      get: (actionId) => this.states.get(actionId),
      byItem: (itemId) =>
        (this.bySourceRef.get(itemId) ?? [])
          .map((id) => this.states.get(id))
          .filter((state): state is ActionState => state !== undefined)
          .reverse(),
      all: () =>
        [...this.states.values()].sort((a, b) =>
          a.actionId < b.actionId ? 1 : a.actionId > b.actionId ? -1 : 0,
        ),
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
    };
  }
}

/** The registry key of one action (its source ref). */
function sourceRefKey(action: UserAction): string {
  return `${action.connectorId}:${action.externalRef}`;
}

/** Validate a claimed `UserAction` (caller misuse — typed throw). */
export function assertValidUserAction(action: UserAction): void {
  if (!isRecord(action)) {
    throw new RuntimeError("invalid-input", `action: expected a UserAction object, got ${previewValue(action)}`);
  }
  const types: readonly string[] = ["like", "save", "follow", "comment", "download", "transform"];
  if (typeof action.type !== "string" || !types.includes(action.type)) {
    throw new RuntimeError(
      "invalid-input",
      `action.type: expected one of ${types.join(" | ")}, got ${previewValue(action.type)}`,
    );
  }
  if (typeof action.connectorId !== "string" || action.connectorId.length === 0) {
    throw new RuntimeError(
      "invalid-input",
      `action.connectorId: expected a non-empty string, got ${previewValue(action.connectorId)}`,
    );
  }
  if (typeof action.externalRef !== "string" || action.externalRef.length === 0) {
    throw new RuntimeError(
      "invalid-input",
      `action.externalRef: expected a non-empty string, got ${previewValue(action.externalRef)}`,
    );
  }
  if (action.payload !== undefined && !isRecord(action.payload)) {
    throw new RuntimeError(
      "invalid-input",
      `action.payload: expected a record when present, got ${previewValue(action.payload)}`,
    );
  }
}
