/**
 * @wfx/client-runtime — the R24 feature capability matrix + placement
 * contracts (Worker 1's shared read model; the R24-B extension law as
 * machine-checkable contracts).
 *
 * THE LAW THIS MODULE FREEZES (docs/plans/
 * 2026-09-20-webflix-youtube-parity-performance-plan.md — R24-B, the
 * "YouTube-consistent WebFlix extension law", applied to EVERY capability
 * through the joined capability matrix):
 *
 * WebFlix adds capabilities YouTube does not have. They remain product
 * features, but they use the same interaction grammar:
 *
 * 1. POINT-OF-INTENT ENCOUNTER — a user encounters the feature at the
 *    point of intent (never settings-only: a WebFlix-only feature exposed
 *    only through Settings/diagnostics is an R24 REJECTION);
 * 2. ONE OBVIOUS PRIMARY ACTION;
 * 3. PROGRESSIVE DISCLOSURE — detail (and diagnostics) disclose in a
 *    ladder: summary -> detail -> diagnostics; raw capability/protocol
 *    diagnostics are never the first thing a user meets;
 * 4. NO DASHBOARD REQUIREMENT — understanding the feature never requires
 *    visiting an architecture/diagnostics dashboard; entry renders inside
 *    the CLOSED product-surface union (Home / Watch / Shorts / Search /
 *    Library / Settings + item/player contexts), where no dashboard route
 *    exists by construction;
 * 5. STABLE STATE AND TERMINOLOGY — state and wording remain stable
 *    between Home, Watch, Shorts and Library (one stable term per
 *    capability; shared terms only inside a declared control family);
 * 6. PLATFORM DIFFERENCES AS CAPABILITY TRUTH — Web/Desktop differences
 *    are expressed as capability truth (supported / capability-dependent /
 *    native-only-next-step), never as redesigned product semantics; the
 *    placement truth must AGREE with the taxonomy's applicability.
 *
 * Plus the R24-E startup hook at the placement level: NO capability may
 * block first-frame playback (`blocksPlayback` is false for every record
 * and machine-checked — nonessential work never blocks; the essential
 * path IS the startup, it does not block it).
 *
 * WHAT THIS MODULE IS: the shared read model that renders parity
 * classification + contextual placement truth for EVERY taxonomy
 * capability — the lab's UX/UI review checklist (primary/secondary
 * actions, disclosure, empty/loading/success/failure states, anonymous vs
 * authenticated behavior, mobile readiness, reduced-motion and keyboard/
 * screen-reader behavior) as typed data. Workers 2/3 bind their parity
 * surfaces to THIS matrix so Web/Desktop cannot diverge in placement
 * semantics; the lead's J40/J42 acceptance verifies against the same
 * contract. DATA + PURE DERIVATIONS ONLY.
 *
 * WHAT THIS MODULE IS NOT: a second product architecture, a navigation
 * system, or UI copy enforcement beyond the one-derivation-source law.
 * The taxonomy (parity-taxonomy.ts) stays the classification owner; this
 * module only adds PLACEMENT truth and joins with it.
 */

import {
  PARITY_TAXONOMY,
  parityTaxonomyRowOf,
  type ParityApplicability,
  type ParityClassification,
  type ParityTaxonomyArea,
  type ParityTaxonomyRowId,
  type ParityTaxonomyRow,
} from "./parity-taxonomy";
import { isProductSurfaceId } from "./discoverability";

// ---------------------------------------------------------------------------
// The disclosure ladder (law 3)
// ---------------------------------------------------------------------------

/**
 * One disclosure level of the progressive-disclosure ladder (law 3), in
 * canonical order: the SUMMARY a user meets first, the DETAIL behind it,
 * and the gated DIAGNOSTICS (raw capability/protocol truth) last.
 */
export type PlacementDisclosureLevel = "summary" | "detail" | "diagnostics";

/** The canonical ladder order (law 3's machine-checkable sequence). */
export const PLACEMENT_DISCLOSURE_LADDER: readonly PlacementDisclosureLevel[] =
  ["summary", "detail", "diagnostics"] as const;

/** Runtime membership check against the disclosure union. */
export function isPlacementDisclosureLevel(
  x: unknown,
): x is PlacementDisclosureLevel {
  return (
    typeof x === "string" &&
    (PLACEMENT_DISCLOSURE_LADDER as readonly string[]).includes(x)
  );
}

// ---------------------------------------------------------------------------
// One placement record (the lab's UX/UI review checklist, typed)
// ---------------------------------------------------------------------------

/**
 * The four states the lab records for every row (the UX/UI review
 * checklist): what the capability looks like empty, loading, succeeded,
 * and failed-with-recovery. The failure view MUST name the useful next
 * action (the R21 recovery law).
 */
export interface PlacementStateViews {
  readonly empty: string;
  readonly loading: string;
  readonly success: string;
  readonly failureRecovery: string;
}

/**
 * The contextual placement truth for ONE capability — the placement half
 * of the capability matrix (the classification half lives in the
 * taxonomy). Entry surfaces are NOT duplicated here: they stay owned by
 * the taxonomy row's `userEntryPoint` (one source of truth); the laws
 * read them through the join.
 */
export interface CapabilityPlacementRecord {
  /** The taxonomy row this placement belongs to (exactly one per row). */
  readonly capability: ParityTaxonomyRowId;
  /**
   * Law 5: the ONE stable user-facing term for the capability — the same
   * wording on Home, Watch, Shorts and Library (the one derivation
   * source; surfaces never invent their own term).
   */
  readonly stableTerm: string;
  /**
   * Law 5: when two capabilities deliberately render the SAME control
   * vocabulary (e.g. "Playback speed" on the Watch player and on Shorts),
   * the shared term is lawful only inside this declared family.
   */
  readonly sharedTermFamily?: string;
  /** Law 2: the ONE obvious primary action (never blank). */
  readonly primaryAction: string;
  /** Secondary actions (disclosed progressively; never duplicates). */
  readonly secondaryActions: readonly string[];
  /** Law 3: the disclosure ladder (starts at "summary", strictly up). */
  readonly disclosure: readonly PlacementDisclosureLevel[];
  /** Law 6: the Web/Desktop capability truth (must agree with the taxonomy). */
  readonly platformTruth: ParityApplicability;
  /** The four honest states (the lab checklist). */
  readonly states: PlacementStateViews;
  /** What an anonymous viewer experiences. */
  readonly anonymousBehavior: string;
  /** What an authenticated viewer additionally experiences. */
  readonly authenticatedBehavior: string;
  /** Future-Mobile law: the semantics are an adapter exercise, not a rewrite. */
  readonly mobileReady: boolean;
  /** Reduced-motion behavior (the design language's motion law). */
  readonly reducedMotionBehavior: string;
  /** Keyboard / screen-reader behavior. */
  readonly keyboardScreenReaderBehavior: string;
  /** The R24-E startup hook: rendering/using this capability NEVER blocks first frame. */
  readonly blocksPlayback: boolean;
  /**
   * Honest label for the few REFERENCE capabilities whose only in-product
   * entry is Settings management (e.g. platform notifications). A
   * WebFlix-only extension can NEVER be settings-managed (law 1/law 4).
   */
  readonly settingsManaged: boolean;
  /** The frozen lab/evidence link for the placement decision. */
  readonly evidence: string;
}

// ---------------------------------------------------------------------------
// THE PLACEMENT MATRIX (one record per taxonomy capability — all 65)
// ---------------------------------------------------------------------------

/**
 * The frozen capability placement matrix — exactly one record for every
 * {@link PARITY_TAXONOMY} row (machine-checked by
 * {@link validateCapabilityPlacementMatrix}).
 */
export const CAPABILITY_PLACEMENTS: readonly CapabilityPlacementRecord[] = [
  // ——— Discovery (the R24-C matrix + the lab inventory) ———
  {
    capability: "home-feed",
    stableTerm: "Home",
    primaryAction: "Browse the feed",
    secondaryActions: ["Personalize", "Set your intent", "Switch feed mode"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Nothing here yet — connect a source or search for something to watch",
      loading: "Loading your feed…",
      success: "Rows of source-neutral cards you can play from",
      failureRecovery: "The feed failed to load — retry, or open Sources to check a connection",
    },
    anonymousBehavior: "Browses with session signals only — no account needed",
    authenticatedBehavior: "Personalized from the profile's policy, intent and history",
    mobileReady: true,
    reducedMotionBehavior: "Hover previews stay off; rows animate without motion",
    keyboardScreenReaderBehavior: "Card grid is tab-navigable; row and card titles are announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "search",
    stableTerm: "Search",
    primaryAction: "Search",
    secondaryActions: ["Filter results", "Open a moment hit"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No results — try different words, or connect another source",
      loading: "Searching your sources…",
      success: "Results across every connected source",
      failureRecovery: "Search failed — retry, or check the source connection",
    },
    anonymousBehavior: "Full search without an account",
    authenticatedBehavior: "Query history and preferences persist with the profile",
    mobileReady: true,
    reducedMotionBehavior: "Result updates replace in place, no motion",
    keyboardScreenReaderBehavior: "Labeled input; results announced as a list; Enter opens the first hit",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "search-suggestions",
    stableTerm: "Suggestions",
    primaryAction: "Pick a suggestion",
    secondaryActions: ["Dismiss suggestions"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No suggestions yet — keep typing",
      loading: "Suggesting…",
      success: "Completion and prediction list under the box",
      failureRecovery: "Suggestions failed silently — search still works without them",
    },
    anonymousBehavior: "Suggestions from canonical titles and moments",
    authenticatedBehavior: "Plus recent-query completion from the profile",
    mobileReady: true,
    reducedMotionBehavior: "List appears without animation",
    keyboardScreenReaderBehavior: "Combobox pattern: arrows move, Escape dismisses, active option announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "natural-language-search",
    stableTerm: "Search by description",
    primaryAction: "Describe what you want",
    secondaryActions: ["Refine with follow-up words"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No semantic results — try describing a scene differently",
      loading: "Understanding your description…",
      success: "Semantically relevant titles and moments",
      failureRecovery: "Semantic search unavailable — plain search still works",
    },
    anonymousBehavior: "Works anonymously per the R23-K low-cost/local AI boundary",
    authenticatedBehavior: "Same capability; durable query history with the profile",
    mobileReady: true,
    reducedMotionBehavior: "Same as plain search",
    keyboardScreenReaderBehavior: "Same input contract as plain search",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "related-next-videos",
    stableTerm: "Related",
    primaryAction: "Open a related item",
    secondaryActions: ["Not interested", "More like this"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Nothing related yet — watch something to build suggestions",
      loading: "Finding related content…",
      success: "Related rail beside the player",
      failureRecovery: "Related content failed to load — playback is unaffected",
    },
    anonymousBehavior: "Session-derived suggestions, no account needed",
    authenticatedBehavior: "Policy-aware related content (anti-tunnel, intent-aware)",
    mobileReady: true,
    reducedMotionBehavior: "Rail scroll is plain; no autoplaying tiles",
    keyboardScreenReaderBehavior: "Navigable list beside the player",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "inline-playback",
    stableTerm: "Preview",
    primaryAction: "Hover or focus a card to preview",
    secondaryActions: ["Keep browsing"],
    disclosure: ["summary"],
    platformTruth: { web: "capability-dependent", desktop: "capability-dependent" },
    states: {
      empty: "No preview for this realization — the card stays static",
      loading: "Preparing preview…",
      success: "Inline preview plays on the card",
      failureRecovery: "Preview cannot start — opening the item still works normally",
    },
    anonymousBehavior: "Previews follow the attention policy, anonymous included",
    authenticatedBehavior: "Same policy truth (the policy persists with the profile)",
    mobileReady: true,
    reducedMotionBehavior: "Previews are fully suppressed under reduced-motion",
    keyboardScreenReaderBehavior: "Preview is opt-in via hover/focus, never the only affordance",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/7640367",
  },
  {
    capability: "subscriptions",
    stableTerm: "Following",
    sharedTermFamily: "following",
    primaryAction: "Follow a source",
    secondaryActions: ["Unfollow", "Open the Following feed"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Not following anyone yet — follow a source from its page or a card",
      loading: "Updating your follows…",
      success: "Follow state visible on cards and the source page",
      failureRecovery: "Follow failed — retry, or reconnect the source",
    },
    anonymousBehavior: "Viewing follows needs no account; creating one does (typed prerequisite, never a wall)",
    authenticatedBehavior: "Durable follow relationships; BYOF may import them",
    mobileReady: true,
    reducedMotionBehavior: "Follow toggle changes state without animation",
    keyboardScreenReaderBehavior: "Follow is a labeled toggle announcing its state",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "shorts-surface",
    stableTerm: "Shorts",
    primaryAction: "Open Shorts",
    secondaryActions: ["Swipe to the next short"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No shorts yet — connect a source with short-form content",
      loading: "Loading Shorts…",
      success: "Vertical feed with the current card stable while presenting",
      failureRecovery: "Shorts failed to load — retry or return to Home",
    },
    anonymousBehavior: "Watch shorts with no account",
    authenticatedBehavior: "Binge position and feedback persist with the profile",
    mobileReady: true,
    reducedMotionBehavior: "Card transitions are instant; no parallax or bounce",
    keyboardScreenReaderBehavior: "Arrow keys page; the current card's title and actions are announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "channel-profile-pages",
    stableTerm: "Source page",
    primaryAction: "Open the source page",
    secondaryActions: ["Follow", "View items"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "This source has no items yet",
      loading: "Loading the source page…",
      success: "The source's items and about info within canonical identity",
      failureRecovery: "Source page failed — retry or check the source connection",
    },
    anonymousBehavior: "Browse any source's public page without an account",
    authenticatedBehavior: "Follow state and authorization-aware actions appear",
    mobileReady: true,
    reducedMotionBehavior: "List updates in place",
    keyboardScreenReaderBehavior: "The source link is a labeled navigation target",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "watch-later",
    stableTerm: "Watchlist",
    primaryAction: "Save to Watchlist",
    secondaryActions: ["Remove from Watchlist", "Play the Watchlist"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Your Watchlist is empty — save something from its card or the player",
      loading: "Saving…",
      success: "Saved — it appears in Library on every device",
      failureRecovery: "Could not save — retry, or check your connection",
    },
    anonymousBehavior: "Session-scoped local saves where supported, honestly labeled as session-only",
    authenticatedBehavior: "Durable, server-side, cross-device Watchlist",
    mobileReady: true,
    reducedMotionBehavior: "Save state changes without animation",
    keyboardScreenReaderBehavior: "Save is a labeled toggle announcing state and result",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/56101",
  },

  // ——— Watch/player (the R24-C matrix + the lab inventory) ———
  {
    capability: "play-pause",
    stableTerm: "Play",
    primaryAction: "Play",
    secondaryActions: ["Pause"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Nothing to play — choose something first",
      loading: "Preparing playback…",
      success: "Playing with familiar control placement and spacebar behavior",
      failureRecovery: "Playback could not start — try another way to watch or retry",
    },
    anonymousBehavior: "Plays public content with no account",
    authenticatedBehavior: "Same play action; watch state records to the profile",
    mobileReady: true,
    reducedMotionBehavior: "No motion on state change",
    keyboardScreenReaderBehavior: "Spacebar toggles; the button's state is announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "seek-scrub",
    stableTerm: "Seek",
    primaryAction: "Drag the timeline to seek",
    secondaryActions: ["Arrow-key jumps"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Timeline appears once playback loads",
      loading: "Seeking…",
      success: "Position jumps to the target with truthful buffered ranges",
      failureRecovery: "Seek failed — the old position is kept (never a fake jump)",
    },
    anonymousBehavior: "Works on public playback",
    authenticatedBehavior: "Seeks sync to canonical resume state",
    mobileReady: true,
    reducedMotionBehavior: "Scrub feedback is immediate, no animation",
    keyboardScreenReaderBehavior: "Arrows seek ±5/10s; the position is announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "volume-mute",
    stableTerm: "Volume",
    primaryAction: "Adjust volume",
    secondaryActions: ["Mute"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Volume control appears with the player",
      loading: "—",
      success: "Player-local volume with a mute toggle",
      failureRecovery: "Volume unavailable on this realization — the player says so honestly",
    },
    anonymousBehavior: "Works on public playback",
    authenticatedBehavior: "Same; the preference persists locally per platform",
    mobileReady: true,
    reducedMotionBehavior: "Slider without animated fill",
    keyboardScreenReaderBehavior: "M is the shortcut; the level is announced as a percentage",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "fullscreen",
    stableTerm: "Fullscreen",
    primaryAction: "Enter fullscreen",
    secondaryActions: ["Exit fullscreen"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Available on the player whenever media plays",
      loading: "—",
      success: "Fullscreen with playback continuing seamlessly",
      failureRecovery: "Fullscreen was refused — playback continues in place",
    },
    anonymousBehavior: "Works on public playback",
    authenticatedBehavior: "Same",
    mobileReady: true,
    reducedMotionBehavior: "Instant transition, no animation",
    keyboardScreenReaderBehavior: "F/Escape toggles; focus is trapped and restored",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "miniplayer-pip",
    stableTerm: "Miniplayer",
    primaryAction: "Open the miniplayer",
    secondaryActions: ["Return to full view", "Close"],
    disclosure: ["summary"],
    platformTruth: { web: "capability-dependent", desktop: "supported" },
    states: {
      empty: "Not offered when the platform cannot keep the realization playing",
      loading: "—",
      success: "Playback continues in a floating surface while you browse",
      failureRecovery: "Miniplayer unavailable — playback stays in place (honest absence)",
    },
    anonymousBehavior: "Works on public playback where supported",
    authenticatedBehavior: "Same",
    mobileReady: true,
    reducedMotionBehavior: "The miniplayer appears without animation",
    keyboardScreenReaderBehavior: "Full control set stays keyboard-reachable in the compact layout",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "playback-speed",
    stableTerm: "Playback speed",
    sharedTermFamily: "playback-speed",
    primaryAction: "Choose a speed",
    secondaryActions: ["Reset to normal"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Offered in player settings when the realization honors speed",
      loading: "—",
      success: "Speed applies immediately and is remembered",
      failureRecovery: "Speed not honored by this realization — the control is absent, not dead",
    },
    anonymousBehavior: "Works on public playback",
    authenticatedBehavior: "Last-used speed persists with the profile",
    mobileReady: true,
    reducedMotionBehavior: "Instant change",
    keyboardScreenReaderBehavior: "Labeled listbox; the active speed is announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "quality",
    stableTerm: "Quality",
    primaryAction: "Choose a quality",
    secondaryActions: ["Set to Auto"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "capability-dependent", desktop: "capability-dependent" },
    states: {
      empty: "No quality ladder exposed by this realization — honestly absent",
      loading: "—",
      success: "Real qualities from the realization's exposed ladder; Auto adapts",
      failureRecovery: "Quality switch failed — playback continues at the current quality",
    },
    anonymousBehavior: "Works on public playback",
    authenticatedBehavior: "Preference persists with the profile",
    mobileReady: true,
    reducedMotionBehavior: "Instant change",
    keyboardScreenReaderBehavior: "Labeled listbox with real quality names; the active one is announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/91449",
  },
  {
    capability: "captions",
    stableTerm: "Captions",
    primaryAction: "Turn captions on",
    secondaryActions: ["Choose language", "Adjust styling"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No captions available for this item yet (provider, local or generated)",
      loading: "Preparing captions…",
      success: "Captions render with the active path's provenance disclosed",
      failureRecovery: "Captions failed to load — playback continues without them",
    },
    anonymousBehavior: "Captions work without an account (R23-K boundary)",
    authenticatedBehavior: "Language/styling preference persists with the profile",
    mobileReady: true,
    reducedMotionBehavior: "Caption cues appear without animation",
    keyboardScreenReaderBehavior: "CC toggles; caption text is a live region when enabled",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "transcript",
    stableTerm: "Transcript",
    primaryAction: "Show transcript",
    secondaryActions: ["Jump to a segment", "Search within transcript"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No transcript yet — it can be generated once available",
      loading: "Preparing the transcript…",
      success: "Timestamped segments scroll with playback",
      failureRecovery: "Transcript unavailable — playback and captions are unaffected",
    },
    anonymousBehavior: "Reads transcripts without an account",
    authenticatedBehavior: "Generated artifacts persist with provenance for the profile",
    mobileReady: true,
    reducedMotionBehavior: "Auto-scroll respects reduced-motion (stops following)",
    keyboardScreenReaderBehavior: "Segments are a navigable list; the current one is announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "chapters",
    stableTerm: "Chapters",
    primaryAction: "Open a chapter",
    secondaryActions: ["Scan chapter titles on the timeline"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No chapters for this item — semantic chapters may be derived later",
      loading: "Loading chapters…",
      success: "Chapter marks on the timeline and a titled list (derived ones labeled)",
      failureRecovery: "Chapters failed to load — seeking still works normally",
    },
    anonymousBehavior: "Works without an account",
    authenticatedBehavior: "Same",
    mobileReady: true,
    reducedMotionBehavior: "Chapter list opens without animation",
    keyboardScreenReaderBehavior: "Chapter stops are keyboard-navigable with titles announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/9884579",
  },
  {
    capability: "autoplay",
    stableTerm: "Autoplay",
    primaryAction: "Toggle autoplay",
    secondaryActions: ["Cancel the countdown"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No next content to autoplay",
      loading: "—",
      success: "Follows the attention policy: countdown + off switch when on; quiet stop when off",
      failureRecovery: "Next content failed — playback of the current item is unaffected",
    },
    anonymousBehavior: "Autoplay needs no account; the session attention policy governs",
    authenticatedBehavior: "The profile's attention policy is the default",
    mobileReady: true,
    reducedMotionBehavior: "Countdown is numeric, no animated ring",
    keyboardScreenReaderBehavior: "The toggle and countdown are announced; Escape cancels",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/6327615",
  },
  {
    capability: "up-next",
    stableTerm: "Up next",
    primaryAction: "Play the up-next item",
    secondaryActions: ["Choose a different next item"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No next content yet",
      loading: "Finding what's next…",
      success: "The next canonical item beside the player",
      failureRecovery: "Up-next failed — playback and the related rail are unaffected",
    },
    anonymousBehavior: "Works from session signals",
    authenticatedBehavior: "Policy-aware next choice",
    mobileReady: true,
    reducedMotionBehavior: "Card updates in place",
    keyboardScreenReaderBehavior: "A labeled navigation target; countdown state announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "queue",
    stableTerm: "Queue",
    primaryAction: "Add to queue",
    secondaryActions: ["Reorder", "Remove", "Save queue"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Queue is empty — add from any card, item or the player",
      loading: "—",
      success: "Plays through in order during the session",
      failureRecovery: "Queue changes failed — playback of the current item is unaffected",
    },
    anonymousBehavior: "Session queue needs no account",
    authenticatedBehavior: "Same; explicit saves persist via Save queue",
    mobileReady: true,
    reducedMotionBehavior: "Reorder without animated dragging",
    keyboardScreenReaderBehavior: "A reorderable list with keyboard move controls",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/9546304",
  },
  {
    capability: "save-queue",
    stableTerm: "Save queue",
    primaryAction: "Save the queue to Library",
    secondaryActions: ["Name the collection"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Nothing queued to save",
      loading: "Saving the queue…",
      success: "Saved as a Library collection on every device",
      failureRecovery: "Could not save — the session queue is kept while you retry",
    },
    anonymousBehavior: "Needs an account (typed sign-in prerequisite, never a wall)",
    authenticatedBehavior: "Durable Library collection",
    mobileReady: true,
    reducedMotionBehavior: "Instant confirmation",
    keyboardScreenReaderBehavior: "Confirm/retry states are announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/57792",
  },
  {
    capability: "share",
    stableTerm: "Share",
    primaryAction: "Copy the WebFlix link",
    secondaryActions: ["Open share targets", "Copy the source link"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "—",
      loading: "—",
      success: "Canonical link ready to share",
      failureRecovery: "Copy failed — select the link manually",
    },
    anonymousBehavior: "Shares without an account",
    authenticatedBehavior: "Same",
    mobileReady: true,
    reducedMotionBehavior: "Dialog opens without animation",
    keyboardScreenReaderBehavior: "Labeled dialog with focus management; the link is keyboard-copyable",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "like-save",
    stableTerm: "Like / Save",
    primaryAction: "Like",
    secondaryActions: ["Save to Watchlist", "Undo"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Appears when the source advertises the action",
      loading: "Recording your action…",
      success: "State confirmed with provider-confirmed vs WebFlix-recorded truth",
      failureRecovery: "The action failed — nothing is shown as successful (J10 law)",
    },
    anonymousBehavior: "Needs an account (typed prerequisite — the action is durable)",
    authenticatedBehavior: "Durable; provider-synced where the provider confirms",
    mobileReady: true,
    reducedMotionBehavior: "Toggle state without animation",
    keyboardScreenReaderBehavior: "Labeled toggles announcing state and sync truth",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "negative-feedback",
    stableTerm: "Not interested",
    sharedTermFamily: "feedback",
    primaryAction: "Tell us why (feedback menu)",
    secondaryActions: ["Undo", "Don't recommend this source", "I've already watched this"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Available wherever recommendations render",
      loading: "Applying your feedback…",
      success: "Future composition changes; the action is reversible",
      failureRecovery: "Feedback failed — nothing silently claimed",
    },
    anonymousBehavior: "Needs an account for durable effect (typed prerequisite)",
    authenticatedBehavior: "Durable policy input, reversible",
    mobileReady: true,
    reducedMotionBehavior: "Menu opens without animation",
    keyboardScreenReaderBehavior: "Menu items state their effect; applied changes are announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "comments-reactions",
    stableTerm: "Comments",
    primaryAction: "Read comments",
    secondaryActions: ["Reply", "React (where authorized)"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "capability-dependent", desktop: "capability-dependent" },
    states: {
      empty: "Comments are off or unavailable for this source — honestly absent",
      loading: "Loading comments…",
      success: "Provider-authorized comment interaction renders below the player",
      failureRecovery: "Comments failed — playback is unaffected; retry or continue watching",
    },
    anonymousBehavior: "Reading where the source allows it; interacting may require the provider's authorization",
    authenticatedBehavior: "Provider-confirmed interactions with sync truth",
    mobileReady: true,
    reducedMotionBehavior: "List loads without animation",
    keyboardScreenReaderBehavior: "Navigable list with labeled actions",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "description-links",
    stableTerm: "Description",
    primaryAction: "Expand the description",
    secondaryActions: ["Open a link", "Jump to a timestamp"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No description for this item",
      loading: "Loading details…",
      success: "Expandable metadata with links and timestamp jumps",
      failureRecovery: "Details failed — playback is unaffected",
    },
    anonymousBehavior: "Reads without an account",
    authenticatedBehavior: "Same",
    mobileReady: true,
    reducedMotionBehavior: "Expand/collapse without animation",
    keyboardScreenReaderBehavior: "Disclosed region with announced state; links are focusable",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "continue-watching",
    stableTerm: "Continue watching",
    primaryAction: "Continue",
    secondaryActions: ["Start over", "Remove from the row"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Nothing in progress yet — anything you watch shows up here",
      loading: "—",
      success: "In-progress items with remaining time and one Continue action",
      failureRecovery: "The row failed — items remain playable from Search/Home",
    },
    anonymousBehavior: "Session-scoped resume within the anonymous session",
    authenticatedBehavior: "Cross-device resume from canonical watch state",
    mobileReady: true,
    reducedMotionBehavior: "Row updates in place",
    keyboardScreenReaderBehavior: "Cards announce elapsed/remaining time; Continue is one action",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "watch-history",
    stableTerm: "History",
    sharedTermFamily: "history",
    primaryAction: "Open History",
    secondaryActions: ["Remove an entry", "Clear history"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Nothing watched yet — your watched items appear here",
      loading: "Loading History…",
      success: "One chronological list across every realization you watched",
      failureRecovery: "History failed — retry; playback is unaffected",
    },
    anonymousBehavior: "Needs an account for durable history (typed prerequisite)",
    authenticatedBehavior: "Durable server-side history with real removal",
    mobileReady: true,
    reducedMotionBehavior: "List without animation",
    keyboardScreenReaderBehavior: "Navigable list with per-item remove controls",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "playlists",
    stableTerm: "Playlists",
    primaryAction: "Save to a playlist",
    secondaryActions: ["Create a playlist", "Reorder", "Remove"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No playlists yet — create one from any card or the player",
      loading: "Saving…",
      success: "Ordered collections that play through",
      failureRecovery: "Could not save — retry; playback is unaffected",
    },
    anonymousBehavior: "Needs an account (typed prerequisite)",
    authenticatedBehavior: "Durable collections, cross-device",
    mobileReady: true,
    reducedMotionBehavior: "Reorder without animated dragging",
    keyboardScreenReaderBehavior: "Editing is keyboard-operable with announced results",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/57792",
  },
  {
    capability: "external-handoff",
    stableTerm: "Open in source",
    primaryAction: "Open in the source app/site",
    secondaryActions: ["Come back to WebFlix"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Offered only when a realization is external",
      loading: "—",
      success: "Opens at the provider; return context is preserved",
      failureRecovery: "The provider could not open — choose another way to watch",
    },
    anonymousBehavior: "Works without an account",
    authenticatedBehavior: "Return resumes from the canonical position",
    mobileReady: true,
    reducedMotionBehavior: "No animation",
    keyboardScreenReaderBehavior: "A labeled action explaining where it goes and how to return",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "live-playback",
    stableTerm: "Live",
    primaryAction: "Join live",
    secondaryActions: ["Seek within DVR (where offered)"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "capability-dependent", desktop: "capability-dependent" },
    states: {
      empty: "No live realization for this item",
      loading: "Joining live…",
      success: "Playing at the live edge with honest LIVE state",
      failureRecovery: "Live cannot start — the next supported way to watch is offered",
    },
    anonymousBehavior: "Watches public live content without an account",
    authenticatedBehavior: "Same",
    mobileReady: true,
    reducedMotionBehavior: "LIVE badge without pulsing animation",
    keyboardScreenReaderBehavior: "LIVE state announced; timeline reflects DVR truth",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/15270973",
  },
  {
    capability: "live-chat",
    stableTerm: "Live chat",
    primaryAction: "Join the chat",
    secondaryActions: ["Pause the stream", "Dismiss chat"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "capability-dependent", desktop: "capability-dependent" },
    states: {
      empty: "Chat unavailable for this stream — honestly absent",
      loading: "Connecting to chat…",
      success: "Provider chat beside the player, dismissible without affecting playback",
      failureRecovery: "Chat disconnected — playback continues",
    },
    anonymousBehavior: "Viewing where the provider allows; posting may require provider authorization",
    authenticatedBehavior: "Provider-confirmed interaction",
    mobileReady: true,
    reducedMotionBehavior: "Chat is a live region; auto-scroll can be paused",
    keyboardScreenReaderBehavior: "Dismissible region; playback controls remain reachable",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/15270973",
  },
  {
    capability: "live-replay",
    stableTerm: "Replay",
    primaryAction: "Replay",
    secondaryActions: ["Find it in History"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "The stream is still live",
      loading: "Preparing the replay…",
      success: "Plays as an ordinary item with VOD semantics",
      failureRecovery: "Replay unavailable — it appears in History when ready",
    },
    anonymousBehavior: "Replays without an account",
    authenticatedBehavior: "Enters History like any watch",
    mobileReady: true,
    reducedMotionBehavior: "No transition animation",
    keyboardScreenReaderBehavior: "VOD semantics announced; no dead live chrome",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },

  // ——— Shorts (the R24-C matrix) ———
  {
    capability: "shorts-vertical-swipe",
    stableTerm: "Shorts feed",
    primaryAction: "Swipe to the next short",
    secondaryActions: ["Go back", "Open the item"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No shorts in this feed",
      loading: "Loading the next short…",
      success: "Vertical paging with the current card stable while presenting",
      failureRecovery: "This short cannot play — swipe on or open its item for other ways to watch",
    },
    anonymousBehavior: "Binge without an account",
    authenticatedBehavior: "Binge position persists with the profile",
    mobileReady: true,
    reducedMotionBehavior: "Instant card changes; no bounce or parallax",
    keyboardScreenReaderBehavior: "Up/down/space page; the current card is announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/13363900",
  },
  {
    capability: "shorts-like-save-share",
    stableTerm: "Shorts actions",
    primaryAction: "Like",
    secondaryActions: ["Save", "Share", "Undo"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Appears when the source advertises shorts actions",
      loading: "Recording your action…",
      success: "Hydrated provider actions on the same screen",
      failureRecovery: "The action failed — no dead button is shown (J36 law)",
    },
    anonymousBehavior: "Needs an account (typed prerequisite)",
    authenticatedBehavior: "Durable, provider-synced where confirmed",
    mobileReady: true,
    reducedMotionBehavior: "State change without animation",
    keyboardScreenReaderBehavior: "Labeled buttons announcing state",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "shorts-sound-related",
    stableTerm: "Sound",
    primaryAction: "Open the sound/source relation",
    secondaryActions: ["Browse related shorts"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No sound/source relation for this short",
      loading: "—",
      success: "Canonical audio/source links where available",
      failureRecovery: "Relations failed — the short keeps playing",
    },
    anonymousBehavior: "Works without an account",
    authenticatedBehavior: "Same",
    mobileReady: true,
    reducedMotionBehavior: "No animation",
    keyboardScreenReaderBehavior: "A labeled link announcing what it leads to",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "shorts-remix-attribution",
    stableTerm: "Remix",
    primaryAction: "Remix (where authorized)",
    secondaryActions: ["View attribution"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "capability-dependent", desktop: "capability-dependent" },
    states: {
      empty: "Remix not authorized for this source — honestly absent",
      loading: "Preparing the remix path…",
      success: "Authorized source-aware remix/reference with attribution",
      failureRecovery: "Remix unavailable — the short keeps playing",
    },
    anonymousBehavior: "Provider authorization governs (never a WebFlix account wall)",
    authenticatedBehavior: "Same provider-authorization truth",
    mobileReady: true,
    reducedMotionBehavior: "No animation",
    keyboardScreenReaderBehavior: "The attribution is explained before use",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/10623810",
  },
  {
    capability: "shorts-clear-screen",
    stableTerm: "Clear screen",
    primaryAction: "Clear the screen",
    secondaryActions: ["Restore controls"],
    disclosure: ["summary"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "—",
      loading: "—",
      success: "Distraction-free presentation under the attention policy",
      failureRecovery: "Controls restore on any input",
    },
    anonymousBehavior: "Works without an account",
    authenticatedBehavior: "Same",
    mobileReady: true,
    reducedMotionBehavior: "Instant chrome dismissal",
    keyboardScreenReaderBehavior: "An accessible restore affordance always remains",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "shorts-speed-controls",
    stableTerm: "Playback speed",
    sharedTermFamily: "playback-speed",
    primaryAction: "Choose a speed",
    secondaryActions: ["Reset to normal"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Offered when the realization honors speed",
      loading: "—",
      success: "Same speed semantics as the long-form player",
      failureRecovery: "Speed not honored — the control is absent, not dead",
    },
    anonymousBehavior: "Works without an account",
    authenticatedBehavior: "Preference shared with the long-form player",
    mobileReady: true,
    reducedMotionBehavior: "Instant change",
    keyboardScreenReaderBehavior: "Same selector semantics as the player",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "shorts-inline-feedback",
    stableTerm: "Not interested",
    sharedTermFamily: "feedback",
    primaryAction: "Open the feedback menu",
    secondaryActions: ["Undo", "More like this"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Available on every shorts card",
      loading: "Applying your feedback…",
      success: "The feed policy adjusts; the action is reversible",
      failureRecovery: "Feedback failed — nothing silently claimed",
    },
    anonymousBehavior: "Needs an account for durable effect (typed prerequisite)",
    authenticatedBehavior: "Durable, reversible policy input",
    mobileReady: true,
    reducedMotionBehavior: "Menu opens without animation",
    keyboardScreenReaderBehavior: "Same menu semantics as long-form feedback",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },

  // ——— Identity and continuity (the R24-C matrix + the lab inventory) ———
  {
    capability: "anonymous-public-viewing",
    stableTerm: "Watch now",
    primaryAction: "Just watch — no account needed",
    secondaryActions: ["Sign in for extras"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "—",
      loading: "—",
      success: "Public playback with zero login walls",
      failureRecovery: "A provider gap names the provider's authorization — never a WebFlix sign-in wall",
    },
    anonymousBehavior: "The whole point: full public viewing, honestly session-scoped",
    authenticatedBehavior: "Same viewing plus durable state",
    mobileReady: true,
    reducedMotionBehavior: "No interstitial animations",
    keyboardScreenReaderBehavior: "No auth modal traps focus on public playback",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/webflix-golden-journeys.md",
  },
  {
    capability: "account-history",
    stableTerm: "History",
    sharedTermFamily: "history",
    primaryAction: "Open History",
    secondaryActions: ["Remove an entry"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Nothing watched on this account yet",
      loading: "Loading History…",
      success: "Account history across every device",
      failureRecovery: "History failed — retry; nothing is lost",
    },
    anonymousBehavior: "Needs an account (typed prerequisite)",
    authenticatedBehavior: "Durable, server-side, cross-device",
    mobileReady: true,
    reducedMotionBehavior: "List without animation",
    keyboardScreenReaderBehavior: "Navigable list with remove controls",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "cross-device-continuity",
    stableTerm: "Continue anywhere",
    primaryAction: "Sign in to continue everywhere",
    secondaryActions: ["Continue on this device only"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Not signed in — viewing continues in this session",
      loading: "Syncing your state…",
      success: "Position, library and preferences follow you between devices",
      failureRecovery: "Sync lag is honest — the local state stays usable",
    },
    anonymousBehavior: "Session-only continuity, honestly labeled",
    authenticatedBehavior: "Canonical server-side state on every device",
    mobileReady: true,
    reducedMotionBehavior: "No transition animation",
    keyboardScreenReaderBehavior: "Sign-in states announced without nagging",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "source-subscription-relationships",
    stableTerm: "Following",
    sharedTermFamily: "following",
    primaryAction: "Bring Your Feed",
    secondaryActions: ["Preview the import", "Confirm", "Disconnect"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Nothing imported — start from a connected source or an official export",
      loading: "Importing and reconciling…",
      success: "Imported relationships with provenance and freshness truth",
      failureRecovery: "The import failed — nothing was half-applied; retry is safe (idempotent)",
    },
    anonymousBehavior: "Needs an account (typed prerequisite)",
    authenticatedBehavior: "Authorized import/sync with source-native order preserved",
    mobileReady: true,
    reducedMotionBehavior: "Progress without animated spinners",
    keyboardScreenReaderBehavior: "Preview/confirm steps are keyboard-operable with announced results",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/architecture/byof-architecture.md",
  },
  {
    capability: "notifications",
    stableTerm: "Notifications",
    primaryAction: "Manage notifications",
    secondaryActions: ["Turn a source's notifications on/off"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "capability-dependent", desktop: "capability-dependent" },
    states: {
      empty: "No notifications yet — follow sources to get them",
      loading: "—",
      success: "New-content notifications through the platform's system, where supported",
      failureRecovery: "The platform refused notifications — preferences stay intact",
    },
    anonymousBehavior: "Needs an account (typed prerequisite)",
    authenticatedBehavior: "Followed-source notifications via the adapter",
    mobileReady: true,
    reducedMotionBehavior: "Permission prompts happen in context",
    keyboardScreenReaderBehavior: "Permission state and outcomes are announced",
    blocksPlayback: false,
    settingsManaged: true,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "tv-second-screen-continuation",
    stableTerm: "Cast",
    primaryAction: "Cast to a screen (where supported)",
    secondaryActions: ["Disconnect"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "capability-dependent", desktop: "capability-dependent" },
    states: {
      empty: "No castable target or the platform cannot cast — honestly absent",
      loading: "Connecting…",
      success: "Playback continues on the target screen",
      failureRecovery: "Casting failed — playback continues here (never lost)",
    },
    anonymousBehavior: "Works without an account where the platform supports it",
    authenticatedBehavior: "Same (resume is canonical watch state)",
    mobileReady: true,
    reducedMotionBehavior: "Target list appears without animation",
    keyboardScreenReaderBehavior: "The cast control is labeled; state is announced; absent where unsupported",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "https://support.google.com/youtube/answer/7640706",
  },
  {
    capability: "device-handoff",
    stableTerm: "Continue on another device",
    primaryAction: "Open on the other device and continue",
    secondaryActions: ["Send the link"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No other signed-in device yet",
      loading: "—",
      success: "The same item at the same position on the other device",
      failureRecovery: "The other device is behind — the position syncs when it reconnects",
    },
    anonymousBehavior: "Session-scoped only (honest: no durable identity to hand off)",
    authenticatedBehavior: "Canonical cross-device resume (J31)",
    mobileReady: true,
    reducedMotionBehavior: "No animation",
    keyboardScreenReaderBehavior: "Handoff states announced; one obvious resume action",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "offline-viewing",
    stableTerm: "Offline",
    sharedTermFamily: "offline",
    primaryAction: "Watch offline (Desktop)",
    secondaryActions: ["Verify integrity", "Open in Library"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "native-only-next-step", desktop: "supported" },
    states: {
      empty: "No offline assets yet — an available authorized copy can be made offline",
      loading: "Preparing and verifying…",
      success: "Verified local assets play with the same item semantics",
      failureRecovery: "Verification failed — the asset is NOT shown as ready offline (honest integrity)",
    },
    anonymousBehavior: "Needs an account (typed prerequisite)",
    authenticatedBehavior: "Verified offline Library on Desktop; Web shows the honest Desktop next step",
    mobileReady: false,
    reducedMotionBehavior: "Progress is numeric; never a fake spinner",
    keyboardScreenReaderBehavior: "Verified/needs-verification states are announced per item",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/webflix-golden-journeys.md",
  },

  // ——— WebFlix-only extensions (the complete R24-B list) ———
  {
    capability: "canonical-identity",
    stableTerm: "The title",
    primaryAction: "Open the title",
    secondaryActions: ["See where to watch"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "—",
      loading: "—",
      success: "One canonical title with sources as secondary truth everywhere",
      failureRecovery: "Identity could not resolve — search again or check the connection",
    },
    anonymousBehavior: "Source-neutral identity for every viewer",
    authenticatedBehavior: "Same identity plus durable resume/actions on it",
    mobileReady: true,
    reducedMotionBehavior: "No animation",
    keyboardScreenReaderBehavior: "The title is announced first; the source second",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "where-to-watch",
    stableTerm: "Where to watch",
    primaryAction: "Choose where to watch",
    secondaryActions: ["Switch realization", "See capability truth"],
    disclosure: ["summary", "detail", "diagnostics"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No supported way to watch right now — the honest reason is shown",
      loading: "Resolving ways to watch…",
      success: "A familiar source picker: WebFlix, authorized peer copy, provider, external",
      failureRecovery: "The chosen way failed — the picker reopens with the next supported option",
    },
    anonymousBehavior: "Picks a way to watch with no account",
    authenticatedBehavior: "Same; the choice persists per item with the profile",
    mobileReady: true,
    reducedMotionBehavior: "Picker opens without animation",
    keyboardScreenReaderBehavior: "A labeled list of ways to watch; the active one is announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "authorized-peer-copy",
    stableTerm: "Authorized peer copy",
    primaryAction: "Play the authorized peer copy",
    secondaryActions: ["Check progress", "Keep for offline"],
    disclosure: ["summary", "detail", "diagnostics"],
    platformTruth: { web: "capability-dependent", desktop: "supported" },
    states: {
      empty: "No authorized peer copy available for this title",
      loading: "Preparing — honest product states (Preparing/Buffering), never fake progress",
      success: "Plays with the same player language as any way to watch",
      failureRecovery: "The peer copy could not start — Where to watch reopens with other options",
    },
    anonymousBehavior: "Plays an authorized public peer copy without an account",
    authenticatedBehavior: "Same; background completion and offline keep going with the profile",
    mobileReady: false,
    reducedMotionBehavior: "Progress is numeric and truthful",
    keyboardScreenReaderBehavior: "Acquisition states are announced in product vocabulary; protocol details stay disclosed",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "bring-your-own-feed",
    stableTerm: "Bring Your Feed",
    primaryAction: "Bring Your Feed",
    secondaryActions: ["Preview the import", "Confirm", "Sync", "Disconnect"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No imported feed — start from a connected source or an official export",
      loading: "Importing your relationships…",
      success: "Your imported feed with source-native order and freshness truth",
      failureRecovery: "The import failed — nothing was half-applied; retry is idempotent",
    },
    anonymousBehavior: "Needs an account (typed sign-in prerequisite — never a wall on viewing)",
    authenticatedBehavior: "Authorized import/sync with provenance preserved",
    mobileReady: false,
    reducedMotionBehavior: "Progress without animated spinners",
    keyboardScreenReaderBehavior: "Preview/confirm steps are keyboard-operable with announced results",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/architecture/byof-architecture.md",
  },
  {
    capability: "feed-modes",
    stableTerm: "Feed mode",
    primaryAction: "Switch feed mode",
    secondaryActions: ["For you", "Following", "Your imported feed", "Blend"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Only For you is available until you connect/import (stated honestly)",
      loading: "—",
      success: "A segmented control on Home; the active mode is clear",
      failureRecovery: "A mode failed to load — the active mode stays; the reason is shown",
    },
    anonymousBehavior: "For you works; other modes show their honest prerequisite",
    authenticatedBehavior: "All available modes with their real availability truth",
    mobileReady: false,
    reducedMotionBehavior: "Segmented control changes without animation",
    keyboardScreenReaderBehavior: "Keyboard-operable with the active mode announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "session-intent",
    stableTerm: "Your intent",
    primaryAction: "Tell WebFlix what you're in the mood for",
    secondaryActions: ["Clear the intent"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No intent set — the feed works from your usual signals",
      loading: "Applying your intent…",
      success: "A temporary context shapes this session and clears when you leave",
      failureRecovery: "The intent could not apply — the feed keeps working normally",
    },
    anonymousBehavior: "Session intent without an account",
    authenticatedBehavior: "Same session semantics; durable intent history is separate",
    mobileReady: true,
    reducedMotionBehavior: "The prompt appears in place, not as a flying banner",
    keyboardScreenReaderBehavior: "Dismissible without answering; announced and clearable in one action",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "attention-policy",
    stableTerm: "Attention mode",
    primaryAction: "Choose an attention mode",
    secondaryActions: ["Mindful", "Balanced", "Immersive", "Custom"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "—",
      loading: "—",
      success: "The mode governs autoplay/inline/distraction-free behavior immediately",
      failureRecovery: "—",
    },
    anonymousBehavior: "A session attention mode works without an account",
    authenticatedBehavior: "The profile's mode persists across devices",
    mobileReady: true,
    reducedMotionBehavior: "The selector changes without animation",
    keyboardScreenReaderBehavior: "The four modes are labeled with their effects; the active one is announced",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "anti-tunnel-controls",
    stableTerm: "Recommendation steering",
    primaryAction: "Steer your recommendations",
    secondaryActions: ["More like this", "Not interested", "Already watched"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Available wherever recommendations render",
      loading: "Applying your steering…",
      success: "The feed explores beyond the last topic; a recent watch stays one signal",
      failureRecovery: "Steering failed — nothing silently claimed",
    },
    anonymousBehavior: "Needs an account for durable policy (typed prerequisite)",
    authenticatedBehavior: "Durable policy inputs, reversible (J16 anti-tunnel truth)",
    mobileReady: true,
    reducedMotionBehavior: "Menu opens without animation",
    keyboardScreenReaderBehavior: "Same vocabulary as the feedback menu, with announced effects",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/webflix-golden-journeys.md",
  },
  {
    capability: "model-selection",
    stableTerm: "Model",
    primaryAction: "Choose the model powering a feature",
    secondaryActions: ["Manage providers (Model & AI)"],
    disclosure: ["summary", "detail", "diagnostics"],
    platformTruth: { web: "capability-dependent", desktop: "supported" },
    states: {
      empty: "The default WebFlix model runs — nothing to configure to watch",
      loading: "—",
      success: "An optional selector in the AI tray; management in Model & AI",
      failureRecovery: "A provider is unusable — the default model takes over honestly",
    },
    anonymousBehavior: "Watching needs no model choice at all",
    authenticatedBehavior: "BYOM/local model policy persists; local models run where the platform supports them",
    mobileReady: true,
    reducedMotionBehavior: "Selector changes without animation",
    keyboardScreenReaderBehavior: "Privacy/execution truth (cloud vs local) is labeled plainly",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "ai-transformations",
    stableTerm: "AI actions",
    primaryAction: "Run an AI action on this content",
    secondaryActions: ["Transcribe", "Translate", "Dub", "Commentary", "Ask about this video"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No AI actions available for this content yet",
      loading: "Working… with real, cancellable progress",
      success: "The result renders (e.g. transcript) with model/provenance truth",
      failureRecovery: "The action failed — playback is untouched; retry or choose another action",
    },
    anonymousBehavior: "Low-cost/local AI per the R23-K boundary (no login wall)",
    authenticatedBehavior: "Durable artifacts and account-scoped model policy",
    mobileReady: true,
    reducedMotionBehavior: "Progress is textual; results appear in place",
    keyboardScreenReaderBehavior: "Actions are labeled with progress/result announced; cancellable",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "semantic-moment-search",
    stableTerm: "Find the moment",
    primaryAction: "Find the part where…",
    secondaryActions: ["Jump to the moment"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No matching moment found — try describing it differently",
      loading: "Searching inside the content…",
      success: "Moment hits with timestamps that jump like chapter clicks",
      failureRecovery: "Moment search unavailable — plain search still works",
    },
    anonymousBehavior: "Works without an account (local/low-cost paths per R23-K)",
    authenticatedBehavior: "Same; the index persists with the profile's library",
    mobileReady: true,
    reducedMotionBehavior: "Results replace in place",
    keyboardScreenReaderBehavior: "Hits announce timestamp + context; jump is one action",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
  {
    capability: "browser-host",
    stableTerm: "Contained playback",
    primaryAction: "Play in the contained web surface",
    secondaryActions: ["Open externally instead"],
    disclosure: ["summary", "detail", "diagnostics"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "Offered only where a provider realization permits contained playback",
      loading: "Opening the contained surface…",
      success: "Plays like any other surface in the player",
      failureRecovery: "The surface could not open — Where to watch reopens with other options",
    },
    anonymousBehavior: "Contained public playback without an account",
    authenticatedBehavior: "Same surface; position mirrors canonical watch state",
    mobileReady: true,
    reducedMotionBehavior: "No transition animation",
    keyboardScreenReaderBehavior: "The player's focus contract governs; honest limits are disclosed",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/webflix-golden-journeys.md",
  },
  {
    capability: "local-offline-media",
    stableTerm: "Offline",
    sharedTermFamily: "offline",
    primaryAction: "Play the verified local copy",
    secondaryActions: ["Keep offline", "Remove"],
    disclosure: ["summary", "detail"],
    platformTruth: { web: "native-only-next-step", desktop: "supported" },
    states: {
      empty: "Nothing offline yet — authorized copies can be kept offline",
      loading: "Verifying… (integrity truth, never fake progress)",
      success: "The same item plays locally in Library with the same player semantics",
      failureRecovery: "Integrity failed — the asset is not shown as ready offline; the source path remains",
    },
    anonymousBehavior: "Needs an account (typed prerequisite)",
    authenticatedBehavior: "Verified offline Library; the same item continues locally",
    mobileReady: false,
    reducedMotionBehavior: "Progress is numeric",
    keyboardScreenReaderBehavior: "Verified/needs-Desktop states are announced per item",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/webflix-golden-journeys.md",
  },
  {
    capability: "provenance-transparency",
    stableTerm: "Details",
    primaryAction: "Show the details",
    secondaryActions: ["See provenance", "See model/license truth"],
    disclosure: ["summary", "detail", "diagnostics"],
    platformTruth: { web: "supported", desktop: "supported" },
    states: {
      empty: "No provenance details available for this content",
      loading: "—",
      success: "Origin, model and license truth on demand — never the main UX",
      failureRecovery: "—",
    },
    anonymousBehavior: "Visible to every viewer",
    authenticatedBehavior: "Same",
    mobileReady: true,
    reducedMotionBehavior: "Disclosure without animation",
    keyboardScreenReaderBehavior: "A described disclosure reachable by keyboard",
    blocksPlayback: false,
    settingsManaged: false,
    evidence: "docs/validation/youtube-parity-lab.md",
  },
];

// ---------------------------------------------------------------------------
// The R24-B laws 1–6 as machine-checkable contracts
// ---------------------------------------------------------------------------

/** One of the six frozen extension laws (the plan's R24-B numbering). */
export type PlacementLawId =
  /** Law 1: a user encounters the feature at the point of intent. */
  | "point-of-intent"
  /** Law 2: the feature has one obvious primary action. */
  | "one-primary-action"
  /** Law 3: detail is progressively disclosed (summary -> detail -> diagnostics). */
  | "progressive-disclosure"
  /** Law 4: no architecture/diagnostics dashboard is required to use it. */
  | "no-dashboard-requirement"
  /** Law 5: state and terminology stay stable across surfaces. */
  | "stable-terminology"
  /** Law 6: platform differences are capability truth, not new semantics. */
  | "platform-capability-truth";

/** Every law id, in the plan's order. */
export const PLACEMENT_LAWS: readonly PlacementLawId[] = [
  "point-of-intent",
  "one-primary-action",
  "progressive-disclosure",
  "no-dashboard-requirement",
  "stable-terminology",
  "platform-capability-truth",
] as const;

/** One placement-law violation (capability-scoped, machine-checkable). */
export interface PlacementLawViolation {
  readonly capability: ParityTaxonomyRowId | "(matrix)";
  readonly law: PlacementLawId | "blocks-playback" | "coverage" | "structure";
  readonly problem: string;
}

const NON_EMPTY = /\S/;
const EVIDENCE_RE = /^(https:\/\/|http:\/\/|docs\/|evidence\/)/;

/**
 * Check ALL six R24-B laws (plus the blocks-playback startup hook) for ONE
 * placement record, joining it with its taxonomy row. PURE — surfaces, the
 * lead's harness and the regression tests call this to verify placement
 * truth; a violation list is returned (empty = lawful).
 */
export function checkPlacementLaws(
  record: CapabilityPlacementRecord,
): readonly PlacementLawViolation[] {
  const violations: PlacementLawViolation[] = [];
  const row = parityTaxonomyRowOf(record.capability);
  if (!row) {
    return [
      {
        capability: record.capability,
        law: "coverage",
        problem: "no taxonomy row for this placement record",
      },
    ];
  }
  const isExtension = row.area === "webflix-extension";

  // Structure: required copy on every record.
  if (!NON_EMPTY.test(record.stableTerm)) {
    violations.push({
      capability: record.capability,
      law: "stable-terminology",
      problem: "empty stable term",
    });
  }
  if (!NON_EMPTY.test(record.primaryAction)) {
    violations.push({
      capability: record.capability,
      law: "one-primary-action",
      problem: "empty primary action",
    });
  }
  for (const [state, text] of Object.entries(record.states)) {
    if (!NON_EMPTY.test(text)) {
      violations.push({
        capability: record.capability,
        law: "structure",
        problem: `empty ${state} state view`,
      });
    }
  }
  for (const text of [
    record.anonymousBehavior,
    record.authenticatedBehavior,
    record.reducedMotionBehavior,
    record.keyboardScreenReaderBehavior,
  ]) {
    if (!NON_EMPTY.test(text)) {
      violations.push({
        capability: record.capability,
        law: "structure",
        problem: "empty behavior/accessibility view",
      });
    }
  }
  if (!EVIDENCE_RE.test(record.evidence)) {
    violations.push({
      capability: record.capability,
      law: "structure",
      problem: "evidence must be a doc path, evidence path or URL",
    });
  }

  // Law 1 — point-of-intent encounter. The taxonomy row owns the entry
  // surfaces (one source of truth); a WebFlix-only extension must have a
  // CONTEXTUAL entry (never settings-only — an R24 rejection).
  if (row.userEntryPoint.surfaces.length === 0) {
    violations.push({
      capability: record.capability,
      law: "point-of-intent",
      problem: "no entry surfaces on the taxonomy row",
    });
  }
  if (
    isExtension &&
    row.userEntryPoint.surfaces.every((surface) => surface === "settings")
  ) {
    violations.push({
      capability: record.capability,
      law: "point-of-intent",
      problem: "WebFlix-only extension is settings-only (R24 rejection)",
    });
  }
  if (isExtension && !row.userEntryPoint.contextual) {
    violations.push({
      capability: record.capability,
      law: "point-of-intent",
      problem: "WebFlix-only extension entry is not contextual",
    });
  }

  // Law 2 — one obvious primary action.
  const loweredSecondary = record.secondaryActions.map((a) =>
    a.trim().toLowerCase(),
  );
  if (loweredSecondary.includes(record.primaryAction.trim().toLowerCase())) {
    violations.push({
      capability: record.capability,
      law: "one-primary-action",
      problem: "a secondary action duplicates the primary action",
    });
  }
  if (new Set(loweredSecondary).size !== loweredSecondary.length) {
    violations.push({
      capability: record.capability,
      law: "one-primary-action",
      problem: "duplicate secondary actions",
    });
  }

  // Law 3 — progressive disclosure: the ladder starts at "summary" and
  // climbs the canonical order strictly (diagnostics is never first and
  // only ever last).
  if (record.disclosure.length === 0) {
    violations.push({
      capability: record.capability,
      law: "progressive-disclosure",
      problem: "empty disclosure ladder",
    });
  } else {
    if (record.disclosure[0] !== "summary") {
      violations.push({
        capability: record.capability,
        law: "progressive-disclosure",
        problem: "disclosure must start at 'summary'",
      });
    }
    let lastIndex = -1;
    for (const level of record.disclosure) {
      const index = PLACEMENT_DISCLOSURE_LADDER.indexOf(level);
      if (index < 0) {
        violations.push({
          capability: record.capability,
          law: "progressive-disclosure",
          problem: `unknown disclosure level ${String(level)}`,
        });
        continue;
      }
      if (index <= lastIndex) {
        violations.push({
          capability: record.capability,
          law: "progressive-disclosure",
          problem: "disclosure ladder must strictly climb summary->detail->diagnostics",
        });
        break;
      }
      lastIndex = index;
    }
  }

  // Law 4 — no dashboard requirement: every entry surface is a member of
  // the CLOSED product-surface union (which contains no dashboard route
  // by construction); a settingsManaged label is lawful only for
  // reference capabilities, never for WebFlix-only extensions.
  for (const surface of row.userEntryPoint.surfaces) {
    if (!isProductSurfaceId(surface)) {
      violations.push({
        capability: record.capability,
        law: "no-dashboard-requirement",
        problem: `entry surface ${String(surface)} is outside the product-surface union`,
      });
    }
  }
  if (record.settingsManaged && isExtension) {
    violations.push({
      capability: record.capability,
      law: "no-dashboard-requirement",
      problem: "a WebFlix-only extension may not be settings-managed",
    });
  }
  if (
    record.settingsManaged &&
    row.userEntryPoint.surfaces.some((s) => s !== "settings")
  ) {
    violations.push({
      capability: record.capability,
      law: "no-dashboard-requirement",
      problem: "settingsManaged is set but the entry is not settings-only (mislabel)",
    });
  }

  // Law 6 — platform differences as capability truth: the placement truth
  // must AGREE with the taxonomy's applicability (placement never
  // rewrites capability truth), and an honest next step must point at a
  // platform that truly has the path.
  if (
    record.platformTruth.web !== row.webDesktopApplicability.web ||
    record.platformTruth.desktop !== row.webDesktopApplicability.desktop
  ) {
    violations.push({
      capability: record.capability,
      law: "platform-capability-truth",
      problem: "placement platform truth disagrees with the taxonomy applicability",
    });
  }
  if (
    record.platformTruth.web === "native-only-next-step" &&
    record.platformTruth.desktop !== "supported"
  ) {
    violations.push({
      capability: record.capability,
      law: "platform-capability-truth",
      problem: "an honest Web next step requires the Desktop path to be supported",
    });
  }
  if (
    record.platformTruth.desktop === "native-only-next-step" &&
    record.platformTruth.web !== "supported"
  ) {
    violations.push({
      capability: record.capability,
      law: "platform-capability-truth",
      problem: "an honest Desktop next step requires the Web path to be supported",
    });
  }

  // The R24-E startup hook: NO capability's placement may block first
  // frame (the startup law at the placement level).
  if (record.blocksPlayback) {
    violations.push({
      capability: record.capability,
      law: "blocks-playback",
      problem: "placement may not block first-frame playback (R24-E startup law)",
    });
  }

  return violations;
}

/**
 * The complete placement-matrix validation: coverage (exactly one record
 * per taxonomy capability), per-record law checks, and the law-5
 * terminology uniqueness rules (terms unique across records except
 * inside a declared shared-term family; families have ≥2 members).
 */
export interface CapabilityPlacementValidation {
  readonly ok: boolean;
  readonly recordCount: number;
  readonly violations: readonly PlacementLawViolation[];
}

/** Validate the ENTIRE placement matrix (pure; the regression contract). */
export function validateCapabilityPlacementMatrix(): CapabilityPlacementValidation {
  const violations: PlacementLawViolation[] = [];

  // Coverage: exactly one record per taxonomy row.
  const byCapability = new Map<ParityTaxonomyRowId, number>();
  for (const record of CAPABILITY_PLACEMENTS) {
    byCapability.set(
      record.capability,
      (byCapability.get(record.capability) ?? 0) + 1,
    );
  }
  for (const row of PARITY_TAXONOMY) {
    const count = byCapability.get(row.id) ?? 0;
    if (count !== 1) {
      violations.push({
        capability: row.id,
        law: "coverage",
        problem: `expected exactly one placement record, found ${String(count)}`,
      });
    }
  }
  for (const [capability, count] of byCapability) {
    if (count > 1) {
      violations.push({
        capability,
        law: "coverage",
        problem: "duplicate placement record",
      });
    }
  }

  // Per-record laws.
  for (const record of CAPABILITY_PLACEMENTS) {
    violations.push(...checkPlacementLaws(record));
  }

  // Law 5 — stable terminology across the matrix: a term may be shared
  // only inside a declared family; families must have ≥2 members.
  const families = new Map<string, number>();
  for (const record of CAPABILITY_PLACEMENTS) {
    if (record.sharedTermFamily) {
      families.set(
        record.sharedTermFamily,
        (families.get(record.sharedTermFamily) ?? 0) + 1,
      );
    }
  }
  const termsWithoutFamily = new Map<string, number>();
  for (const record of CAPABILITY_PLACEMENTS) {
    if (!record.sharedTermFamily) {
      termsWithoutFamily.set(
        record.stableTerm,
        (termsWithoutFamily.get(record.stableTerm) ?? 0) + 1,
      );
    }
  }
  for (const [term, count] of termsWithoutFamily) {
    if (count > 1) {
      violations.push({
        capability: "(matrix)",
        law: "stable-terminology",
        problem: `stable term "${term}" used by ${String(count)} unrelated capabilities (declare a sharedTermFamily or differentiate)`,
      });
    }
  }
  for (const record of CAPABILITY_PLACEMENTS) {
    if (!record.sharedTermFamily) continue;
    const family = families.get(record.sharedTermFamily) ?? 0;
    if (family < 2) {
      violations.push({
        capability: record.capability,
        law: "stable-terminology",
        problem: `sharedTermFamily "${record.sharedTermFamily}" has fewer than two members`,
      });
    }
  }
  // A shared term must not ALSO be used by an unrelated capability.
  const familyTerms = new Map<string, string>();
  for (const record of CAPABILITY_PLACEMENTS) {
    if (!record.sharedTermFamily) continue;
    const owner = familyTerms.get(record.stableTerm);
    if (owner !== undefined && owner !== record.sharedTermFamily) {
      violations.push({
        capability: record.capability,
        law: "stable-terminology",
        problem: `stable term "${record.stableTerm}" already belongs to family "${owner}"`,
      });
    }
    familyTerms.set(record.stableTerm, record.sharedTermFamily);
  }
  for (const record of CAPABILITY_PLACEMENTS) {
    if (record.sharedTermFamily) continue;
    if (familyTerms.has(record.stableTerm)) {
      violations.push({
        capability: record.capability,
        law: "stable-terminology",
        problem: `stable term "${record.stableTerm}" collides with a family-owned term`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    recordCount: CAPABILITY_PLACEMENTS.length,
    violations,
  };
}

// ---------------------------------------------------------------------------
// The joined capability matrix (the shared read model the surfaces render)
// ---------------------------------------------------------------------------

/**
 * One row of the FEATURE CAPABILITY MATRIX — the taxonomy's
 * classification joined with the placement truth: what the capability is,
 * how it is classified, where the user meets it, and the one obvious
 * action. This is the read model Workers 2/3 bind their parity surfaces
 * to and the lead's J40/J42 evidence verifies against.
 */
export interface CapabilityMatrixEntry {
  // — classification half (from the taxonomy) —
  readonly capability: ParityTaxonomyRowId;
  readonly area: ParityTaxonomyArea;
  readonly classification: ParityClassification;
  readonly webflixTreatment: string;
  readonly entrySurfaces: readonly string[];
  readonly entryControl: string;
  readonly authRequirement: string;
  // — placement half (from the placement matrix) —
  readonly stableTerm: string;
  readonly primaryAction: string;
  readonly secondaryActions: readonly string[];
  readonly disclosure: readonly PlacementDisclosureLevel[];
  readonly webSupport: string;
  readonly desktopSupport: string;
  readonly mobileReady: boolean;
  readonly blocksPlayback: boolean;
  readonly settingsManaged: boolean;
}

/** The joined capability matrix (one entry per taxonomy capability). */
export function capabilityMatrix(): readonly CapabilityMatrixEntry[] {
  return PARITY_TAXONOMY.map((row) => {
    const placement = CAPABILITY_PLACEMENTS.find(
      (record) => record.capability === row.id,
    );
    if (!placement) {
      // validateCapabilityPlacementMatrix names this as a coverage
      // violation; the view still needs a total shape.
      return {
        capability: row.id,
        area: row.area,
        classification: row.classification,
        webflixTreatment: row.webflixTreatment,
        entrySurfaces: row.userEntryPoint.surfaces,
        entryControl: row.userEntryPoint.control,
        authRequirement: row.authRequirement,
        stableTerm: "",
        primaryAction: "",
        secondaryActions: [],
        disclosure: [],
        webSupport: row.webDesktopApplicability.web,
        desktopSupport: row.webDesktopApplicability.desktop,
        mobileReady: false,
        blocksPlayback: true,
        settingsManaged: false,
      };
    }
    return {
      capability: row.id,
      area: row.area,
      classification: row.classification,
      webflixTreatment: row.webflixTreatment,
      entrySurfaces: row.userEntryPoint.surfaces,
      entryControl: row.userEntryPoint.control,
      authRequirement: row.authRequirement,
      stableTerm: placement.stableTerm,
      primaryAction: placement.primaryAction,
      secondaryActions: placement.secondaryActions,
      disclosure: placement.disclosure,
      webSupport: placement.platformTruth.web,
      desktopSupport: placement.platformTruth.desktop,
      mobileReady: placement.mobileReady,
      blocksPlayback: placement.blocksPlayback,
      settingsManaged: placement.settingsManaged,
    };
  });
}

/** One entry of the joined capability matrix (undefined when unknown). */
export function capabilityMatrixEntryOf(
  capability: ParityTaxonomyRowId,
): CapabilityMatrixEntry | undefined {
  return capabilityMatrix().find((entry) => entry.capability === capability);
}

/**
 * The taxonomy row a placement joins with (exported for harnesses that
 * want the full 17-field inventory row next to the placement truth).
 */
export function taxonomyRowOfPlacement(
  record: CapabilityPlacementRecord,
): ParityTaxonomyRow | undefined {
  return parityTaxonomyRowOf(record.capability);
}
