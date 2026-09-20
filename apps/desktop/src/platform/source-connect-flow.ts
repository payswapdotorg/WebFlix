/**
 * @wfx/app-desktop — the Desktop source connect flow (R22-H).
 *
 * THE ADAPTER-OWNED SOURCE FLOWS (the sources.ts layering law: "the
 * ADAPTER owns the flows"). The shared runtime owns the source STATE
 * (the read model + the observe/refresh machinery); this module runs the
 * platform-native connect/reauthorize journeys against the service's
 * documented source-management routes, through the Desktop's REAL native
 * affordances:
 *
 * - `provider-signin` (oauth): the CONTAINED BROWSER SURFACE with cookie
 *   isolation and `purpose: "authorization"` (the R09 browser-host law:
 *   navigation OBSERVED, never steered; no script injection, no
 *   credential capture). The service answers the authorization URL; the
 *   user signs in on the provider's own page; the provider redirects the
 *   surface to the service's documented callback route (the redirect
 *   completes the flow server-side); the adapter observes that
 *   navigation, closes the surface, and verifies the connected truth
 *   through a fresh sources read — never an assumed success.
 * - `device-code`: the service answers the provider's verification URL +
 *   the poll cadence; the surface renders the instructions; the HOST
 *   drives poll steps (`poll()` — no hidden timers, the repo's cadence
 *   law); each poll reads the sources truth and settles only on the
 *   server-side transition (or the pending's honest expiry).
 * - `access-key` (local): the credential crosses the typed command once
 *   and connects directly; the completion is VERIFIED through a fresh
 *   sources read.
 * - `no-signin` (none): connects directly (nothing to authorize); the
 *   completion is verified the same way.
 *
 * HONESTY LAWS:
 * - every state that completed a verifying read carries the refreshed
 *   {@link SourceInfo} row (the observed truth the first-run surface
 *   reports into the shared runtime through `runtime.sources.observe` —
 *   including mid-flow `authorizing` rows, which the R22-A catalog
 *   derives its `connecting` truth from), EXCEPT the user non-events
 *   (`dismissed`) — a closed surface is a normal non-event, never an
 *   error, never a fabricated connection;
 * - `denied` (the provider refused / the row did not connect) and
 *   `failed` (transport failures) carry the typed recovery next action
 *   (the R17 recovery vocabulary — reauthorize / retry / sign-in-again);
 * - `expired` (the device pending elapsed) carries the honest retry;
 * - a second `start` for a connector with a LIVE flow answers the live
 *   flow's current view (no duplicate surfaces, no superseded states);
 * - the one live surface per flow is closed on every terminal transition
 *   and on `cancel` (no leaked authorization windows).
 *
 * Determinism: no clock of its own (the service's expiresAt truth +
 * the caller's now stamp settle expiries); no hidden timers (the host
 * drives polls); the shell's events drive the surface transitions.
 */

import type { SourceInfo } from "@wfx/client-runtime";
import { isUsableSourceInfo } from "@wfx/client-runtime";

import type { ShellIpc } from "./shell-ipc";
import type {
  DesktopAuthTransport,
  DesktopConnectAnswer,
} from "./auth-transport";

// ---------------------------------------------------------------------------
// The flow state vocabulary
// ---------------------------------------------------------------------------

/** One connect/reauthorize flow's journey state. */
export type DesktopSourceFlowState =
  /** oauth: the contained authorization surface is open and observed. */
  | "authorization-surface"
  /** device: the provider instructions are rendered; polls are pending. */
  | "awaiting-provider"
  /** the flow's verifying read is in flight (post-callback / direct). */
  | "completing"
  /** terminal: the row verified connected. */
  | "completed"
  /** terminal: the provider refused or the row did not connect. */
  | "denied"
  /** terminal: the user closed the surface before completing (a non-event). */
  | "dismissed"
  /** terminal: the device pending elapsed before the provider approved. */
  | "expired"
  /** terminal: the flow failed (transport / verification failures). */
  | "failed";

/** The typed recovery next action of a non-completed terminal state. */
export interface DesktopSourceFlowRecovery {
  readonly kind: "reauthorize" | "retry" | "sign-in-again";
  readonly label: string;
  readonly detail: string;
}

/** One live or terminal connect/reauthorize flow's complete view. */
export interface DesktopSourceFlowView {
  readonly connectorId: string;
  /** The flow kind that ran (the connector's method truth). */
  readonly method: "provider-signin" | "device-code" | "access-key" | "no-signin";
  readonly state: DesktopSourceFlowState;
  /** The state's user label (one derivation source). */
  readonly stateLabel: string;
  /** One honest sentence about the state. */
  readonly stateDetail: string;
  /** The typed recovery (present iff the state is a recoverable terminal). */
  readonly recovery: DesktopSourceFlowRecovery | null;
  /** oauth: the contained authorization surface's id (null otherwise). */
  readonly surfaceId: string | null;
  /** device: the provider's verification URL (null otherwise). */
  readonly verificationUrl: string | null;
  /** device: the service's poll cadence in seconds (null otherwise). */
  readonly pollIntervalSeconds: number | null;
  /** oauth/device: the pending authorization's expiry (ISO instant). */
  readonly expiresAt: string | null;
  /**
   * The refreshed observed row (present on every state that completed a
   * verifying read — including the mid-flow `authorizing` rows; absent on
   * user non-events and pre-read failures).
   */
  readonly row: SourceInfo | null;
}

/** The start input (one connect or reauthorize attempt). */
export interface DesktopSourceFlowStartInput {
  /** The session token (the flows are account actions). */
  readonly token: string;
  readonly connectorId: string;
  /** local-flow credentials (the access key — never stored, never logged). */
  readonly credential?: string;
  /** Re-run the flow for an existing connection (expired/failed/refresh). */
  readonly reauthorize?: boolean;
  /**
   * The connector's method (the R22-A catalog's own truth) — carried onto
   * begin-failure views so a failed start still renders honestly.
   */
  readonly methodHint?: DesktopSourceFlowView["method"];
}

/** The outcome of {@link DesktopSourceConnectFlow.start}. */
export type DesktopSourceFlowStartResult =
  | { readonly ok: true; readonly view: DesktopSourceFlowView }
  | { readonly ok: false; readonly view: DesktopSourceFlowView };

// ---------------------------------------------------------------------------
// The frozen copy (the one derivation source — user vocabulary)
// ---------------------------------------------------------------------------

const STATE_LABELS: Readonly<Record<DesktopSourceFlowState, string>> = {
  "authorization-surface": "Waiting for you to sign in",
  "awaiting-provider": "Waiting for the provider",
  completing: "Finishing the connection",
  completed: "Connected",
  denied: "Not connected",
  dismissed: "Canceled",
  expired: "Sign-in window elapsed",
  failed: "Connection failed",
};

const STATE_DETAILS: Readonly<Record<DesktopSourceFlowState, string>> = {
  "authorization-surface":
    "Finish signing in on the source's own page — WebFlix returns here when it completes.",
  "awaiting-provider":
    "Approve the connection on the source's website — WebFlix checks for the approval when you refresh.",
  completing: "The connection is being confirmed with the service.",
  completed: "This source is connected and ready to use.",
  denied: "The source did not complete the sign-in — you can try again.",
  dismissed: "You closed the sign-in page before it completed — nothing was connected.",
  expired: "The sign-in window elapsed before the source approved — you can start again.",
  failed: "The connection attempt failed — the honest reason is stated with it.",
};

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopSourceConnectFlow}. */
export interface DesktopSourceConnectFlowOptions {
  /** The live native shell (the contained authorization surfaces). */
  readonly shell: ShellIpc;
  /** The Desktop account/source transport (the documented routes). */
  readonly transport: DesktopAuthTransport;
  /**
   * The now stamp (ISO instant) the flow settles device-pending expiries
   * against when a poll observes no transition (the service's expiresAt
   * truth + the caller's clock — the flow owns no clock of its own).
   */
  readonly now: () => string;
}

/** One internal flow record (the view + the live wiring). */
interface FlowRecord {
  readonly connectorId: string;
  readonly method: DesktopSourceFlowView["method"];
  state: DesktopSourceFlowState;
  surfaceId: string | null;
  verificationUrl: string | null;
  pollIntervalSeconds: number | null;
  expiresAt: string | null;
  failureDetail: string | null;
  row: SourceInfo | null;
  token: string;
  /** The terminal promise's resolvers (the waitForTerminal convenience). */
  waiters: Array<() => void>;
}

/** The Desktop source connect/reauthorize flows (the adapter-owned UX). */
export interface DesktopSourceConnectFlow {
  /** Start one connect/reauthorize attempt (the typed answer rides the view). */
  start(input: DesktopSourceFlowStartInput): Promise<DesktopSourceFlowStartResult>;
  /** One poll step (device flows settle here; other live flows re-derive). */
  poll(connectorId: string): Promise<DesktopSourceFlowView>;
  /** The user's abandon (closes the live surface; the typed dismissed view). */
  cancel(connectorId: string): Promise<DesktopSourceFlowView>;
  /** The current flow views (live and terminal; the surface renders these). */
  flows(): readonly DesktopSourceFlowView[];
  /** One connector's current flow view (null when none ever ran). */
  flow(connectorId: string): DesktopSourceFlowView | null;
  /** Resolve when the connector's flow reaches a terminal state. */
  waitForTerminal(connectorId: string): Promise<DesktopSourceFlowView>;
  /** Subscribe to flow-state changes (the surface observes rows here). */
  subscribe(listener: (view: DesktopSourceFlowView) => void): () => void;
  /** Release the shell-event subscription + close live surfaces (idempotent). */
  dispose(): void;
}

const TERMINAL_STATES: readonly DesktopSourceFlowState[] = [
  "completed",
  "denied",
  "dismissed",
  "expired",
  "failed",
];

function isTerminal(state: DesktopSourceFlowState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

function methodOf(answer: DesktopConnectAnswer): DesktopSourceFlowView["method"] {
  switch (answer.kind) {
    case "oauth":
      return "provider-signin";
    case "device":
      return "device-code";
    case "local":
      return "access-key";
    case "none":
      return "no-signin";
  }
}

function recoveryOf(
  state: DesktopSourceFlowState,
): DesktopSourceFlowRecovery | null {
  switch (state) {
    case "denied":
    case "expired":
      return {
        kind: "reauthorize",
        label: "Try connecting again",
        detail: "Start the sign-in again — the previous attempt left nothing connected.",
      };
    case "failed":
      return {
        kind: "retry",
        label: "Try again",
        detail: "The connection attempt failed before anything was connected — you can safely try again.",
      };
    default:
      return null;
  }
}

/**
 * Create the Desktop source connect/reauthorize flow over the shell's
 * contained authorization surfaces + the Desktop transport. The surface
 * layer subscribes and reports observed rows into the shared runtime.
 */
export function createDesktopSourceConnectFlow(
  options: DesktopSourceConnectFlowOptions,
): DesktopSourceConnectFlow {
  const { shell, transport, now } = options;
  const flows = new Map<string, FlowRecord>();
  const listeners = new Set<(view: DesktopSourceFlowView) => void>();
  let unsubscribeSurfaceEvents: (() => void) | null = null;
  let disposed = false;

  function viewOf(record: FlowRecord): DesktopSourceFlowView {
    const state = record.state;
    return {
      connectorId: record.connectorId,
      method: record.method,
      state,
      stateLabel: STATE_LABELS[state],
      stateDetail:
        state === "failed" && record.failureDetail !== null
          ? `${STATE_DETAILS[state]} (${record.failureDetail})`
          : STATE_DETAILS[state],
      recovery: recoveryOf(state),
      surfaceId: record.surfaceId,
      verificationUrl: record.verificationUrl,
      pollIntervalSeconds: record.pollIntervalSeconds,
      expiresAt: record.expiresAt,
      row: record.row,
    };
  }

  function emit(record: FlowRecord): DesktopSourceFlowView {
    const view = viewOf(record);
    for (const listener of listeners) listener(view);
    if (isTerminal(record.state)) {
      for (const waiter of record.waiters) waiter();
      record.waiters = [];
    }
    return view;
  }

  async function closeSurface(record: FlowRecord): Promise<void> {
    if (record.surfaceId === null) return;
    const sessionId = record.surfaceId;
    record.surfaceId = null;
    try {
      await shell.surfaceClose(sessionId);
    } catch {
      // The surface was already gone (the shell's own closed event fired
      // first — the idempotent truth); nothing to close.
    }
  }

  /**
   * Read the sources truth and settle the flow against it. `notConnected`
   * names the state a not-yet/never-connected row settles into ("denied"
   * for terminal flows; "awaiting-provider" for device polls that may
   * still transition).
   */
  async function settleWithRead(
    record: FlowRecord,
    notConnected: DesktopSourceFlowState,
  ): Promise<void> {
    record.state = "completing";
    emit(record);
    const read = await transport.readSources(record.token);
    if (!read.ok) {
      record.state = "failed";
      record.failureDetail = read.failure.detail;
      emit(record);
      return;
    }
    const row = read.value.sources.find(
      (candidate) => candidate.connectorId === record.connectorId,
    );
    if (row === undefined || !isUsableSourceInfo(row)) {
      record.state = "failed";
      record.failureDetail = "the source management read no longer lists this source";
      emit(record);
      return;
    }
    record.row = row;
    record.state = row.authState === "signedIn" ? "completed" : notConnected;
    emit(record);
  }

  function ensureSurfaceSubscription(): void {
    if (unsubscribeSurfaceEvents !== null || disposed) return;
    unsubscribeSurfaceEvents = shell.onSurfaceEvent((event) => {
      void handleSurfaceEvent(event);
    });
  }

  /** The service's documented callback route (the redirect target). */
  function isCallbackUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      // The callback path rides the API base (which may carry its own
      // prefix — e.g. `/api/sources/callback/<state>`): match the route's
      // own tail, anchored at the pathname's end.
      return /\/sources\/callback\/[^/]+\/?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  async function handleSurfaceEvent(event: {
    readonly kind: "navigated" | "closed" | "blocked";
    readonly sessionId: string;
    readonly url?: string;
  }): Promise<void> {
    for (const record of flows.values()) {
      if (record.surfaceId !== event.sessionId) continue;
      if (event.kind === "navigated" && event.url !== undefined) {
        // The provider redirected the surface. The SERVICE's callback
        // route (the registered redirect target) completes the flow
        // server-side; the adapter OBSERVES that navigation (never
        // steers), closes the surface, and verifies the truth.
        if (isCallbackUrl(event.url)) {
          await closeSurface(record);
          await settleWithRead(record, "denied");
        }
        return;
      }
      if (event.kind === "closed") {
        // The user closed the authorization surface: the typed non-event.
        record.surfaceId = null;
        record.state = "dismissed";
        emit(record);
        return;
      }
      if (event.kind === "blocked") {
        record.surfaceId = null;
        record.state = "failed";
        record.failureDetail = "the shell's policy refused the provider's page";
        emit(record);
        return;
      }
    }
  }

  return {
    async start(input) {
      if (disposed) {
        throw new Error("sourceConnectFlow.start: the flow was disposed");
      }
      const existing = flows.get(input.connectorId);
      if (existing !== undefined && !isTerminal(existing.state)) {
        // A live flow stands (no duplicate surfaces, no superseded states).
        return { ok: true, view: emit(existing) };
      }

      const answer = input.reauthorize
        ? await transport.beginReauthorize(input.token, input.connectorId, input.credential)
        : await transport.beginConnect(input.token, input.connectorId, input.credential);
      if (!answer.ok) {
        const record: FlowRecord = {
          connectorId: input.connectorId,
          method: input.methodHint ?? "access-key",
          state: "failed",
          surfaceId: null,
          verificationUrl: null,
          pollIntervalSeconds: null,
          expiresAt: null,
          failureDetail: answer.failure.detail,
          row: null,
          token: input.token,
          waiters: [],
        };
        flows.set(input.connectorId, record);
        const kind = answer.failure.kind;
        if (kind === "invalid-credentials" || kind === "unauthorized") {
          // The session token was not accepted — the flows are account
          // actions; the honest recovery is signing in again.
          const view = {
            ...emit(record),
            recovery: {
              kind: "sign-in-again" as const,
              label: "Sign in again",
              detail:
                "Your session was not accepted — sign in again, then connect the source.",
            },
          };
          return { ok: false, view };
        }
        return { ok: false, view: emit(record) };
      }

      const method = methodOf(answer.value);
      const record: FlowRecord = {
        connectorId: input.connectorId,
        method,
        state: "completing",
        surfaceId: null,
        verificationUrl: null,
        pollIntervalSeconds: null,
        expiresAt: null,
        failureDetail: null,
        row: null,
        token: input.token,
        waiters: [],
      };
      flows.set(input.connectorId, record);

      switch (answer.value.kind) {
        case "oauth": {
          ensureSurfaceSubscription();
          try {
            const opened = await shell.surfaceOpen({
              url: answer.value.authorizationUrl,
              restrictCookies: "isolate",
              purpose: "authorization",
            });
            record.surfaceId = opened.sessionId;
            record.expiresAt = answer.value.expiresAt;
            record.state = "authorization-surface";
            return { ok: true, view: emit(record) };
          } catch (thrown) {
            record.state = "failed";
            record.failureDetail =
              thrown instanceof Error ? thrown.message : String(thrown);
            return { ok: false, view: emit(record) };
          }
        }
        case "device": {
          record.verificationUrl = answer.value.verificationUrl;
          record.pollIntervalSeconds = answer.value.pollIntervalSeconds;
          record.expiresAt = answer.value.expiresAt;
          record.state = "awaiting-provider";
          return { ok: true, view: emit(record) };
        }
        case "local":
        case "none": {
          // The direct answers: verify through the fresh management read
          // (never an assumed success).
          await settleWithRead(record, "denied");
          return { ok: record.state === "completed", view: emit(record) };
        }
      }
    },

    async poll(connectorId) {
      const record = flows.get(connectorId);
      if (record === undefined) {
        throw new Error(
          `sourceConnectFlow.poll: no flow ever ran for '${connectorId}' — start one first`,
        );
      }
      if (isTerminal(record.state)) return emit(record);
      if (record.state === "awaiting-provider") {
        await settleWithRead(record, "awaiting-provider");
        if (
          record.state === "awaiting-provider" &&
          record.expiresAt !== null &&
          Date.parse(now()) >= Date.parse(record.expiresAt)
        ) {
          // The service's pending elapsed without the provider's approval.
          record.state = "expired";
        }
        return emit(record);
      }
      return emit(record);
    },

    async cancel(connectorId) {
      const record = flows.get(connectorId);
      if (record === undefined) {
        throw new Error(
          `sourceConnectFlow.cancel: no flow ever ran for '${connectorId}' — start one first`,
        );
      }
      if (isTerminal(record.state)) return emit(record);
      await closeSurface(record);
      record.state = "dismissed";
      return emit(record);
    },

    flows() {
      return [...flows.values()].map(viewOf);
    },

    flow(connectorId) {
      const record = flows.get(connectorId);
      return record === undefined ? null : viewOf(record);
    },

    waitForTerminal(connectorId) {
      const record = flows.get(connectorId);
      if (record === undefined) {
        return Promise.reject(
          new Error(
            `sourceConnectFlow.waitForTerminal: no flow ever ran for '${connectorId}' — start one first`,
          ),
        );
      }
      if (isTerminal(record.state)) return Promise.resolve(viewOf(record));
      return new Promise<DesktopSourceFlowView>((resolve) => {
        record.waiters.push(() => resolve(viewOf(record)));
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeSurfaceEvents?.();
      unsubscribeSurfaceEvents = null;
      for (const record of flows.values()) {
        if (!isTerminal(record.state)) {
          void closeSurface(record);
          record.state = "dismissed";
        }
      }
      listeners.clear();
    },
  };
}
