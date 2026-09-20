/**
 * @wfx/client-runtime — the capability discovery matrix (R21-A).
 *
 * THE LAW THIS MODULE RATIFIES (docs/plans/
 * 2026-09-19-webflix-journey-discoverability-plan.md — the frozen UX law
 * + the capability-to-surface map, encoded as TYPED CONTRACTS):
 *
 * A capability is not complete from the user's perspective merely because
 * its contract, backend, or transport exists. Every IMPORTANT accepted
 * architecture capability needs:
 *
 * 1. a NORMAL discovery affordance (a contextual product entry — no
 *    architecture dashboard, no second navigation system: Home / Watch /
 *    Shorts / Search / Library / Settings stay the primary vocabulary);
 * 2. a RECOVERY / next-action path (every important failure state carries
 *    a useful next action);
 * 3. DETAILED MANAGEMENT that lives in Settings — but Settings is never
 *    the ONLY discovery path;
 * 4. PLATFORM TRUTH: Web/Desktop expose the same product SEMANTICS and
 *    differ only where platform capability truth requires; unsupported is
 *    NOT undiscoverable — a native-only capability stays discoverable on
 *    Web with a truthful next step ("Available offline in the Desktop
 *    app"), never a dead "not available";
 * 5. no STALE COMPLETION COPY: an accepted lane never renders "arrives
 *    later / ships with R0x" wording (see {@link STALE_COMPLETION_MARKERS}
 *    — the machine-checkable pattern J35 evidence consumes).
 *
 * WHAT THIS MODULE IS: the frozen, typed product-surface matrix binding
 * every architecture capability to its contextual entry points and
 * recovery paths. It is DATA + PURE DERIVATIONS ONLY — no product policy,
 * no platform-specific business rules, no UI. Workers 2/3 (R21-D/E and
 * R21-G/H) bind their surfaces to these entries so Web/Desktop cannot
 * diverge in discovery semantics; the lead's J34/J35 evidence verifies
 * against the same contract.
 *
 * WHAT THIS MODULE IS NOT: a navigation system. It never drives routing;
 * the runtime's navigation state machine (R01) stays the one owner of
 * surface state. The matrix's `surface` references are TYPED DESCRIPTORS
 * adapters render against their own IA.
 */

// ---------------------------------------------------------------------------
// The frozen primary navigation vocabulary (no second navigation system)
// ---------------------------------------------------------------------------

/**
 * The frozen primary navigation surfaces (the R21 UX law: this vocabulary
 * is CLOSED — R21 adds contextual controls INSIDE these surfaces, never a
 * competing navigation system).
 */
export type PrimaryNavigationSurface =
  | "home"
  | "watch"
  | "shorts"
  | "search"
  | "library"
  | "settings";

/** Every value of {@link PrimaryNavigationSurface}, in frozen order. */
export const PRIMARY_NAVIGATION_SURFACES: readonly PrimaryNavigationSurface[] = [
  "home",
  "watch",
  "shorts",
  "search",
  "library",
  "settings",
];

/** Runtime membership check against the frozen primary navigation union. */
export function isPrimaryNavigationSurface(
  x: unknown,
): x is PrimaryNavigationSurface {
  return (
    typeof x === "string" &&
    (PRIMARY_NAVIGATION_SURFACES as readonly string[]).includes(x)
  );
}

/**
 * The product surfaces contextual controls render on: the frozen primary
 * navigation PLUS the two existing content surfaces (`item` — the detail
 * hub the runtime's own `SurfaceId` already types; `player` — the
 * playback context of the watch surface). NOT a navigation system: no
 * architecture/dashboard route exists or may be added here (the frozen
 * UX law — these are the surfaces the R21 plan's matrix names).
 */
export type ProductSurfaceId = PrimaryNavigationSurface | "item" | "player";

/** Every value of {@link ProductSurfaceId}, in canonical order. */
export const PRODUCT_SURFACE_IDS: readonly ProductSurfaceId[] = [
  "home",
  "watch",
  "shorts",
  "search",
  "item",
  "library",
  "settings",
  "player",
];

/** Runtime membership check against the product-surface union. */
export function isProductSurfaceId(x: unknown): x is ProductSurfaceId {
  return (
    typeof x === "string" && (PRODUCT_SURFACE_IDS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The feed-mode vocabulary (the Home/Watch/Shorts feed control)
// ---------------------------------------------------------------------------

/**
 * The session feed mode (the plan's Home orientation vocabulary): which
 * relationship the current feed honors — the user's WebFlix-ranked
 * discovery, the accounts they follow, their imported (BYOF) feed's
 * source-native order, or a hybrid blend. Shared Web/Desktop semantics;
 * the RUNTIME owns the presentation state (R21-C's feed-mode view).
 */
export type FeedMode = "foryou" | "following" | "byof" | "hybrid";

/** Every value of {@link FeedMode}, in union order. */
export const FEED_MODES: readonly FeedMode[] = [
  "foryou",
  "following",
  "byof",
  "hybrid",
] as const;

/** Runtime membership check against the feed-mode union. */
export function isFeedMode(x: unknown): x is FeedMode {
  return typeof x === "string" && (FEED_MODES as readonly string[]).includes(x);
}

/**
 * The user-facing label of each feed mode (the one derivation source — no
 * surface may invent its own mode wording; the BYOF label always names
 * source-native order so an imported feed is never mislabeled as
 * WebFlix-ranked).
 */
export const FEED_MODE_LABELS: Readonly<Record<FeedMode, string>> = {
  foryou: "For you",
  following: "Following",
  byof: "Your imported feed",
  hybrid: "Blend",
};

// ---------------------------------------------------------------------------
// The J34 discovery-task vocabulary (the meta-journey's enumerated sweep)
// ---------------------------------------------------------------------------

/**
 * The J34 capability-discoverability tasks (docs/validation/
 * webflix-golden-journeys.md — "Starting from a fresh Home state, the
 * user must be able to discover without documentation: …"). TYPED here so
 * the matrix binds every task to the capability whose discoverability
 * satisfies it, and J34/J35 evidence can verify COVERAGE mechanically
 * (every task has ≥1 matrix entry; every matrix entry maps to real
 * surfaces).
 */
export type J34TaskId =
  | "identity-profile"
  | "connect-source"
  | "bring-own-feed"
  | "feed-mode-choice"
  | "temporary-intent"
  | "attention-mode"
  | "recommendation-feedback"
  | "model-controls"
  | "ai-action-launch"
  | "playback-realization"
  | "desktop-offline-path"
  | "library-sections";

/** Every value of {@link J34TaskId}, in journey order. */
export const J34_TASKS: readonly J34TaskId[] = [
  "identity-profile",
  "connect-source",
  "bring-own-feed",
  "feed-mode-choice",
  "temporary-intent",
  "attention-mode",
  "recommendation-feedback",
  "model-controls",
  "ai-action-launch",
  "playback-realization",
  "desktop-offline-path",
  "library-sections",
];

/** Runtime membership check against the J34 task union. */
export function isJ34TaskId(x: unknown): x is J34TaskId {
  return typeof x === "string" && (J34_TASKS as readonly string[]).includes(x);
}

// ---------------------------------------------------------------------------
// The typed matrix shape
// ---------------------------------------------------------------------------

/** One reference to a surface + the control that lives on it. */
export interface SurfaceControlRef {
  /** The product surface the control renders on (frozen vocabulary). */
  readonly surface: ProductSurfaceId;
  /**
   * The control's identity on that surface (plain, product vocabulary —
   * e.g. "session menu", "feed-mode control", "Personalize", "AI action
   * tray"). Descriptive contracts the adapters bind to their own IA.
   */
  readonly control: string;
}

/** A contextual entry: WHERE the control appears + when it matters. */
export interface ContextualEntry {
  /** The product surface the contextual control renders on. */
  readonly surface: ProductSurfaceId;
  /** The control's identity (product vocabulary). */
  readonly control: string;
  /** WHEN the entry matters (the moment the user needs it). */
  readonly moment: string;
}

/**
 * The Settings management destination. `area` is the R21 settings-area
 * vocabulary (the plan's expected sections); adapters map it onto their
 * settings IA — the runtime's R01 `SettingsSection` navigation vocabulary
 * is untouched (escalated for lead ratification when Workers 2/3 need
 * typed navigation sections beyond sources | model | general).
 */
export interface ManagementRef {
  readonly surface: "settings";
  readonly area:
    | "profile"
    | "sources"
    | "feeds"
    | "recommendation"
    | "model"
    | "playback"
    | "general";
}

/** The recovery / next-action path every capability MUST carry. */
export interface RecoveryPath {
  /** The failure/limitation state the path addresses (plain language). */
  readonly state: string;
  /** The next action the surface offers (a control label, plain language). */
  readonly action: string;
  /** Why the action helps (one honest sentence). */
  readonly detail: string;
}

/**
 * The platform-capability truth note: WHY Web and Desktop differ for this
 * capability (the frozen "differ only where platform capability truth
 * requires" law). A capability with NO note must behave identically on
 * Web and Desktop — a divergence without a note here is a parity defect.
 */
export interface PlatformTruthNote {
  /** The platform that carries the extra capability truth. */
  readonly platform: "web" | "desktop";
  /** The honest divergence reason (capability truth, never product policy). */
  readonly reason: string;
  /**
   * The truthful next step the OTHER platform renders (the
   * "unsupported is not undiscoverable" law — e.g. "Available offline in
   * the Desktop app").
   */
  readonly nextStep: string;
}

/**
 * One row of the capability discovery matrix: EVERY important accepted
 * capability, its normal discovery affordance(s), its detailed
 * management, and its recovery path. Structural laws (machine-tested):
 * `contextualEntries` is non-empty; `recovery` is present; `j34Task`
 * binds the row to the meta-journey it serves when it does.
 */
export interface CapabilitySurfaceEntry {
  /** The capability's stable id (the matrix's key). */
  readonly capability: DiscoverableCapabilityId;
  /** The user-facing product label (product concepts, never jargon). */
  readonly productLabel: string;
  /** The PRIMARY discovery surface + control (the everyday affordance). */
  readonly primaryDiscovery: SurfaceControlRef;
  /** Contextual entries (non-empty by law — Settings is never the only path). */
  readonly contextualEntries: readonly ContextualEntry[];
  /** The detailed management destination (Settings area). */
  readonly management: ManagementRef;
  /** The recovery / next-action path (required by law). */
  readonly recovery: RecoveryPath;
  /** Platform capability truth (only where Web/Desktop honestly differ). */
  readonly platformTruth: PlatformTruthNote | null;
  /** The J34 task this row's discoverability satisfies (when applicable). */
  readonly j34Task: J34TaskId | null;
}

/**
 * The closed capability-id vocabulary of the matrix (the plan's
 * capability-to-surface map, one stable id per row). ADD-ONLY: new
 * capabilities may join; an id never changes meaning or leaves.
 */
export type DiscoverableCapabilityId =
  | "identity-session"
  | "connected-sources"
  | "following-byof"
  | "feed-mode"
  | "recommendation-policy"
  | "explicit-intent"
  | "attention-mode"
  | "recommendation-feedback"
  | "model-policy"
  | "ai-transformations"
  | "realization-choice"
  | "playback-fallback"
  | "native-offline"
  | "acquisition-recovery"
  | "canonical-availability"
  | "library-continuity"
  | "feed-freshness";

/** Every value of {@link DiscoverableCapabilityId}, in matrix order. */
export const DISCOVERABLE_CAPABILITY_IDS: readonly DiscoverableCapabilityId[] = [
  "identity-session",
  "connected-sources",
  "following-byof",
  "feed-mode",
  "recommendation-policy",
  "explicit-intent",
  "attention-mode",
  "recommendation-feedback",
  "model-policy",
  "ai-transformations",
  "realization-choice",
  "playback-fallback",
  "native-offline",
  "acquisition-recovery",
  "canonical-availability",
  "library-continuity",
  "feed-freshness",
];

/** Runtime membership check against the capability-id union. */
export function isDiscoverableCapabilityId(
  x: unknown,
): x is DiscoverableCapabilityId {
  return (
    typeof x === "string" &&
    (DISCOVERABLE_CAPABILITY_IDS as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// The frozen matrix (the plan's capability-to-surface map, ratified)
// ---------------------------------------------------------------------------

/**
 * THE capability discovery matrix — the typed ratification of the R21
 * plan's capability-to-surface map. FROZEN: the rows' SURFACE BINDINGS
 * (discovery/context/management/recovery) change only through lead
 * ratification; adding capabilities is ADD-ONLY.
 */
export const CAPABILITY_SURFACE_MATRIX: readonly CapabilitySurfaceEntry[] = [
  {
    capability: "identity-session",
    productLabel: "Your account and profiles",
    primaryDiscovery: { surface: "home", control: "session menu" },
    contextualEntries: [
      {
        surface: "home",
        control: "session menu",
        moment: "signed out: a sign-in / create-profile affordance is always visible",
      },
      {
        surface: "settings",
        control: "Session section",
        moment: "reviewing the current identity and its durability",
      },
    ],
    management: { surface: "settings", area: "profile" },
    recovery: {
      state: "sign-in was not accepted or the stored session expired",
      action: "Sign in again",
      detail:
        "The session degrades honestly to the named signed-out state — nothing pretends to be a profile, and the sign-in path is the next action.",
    },
    platformTruth: null,
    j34Task: "identity-profile",
  },
  {
    capability: "connected-sources",
    productLabel: "Connected sources",
    primaryDiscovery: { surface: "home", control: "source strip" },
    contextualEntries: [
      {
        surface: "home",
        control: "empty-state connect-sources call to action",
        moment: "no sources connected yet: the feed explains why it is thin and offers connect",
      },
      {
        surface: "item",
        control: "availability row",
        moment: "asking where a title can be watched",
      },
    ],
    management: { surface: "settings", area: "sources" },
    recovery: {
      state: "a source's sign-in expired or its connection failed",
      action: "Reconnect",
      detail:
        "The expired/failed state is its own named state with its reconnect path — never a silent fallback to disconnected, never a fake connected state.",
    },
    platformTruth: null,
    j34Task: "connect-source",
  },
  {
    capability: "following-byof",
    productLabel: "Following and Bring your feed",
    primaryDiscovery: { surface: "home", control: "feed-mode control" },
    contextualEntries: [
      {
        surface: "home",
        control: "Bring your feed call to action",
        moment: "first-run and empty-feed states: importing an existing feed is offered in context",
      },
      {
        surface: "settings",
        control: "Sources panel import entry",
        moment: "managing sources and imports together",
      },
    ],
    management: { surface: "settings", area: "feeds" },
    recovery: {
      state: "an imported feed's authorization lapsed",
      action: "Reauthorize import",
      detail:
        "The import's freshness truth names the recovery path; disconnecting never deletes WebFlix-local records — deletion is a separate explicit action.",
    },
    platformTruth: {
      platform: "desktop",
      reason:
        "Desktop additionally imports feed files/exports through its filesystem; Web imports through the service's authorized routes.",
      nextStep:
        "On Web, official exports and file imports run through the configured service import flow.",
    },
    j34Task: "bring-own-feed",
  },
  {
    capability: "feed-mode",
    productLabel: "Feed mode (For you / Following / imported / Blend)",
    primaryDiscovery: { surface: "home", control: "feed-mode control" },
    contextualEntries: [
      {
        surface: "watch",
        control: "feed-mode control",
        moment: "browsing long-form: switching the honored relationship without leaving Watch",
      },
      {
        surface: "shorts",
        control: "feed-mode control",
        moment: "in the short feed: the same mode semantics as long-form",
      },
    ],
    management: { surface: "settings", area: "feeds" },
    recovery: {
      state: "the imported-feed mode is selected with no imported feed",
      action: "Bring your feed",
      detail:
        "An unavailable mode is DISCOVERABLE with its explanation and the import next-action — never hidden, never silently swapped for another mode.",
    },
    platformTruth: null,
    j34Task: "feed-mode-choice",
  },
  {
    capability: "recommendation-policy",
    productLabel: "Personalize your recommendations",
    primaryDiscovery: { surface: "home", control: "Personalize control" },
    contextualEntries: [
      {
        surface: "watch",
        control: "feed controls",
        moment: "adjusting why rows compose while browsing",
      },
      {
        surface: "shorts",
        control: "feed controls",
        moment: "the same policy controls in the short feed",
      },
    ],
    management: { surface: "settings", area: "recommendation" },
    recovery: {
      state: "the dials or exploration settings produced an unwanted feed",
      action: "Reset personalization",
      detail:
        "Policy is explicit and user-controlled; resetting returns the balanced defaults without losing watch history.",
    },
    platformTruth: null,
    j34Task: null,
  },
  {
    capability: "explicit-intent",
    productLabel: "Tell WebFlix what you are in the mood for",
    primaryDiscovery: { surface: "home", control: "Personalize control" },
    contextualEntries: [
      {
        surface: "watch",
        control: "current-intent control",
        moment: "stating a temporary intent while browsing (session-scoped, reversible)",
      },
      {
        surface: "shorts",
        control: "current-intent control",
        moment: "the same temporary intent semantics in the short feed",
      },
    ],
    management: { surface: "settings", area: "recommendation" },
    recovery: {
      state: "a temporary intent outlived its welcome",
      action: "Clear intent",
      detail:
        "Temporary intents expire by their own deadline and are clearable on the spot — a recent watch is one signal, never permanent identity.",
    },
    platformTruth: null,
    j34Task: "temporary-intent",
  },
  {
    capability: "attention-mode",
    productLabel: "Attention mode (mindful / balanced / immersive / custom)",
    primaryDiscovery: { surface: "home", control: "Personalize control" },
    contextualEntries: [
      {
        surface: "watch",
        control: "attention-mode control",
        moment: "changing how the session treats time while browsing",
      },
      {
        surface: "shorts",
        control: "attention-mode control",
        moment: "the same modes in the short feed",
      },
    ],
    management: { surface: "settings", area: "recommendation" },
    recovery: {
      state: "an attention mode no longer fits",
      action: "Switch mode",
      detail:
        "Attention modes are policy, not cosmetics — switching changes behavior honestly, and balanced is always the explicit default.",
    },
    platformTruth: null,
    j34Task: "attention-mode",
  },
  {
    capability: "recommendation-feedback",
    productLabel: "More like this / Not interested",
    primaryDiscovery: { surface: "home", control: "row and card feedback controls" },
    contextualEntries: [
      {
        surface: "item",
        control: "item feedback controls",
        moment: "deciding on a specific title (More like this, Not interested, Already watched)",
      },
      {
        surface: "shorts",
        control: "card feedback controls",
        moment: "immediate, reversible feedback in the short feed",
      },
    ],
    management: { surface: "settings", area: "recommendation" },
    recovery: {
      state: "feedback was given by mistake or no longer wanted",
      action: "Undo feedback",
      detail:
        "Feedback is immediate and reversible — undoing restores the signal so future candidate composition is not corrupted by an accident.",
    },
    platformTruth: null,
    j34Task: "recommendation-feedback",
  },
  {
    capability: "model-policy",
    productLabel: "Model & AI controls (WebFlix, bring-your-own, local)",
    primaryDiscovery: { surface: "settings", control: "Model & AI section" },
    contextualEntries: [
      {
        surface: "item",
        control: "AI action tray",
        moment: "launching an AI action from content: the tray names which model class will run",
      },
      {
        surface: "watch",
        control: "player AI action tray",
        moment: "transforming what is playing (subtitles, translation, transcription)",
      },
    ],
    management: { surface: "settings", area: "model" },
    recovery: {
      state: "a bound provider stopped working or was removed",
      action: "Rebind provider",
      detail:
        "The fallback chain keeps AI actions working; the policy view names the preferred provider and its fallbacks, and rebinding restores the chain.",
    },
    platformTruth: {
      platform: "desktop",
      reason:
        "Local-model execution requires the Desktop runtime; Web serves the same policy semantics over its service providers.",
      nextStep:
        "On Web, local-model rows render their honest platform truth with the Desktop next step instead of pretending to run locally.",
    },
    j34Task: "model-controls",
  },
  {
    capability: "ai-transformations",
    productLabel: "AI media actions (subtitles, translate, transcribe, dub, commentary)",
    primaryDiscovery: { surface: "watch", control: "player AI action tray" },
    contextualEntries: [
      {
        surface: "item",
        control: "AI action tray",
        moment: "before playing: the same actions from the decision hub",
      },
    ],
    management: { surface: "settings", area: "model" },
    recovery: {
      state: "a transformation failed, was cancelled, or its result is no longer needed",
      action: "Retry or clear result",
      detail:
        "Every operation is explicit with progress and typed outcomes — retry is offered for recoverable failures, cancellation is explicit, and results are clearable.",
    },
    platformTruth: null,
    j34Task: "ai-action-launch",
  },
  {
    capability: "realization-choice",
    productLabel: "Where to watch (source realization choice)",
    primaryDiscovery: { surface: "item", control: "Where to watch row" },
    contextualEntries: [
      {
        surface: "watch",
        control: "player source switch",
        moment: "playing: switching to another supported realization of the same canonical title",
      },
      {
        surface: "search",
        control: "result availability summary",
        moment: "answering 'where can I watch this?' without opening multiple pages",
      },
    ],
    management: { surface: "settings", area: "sources" },
    recovery: {
      state: "the chosen realization cannot play",
      action: "Switch source",
      detail:
        "One canonical title first, source realizations second — a failed realization offers the next supported one, never a dead end.",
    },
    platformTruth: null,
    j34Task: "playback-realization",
  },
  {
    capability: "playback-fallback",
    productLabel: "Playback inside WebFlix, with an honest handoff",
    primaryDiscovery: { surface: "watch", control: "player surface" },
    contextualEntries: [
      {
        surface: "watch",
        control: "playback failure recovery",
        moment: "when playback fails: the recovery path names the next supported mode",
      },
    ],
    management: { surface: "settings", area: "playback" },
    recovery: {
      state: "playback failed or degraded",
      action: "Try the next way to watch",
      detail:
        "Resolution follows the frozen precedence (native, embed, contained browser, external handoff) — the trace is progressive disclosure, and the recovery action moves to the next rung that can play.",
    },
    platformTruth: {
      platform: "desktop",
      reason:
        "Native playback is a Desktop capability; Web plays embeds, contained browser surfaces, and external handoffs.",
      nextStep:
        "On Web, native-only realizations render the truthful 'plays natively in the Desktop app' next step.",
    },
    j34Task: null,
  },
  {
    capability: "native-offline",
    productLabel: "Make available offline",
    primaryDiscovery: { surface: "item", control: "Make available offline action" },
    contextualEntries: [
      {
        surface: "watch",
        control: "player offline status",
        moment: "acquisition state while watching (Preparing, Buffering, Completing)",
      },
      {
        surface: "library",
        control: "Offline section",
        moment: "finding verified offline assets and replaying them locally",
      },
    ],
    management: { surface: "settings", area: "playback" },
    recovery: {
      state: "an offline acquisition failed or was interrupted",
      action: "Retry download",
      detail:
        "Interruption preserves recoverable state — resuming never falsely claims completion, and failed acquisitions name their recoverable-vs-fatal cause.",
    },
    platformTruth: {
      platform: "desktop",
      reason:
        "Native/offline acquisition requires the Desktop native-media engine; the Web platform honestly cannot execute it.",
      nextStep:
        "On Web the capability is DISCOVERABLE with 'Available offline in the Desktop app' — never a dead 'not available'.",
    },
    j34Task: "desktop-offline-path",
  },
  {
    capability: "acquisition-recovery",
    productLabel: "Download status and recovery",
    primaryDiscovery: { surface: "library", control: "acquisition panel" },
    contextualEntries: [
      {
        surface: "watch",
        control: "player acquisition status",
        moment: "buffering/completing states during playback",
      },
    ],
    management: { surface: "settings", area: "playback" },
    recovery: {
      state: "preparing, buffering, or completing stalls or fails",
      action: "Resume or diagnose",
      detail:
        "The user-facing states are product states (Available, Preparing, Buffering, Playing, Completing, Ready offline, Failed) — protocol detail stays behind the gated advanced-diagnostics disclosure.",
    },
    platformTruth: {
      platform: "desktop",
      reason:
        "Acquisition runs through the Desktop native-media/torrent engine; Web shows the limited status UX only.",
      nextStep:
        "On Web, acquisition panels carry the honest limited-status truth and the Desktop next step.",
    },
    j34Task: null,
  },
  {
    capability: "canonical-availability",
    productLabel: "One title across every source",
    primaryDiscovery: { surface: "item", control: "canonical title header" },
    contextualEntries: [
      {
        surface: "search",
        control: "canonical result grouping",
        moment: "the same title surfaced by several sources appears as one identity with its realizations",
      },
    ],
    management: { surface: "settings", area: "sources" },
    recovery: {
      state: "a source's copy of a title is unavailable",
      action: "See other sources",
      detail:
        "Canonical identity first, realization second — an unavailable realization folds into the availability truth instead of hiding the title.",
    },
    platformTruth: null,
    j34Task: null,
  },
  {
    capability: "library-continuity",
    productLabel: "Watchlist, History, and Continue Watching",
    primaryDiscovery: { surface: "library", control: "Watchlist / History / Offline sections" },
    contextualEntries: [
      {
        surface: "home",
        control: "Continue Watching row",
        moment: "returning: resuming where the last session stopped",
      },
      {
        surface: "watch",
        control: "player resume",
        moment: "resuming a title from its saved position",
      },
    ],
    management: { surface: "settings", area: "profile" },
    recovery: {
      state: "history or watchlist looks wrong or incomplete",
      action: "Review history",
      detail:
        "Library is source-neutral and identity-scoped — the same profile sees the same history on every device, and history controls are explicit.",
    },
    platformTruth: null,
    j34Task: "library-sections",
  },
  {
    capability: "feed-freshness",
    productLabel: "Feed freshness and where it came from",
    primaryDiscovery: { surface: "home", control: "feed header provenance" },
    contextualEntries: [
      {
        surface: "library",
        control: "imported-feed freshness truth",
        moment: "reviewing an imported feed: live, snapshot, or stale — named, never guessed",
      },
    ],
    management: { surface: "settings", area: "feeds" },
    recovery: {
      state: "an imported feed went stale",
      action: "Refresh feed",
      detail:
        "A snapshot is never labeled live; stale captures say why and offer the refresh path the source supports.",
    },
    platformTruth: null,
    j34Task: null,
  },
];

// ---------------------------------------------------------------------------
// Pure lookups (the adapters' consumption surface)
// ---------------------------------------------------------------------------

/**
 * The matrix row of one capability (the typed entry adapters bind their
 * surfaces to). Throws the typed `RuntimeError` (`invalid-input`) for an
 * unknown id — the closed vocabulary is the contract.
 */
export function capabilitySurfaceOf(id: DiscoverableCapabilityId): CapabilitySurfaceEntry {
  const entry = CAPABILITY_SURFACE_MATRIX.find((row) => row.capability === id);
  if (entry === undefined) {
    throw new Error(
      `capabilitySurfaceOf: no matrix row for '${id}' (the closed vocabulary is DISCOVERABLE_CAPABILITY_IDS)`,
    );
  }
  return entry;
}

/**
 * Every matrix row bound to one J34 task (the meta-journey's coverage
 * sweep — J34/J35 evidence verifies each task has a normal product entry
 * through these rows).
 */
export function capabilitiesForJ34Task(task: J34TaskId): readonly CapabilitySurfaceEntry[] {
  return CAPABILITY_SURFACE_MATRIX.filter((row) => row.j34Task === task);
}

// ---------------------------------------------------------------------------
// The stale-completion-copy law (machine-checkable — J35's sweep)
// ---------------------------------------------------------------------------

/**
 * The stale completion-copy patterns that must NOT survive an accepted
 * lane (the frozen UX law: "No stale 'arrives later'/'R0x ships later'
 * copy for accepted lanes — eliminate it at the transport/copy source").
 *
 * J35 (production capability parity) and J34 evidence sweep rendered
 * product copy against these patterns; a hit is a parity defect for a
 * capability the repository marks complete. The patterns deliberately
 * match BOTH user-facing copy and transport-layer detail strings — the
 * "transport-says-unavailable for an accepted capability" mismatch is
 * the same defect family.
 */
export const STALE_COMPLETION_MARKERS: readonly RegExp[] = [
  // "arrives with the X lane", "arrive with R06", "arriving later"…
  /arriv(?:es?|ing)\s+with\s+(?:the\s+)?[\w\s-]*lane/i,
  /arriv(?:es?|ing)\s+later/i,
  // "seeded until personal ranking ships", "until R05", "until then"…
  /seeded\s+until/i,
  /until\s+(?:R\d{1,2}|personal ranking|the\s+[\w\s-]*lane\s+(?:lands|ships))/i,
  // "R06 ships later", "lands with R20", "ships with the model lane",
  // "endpoints land with R04 (history)…"…
  /R\d{1,2}\s+(?:ships|lands|arrives)\s+(?:later|with)/i,
  /(?:ships|lands?|arriv(?:es?|ing))\s+with\s+(?:the\s+)?R\d{1,2}\b/i,
  /lands?\s+with\s+(?:the\s+)?[\w\s-]*lane/i,
];

/**
 * Does one rendered copy string carry stale completion wording? (The J35
 * sweep primitive — pure, total, deterministic.)
 */
export function isStaleCompletionCopy(text: string): boolean {
  return STALE_COMPLETION_MARKERS.some((pattern) => pattern.test(text));
}
