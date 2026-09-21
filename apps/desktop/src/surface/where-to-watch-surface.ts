/**
 * @wfx/app-desktop — the Where-to-watch surface (R23-E, the Desktop torrent
 * play surface).
 *
 * THE LAW THIS SURFACE PROJECTS (the plan's R23-E + Worker 1's frozen R23-C
 * vocabulary): the item/detail's Where-to-watch decision hub lists the
 * authorized peer copy as a FIRST-CLASS way to watch —
 *
 * ```text
 * Where to watch
 * - WebFlix source            (the item's own source ways)
 * - Authorized peer copy      (the torrent realization — NEVER "Offline copy")
 * - Other ways to watch       (the remaining provider realizations)
 * ```
 *
 * - the peer-copy entry renders Worker 1's frozen vocabulary VERBATIM
 *   (`TORRENT_REALIZATION_VIEW` — "Authorized peer copy"), and the
 *   primary-label law is machine-checked against the runtime's
 *   `isLawfulTorrentPrimaryLabel` (never a mere "Offline copy");
 * - the peer copy is ELIGIBLE FOR THE PRIMARY PLAY DECISION: it appears in
 *   the top-level groups (never under Settings, never inside a diagnostics
 *   panel), and selecting it makes it THE way the primary play action
 *   plays — through the NATIVE rung the R23-C binding composes (there is
 *   no torrent playback mode; the precedence model is preserved);
 * - the acquisition states stay PROTOCOL-FREE (the runtime's own
 *   `AcquisitionStatusView` vocabulary — Available → Preparing →
 *   Buffering → Playing → Completing → Ready offline / Failed);
 * - the ADVANCED TORRENT DIAGNOSTICS stay progressively disclosed: this
 *   surface carries ONLY the gated-availability flag — the diagnostics
 *   content itself lives behind the acquisition surface's explicitly
 *   gated projection (the R14 leak law);
 * - "Offline copy" is NO LONGER the sole conceptual entry point: the
 *   make-available-offline affordance remains reachable (the R21-H
 *   surface, unchanged), but the PEER COPY is a way to WATCH — the
 *   primary decision is a play decision, not a download decision.
 *
 * WHAT THIS MODULE IS NOT: a second realization-choice derivation (the
 * runtime's `realizationChoiceView` owns the provider ways' truth — this
 * surface projects it into the R23-E grouping), or a playback system (the
 * R23-C binding + the runtime own playback).
 */

import type {
  AcquisitionStatusView,
  RealizationChoiceView,
} from "@wfx/client-runtime";
import {
  isLawfulTorrentPrimaryLabel,
  realizationChoiceView,
  TORRENT_REALIZATION_VIEW,
  WHERE_TO_WATCH_GROUP_VIEWS,
  type TorrentRungSatisfaction,
  type WhereToWatchEntryKind,
} from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";
import type { PlaybackMode } from "@wfx/domain";

import type { DesktopAcquisitionSurface } from "./acquisition-surface";
import type {
  DesktopPeerCopyPlayOutcome,
  DesktopTorrentPlaybackBinding,
} from "../platform/torrent-playback";

// ---------------------------------------------------------------------------
// The view shapes
// ---------------------------------------------------------------------------

/** One way to watch, projected into the R23-E grouping. */
export interface DesktopWhereToWatchEntryView {
  /** The entry's shape: the WebFlix-source way, the peer copy, or another provider way. */
  readonly kind: "webflix-source" | "authorized-peer-copy" | "provider-realization";
  /** The frozen Where-to-watch group the entry renders in. */
  readonly group: WhereToWatchEntryKind;
  /** The entry's label (the peer copy: the frozen R23-C vocabulary, verbatim). */
  readonly label: string;
  /** The honest one-sentence detail. */
  readonly detail: string;
  /** Present for provider ways: the playback mode (the frozen vocabulary). */
  readonly mode?: PlaybackMode;
  /** Present for provider ways: the offering source's compact label. */
  readonly connectorId?: string;
  /** Present for provider ways: the platform capability truth. */
  readonly usable?: boolean;
  /** Present for provider ways that this platform cannot host: WHY. */
  readonly unusableReason?: string;
  /** Present for the peer copy: the rung truth (the R23-C contract's answer). */
  readonly rung?: TorrentRungSatisfaction;
}

/** One Where-to-watch group (the frozen order: source → peer copy → others). */
export interface DesktopWhereToWatchGroupView {
  readonly kind: WhereToWatchEntryKind;
  readonly label: string;
  readonly detail: string;
  readonly entries: readonly DesktopWhereToWatchEntryView[];
}

/** The primary play decision (the one obvious play action — the R24 UX law's preview). */
export interface DesktopPrimaryPlayView {
  /** The decision's shape. */
  readonly action:
    | "play-selected-way"
    | "choose-way-first"
    | "authorize-with-provider"
    | "nothing-yet";
  /** The action's label (user vocabulary). */
  readonly label: string;
  /** The honest one-sentence truth of the decision. */
  readonly detail: string;
  /** Whether the selected way is the authorized peer copy (the native rung). */
  readonly selectedPeerCopy: boolean;
  /** The peer copy's primary eligibility (the R23-E law — machine-checked). */
  readonly peerCopyEligible: boolean;
}

/** The Where-to-watch view (the item detail's decision hub). */
export interface DesktopWhereToWatchView {
  readonly itemId: string;
  /** The frozen-order groups (empty groups render honestly absent). */
  readonly groups: readonly DesktopWhereToWatchGroupView[];
  /** The primary play decision. */
  readonly primary: DesktopPrimaryPlayView;
  /** The item's honest acquisition lifecycle (protocol-free; null when nothing is known). */
  readonly acquisition: AcquisitionStatusView | null;
  /** Whether the gated advanced diagnostics exist for this item (progressive disclosure). */
  readonly diagnosticsAvailable: boolean;
  /** The make-available-offline path's note (a SECONDARY path, never the sole entry). */
  readonly offlineAffordanceNote: string;
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopWhereToWatchSurface}. */
export interface DesktopWhereToWatchOptions {
  /** The truthful Desktop capability bundle. */
  readonly capabilities: PlatformCapabilities;
  /** The R14 acquisition surface (the lifecycle views + the gated flag). */
  readonly acquisition: DesktopAcquisitionSurface;
  /** The R23-C binding (the peer-copy rung + the play flow). */
  readonly torrentPlayback: DesktopTorrentPlaybackBinding;
}

/** The Desktop Where-to-watch surface (the R23-E projection). */
export interface DesktopWhereToWatchSurface {
  /**
   * The Where-to-watch view for one item: the provider ways (the runtime's
   * own `realizationChoiceView` truth, grouped) + the authorized peer copy
   * (the R23-C rung decision) + the primary play decision. The selected
   * way defaults to the platform's frozen precedence answer; an explicit
   * `selectedPeerCopy` selection makes the peer copy THE way the primary
   * action plays (the eligibility law).
   */
  whereToWatch(input: {
    readonly itemId: string;
    /** The offered provider realizations (the server's resolve answer). */
    readonly providerRealizations: readonly {
      readonly mode: PlaybackMode;
      readonly connectorId: string;
    }[];
    /** The active/chosen provider realization (null when none). */
    readonly active?: { readonly mode: PlaybackMode; readonly connectorId: string } | null;
    /** Whether the user selected the authorized peer copy as the way to watch. */
    readonly selectedPeerCopy?: boolean;
  }): DesktopWhereToWatchView;
  /**
   * THE PRIMARY PLAY ACTION through the authorized peer copy (the J38
   * walk's start): delegates to the R23-C binding's play flow (the typed
   * outcome carries every honest branch — the file-choice step included).
   */
  playPeerCopy(
    itemId: string,
    options?: { readonly fileIndexes?: readonly number[]; readonly resumePositionMs?: number },
  ): Promise<DesktopPeerCopyPlayOutcome>;
}

/**
 * Project the Desktop Where-to-watch surface. Pure projection: the group
 * vocabulary and the peer-copy label are the frozen R23-C constants; the
 * provider ways' truth is the runtime's own derivation; the acquisition
 * lifecycle is the R14 surface's own view — ZERO new product policy.
 */
export function createDesktopWhereToWatchSurface(
  options: DesktopWhereToWatchOptions,
): DesktopWhereToWatchSurface {
  const { capabilities, acquisition, torrentPlayback } = options;

  return {
    whereToWatch(input: {
      readonly itemId: string;
      readonly providerRealizations: readonly {
        readonly mode: PlaybackMode;
        readonly connectorId: string;
      }[];
      readonly active?: { readonly mode: PlaybackMode; readonly connectorId: string } | null;
      readonly selectedPeerCopy?: boolean;
    }): DesktopWhereToWatchView {
      // The provider ways' truth: the runtime's own choice derivation.
      const choice: RealizationChoiceView = realizationChoiceView({
        capabilities,
        realizations: input.providerRealizations,
        active: input.active ?? null,
      });

      // The R23-E grouping: the FIRST usable provider way is the WebFlix
      // source's headline way; the remaining ways are "other ways". When
      // no provider way exists, the source group renders honestly empty
      // (the peer copy may still be the way to watch).
      const usableOrder = choice.options.filter((option) => option.usable);
      const headline = usableOrder[0] ?? null;
      const webflixEntries: DesktopWhereToWatchEntryView[] =
        headline !== null
          ? [
              {
                kind: "webflix-source",
                group: "webflix-source",
                label: headline.modeLabel,
                detail: `Watch this through the WebFlix source (${headline.connectorId}).`,
                mode: headline.mode,
                connectorId: headline.connectorId,
                usable: true,
              },
            ]
          : [];
      const otherEntries: DesktopWhereToWatchEntryView[] = choice.options
        .filter((option) => headline === null || option !== headline)
        .map((option) => ({
          kind: "provider-realization" as const,
          group: "other-realizations" as const,
          label: option.modeLabel,
          detail:
            option.usable
              ? `Another way to watch, through ${option.connectorId}.`
              : (option.unusableReason ?? "This platform cannot host that way of watching."),
          mode: option.mode,
          connectorId: option.connectorId,
          usable: option.usable,
          ...(option.unusableReason !== undefined && !option.usable
            ? { unusableReason: option.unusableReason }
            : {}),
        }));

      // THE PEER-COPY ENTRY (the first-class torrent realization): the
      // R23-C rung decision over the composition's truth, the frozen
      // vocabulary verbatim, the label law machine-checked (an unlawful
      // label is a defect, never a rendered string).
      const rung = torrentPlayback.peerCopyRung(input.itemId);
      const peerCopyLabel = TORRENT_REALIZATION_VIEW.label;
      if (!isLawfulTorrentPrimaryLabel(peerCopyLabel)) {
        throw new Error(
          `where-to-watch: the peer-copy primary label '${peerCopyLabel}' violates the R23-C label law (never a mere offline/download label)`,
        );
      }
      const peerCopyEntries: DesktopWhereToWatchEntryView[] =
        rung !== null
          ? [
              {
                kind: "authorized-peer-copy",
                group: "authorized-peer-copy",
                label: peerCopyLabel,
                detail:
                  rung.kind === "satisfies-native-rung"
                    ? TORRENT_REALIZATION_VIEW.detail
                    : rung.detail,
                rung,
              },
            ]
          : [];

      const groups: readonly DesktopWhereToWatchGroupView[] = (
        [
          { kind: "webflix-source", entries: webflixEntries },
          { kind: "authorized-peer-copy", entries: peerCopyEntries },
          { kind: "other-realizations", entries: otherEntries },
        ] as const
      ).map((group) => ({
        kind: group.kind,
        label: WHERE_TO_WATCH_GROUP_VIEWS[group.kind].label,
        detail: WHERE_TO_WATCH_GROUP_VIEWS[group.kind].detail,
        entries: [...group.entries],
      }));

      // THE PRIMARY PLAY DECISION (the eligibility law): the peer copy is
      // primary-eligible whenever its rung is satisfied; the selected way
      // decides the action. The frozen precedence stays the DEFAULT (the
      // WebFlix source's headline way when one exists).
      const peerCopyEligible = rung?.kind === "satisfies-native-rung";
      const selectedPeerCopy = input.selectedPeerCopy === true && peerCopyEligible;
      const providerWayExists = headline !== null;
      const providerAuthGap =
        !providerWayExists &&
        choice.options.some((option) => !option.usable && option.unusableReason !== undefined);

      let primary: DesktopPrimaryPlayView;
      if (selectedPeerCopy) {
        primary = {
          action: "play-selected-way",
          label: `Play — ${TORRENT_REALIZATION_VIEW.label}`,
          detail:
            "Playback starts through this authorized peer copy — it can begin before the copy completes, keeps your place, and the finished copy lands in your Library.",
          selectedPeerCopy: true,
          peerCopyEligible: true,
        };
      } else if (providerWayExists) {
        primary = {
          action: "play-selected-way",
          label: `Play — ${headline.modeLabel}`,
          detail: `${choice.activeLabel} when you press play.`,
          selectedPeerCopy: false,
          peerCopyEligible,
        };
      } else if (peerCopyEligible) {
        // No provider way, but the peer copy satisfies the native rung:
        // the peer copy IS the primary way (never hidden, never demoted).
        primary = {
          action: "play-selected-way",
          label: `Play — ${TORRENT_REALIZATION_VIEW.label}`,
          detail: TORRENT_REALIZATION_VIEW.detail,
          selectedPeerCopy: true,
          peerCopyEligible: true,
        };
      } else if (providerAuthGap) {
        primary = {
          action: "authorize-with-provider",
          label: "Authorize with this source",
          detail: "The remaining way to watch needs the source's own sign-in — that is the source's requirement, not a WebFlix account.",
          selectedPeerCopy: false,
          peerCopyEligible,
        };
      } else if (rung !== null && rung.kind === "requires-authorization") {
        primary = {
          action: "nothing-yet",
          label: "No authorized way to watch",
          detail: rung.detail,
          selectedPeerCopy: false,
          peerCopyEligible: false,
        };
      } else {
        primary = {
          action: "nothing-yet",
          label: "No way to watch yet",
          detail: "The ways that exist are named below — nothing is hidden.",
          selectedPeerCopy: false,
          peerCopyEligible: false,
        };
      }

      const acquisitionView = acquisition.acquisitionView(input.itemId);
      return {
        itemId: input.itemId,
        groups,
        primary,
        acquisition: acquisitionView,
        diagnosticsAvailable: acquisition.bound && acquisition.acquisitionDiagnostics(input.itemId) !== null,
        offlineAffordanceNote:
          "You can also make this title available offline — it downloads in the background and lands in your Library, under Offline.",
      };
    },

    async playPeerCopy(
      itemId: string,
      playOptions?: {
        readonly fileIndexes?: readonly number[];
        readonly resumePositionMs?: number;
      },
    ): Promise<DesktopPeerCopyPlayOutcome> {
      return torrentPlayback.playPeerCopy(itemId, playOptions);
    },
  };
}

// ---------------------------------------------------------------------------
// The copy sweep (the J35/J38 laws over this surface's strings)
// ---------------------------------------------------------------------------

/**
 * Gather every user-facing copy string the view can project (the stale-copy
 * sweep + the label-law sweep primitives; tests assert every string passes
 * `isStaleCompletionCopy` and the peer-copy label passes
 * `isLawfulTorrentPrimaryLabel`).
 */
export function whereToWatchCopyStrings(view: DesktopWhereToWatchView): readonly string[] {
  const strings: string[] = [];
  for (const group of view.groups) {
    strings.push(group.label, group.detail);
    for (const entry of group.entries) {
      strings.push(entry.label, entry.detail);
      if (entry.unusableReason !== undefined) strings.push(entry.unusableReason);
    }
  }
  strings.push(view.primary.label, view.primary.detail, view.offlineAffordanceNote);
  if (view.acquisition !== null) strings.push(view.acquisition.label, view.acquisition.detail);
  return strings;
}
