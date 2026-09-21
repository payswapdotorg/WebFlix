/**
 * @wfx/app-desktop — the R24 Desktop YouTube-parity interaction audit
 * (R24-W3 lane, the R24-C pairing matrix walked against the Desktop
 * product surface composition).
 *
 * THE LAW THIS RECORD KEEPS (docs/plans/
 * 2026-09-20-webflix-youtube-parity-performance-plan.md — R24-C + the
 * Worker 3 lane): every row of the plan's feature pairing matrix, walked
 * against the REAL Desktop surface composition, classified with the
 * HONEST current state. The classification vocabulary is the frozen
 * lab contract's (docs/validation/youtube-parity-lab.md):
 *
 * - `parity`             — the same user capability, source-neutral;
 * - `native-equivalent`  — the capability exists with WebFlix-specific
 *   mechanics the multi-source mission requires;
 * - `platform-variant`   — the capability exists where the Desktop
 *   platform truthfully supports it, and says so honestly where it does
 *   not (capability truth, NEVER fake universal support);
 * - `intentionally-out-of-scope` — outside the Universal Entertainment OS
 *   mission, with the reason + the nearest user-facing path.
 *
 * THE HONESTY LAW: a native affordance counts as native-equivalent or
 * platform-variant — NEVER as "missing parity". A row whose affordance is
 * not yet composed on the Desktop surface says exactly that in its
 * `currentState`, names its placement decision, and names the honest
 * next path; a blank classification is a lab failure (the walking test
 * enforces it). The audit is verified MECHANICALLY:
 * `apps/desktop/tests/r24-parity-audit.test.ts` boots the real Desktop
 * composition (the r23-harness doctrine) and checks every row's
 * backing claim against the actual surfaces — this module is the typed
 * record, the test is the proof, `evidence/r24-w3/audit/` is the
 * machine-generated evidence.
 *
 * WHAT THIS MODULE IS NOT: a second parity taxonomy (Worker 1 owns the
 * shared record — this is the DESKTOP walk of the plan's R24-C matrix),
 * or a UI (the rows are the audit record the evidence renders).
 */

// ---------------------------------------------------------------------------
// The classification vocabulary (the frozen lab contract, verbatim)
// ---------------------------------------------------------------------------

/** The frozen parity classification vocabulary (youtube-parity-lab.md). */
export type DesktopParityClassification =
  | "parity"
  | "native-equivalent"
  | "platform-variant"
  | "intentionally-out-of-scope";

/** Every classification value, in frozen order. */
export const DESKTOP_PARITY_CLASSIFICATIONS: readonly DesktopParityClassification[] = [
  "parity",
  "native-equivalent",
  "platform-variant",
  "intentionally-out-of-scope",
] as const;

/** Runtime membership check against the classification union. */
export function isDesktopParityClassification(
  x: unknown,
): x is DesktopParityClassification {
  return (
    typeof x === "string" &&
    (DESKTOP_PARITY_CLASSIFICATIONS as readonly string[]).includes(x)
  );
}

/** The four R24-C matrix sections (the plan's own grouping). */
export type DesktopParitySection =
  | "discovery"
  | "watch-player"
  | "shorts"
  | "identity-continuity";

// ---------------------------------------------------------------------------
// The audit row shape
// ---------------------------------------------------------------------------

/**
 * One walked row of the R24-C pairing matrix against the Desktop product
 * surface composition: the YouTube reference behavior, the plan's WebFlix
 * pairing (verbatim), the classification, and the HONEST current state.
 */
export interface DesktopParityAuditRow {
  /** The stable row id (`r24-<section>-<slug>`). */
  readonly id: string;
  /** The R24-C section the row belongs to. */
  readonly section: DesktopParitySection;
  /** The YouTube reference behavior (the plan's left column, verbatim). */
  readonly referenceCapability: string;
  /** The plan's WebFlix pairing (the right column, verbatim). */
  readonly webflixTreatment: string;
  /** The frozen classification. NEVER blank. */
  readonly classification: DesktopParityClassification;
  /** The honest current state of this pairing on the Desktop composition. */
  readonly currentState: string;
  /** Where a Desktop user meets the capability (the familiar entry point). */
  readonly entryPoint: string;
  /** The Desktop module/surface that backs the row (the walking test's target). */
  readonly desktopBacking: string;
  /**
   * Where the platform-native affordance differs HONESTLY from Web
   * (capability truth — the shared semantics, the platform's own affordance).
   */
  readonly nativeAffordanceNote: string;
  /** The journey/test id that evidences the row. */
  readonly evidence: string;
}

// ---------------------------------------------------------------------------
// The walked matrix (the plan's R24-C rows, in the plan's order)
// ---------------------------------------------------------------------------

/**
 * THE AUDIT: every R24-C row walked against the Desktop product surface
 * composition. 44 rows — Discovery (7), Watch/player (24), Shorts (7),
 * Identity and continuity (6) — exactly the plan's pairing matrix, in the
 * plan's order, each with the honest current state.
 */
export const DESKTOP_PARITY_AUDIT_ROWS: readonly DesktopParityAuditRow[] = [
  // — Discovery (the plan's R24-C Discovery table) —
  {
    id: "r24-discovery-home-feed",
    section: "discovery",
    referenceCapability: "Home feed",
    webflixTreatment: "Home discovery with source-neutral cards and explicit intent controls",
    classification: "native-equivalent",
    currentState:
      "Composed: the runtime's Home read (getHome — Continue Watching + discovery rows over source-neutral canonical cards) plus the R21-G discoverability surface's intent entry (learn / happier / surprise / tonight / friend taste) and attention-mode controls; the Desktop webview renders the same Home grammar the Web adapter renders.",
    entryPoint: "Home (the primary nav rail's first destination)",
    desktopBacking: "@wfx/client-runtime getHome + apps/desktop/src/surface/discoverability-surface.ts",
    nativeAffordanceNote:
      "The fixed Desktop rail replaces the Web top navigation; the card/feed grammar is the shared runtime's own (no platform fork).",
    evidence: "J02/J34 (r21) + J40 walk (r24-w3)",
  },
  {
    id: "r24-discovery-search",
    section: "discovery",
    referenceCapability: "Search",
    webflixTreatment: "Unified source-neutral Search with exact, semantic and moment retrieval",
    classification: "native-equivalent",
    currentState:
      "Composed: the runtime's unified search (search) over canonical identity, with semantic + moment retrieval through the media-intelligence artifacts the local AI surface projects (R39); the Desktop composition serves the same search operations the Web adapter serves.",
    entryPoint: "Search (the nav rail)",
    desktopBacking: "@wfx/client-runtime search + apps/desktop/src/surface/local-ai-surface.ts",
    nativeAffordanceNote:
      "Identical query semantics; the Desktop webview's search field is the same control grammar, not a platform-specific search.",
    evidence: "J05/J39 + J40 walk (r24-w3)",
  },
  {
    id: "r24-discovery-search-suggestions",
    section: "discovery",
    referenceCapability: "Search suggestions",
    webflixTreatment: "WebFlix suggestions plus optional voice/AI query",
    classification: "native-equivalent",
    currentState:
      "Partially composed, honestly: unified search and the AI-query path exist (the local AI surface's transform/query route); the typeahead suggestion strip is not yet a Desktop affordance — the placement decision is made (the search field's dropdown, the same location a mature video product puts it), and the shared suggestion contract is Worker 1's seam when it lands.",
    entryPoint: "Search field (the dropdown where it composes)",
    desktopBacking: "@wfx/client-runtime search + apps/desktop/src/surface/local-ai-surface.ts",
    nativeAffordanceNote:
      "The voice/AI query rides the same search field on every platform; no platform-specific suggestion system.",
    evidence: "J05/J39 + J40 walk (r24-w3)",
  },
  {
    id: "r24-discovery-related-next",
    section: "discovery",
    referenceCapability: "Related/next videos",
    webflixTreatment: "WebFlix recommendation policy + source-neutral realizations",
    classification: "native-equivalent",
    currentState:
      "Composed: the recommendation policy (intents + setRecommendationPolicy, the anti-tunnel controls) drives next-content composition; the player's Up-next affordance (R24-W3) projects the next source-neutral content beside the player, and the realization choice stays the Where-to-watch decision.",
    entryPoint: "Watch page's Up-next rail (beside/below the player)",
    desktopBacking: "@wfx/client-runtime intents/setRecommendationPolicy + apps/desktop/src/surface/player-affordance-surface.ts",
    nativeAffordanceNote:
      "Same policy, same placement grammar as Web; the Desktop rail is the only platform difference.",
    evidence: "J15/J16/J17 + J40 walk (r24-w3)",
  },
  {
    id: "r24-discovery-inline-playback",
    section: "discovery",
    referenceCapability: "Inline playback",
    webflixTreatment: "Inline previews where platform capability and user attention policy allow",
    classification: "platform-variant",
    currentState:
      "Honest capability truth: the attention policy exists (mindful/balanced/immersive/custom gates autoplay-class behavior) and the Desktop webview can host inline surfaces, but the inline-preview surface is not yet composed on Desktop — the placement decision is made (hover/surface preview on discovery cards, under the attention policy), pending the shared inline-preview contract.",
    entryPoint: "Discovery cards (hover preview where it composes)",
    desktopBacking: "@wfx/client-runtime intents (attention modes) + the webview surface capability truth",
    nativeAffordanceNote:
      "Inline preview is gated by the SAME attention policy on every platform; the Desktop window manager makes always-on-top previews possible where the Web cannot — capability truth, never a promise.",
    evidence: "J18 + J40 walk (r24-w3)",
  },
  {
    id: "r24-discovery-subscriptions",
    section: "discovery",
    referenceCapability: "Subscriptions",
    webflixTreatment: "Following plus native/BYOF relationship semantics",
    classification: "native-equivalent",
    currentState:
      "Composed: Following is a feed mode (the runtime's feedMode operations — For you / Following / imported / Blend) and BYOF imports relationship truth through the Desktop file-import path (the frozen FeedPort; the OS dialog + read-root law), with source-native order kept distinct from WebFlix ranking.",
    entryPoint: "Home feed-mode control + Bring Your Feed (source context)",
    desktopBacking: "@wfx/client-runtime feedMode + apps/desktop/src/surface/feed-surface.ts",
    nativeAffordanceNote:
      "The Desktop import path is the NATIVE OS file dialog (wfx_file_pick_open) — the platform variant of the Web's file input; the semantics are the shared frozen FeedPort's.",
    evidence: "J33 + J40 walk (r24-w3)",
  },
  {
    id: "r24-discovery-shorts-surface",
    section: "discovery",
    referenceCapability: "Shorts surface",
    webflixTreatment: "Shorts",
    classification: "parity",
    currentState:
      "Composed: the runtime's shorts feed (shorts) serves the vertical feed; the Desktop webview renders the same vertical Shorts grammar (stable current card, forward skip/rerank, like/save/share after hydration, feedback).",
    entryPoint: "Shorts (the nav rail)",
    desktopBacking: "@wfx/client-runtime shorts",
    nativeAffordanceNote:
      "Wheel/arrow-key paging is the Desktop-native paging affordance where the Web scrolls — same semantics, platform input truth.",
    evidence: "J04/J36 + J40 walk (r24-w3)",
  },

  // — Watch/player (the plan's R24-C Watch/player table) —
  {
    id: "r24-watch-play-pause",
    section: "watch-player",
    referenceCapability: "Play/pause",
    webflixTreatment: "Same familiar control placement and keyboard behavior",
    classification: "parity",
    currentState:
      "Composed: the runtime's PlaybackController (play/pause/pause-resume over the native port's pause/resume) drives the same transport control every realization uses — provider, peer copy, and local alike; the R24 player-affordance surface places the controls (the bottom transport bar) and the keyboard grammar (Space/K) over them.",
    entryPoint: "The player's transport bar + Space/K",
    desktopBacking: "@wfx/client-runtime PlaybackController + apps/desktop/src/surface/player-affordance-surface.ts",
    nativeAffordanceNote:
      "The native rung's pause/resume is the engine process's own command — the same control grammar, the platform's own mechanism.",
    evidence: "J03/J07 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-seek-scrub",
    section: "watch-player",
    referenceCapability: "Seek/scrub",
    webflixTreatment: "Same direct manipulation model",
    classification: "parity",
    currentState:
      "Composed: the controller's typed seek (acceptance = position evidence; external mode answers the typed unsupported failure) plus the R24 scrub model — the progress bar with the truthful buffered runway, the scrub-target preview, and the honest not-yet-verified-range answer for in-progress peer-copy sessions (the deadline declaration path).",
    entryPoint: "The player's progress bar + J/L/arrow keys",
    desktopBacking: "@wfx/client-runtime PlaybackController.seek + apps/desktop/src/surface/player-affordance-surface.ts",
    nativeAffordanceNote:
      "Native seeks go to the engine (the port's own seek); the scrub preview is the same direct-manipulation grammar on every platform.",
    evidence: "J03/J23 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-volume-mute",
    section: "watch-player",
    referenceCapability: "Volume/mute",
    webflixTreatment: "Same player-local control",
    classification: "platform-variant",
    currentState:
      "Honest capability truth: volume/mute is placed in the control grammar (the transport bar's player-local cluster + M/arrow-up/down keys), but the frozen NativeMediaPort contract does not yet expose a volume command — the native path answers the honest not-yet-exposed backing, provider embeds carry their own volume control, and the shared volume seam is an escalation for lead ratification (it extends the frozen port contract).",
    entryPoint: "The player's volume cluster + M / arrow-up/down",
    desktopBacking: "apps/desktop/src/surface/player-affordance-surface.ts (the honest backing: not-exposed on the native rung yet)",
    nativeAffordanceNote:
      "The OS-level volume remains available to the Desktop user (the platform's own affordance); the in-player volume is the shared seam that must be ratified — never a dead button and never a fake control.",
    evidence: "J40 walk (r24-w3) — honest backing asserted",
  },
  {
    id: "r24-watch-fullscreen",
    section: "watch-player",
    referenceCapability: "Fullscreen",
    webflixTreatment: "Same player affordance",
    classification: "platform-variant",
    currentState:
      "Placed with platform truth: the control grammar carries the fullscreen affordance (the player chrome's right cluster + F), and the Desktop realization is the SHELL window's own fullscreen state (the Tauri window command) — the webview-native affordance, honestly named; the shell ride-along is verified through the real-toolchain procedure.",
    entryPoint: "The player's right control cluster + F",
    desktopBacking: "apps/desktop/src/surface/player-affordance-surface.ts + the shell window capability (apps/desktop/shell)",
    nativeAffordanceNote:
      "Desktop fullscreen is the OS window's own state, not a browser Fullscreen API call — the platform variant of the same affordance.",
    evidence: "J40 walk (r24-w3) — placement + honest backing",
  },
  {
    id: "r24-watch-miniplayer-pip",
    section: "watch-player",
    referenceCapability: "Miniplayer/PiP where supported",
    webflixTreatment: "Platform capability equivalent",
    classification: "platform-variant",
    currentState:
      "Placed with platform truth: the affordance grammar carries the miniplayer/PiP entry (the player chrome's right cluster + I), and the Desktop realization is the window manager's picture-in-picture/always-on-top window — honestly NOT yet composed into the shell surface; the placement decision is made, the composition is the follow-up, and the honest state says so.",
    entryPoint: "The player's right control cluster + I",
    desktopBacking: "apps/desktop/src/surface/player-affordance-surface.ts (the honest backing: placed, not yet composed)",
    nativeAffordanceNote:
      "Desktop PiP is an OS window state (always-on-top) — a genuinely platform-native capability the Web approximates with the browser PiP API; capability truth on both.",
    evidence: "J40 walk (r24-w3) — honest backing asserted",
  },
  {
    id: "r24-watch-playback-speed",
    section: "watch-player",
    referenceCapability: "Playback speed",
    webflixTreatment: "Player settings",
    classification: "platform-variant",
    currentState:
      "Honest realization truth: the speed control is placed in the player settings cluster (the same place a mature video product keeps it), the provider embed/browser realizations carry their own speed control, and the native path does not expose a rate command in the frozen NativeMediaPort — the honest where-the-realization-exposes-it answer, pending the shared rate seam's ratification.",
    entryPoint: "The player's settings cluster",
    desktopBacking: "apps/desktop/src/surface/player-affordance-surface.ts (realization-exposed truth)",
    nativeAffordanceNote:
      "Provider embeds answer speed through their own player; the native rung's rate is the frozen port contract's extension to ratify — never a fake control.",
    evidence: "J40 walk (r24-w3) — honest backing asserted",
  },
  {
    id: "r24-watch-quality",
    section: "watch-player",
    referenceCapability: "Quality",
    webflixTreatment: "Source/player quality selection where exposed",
    classification: "platform-variant",
    currentState:
      "Honest realization truth: quality selection rides the realization — provider embeds expose their own quality menu, and the peer-copy/native rung's quality is the torrent's own file-selection truth (the chosen playable file IS the quality decision, made in the Where-to-watch/file-choice step); a native quality ladder is not exposed by the frozen port contract.",
    entryPoint: "The player's settings cluster (provider realizations) / the file-choice step (peer copy)",
    desktopBacking: "apps/desktop/src/surface/player-affordance-surface.ts + apps/desktop/src/platform/torrent-playback.ts (file choice)",
    nativeAffordanceNote:
      "The torrent realization's quality truth is the file selection — an honest structural difference from an adaptive ladder, expressed as capability truth.",
    evidence: "J22/J38 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-captions",
    section: "watch-player",
    referenceCapability: "Captions",
    webflixTreatment: "AI/provider/local subtitle paths",
    classification: "native-equivalent",
    currentState:
      "Composed: the AI/provider/local subtitle paths are the Model Fabric's transform operations (subtitles/translation through model-controls) plus the local AI surface's catalog truth; the player settings cluster places the captions toggle (C) over the same paths the Web player uses.",
    entryPoint: "The player's settings cluster + C",
    desktopBacking: "@wfx/client-runtime modelControls + apps/desktop/src/surface/local-ai-surface.ts",
    nativeAffordanceNote:
      "Local subtitle files ride the Desktop filesystem (the platform's own affordance); AI captions ride the same Model Fabric seam as Web.",
    evidence: "J20/J39 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-transcript",
    section: "watch-player",
    referenceCapability: "Transcript",
    webflixTreatment: "Timestamped transcript",
    classification: "native-equivalent",
    currentState:
      "Composed: the media-intelligence transcript artifact (ordered timestamped segments, honest provenance) is the R39 truth; the player's transcript panel (T) projects it beside the player with timestamp jump — the same 'find the part where…' grammar as Web.",
    entryPoint: "The player's transcript panel + T",
    desktopBacking: "@wfx/model-fabric media-intelligence artifacts + apps/desktop/src/surface/local-ai-surface.ts",
    nativeAffordanceNote:
      "The transcript panel is the same surface grammar; the Desktop panel docks in the window where the Web panel stacks — layout truth, not semantic truth.",
    evidence: "J39 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-chapters",
    section: "watch-player",
    referenceCapability: "Chapters",
    webflixTreatment: "Chapter rail/list + semantic chapter fallback",
    classification: "native-equivalent",
    currentState:
      "Composed: the media-intelligence chapters/scenes artifact (ordered structural units, honest provenance) backs the chapter rail; the semantic chapter fallback (derived chapters where the source provides none) is the same artifact path — the chapter list jumps through the SAME typed seek as the scrub bar.",
    entryPoint: "The player's chapter rail (under the progress bar) / the transcript panel's chapter list",
    desktopBacking: "@wfx/model-fabric media-intelligence artifacts + the typed seek (PlaybackController)",
    nativeAffordanceNote:
      "Chapter markers render on the shared progress bar; the derivation is the artifact's own truth on every platform.",
    evidence: "J39 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-autoplay",
    section: "watch-player",
    referenceCapability: "Autoplay",
    webflixTreatment: "Attention-policy-aware autoplay",
    classification: "native-equivalent",
    currentState:
      "Composed: the autoplay toggle rides the attention policy (mindful/balanced/immersive/custom) — the R24 player-affordance surface projects the toggle's honest state FROM the policy (never a raw always-on switch), so the same control a mature video product puts on the player obeys WebFlix's own attention law.",
    entryPoint: "The Up-next card's autoplay toggle (the player-adjacent placement)",
    desktopBacking: "@wfx/client-runtime intents (attention modes) + apps/desktop/src/surface/player-affordance-surface.ts",
    nativeAffordanceNote:
      "The policy is the shared runtime's own law; the toggle is the familiar placement over it — no platform-specific autoplay semantics.",
    evidence: "J18 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-up-next",
    section: "watch-player",
    referenceCapability: "Up next",
    webflixTreatment: "Source-neutral next content",
    classification: "native-equivalent",
    currentState:
      "Composed: the Up-next projection (R24-W3) presents the next source-neutral content beside the player with the same card grammar as discovery, driven by the recommendation policy's own next-content answer — and the autoplay behavior above is policy-aware.",
    entryPoint: "The Watch page's Up-next rail",
    desktopBacking: "apps/desktop/src/surface/player-affordance-surface.ts (up-next projection over the recommendation policy)",
    nativeAffordanceNote:
      "Same rail, same card grammar; the Desktop docks it in the window's sidebar where the Web stacks it below.",
    evidence: "J17/J18 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-queue",
    section: "watch-player",
    referenceCapability: "Queue",
    webflixTreatment: "Session queue + save queue to Library/playlist where supported",
    classification: "native-equivalent",
    currentState:
      "Composed (R24-W3): the session queue is a player-adjacent affordance — an ordered session-scoped list of canonical items (enqueue from any card's queue action, play-through resolves the head item through the SAME runtime playback path, remove/reorder are the queue's own view operations) with save-queue-to-watchlist as the Library bridge; NO new business rules (every write is a runtime operation), and the shared session-queue contract is Worker 1's seam to reconcile when it lands.",
    entryPoint: "The player's queue rail (the Up-next card's 'Add to queue' entry)",
    desktopBacking: "apps/desktop/src/surface/player-affordance-surface.ts (session queue over runtime ops)",
    nativeAffordanceNote:
      "The queue is session-scoped on every platform (the same mental model as a mature video product's queue); the watchlist is the durable shared state it saves into.",
    evidence: "J40 walk (r24-w3) — enqueue/play-through/save-queue asserted",
  },
  {
    id: "r24-watch-share",
    section: "watch-player",
    referenceCapability: "Share",
    webflixTreatment: "Canonical WebFlix link + source link when appropriate",
    classification: "native-equivalent",
    currentState:
      "Composed: the sharing port (the OS share sheet on Desktop — the platform's native affordance) carries the canonical link plus the source link when appropriate; the share action sits in the player/title action row with the like/save actions.",
    entryPoint: "The title/player action row",
    desktopBacking: "@wfx/platform-contracts sharing port + apps/desktop/src/platform/sharing.ts",
    nativeAffordanceNote:
      "The OS share sheet is the Desktop-native share affordance where the Web uses its own share menu — same semantics, platform mechanism.",
    evidence: "J10/J36 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-like-save",
    section: "watch-player",
    referenceCapability: "Like/save",
    webflixTreatment: "Existing action model",
    classification: "parity",
    currentState:
      "Composed: the action system (dispatchAction — like/save with WebFlix-confirmed vs provider-confirmed truth) and the library's watchlist writes; the actions sit in the title/player action row with share, hydrated honestly per source capability.",
    entryPoint: "The title/player action row",
    desktopBacking: "@wfx/client-runtime dispatchAction + libraryOps",
    nativeAffordanceNote:
      "Identical action semantics on every platform; the confirmation truth (WebFlix-confirmed vs provider-synced) is the shared law.",
    evidence: "J10/J11 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-feedback",
    section: "watch-player",
    referenceCapability: "Feedback",
    webflixTreatment: "Existing recommendation feedback",
    classification: "native-equivalent",
    currentState:
      "Composed: the recommendation feedback vocabulary (More like this / Not interested / Don't recommend source / Already watched — reversible, affecting future composition) rides the card/player feedback menu and the recommendation policy's own seams.",
    entryPoint: "The card's feedback menu + the player's feedback entry",
    desktopBacking: "@wfx/client-runtime setRecommendationPolicy + the feedback action vocabulary (J15)",
    nativeAffordanceNote:
      "The same feedback placement grammar as Web (the card/menu), the same policy effect — the anti-tunnel law is shared.",
    evidence: "J15/J16 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-comments",
    section: "watch-player",
    referenceCapability: "Comments/reactions",
    webflixTreatment: "Provider/social actions where authorized",
    classification: "platform-variant",
    currentState:
      "Honest capability truth: comments/reactions are provider-authorized social actions — the action system carries the provider-action truth (unsupported provider actions never appear successful), and a dedicated comments surface is not yet composed on Desktop; the nearest user-facing path is the provider's own realization (the embed/browser surface where the source hosts the conversation).",
    entryPoint: "The provider realization's own surface (where authorized)",
    desktopBacking: "@wfx/client-runtime dispatchAction (provider-action truth) — no Desktop comments surface yet, honestly",
    nativeAffordanceNote:
      "Comment capability is the provider's own truth on every platform; WebFlix never fabricates a comment system a source does not offer.",
    evidence: "J10/J30 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-watch-history",
    section: "watch-player",
    referenceCapability: "Watch history",
    webflixTreatment: "WebFlix History",
    classification: "parity",
    currentState:
      "Composed: the watch-state engine's history (start/progress/complete events, at-least-once delivery) + the Library's history section; Continue Watching rides the same truth on Home.",
    entryPoint: "Library → History (the nav rail's Library destination)",
    desktopBacking: "@wfx/client-runtime watchState + libraryOps + navigation (Library sections)",
    nativeAffordanceNote:
      "Same history semantics; the Desktop Library window is the platform's presentation of the same section grammar.",
    evidence: "J11/J12 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-watch-later",
    section: "watch-player",
    referenceCapability: "Watch Later",
    webflixTreatment: "Watchlist",
    classification: "native-equivalent",
    currentState:
      "Composed: the watchlist is the Library's explicit-save section (canonical-keyed entries, the default 'Saved' collection); the save action sits on every card and in the title/player action row.",
    entryPoint: "The card/title 'Save' action + Library → Watchlist",
    desktopBacking: "@wfx/client-runtime libraryOps (watchlist writes) + navigation",
    nativeAffordanceNote:
      "The watchlist is the shared durable state; the queue (session-scoped) is its player-adjacent sibling — the same relationship a mature video product keeps.",
    evidence: "J11 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-playlists",
    section: "watch-player",
    referenceCapability: "Playlists",
    webflixTreatment: "WebFlix playlists/library collections",
    classification: "native-equivalent",
    currentState:
      "Composed at the collection level: the watchlist is the library collection ('Saved' is the default named collection) and the session queue's save-queue path lands an ordered batch into it; multiple named playlist collections are not yet exposed as a Desktop affordance — the placement decision is made (the Library's collections row + the save action's target picker), pending the shared playlist contract.",
    entryPoint: "Library → Watchlist (the collections row where it composes)",
    desktopBacking: "@wfx/client-runtime libraryOps (canonical-keyed collections)",
    nativeAffordanceNote:
      "The collection grammar is shared; the Desktop picker is the OS sheet where the Web uses its own dialog — platform affordance, same semantics.",
    evidence: "J11 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-live-playback",
    section: "watch-player",
    referenceCapability: "Live playback",
    webflixTreatment: "Supported live realization",
    classification: "platform-variant",
    currentState:
      "Honest capability truth: live playback is a realization truth (a source that offers a live realization) — the runtime plays any realization the resolver answers, and no Desktop-specific live composition (DVR window, live edge seeking) is exposed yet; the nearest user-facing path is the provider's live realization through the standard player path.",
    entryPoint: "The live item's standard player path (where a source offers it)",
    desktopBacking: "@wfx/client-runtime resolvePlayback (realization truth) — no Desktop live-specific affordance yet, honestly",
    nativeAffordanceNote:
      "Live capability is the source's declaration on every platform; the Desktop native rung can host live media where the engine supports it — capability truth, never a promise.",
    evidence: "J30 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-live-chat",
    section: "watch-player",
    referenceCapability: "Live chat",
    webflixTreatment: "Provider/realization-specific live interaction when supported",
    classification: "platform-variant",
    currentState:
      "Honest capability truth: live chat is a provider-authorized interaction — no WebFlix surface fabricates it, and no Desktop live-chat surface is composed; the nearest user-facing path is the provider's live realization (the embed/browser surface where the source hosts the chat).",
    entryPoint: "The provider live realization's own surface (where authorized)",
    desktopBacking: "capability truth only — the provider's own interaction surface; no fake chat, honestly",
    nativeAffordanceNote:
      "Live chat is the provider's truth; WebFlix carries the realization, never a synthetic audience.",
    evidence: "J30 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-external-handoff",
    section: "watch-player",
    referenceCapability: "External handoff",
    webflixTreatment: "Return-context-preserving source handoff",
    classification: "native-equivalent",
    currentState:
      "Composed: the external playback mode (the OS handoff through the adapter) preserves the return context — the runtime's navigation return-context law (J09); the Desktop handoff is the OS's own open-url path.",
    entryPoint: "The player's 'Open with the source' fallback (the honest next way to watch)",
    desktopBacking: "@wfx/client-runtime resolvePlayback (external mode) + the navigation return context",
    nativeAffordanceNote:
      "The OS URL handoff is the Desktop-native mechanism; the return-context preservation is the shared law.",
    evidence: "J09 + J40 walk (r24-w3)",
  },
  {
    id: "r24-watch-cast",
    section: "watch-player",
    referenceCapability: "Cast/second screen",
    webflixTreatment: "Platform adapter capability, not fake universal support",
    classification: "platform-variant",
    currentState:
      "Honest capability truth: the reference Desktop declares NO cast sink (desktopDeviceCapabilities.casting = false — the frozen surface matrix's own value); the cast affordance is ABSENT from the Desktop control grammar because the platform truthfully does not support it — the honest absence, never a fake cast button and never a silent capability claim.",
    entryPoint: "N/A on Desktop (the capability is honestly absent; the nearest path is the external handoff)",
    desktopBacking: "apps/desktop/src/platform/media-surface.ts (casting: false — the frozen capability truth)",
    nativeAffordanceNote:
      "The absence is the truth: a cast button that cannot cast is a dead button — the design law forbids it; the external handoff is the honest second-screen path.",
    evidence: "J30/J31 + J40 walk (r24-w3) — the honest absence asserted",
  },

  // — Shorts (the plan's R24-C Shorts table) —
  {
    id: "r24-shorts-vertical-swipe",
    section: "shorts",
    referenceCapability: "Vertical swipe/binge",
    webflixTreatment: "ShortsFeed",
    classification: "parity",
    currentState:
      "Composed: the runtime's shorts feed serves the vertical binge feed; the Desktop paging affordance (wheel/arrow keys) is the platform's input truth over the same stable-current-card semantics.",
    entryPoint: "Shorts (the nav rail)",
    desktopBacking: "@wfx/client-runtime shorts",
    nativeAffordanceNote:
      "Wheel/arrow paging vs touch swipe — same feed semantics, the platform's own input affordance.",
    evidence: "J04 + J40 walk (r24-w3)",
  },
  {
    id: "r24-shorts-like-save-share",
    section: "shorts",
    referenceCapability: "Like/save/share",
    webflixTreatment: "Existing hydrated Shorts actions",
    classification: "parity",
    currentState:
      "Composed: the hydrated Shorts actions (like/save/share appear after the feed read hydrates the source's advertised actions — never fabricated where a source does not offer them).",
    entryPoint: "The current Shorts card's action rail",
    desktopBacking: "@wfx/client-runtime shorts + dispatchAction (hydration truth)",
    nativeAffordanceNote:
      "Same action rail; the share rides the OS share sheet on Desktop.",
    evidence: "J04/J36 + J40 walk (r24-w3)",
  },
  {
    id: "r24-shorts-sound-related",
    section: "shorts",
    referenceCapability: "Sound / related content",
    webflixTreatment: "Canonical audio/source links where available",
    classification: "native-equivalent",
    currentState:
      "Composed at the identity level: the canonical source-neutral identity relates the short to its source/audio context (the same item → realizations law); a dedicated sound-page affordance is not yet composed on Desktop — the placement decision is made (the card's related-content entry), pending the shared sound-context contract.",
    entryPoint: "The Shorts card's related-content entry (where it composes)",
    desktopBacking: "@wfx/client-runtime canonical identity + the Where-to-watch decision (realization relations)",
    nativeAffordanceNote:
      "The relation is the canonical identity's own truth — no platform fork.",
    evidence: "J32 + J40 walk (r24-w3)",
  },
  {
    id: "r24-shorts-remix",
    section: "shorts",
    referenceCapability: "Remix/source attribution",
    webflixTreatment: "Authorized source-aware remix/reference path",
    classification: "platform-variant",
    currentState:
      "Honest capability truth: remix is an authorized source capability (a source that permits derivative creation) — the provenance/authorization truth exists (the torrent engine's own provenance law is the same grammar), and a Desktop remix affordance is not composed; the nearest path is the authorized source's own remix surface.",
    entryPoint: "The authorized source's own remix path (where the source permits it)",
    desktopBacking: "capability truth (authorized source actions) — no fabricated remix, honestly",
    nativeAffordanceNote:
      "Remix rights are the source's truth on every platform; WebFlix attributes honestly and never fabricates a right.",
    evidence: "J30 + J40 walk (r24-w3)",
  },
  {
    id: "r24-shorts-clear-screen",
    section: "shorts",
    referenceCapability: "Clear-screen style viewing",
    webflixTreatment: "WebFlix distraction-free presentation under attention policy",
    classification: "native-equivalent",
    currentState:
      "Composed: the attention policy's distraction-free law (mindful/immersive gate the chrome) is the shared runtime's own; the Shorts presentation keeps the stable current card with quiet chrome, and the clear-screen toggle composes under the same policy.",
    entryPoint: "The Shorts surface (chrome quiet under the attention policy)",
    desktopBacking: "@wfx/client-runtime intents (attention modes) + the Shorts presentation law (J04)",
    nativeAffordanceNote:
      "The same policy-driven presentation on every platform — the Desktop window's focus state is an additional platform truth.",
    evidence: "J04/J18 + J40 walk (r24-w3)",
  },
  {
    id: "r24-shorts-speed",
    section: "shorts",
    referenceCapability: "Speed controls",
    webflixTreatment: "Shorts player controls",
    classification: "platform-variant",
    currentState:
      "Honest realization truth (the same law as the long-form speed row): the Shorts speed control is placed in the shorts player's settings cluster; provider realizations carry their own speed, and the native path's rate is not exposed by the frozen port contract — the honest where-exposed answer.",
    entryPoint: "The Shorts player's settings cluster",
    desktopBacking: "apps/desktop/src/surface/player-affordance-surface.ts (realization-exposed truth)",
    nativeAffordanceNote:
      "The same speed truth as the long-form player — one law, two surfaces.",
    evidence: "J40 walk (r24-w3) — honest backing asserted",
  },
  {
    id: "r24-shorts-feedback",
    section: "shorts",
    referenceCapability: "Recommendation feedback",
    webflixTreatment: "Inline Shorts feedback",
    classification: "native-equivalent",
    currentState:
      "Composed: the inline feedback entry on the Shorts card (the same vocabulary + reversible effect as the long-form feedback) — the anti-tunnel law applies to the Shorts feed's future composition.",
    entryPoint: "The Shorts card's inline feedback entry",
    desktopBacking: "@wfx/client-runtime setRecommendationPolicy + the feedback vocabulary (J15)",
    nativeAffordanceNote:
      "The same feedback grammar inline — no platform fork.",
    evidence: "J15/J16 + J40 walk (r24-w3)",
  },

  // — Identity and continuity (the plan's R24-C Identity table) —
  {
    id: "r24-identity-account-history",
    section: "identity-continuity",
    referenceCapability: "Account-based history",
    webflixTreatment: "Account history",
    classification: "parity",
    currentState:
      "Composed: the authenticated profile's server-side history (the watch-state events over the server port, the profile-scoped reads) — the Desktop auth transport carries the same identity truth as Web.",
    entryPoint: "Sign in → Library → History",
    desktopBacking: "@wfx/client-runtime watchState + apps/desktop/src/platform/auth-transport.ts",
    nativeAffordanceNote:
      "The same account history on every platform; the Desktop session store is the platform's own persistence of the same identity.",
    evidence: "J12/J13 + J40 walk (r24-w3)",
  },
  {
    id: "r24-identity-anonymous-viewing",
    section: "identity-continuity",
    referenceCapability: "Anonymous public viewing",
    webflixTreatment: "WebFlix accountless public viewing",
    classification: "native-equivalent",
    currentState:
      "Composed (R23-W3): the open-viewing surface renders the accountless truth (public read/play without a WebFlix login; provider auth never conflated), and anonymous playback keeps session-scoped progress — the R37 law on Desktop.",
    entryPoint: "Fresh launch → browse/play without signing in",
    desktopBacking: "apps/desktop/src/surface/open-viewing-surface.ts + @wfx/client-runtime anonymous-playback-boundary",
    nativeAffordanceNote:
      "The same accountless law; the Desktop first-run surface offers (never requires) sign-in.",
    evidence: "J37 (r23-w3) + J40 walk (r24-w3)",
  },
  {
    id: "r24-identity-cross-device",
    section: "identity-continuity",
    referenceCapability: "Cross-device continuity",
    webflixTreatment: "Shared server-side profile/library state",
    classification: "native-equivalent",
    currentState:
      "Composed: the shared server-side state (profile-scoped library/history/intents through the server port) is the J12/J31 truth — the Desktop is an adapter over the same state, never a fork.",
    entryPoint: "Sign in on any device → the same Library/Continue Watching",
    desktopBacking: "@wfx/client-runtime server-port + watchState/libraryOps (the shared state law)",
    nativeAffordanceNote:
      "Continuity is the server state's own truth; the platform adapters only present it.",
    evidence: "J12/J31 + J40 walk (r24-w3)",
  },
  {
    id: "r24-identity-source-subscriptions",
    section: "identity-continuity",
    referenceCapability: "Source subscription relationships",
    webflixTreatment: "Following + BYOF",
    classification: "native-equivalent",
    currentState:
      "Composed: Following is the feed-mode relationship over connected sources; BYOF imports the existing relationship truth (the Desktop native import path) — the imported feed stays source-native-ordered with provenance, never silently becomes recommendation identity.",
    entryPoint: "Home feed modes + Bring Your Feed",
    desktopBacking: "@wfx/client-runtime feedMode + apps/desktop/src/surface/feed-surface.ts",
    nativeAffordanceNote:
      "The Desktop import is the OS file dialog over the frozen FeedPort — the platform variant of the same import semantics.",
    evidence: "J33 + J40 walk (r24-w3)",
  },
  {
    id: "r24-identity-notifications",
    section: "identity-continuity",
    referenceCapability: "Notifications",
    webflixTreatment: "Web/desktop notification adapter when supported",
    classification: "platform-variant",
    currentState:
      "Composed: the notification port (the OS notification center on Desktop — permissioned, honestly refused where the OS denies) is the platform's native notification affordance; the Web adapter carries its own browser-notification truth.",
    entryPoint: "The OS notification center (where the app notifies)",
    desktopBacking: "apps/desktop/src/platform/notifications.ts + @wfx/platform-contracts notifications port",
    nativeAffordanceNote:
      "OS notifications are a genuine Desktop-native affordance (the platform's own center, permissioned) — capability truth, not a Web fallback.",
    evidence: "notifications tests (r08) + J40 walk (r24-w3)",
  },
  {
    id: "r24-identity-second-screen",
    section: "identity-continuity",
    referenceCapability: "TV/second-screen continuation",
    webflixTreatment: "Platform adapter where supported",
    classification: "platform-variant",
    currentState:
      "Honest capability truth: the reference Desktop declares no cast sink (the frozen capability truth), so TV/second-screen continuation is honestly absent on this platform — the honest next path is the cross-device continuity row's shared state (resume on another device) plus the external handoff; no fake cast continuation is rendered.",
    entryPoint: "N/A on Desktop (honestly absent; the cross-device resume is the honest path)",
    desktopBacking: "apps/desktop/src/platform/media-surface.ts (casting: false) + the cross-device continuity row",
    nativeAffordanceNote:
      "The absence is the platform truth — the shared state makes device handoff honest without claiming a cast the platform cannot do.",
    evidence: "J31 + J40 walk (r24-w3) — the honest absence asserted",
  },
];

// ---------------------------------------------------------------------------
// The distribution (the audit's classification counts)
// ---------------------------------------------------------------------------

/**
 * The classification distribution over the walked matrix (the audit's own
 * honest count — the walking test asserts it matches the rows exactly).
 */
export function desktopParityClassificationDistribution(): Record<
  DesktopParityClassification,
  number
> {
  const distribution: Record<DesktopParityClassification, number> = {
    parity: 0,
    "native-equivalent": 0,
    "platform-variant": 0,
    "intentionally-out-of-scope": 0,
  };
  for (const row of DESKTOP_PARITY_AUDIT_ROWS) {
    distribution[row.classification] += 1;
  }
  return distribution;
}

/** The per-section row counts (the plan's matrix shape, verified). */
export function desktopParitySectionCounts(): Record<DesktopParitySection, number> {
  const counts: Record<DesktopParitySection, number> = {
    discovery: 0,
    "watch-player": 0,
    shorts: 0,
    "identity-continuity": 0,
  };
  for (const row of DESKTOP_PARITY_AUDIT_ROWS) {
    counts[row.section] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// The audit invariants (pure checks the walking test pins)
// ---------------------------------------------------------------------------

/**
 * Every row's non-blank law: the classification is a member of the frozen
 * union, and no row's honest fields are empty (a blank classification is a
 * lab failure; a blank current state is a hidden decision).
 */
export function desktopParityAuditInvariants(): readonly string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const row of DESKTOP_PARITY_AUDIT_ROWS) {
    if (seen.has(row.id)) issues.push(`duplicate row id '${row.id}'`);
    seen.add(row.id);
    if (!isDesktopParityClassification(row.classification)) {
      issues.push(`row '${row.id}' carries a blank/invalid classification`);
    }
    for (const field of [
      row.referenceCapability,
      row.webflixTreatment,
      row.currentState,
      row.entryPoint,
      row.desktopBacking,
      row.nativeAffordanceNote,
      row.evidence,
    ] as const) {
      if (typeof field !== "string" || field.trim().length === 0) {
        issues.push(`row '${row.id}' carries a blank audit field`);
      }
    }
    // The id law: r24-<section-family>-<slug> (the section's first token —
    // "watch" for watch-player, "identity" for identity-continuity).
    const sectionFamily = row.section.split("-")[0]!;
    if (!row.id.startsWith(`r24-${sectionFamily}-`)) {
      issues.push(`row '${row.id}' does not follow the r24-<section>-<slug> id law`);
    }
  }
  return issues;
}
