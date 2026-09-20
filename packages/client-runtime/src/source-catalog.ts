/**
 * @wfx/client-runtime — the first-connect source catalog (R22-A).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-major-journey-hardening-plan.md — F2, the dead-end
 * killer): "Connect a source" may never terminate by returning the user to
 * the same empty state. The first-connect journey is
 *
 *   Home -> Connect a source -> choose a supported connector
 *        -> authorize/connect -> return to source management
 *        -> the source is Connected with capability truth
 *
 * and THIS module is the typed read model the chooser renders — the shared
 * seam Workers 2/3 (R22-D / R22-H) build the Web/Desktop chooser UI over.
 * Web and Desktop remain adapters over the SAME catalog semantics (the
 * platform rule): no duplicated business rules, no second navigation
 * system, no architecture dashboard.
 *
 * THE SEVEN DISTINGUISHABLE TRUTHS the plan requires, encoded as one typed
 * state per catalog entry:
 *
 * 1. SUPPORTED CONNECTOR — catalog MEMBERSHIP: an entry exists iff the
 *    server's `GET /sources` answer carried the connector's row (the
 *    deployment's wired-source truth). The runtime NEVER fabricates a
 *    connector row it has not observed (a fabricated capability claim is
 *    the reject-drift law).
 * 2. NOT CONNECTED      — `state: "not-connected"` (authState signedOut).
 * 3. CONNECTING/AUTHORIZING — `state: "connecting"` (authState authorizing).
 * 4. CONNECTED          — `state: "connected"` (authState signedIn).
 * 5. AUTHORIZATION EXPIRED — `state: "authorization-expired"` (the named
 *    R17 expired state — never a silent signed-out, never a fake
 *    connected).
 * 6. FAILED             — `state: "failed"` (the last attempt failed).
 * 7. UNSUPPORTED IN THE CURRENT PLATFORM/BOOT — `state: "unsupported"`:
 *    the connector row EXISTS (the product supports it) but THIS boot did
 *    not provision its connect flow (`SourceInfo.connectable === false`,
 *    the R22-A extension) or THIS platform truthfully cannot connect it
 *    (the adapter-supplied platform truth map). Unsupported is NOT
 *    undiscoverable: the entry stays visible with the honest reason and a
 *    recovery next step (the frozen "unsupported capabilities stay visible
 *    with actionable platform truth" law).
 *
 * THE TYPED ACTION TO START CONNECTION: every entry carries
 * {@link SourceCatalogEntry.action} — the typed control the chooser offers
 * (`connect` | `reauthorize` | `disconnect` | `none`, the R17 recovery
 * vocabulary) plus {@link SourceCatalogEntry.method} — HOW the connection
 * happens in USER vocabulary (`Sign in on the provider's website` / `Enter
 * a code from the provider` / `Enter an access key` / `No sign-in needed`),
 * derived from the connector's declared `authMode`. Raw provider protocol
 * details (client ids, scopes, redirect URIs, token endpoints, state
 * tokens) are NEVER the primary UX vocabulary — they stay in the adapter's
 * transport layer where the OAuth/device/local handshake already lives
 * (sources.ts's layering law: the ADAPTER owns the flows).
 *
 * THE ANONYMOUS PREREQUISITE (the F2 dead end for signed-out users): the
 * server's anonymous `GET /sources` answer is the HONEST empty list, and
 * source connections belong to an account (the service law). The catalog
 * view therefore carries {@link SourceCatalogView.prerequisite} — the
 * typed sign-in-or-create-account next action — whenever the session is
 * anonymous. The chooser for an anonymous user renders the prerequisite,
 * NEVER an empty dead end.
 *
 * WHAT THIS MODULE IS: PURE derivations + typed data (the control-views.ts
 * law — plain serializable views; adapters render them, they never
 * re-derive product semantics). No fetching, no clock, no ids, no UI.
 *
 * Design-language binding (docs/architecture/webflix-design-language.md):
 * every entry carries a semantic {@link SourceCatalogEntry.tone}
 * (positive / attention / negative / neutral) so Web/Desktop render the
 * frozen state-color families (teal connected, amber recovering, red
 * failed, neutral idle/unsupported) identically — color always PAIRED with
 * the state label text, never alone.
 */

import type { Capability } from "@wfx/domain";

import type { ModelSectionStatus, SemanticStateTone } from "./models";
import { readySection } from "./models";
import type { SourceAuthMode, SourceInfo } from "./server-port";

// ---------------------------------------------------------------------------
// The frozen catalog-state vocabulary (the plan's seven truths)
// ---------------------------------------------------------------------------

/**
 * One catalog entry's first-connect state. Catalog MEMBERSHIP (the row's
 * presence) is the "supported connector" truth; this union is the
 * CONNECTION-JOURNEY truth of that supported connector.
 */
export type SourceCatalogEntryState =
  /** Supported, no account, no pending handshake (authState signedOut). */
  | "not-connected"
  /** A handshake is in flight (authState authorizing). */
  | "connecting"
  /** Signed in with a live authorization (authState signedIn). */
  | "connected"
  /** The stored authorization elapsed (the named R17 state — never silent). */
  | "authorization-expired"
  /** The last connection attempt failed. */
  | "failed"
  /** The connector is supported but THIS platform/boot cannot connect it. */
  | "unsupported";

/** Every value of {@link SourceCatalogEntryState}, in journey order. */
export const SOURCE_CATALOG_ENTRY_STATES: readonly SourceCatalogEntryState[] = [
  "not-connected",
  "connecting",
  "connected",
  "authorization-expired",
  "failed",
  "unsupported",
] as const;

/** Runtime membership check against the catalog-state union. */
export function isSourceCatalogEntryState(
  x: unknown,
): x is SourceCatalogEntryState {
  return (
    typeof x === "string" &&
    (SOURCE_CATALOG_ENTRY_STATES as readonly string[]).includes(x)
  );
}

/**
 * The semantic tone of one catalog state (the frozen design language's
 * state-color families — color ALWAYS paired with the state label, never
 * alone). Web/Desktop map this to the identical color family; the label
 * text is the truth, the tone is the styling hint. (The shared
 * `SemanticStateTone` vocabulary; this alias keeps the catalog's own
 * readable name.)
 */
export type SourceCatalogTone = SemanticStateTone;

/**
 * The frozen tone mapping (deterministic; the one derivation source — a
 * surface may not invent its own tone for a state):
 * - connected → positive (teal family: connected/ready/confirmed/healthy);
 * - connecting / authorization-expired → attention (amber: recovering,
 *   pending, requires attention);
 * - failed → negative (red: failed/unavailable);
 * - not-connected / unsupported → neutral (idle/disconnected/unsupported/
 *   not-yet-configured).
 */
export const SOURCE_CATALOG_TONES: Readonly<
  Record<SourceCatalogEntryState, SourceCatalogTone>
> = {
  "not-connected": "neutral",
  connecting: "attention",
  connected: "positive",
  "authorization-expired": "attention",
  failed: "negative",
  unsupported: "neutral",
};

/**
 * The user-facing state label of each catalog state (the one derivation
 * source — every surface renders THIS wording, never its own).
 */
export const SOURCE_CATALOG_STATE_LABELS: Readonly<
  Record<SourceCatalogEntryState, string>
> = {
  "not-connected": "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  "authorization-expired": "Sign-in expired",
  failed: "Connection failed",
  unsupported: "Not available here",
};

/**
 * The honest one-sentence state detail of each catalog state (paired with
 * its label; plain product language, never protocol diagnostics).
 */
export const SOURCE_CATALOG_STATE_DETAILS: Readonly<
  Record<SourceCatalogEntryState, string>
> = {
  "not-connected":
    "This source is not connected yet — connect it to use it in WebFlix.",
  connecting: "A connection attempt is in progress right now.",
  connected: "This source is connected and ready to use.",
  "authorization-expired":
    "The stored sign-in expired — reconnect to restore this source.",
  failed: "The last connection attempt failed — you can try again.",
  unsupported:
    "This source cannot be connected on this platform or deployment.",
};

// ---------------------------------------------------------------------------
// The connection method (user vocabulary — never raw protocol detail)
// ---------------------------------------------------------------------------

/**
 * HOW a connector connects, in user vocabulary — the product-level
 * projection of the connector's declared `authMode`. The adapter runs the
 * REAL flow (browser redirect / device instructions / credential
 * collection); this vocabulary is what the user reads when choosing.
 */
export type SourceConnectMethodKind =
  /** oauth — the user signs in on the provider's own website. */
  | "provider-signin"
  /** device — the user enters a code at the provider and waits. */
  | "device-code"
  /** local — the user enters a source access key directly. */
  | "access-key"
  /** none — nothing to authorize; the source works right away. */
  | "no-signin";

/** Every value of {@link SourceConnectMethodKind}, in auth-mode order. */
export const SOURCE_CONNECT_METHOD_KINDS: readonly SourceConnectMethodKind[] = [
  "provider-signin",
  "device-code",
  "access-key",
  "no-signin",
] as const;

/** Runtime membership check against the method union. */
export function isSourceConnectMethodKind(
  x: unknown,
): x is SourceConnectMethodKind {
  return (
    typeof x === "string" &&
    (SOURCE_CONNECT_METHOD_KINDS as readonly string[]).includes(x)
  );
}

/** One connector's connection method in user vocabulary. */
export interface SourceConnectMethodView {
  readonly method: SourceConnectMethodKind;
  /** The method's user label (the one derivation source). */
  readonly label: string;
  /** One honest sentence explaining what connecting will feel like. */
  readonly detail: string;
}

/**
 * The frozen method labels (user words — the chooser renders these, never
 * "OAuth" / "device flow" / "token" jargon).
 */
export const SOURCE_CONNECT_METHOD_VIEWS: Readonly<
  Record<SourceConnectMethodKind, SourceConnectMethodView>
> = {
  "provider-signin": {
    method: "provider-signin",
    label: "Sign in on the provider's website",
    detail: "You'll be taken to the source's own sign-in page, then returned here.",
  },
  "device-code": {
    method: "device-code",
    label: "Enter a code at the provider",
    detail: "You'll get a short code to enter on the source's website — WebFlix connects once you approve it there.",
  },
  "access-key": {
    method: "access-key",
    label: "Enter an access key",
    detail: "You'll paste a personal access key from the source — it is stored encrypted and never shown again.",
  },
  "no-signin": {
    method: "no-signin",
    label: "No sign-in needed",
    detail: "This source needs no sign-in — it works right away.",
  },
};

/**
 * Derive the connection-method view from a connector's declared auth mode
 * (PURE; total over the `SourceAuthMode` union — the auth mode is
 * product-level vocabulary, not raw protocol detail).
 */
export function connectMethodOf(authMode: SourceAuthMode): SourceConnectMethodView {
  switch (authMode) {
    case "oauth":
      return SOURCE_CONNECT_METHOD_VIEWS["provider-signin"];
    case "device":
      return SOURCE_CONNECT_METHOD_VIEWS["device-code"];
    case "local":
      return SOURCE_CONNECT_METHOD_VIEWS["access-key"];
    case "none":
      return SOURCE_CONNECT_METHOD_VIEWS["no-signin"];
  }
}

// ---------------------------------------------------------------------------
// The typed connect action (the R17 recovery vocabulary, first-connect use)
// ---------------------------------------------------------------------------

/** The typed action kinds (the R17 `SourceRecoveryActionKind` vocabulary). */
export type SourceCatalogActionKind =
  /** Start a fresh connection (a not-connected supported connector). */
  | "connect"
  /** Re-run the flow for an existing connection (expired/failed). */
  | "reauthorize"
  /** Remove the connection (a connected source). */
  | "disconnect"
  /** No action control (in progress / unsupported — the detail is the truth). */
  | "none";

/** One typed catalog action + its honest user-language control text. */
export interface SourceCatalogAction {
  readonly kind: SourceCatalogActionKind;
  /** The action's control label (user vocabulary; empty iff kind is none). */
  readonly label: string;
  /** Why the action is offered — one honest sentence. */
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// The catalog entry + view
// ---------------------------------------------------------------------------

/**
 * One supported connector in the first-connect catalog: the chooser card's
 * complete read model. The observed {@link SourceCatalogEntry.source} row
 * stays attached (capability truth + availability notes + expiry stamps —
 * the deeper truth behind the choice), and every derived field is plain
 * serializable data the adapter renders verbatim.
 */
export interface SourceCatalogEntry {
  /** The connector's stable id (the REAL connector identifier — the action's target). */
  readonly connectorId: string;
  /** Human display name (the connector descriptor's). */
  readonly displayName: string;
  /** The connection-journey state (the seven-truth union). */
  readonly state: SourceCatalogEntryState;
  /** The state's user label (the one derivation source). */
  readonly stateLabel: string;
  /** The state's honest one-sentence detail. */
  readonly stateDetail: string;
  /** The semantic tone (the frozen design-language state-color hint). */
  readonly tone: SourceCatalogTone;
  /** How this connector connects, in user vocabulary. */
  readonly method: SourceConnectMethodView;
  /** The typed action the chooser offers for this entry. */
  readonly action: SourceCatalogAction;
  /**
   * Present iff `state === "unsupported"`: the honest reason THIS
   * platform/boot cannot connect it (the boot-provisioning or adapter
   * platform truth — never a guessed one).
   */
  readonly unsupportedDetail: string | null;
  /**
   * Present iff `state === "unsupported"`: the recovery next step (the
   * "unsupported is not undiscoverable" law — never a dead end).
   */
  readonly recoveryHint: string | null;
  /**
   * The capability-truth summary the choice rests on (the "no provider
   * capability is claimed without a real adapter path" law — the observed
   * row's own record, projected for one-glance choice).
   */
  readonly capabilityHighlights: {
    /** The capabilities this connector declares (true flags, frozen order). */
    readonly declared: readonly Capability[];
    /** The notable NOT-declared capabilities (search/metadata/playback family). */
    readonly absent: readonly Capability[];
  };
  /** The full observed source row (the server's management truth). */
  readonly source: SourceInfo;
}

/**
 * The typed prerequisite the anonymous catalog carries (the F2 dead-end
 * killer for signed-out users): source connections belong to an account,
 * so the next required choice is signing in or creating one.
 */
export interface SourceCatalogPrerequisite {
  readonly kind: "sign-in";
  /** The prerequisite's control label (user vocabulary). */
  readonly label: string;
  /** One honest sentence naming why the prerequisite applies. */
  readonly detail: string;
}

/** The first-connect catalog read model (the chooser's complete data). */
export interface SourceCatalogView {
  /** The sources read's status (in-model degradation: an error keeps entries visible). */
  readonly status: ModelSectionStatus;
  /**
   * Non-null iff the session is anonymous: the typed sign-in prerequisite
   * (the next required choice — never an empty dead end).
   */
  readonly prerequisite: SourceCatalogPrerequisite | null;
  /** The supported connectors (sorted by connectorId — stable for diffing). */
  readonly entries: readonly SourceCatalogEntry[];
  /**
   * Present iff signed in, the read is ready, and NO connectors are
   * available in this deployment: the honest empty-catalog sentence (a
   * deployment configuration truth, present tense — never a stale
   * "arrives later" claim).
   */
  readonly catalogEmptyDetail: string | null;
}

// ---------------------------------------------------------------------------
// The derivation (PURE)
// ---------------------------------------------------------------------------

/** The capabilities the chooser's one-glance summary highlights, in frozen order. */
const HIGHLIGHT_CAPABILITIES: readonly Capability[] = [
  "catalogSearch",
  "metadata",
  "playEmbed",
  "playBrowser",
  "playExternal",
  "playNative",
  "like",
  "save",
  "follow",
];

/**
 * The input of {@link sourceCatalogView}. `sources` is the observed row set
 * (the `ServerPort.readSources()` answer — every WIRED connector, connected
 * or not, for a session-scoped read; the honest empty list for an anonymous
 * one). `authenticated` is the session truth the adapter owns. `status` is
 * the sources read's section status (defaults to ready — the caller that
 * just refreshed passes the read model's own status so degradation stays
 * in-model). `unsupportedOnPlatform` is the adapter's platform-truth map:
 * connectorId → the honest one-sentence reason THIS platform cannot
 * connect it (e.g. a Desktop-only connector on Web).
 */
export interface SourceCatalogInput {
  readonly sources: readonly SourceInfo[];
  readonly authenticated: boolean;
  readonly status?: ModelSectionStatus;
  readonly unsupportedOnPlatform?: ReadonlyMap<string, string>;
}

/** The frozen anonymous-prerequisite sentence block (the one derivation source). */
export const SOURCE_CATALOG_PREREQUISITE: SourceCatalogPrerequisite = {
  kind: "sign-in",
  label: "Sign in or create an account",
  detail:
    "Source connections belong to your account — sign in or create one to choose a source to connect.",
};

/** The honest empty-catalog sentence (a deployment truth, present tense). */
export const SOURCE_CATALOG_EMPTY_DETAIL =
  "No connectors are available in this deployment yet — the catalog is empty because no source is wired.";

function byConnectorId(a: SourceCatalogEntry, b: SourceCatalogEntry): number {
  return a.connectorId < b.connectorId ? -1 : a.connectorId > b.connectorId ? 1 : 0;
}

/**
 * Derive one catalog entry's typed action (PURE; aligned with the R17
 * `sourceRecoveryAction` recovery vocabulary — the first-connect chooser
 * needs the same honest actions with chooser-appropriate labels).
 */
function actionFor(source: SourceInfo, state: SourceCatalogEntryState): SourceCatalogAction {
  switch (state) {
    case "not-connected":
      return source.authMode === "none"
        ? {
            kind: "connect",
            label: "Use this source",
            detail: "This source needs no sign-in — it works right away.",
          }
        : {
            kind: "connect",
            label: "Connect",
            detail: "This source is not connected — connect it to use it.",
          };
    case "connecting":
      return {
        kind: "none",
        label: "",
        detail: "A connection attempt is in progress — it will appear here when it completes.",
      };
    case "connected":
      return {
        kind: "disconnect",
        label: "Disconnect",
        detail: "This source is connected.",
      };
    case "authorization-expired":
      return {
        kind: "reauthorize",
        label: "Reconnect",
        detail: "The stored sign-in expired — reconnect to restore this source.",
      };
    case "failed":
      return {
        kind: "reauthorize",
        label: "Try connecting again",
        detail: "The last connection attempt failed — you can try again.",
      };
    case "unsupported":
      return {
        kind: "none",
        label: "",
        detail: "This source cannot be connected on this platform or deployment.",
      };
  }
}

/** The unsupported-state detail + recovery hint of one row (boot truth first). */
function unsupportedTruthOf(
  source: SourceInfo,
  platformReason: string | undefined,
): { unsupportedDetail: string; recoveryHint: string } {
  if (source.connectable === false) {
    return {
      unsupportedDetail:
        "This deployment hasn't provisioned this source's sign-in flow yet.",
      recoveryHint:
        "The source still serves what it can without an account — connecting it needs the deployment's operator to provision its sign-in flow.",
    };
  }
  return {
    unsupportedDetail:
      platformReason ??
      "This platform cannot connect this source.",
    recoveryHint:
      "Use the WebFlix Desktop app to connect and use this source.",
  };
}

/**
 * Derive the first-connect catalog view (PURE — the chooser's complete
 * read model). Laws kept:
 * - entries exist ONLY for observed rows (no fabricated connectors);
 * - an anonymous session carries the sign-in prerequisite and NO entries
 *   (the honest anonymous truth — never a fabricated catalog);
 * - `connectable === false` or an adapter platform-truth entry ⇒ the
 *   honest `unsupported` state with its reason + recovery next step;
 * - the state derivation is total over the `SourceAuthState` union and
 *   never renders an expired source as connected or disconnected (the R17
 *   named-state law);
 * - the passed-in status rides verbatim (in-model degradation).
 */
export function sourceCatalogView(input: SourceCatalogInput): SourceCatalogView {
  const status = input.status ?? readySection();
  const unsupported = input.unsupportedOnPlatform;

  const entries: SourceCatalogEntry[] = input.sources.map((source) => {
    const platformReason = unsupported?.get(source.connectorId);
    const state: SourceCatalogEntryState =
      source.connectable === false || platformReason !== undefined
        ? "unsupported"
        : source.authState === "signedIn"
          ? "connected"
          : source.authState === "authorizing"
            ? "connecting"
            : source.authState === "expired"
              ? "authorization-expired"
              : source.authState === "failed"
                ? "failed"
                : "not-connected";
    const truth =
      state === "unsupported"
        ? unsupportedTruthOf(source, platformReason)
        : { unsupportedDetail: null, recoveryHint: null };
    const declared = HIGHLIGHT_CAPABILITIES.filter(
      (capability) => source.capabilities[capability] === true,
    );
    const absent = HIGHLIGHT_CAPABILITIES.filter(
      (capability) => source.capabilities[capability] !== true,
    );
    return {
      connectorId: source.connectorId,
      displayName: source.displayName,
      state,
      stateLabel: SOURCE_CATALOG_STATE_LABELS[state],
      stateDetail: SOURCE_CATALOG_STATE_DETAILS[state],
      tone: SOURCE_CATALOG_TONES[state],
      method: connectMethodOf(source.authMode),
      action: actionFor(source, state),
      unsupportedDetail: truth.unsupportedDetail,
      recoveryHint: truth.recoveryHint,
      capabilityHighlights: { declared, absent },
      source,
    };
  });
  entries.sort(byConnectorId);

  const empty =
    input.authenticated &&
    status.state === "ready" &&
    entries.length === 0;

  return {
    status,
    prerequisite: input.authenticated ? null : SOURCE_CATALOG_PREREQUISITE,
    entries,
    catalogEmptyDetail: empty ? SOURCE_CATALOG_EMPTY_DETAIL : null,
  };
}
