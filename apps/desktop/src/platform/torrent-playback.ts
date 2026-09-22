/**
 * @wfx/app-desktop — the torrent realization binding with native media
 * (R23-W3, THE R23-C CONSUMPTION).
 *
 * THE LAW THIS BINDING IMPLEMENTS (docs/plans/
 * 2026-09-20-webflix-open-viewing-torrent-ai-plan.md — R23-C + the Worker 3
 * lane): an authorized torrent realization satisfies the NATIVE playback
 * rung on Desktop — torrent is a FIRST-CLASS realization/source path, never
 * a generic `PlaybackMode = "torrent"` and never a mere offline-copy
 * subsystem.
 *
 * THE SHAPE OF THE BINDING (every step typed + honest):
 *
 * 1. THE RUNG DECISION is Worker 1's frozen contract, consumed verbatim:
 *    {@link torrentRungSatisfaction} over the platform truth
 *    (`platform: "desktop"`) + the realization's
 *    {@link TorrentRealizationDeclaration}. Desktop answers
 *    `satisfies-native-rung` for every AUTHORIZED realization; an
 *    unauthorized copy answers `requires-authorization` and is NEVER
 *    offered as playback (the R11/R13 provenance gate).
 * 2. THE ACQUISITION START is the J21-J25 composition-root wiring, made
 *    first-class: authorized ingestion (the engine's own
 *    PROVENANCE_REJECTED gate — the composition mints the provenance
 *    through the authorized-source registry, never bypasses it) → file
 *    selection when needed (the J22 step, protocol-free candidates) →
 *    session → `bindSession` with the R04 canonical identity (the same
 *    wiring the R14 acquire recipe performs).
 * 3. THE NATIVE PLAYBACK runs through the SHARED runtime — the composed
 *    realization carries `mode: "native"` (the rung torrent satisfies;
 *    there is no torrent playback mode) and the controller engages the
 *    platform's NativeMediaPort with the authorized open input (magnet /
 *    torrent bytes / the verified asset's local path for the ready-offline
 *    replay). Playback-before-completion, seek, pause/resume, telemetry
 *    and resume position are the RUNTIME's own laws — identical to any
 *    provider realization (the nine-dimension parity contract).
 * 4. THE VERIFIED LIBRARY CONTINUITY stays the R13 law: only the engine's
 *    EARNED exposure (`exposeCompletedSelection` → `Ready offline`) lands
 *    in the Library; recovery after an interruption re-binds the journaled
 *    session and reports through the acquisition surface (the J25 doctrine
 *    — resumed with retained progress, never a false completion).
 *
 * WHAT THIS MODULE IS NOT: a Where-to-watch UI (that is R23-E's surface
 * projection over this binding), a torrent protocol implementation (the
 * engine's own domain), or a second playback system (the runtime owns
 * playback semantics — this binding only composes the native rung).
 */

import type { ClientRuntime, PlaybackController } from "@wfx/client-runtime";
import {
  TORRENT_REALIZATION_VIEW,
  torrentRungSatisfaction,
  type TorrentRealizationDeclaration,
  type TorrentRungSatisfaction,
} from "@wfx/client-runtime";
import type { PlatformCapabilities } from "@wfx/platform-contracts";
import type { PlaybackRealization } from "@wfx/domain";
import type {
  AuthorizedProvenance,
  TorrentEngine,
  TorrentEngineAdapter,
  TorrentIngestion,
  TorrentResult,
} from "@wfx/torrent-engine";
import { isAuthorizedProvenanceBasis } from "@wfx/torrent-engine";

import type { AcquisitionIdentity, AcquisitionRetryRecipe, DesktopAcquisitionSource } from "./acquisition-source";

// ---------------------------------------------------------------------------
// The authorized torrent realization truth (the composition's source)
// ---------------------------------------------------------------------------

/**
 * One authorized torrent realization the composition provides for a
 * canonical item — the Desktop's peer-copy truth (the user's media vault,
 * a licensed source, a public-domain/Creative-Commons archive…). The
 * provenance names the authorized source; the ENGINE re-gates it at
 * ingestion through the registry mint (PROVENANCE_REJECTED without a
 * lawful registration) — this type only carries the composition's own
 * truth, never a bypass.
 */
export interface DesktopTorrentRealization {
  /** The CANONICAL item this peer copy realizes (`wfxitm_…`). */
  readonly itemId: string;
  /** The item's display title. */
  readonly title: string;
  /** The authorized magnet URI (`magnet:?xt=…`). */
  readonly magnet?: string;
  /** Authorized `.torrent` bytes (the alternative open input). */
  readonly torrentBytes?: Uint8Array;
  /**
   * The authorization provenance (invariant 5): the registered authorized
   * source/vault id + the lawful basis (`user-owned` / `licensed` /
   * `public-domain` / `creative-commons` / `other-authorized`).
   */
  readonly provenance: { readonly sourceId: string; readonly basis: string };
  /**
   * The per-realization WebTorrent/WebRTC capability truth (honest, never
   * assumed — ordinary TCP/UDP-only swarms are unreachable from a browser).
   */
  readonly browserCapable: boolean;
  /**
   * OPTIONAL: the vault's known target file path(s) — the magnet-kind
   * selection resolved at metadata (the composition's own truth; absent
   * ⇒ the engine's default selection, with the file-choice step offered
   * when the metadata reveals a real choice).
   */
  readonly knownFilePaths?: readonly string[];
}

/** The composition's realization truth for one canonical item (null = none offered). */
export type DesktopTorrentRealizationSource = (itemId: string) => DesktopTorrentRealization | null;

/**
 * The provenance mint the composition provides (the authorized-source
 * registry's own `authorizeProvenance` — the ONLY lawful construction
 * path; the binding never fabricates a provenance).
 */
export type DesktopProvenanceMint = (
  sourceId: string,
) => TorrentResult<AuthorizedProvenance>;

/** Structural guard for a claimed torrent realization. */
export function isDesktopTorrentRealization(x: unknown): x is DesktopTorrentRealization {
  if (typeof x !== "object" || x === null) return false;
  const record = x as Record<string, unknown>;
  if (typeof record.itemId !== "string" || record.itemId.length === 0) return false;
  if (typeof record.title !== "string") return false;
  if (record.magnet !== undefined && typeof record.magnet !== "string") return false;
  if (record.torrentBytes !== undefined && !(record.torrentBytes instanceof Uint8Array)) return false;
  const provenance = record.provenance as Record<string, unknown> | undefined;
  if (
    typeof provenance !== "object" ||
    provenance === null ||
    typeof provenance.sourceId !== "string" ||
    typeof provenance.basis !== "string"
  ) {
    return false;
  }
  return typeof record.browserCapable === "boolean";
}

// ---------------------------------------------------------------------------
// The declaration derivation (the R23-C truth over the composition's shape)
// ---------------------------------------------------------------------------

/**
 * Derive the R23-C {@link TorrentRealizationDeclaration} from the
 * composition's realization truth. `authorized` is the LAWFUL-BASIS
 * derivation: a provenance whose basis is a member of the engine's frozen
 * authorized-basis union AND names a source (the engine re-gates at
 * ingestion through the registry mint — the same truth, two gates). An
 * authorized peer copy needs no provider sign-in, so the access class is
 * honestly `"public"` (the R23-C vocabulary).
 */
export function torrentRealizationDeclarationOf(
  realization: DesktopTorrentRealization,
): TorrentRealizationDeclaration {
  return {
    transport: "torrent",
    authorized:
      realization.provenance.sourceId.length > 0 &&
      isAuthorizedProvenanceBasis(realization.provenance.basis),
    browserCapable: realization.browserCapable,
    accessClass: "public",
  };
}

/** The Desktop platform truth for the rung decision (the full-power client). */
const DESKTOP_PLATFORM_TRUTH = {
  platform: "desktop" as const,
  browserTorrentSupported: false, // the Desktop path is the NATIVE rung; no browser adapter is claimed
};

/**
 * THE RUNG DECISION for one item's peer copy on Desktop (pure; Worker 1's
 * frozen contract over the truthful platform + declaration). Answers
 * `null` when the composition offers no realization for the item.
 */
export function desktopTorrentRungSatisfaction(
  realization: DesktopTorrentRealization | null,
): TorrentRungSatisfaction | null {
  if (realization === null) return null;
  return torrentRungSatisfaction(
    DESKTOP_PLATFORM_TRUTH,
    torrentRealizationDeclarationOf(realization),
  );
}

// ---------------------------------------------------------------------------
// The composed native realization (the rung torrent satisfies)
// ---------------------------------------------------------------------------

/**
 * The connector id of the composed peer-copy realization — the frozen
 * Where-to-watch vocabulary's entry kind, stable across items (the
 * "source" offering this way of watching is the authorized peer copy
 * itself; the vault's provenance rides on the acquisition, not here).
 */
export const AUTHORIZED_PEER_COPY_CONNECTOR_ID = "authorized-peer-copy";

/**
 * Compose the playback realization a peer copy satisfies on Desktop: the
 * NATIVE mode (the rung), the frozen peer-copy connector vocabulary, and
 * the frozen `playNative` capability (the play-contract statement). There
 * is NO torrent playback mode — this is exactly the frozen
 * `PlaybackRealization` shape every provider realization carries.
 *
 * R26-W3 (the corrective fix this lane's journey surfaced): the
 * capabilities array carries ONLY frozen `Capability` values. The frozen
 * Media-Surface resolver interprets every non-frozen entry as a MEDIA
 * DEMAND (a codec the native pipeline must decode) — the previous
 * `["authorized-peer-copy", "playback-before-completion"]` vocabulary
 * made the real composition's resolver reject the peer-copy realization
 * as undecodable (`demands [authorized-peer-copy,
 * playback-before-completion] not decodable by device codecs`). The
 * behavior truths those strings gestured at live where they belong: the
 * playback-before-completion law is the R12 scheduler's own; the
 * peer-copy identity is the connectorId. The defect was invisible to
 * the R23 harness (its `createRuntime` boot used the R01 default
 * resolver, which does not decode demands) and surfaced only on the
 * REAL `createDesktopApp` composition (the R09 frozen surface resolver)
 * — exactly the production-first corrective the takeover demanded.
 */
export function peerCopyPlaybackRealization(): PlaybackRealization {
  return {
    mode: "native",
    connectorId: AUTHORIZED_PEER_COPY_CONNECTOR_ID,
    capabilities: ["playNative"],
  };
}

// ---------------------------------------------------------------------------
// The file-choice step (the J22 "choose file if needed" — protocol-free)
// ---------------------------------------------------------------------------

/** One file candidate in the protocol-free file-choice step. */
export interface DesktopTorrentFileCandidate {
  /** The file's index in the torrent's ordered file list. */
  readonly index: number;
  /** The file's path (torrent-relative — the metadata's own truth). */
  readonly path: string;
  /** The file's size in bytes. */
  readonly sizeBytes: number;
  /** Whether the file looks playable (a video-container extension). */
  readonly playable: boolean;
}

/** The video-container extensions the playable-candidate derivation knows. */
const PLAYABLE_FILE_EXTENSIONS: readonly string[] = [
  ".mkv",
  ".mp4",
  ".webm",
  ".avi",
  ".mov",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".ts",
];

/** Does the file path carry a known video-container extension? (Pure.) */
export function isPlayableTorrentFilePath(path: string): boolean {
  const lower = path.toLowerCase();
  return PLAYABLE_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Derive the protocol-free candidates from a file list (playable first, order kept). */
export function torrentFileCandidates(
  files: readonly { readonly path: string; readonly lengthBytes: number }[],
): readonly DesktopTorrentFileCandidate[] {
  const candidates = files.map((file, index) => ({
    index,
    path: file.path,
    sizeBytes: file.lengthBytes,
    playable: isPlayableTorrentFilePath(file.path),
  }));
  return [...candidates].sort((a, b) => {
    if (a.playable !== b.playable) return a.playable ? -1 : 1;
    return a.index - b.index;
  });
}

/**
 * Resolve the session selection for a file list: the AUTO answer when the
 * choice is unambiguous (exactly one playable candidate — its index), the
 * FILE-CHOICE answer when the user must choose (zero or 2+ playable
 * candidates). The caller's explicit selection always wins (the user's
 * own choice is never second-guessed).
 */
export function resolvePeerCopySelection(
  files: readonly { readonly path: string; readonly lengthBytes: number }[],
  explicitFileIndexes: readonly number[] | undefined,
):
  | { kind: "selection"; fileIndexes: readonly number[] }
  | { kind: "file-choice-required"; candidates: readonly DesktopTorrentFileCandidate[] } {
  if (explicitFileIndexes !== undefined && explicitFileIndexes.length > 0) {
    return { kind: "selection", fileIndexes: [...explicitFileIndexes] };
  }
  const candidates = torrentFileCandidates(files);
  const playable = candidates.filter((candidate) => candidate.playable);
  if (playable.length === 1) {
    return { kind: "selection", fileIndexes: [playable[0]!.index] };
  }
  return { kind: "file-choice-required", candidates };
}

// ---------------------------------------------------------------------------
// The play outcome (typed at every honest branch)
// ---------------------------------------------------------------------------

/** The typed outcome of one play-through-peer-copy attempt. */
export type DesktopPeerCopyPlayOutcome =
  | {
      /** The peer copy is playing through the native rung. */
      kind: "started";
      /** The acquisition (torrent) session id (`offline:<id>` for the verified replay). */
      readonly sessionId: string;
      /** The native playback session id (the runtime's own). */
      readonly playbackSessionId: string;
      /** The playback controller (seek/pause/resume/stop — the runtime's laws). */
      readonly controller: PlaybackController;
      /** The honest one-sentence truth of what started. */
      readonly detail: string;
    }
  | {
      /** The metadata revealed a real choice — the user must pick a file. */
      kind: "file-choice-required";
      /** The ingestion the choice resolves against. */
      readonly ingestionId: string;
      /** The protocol-free candidates (playable first). */
      readonly candidates: readonly DesktopTorrentFileCandidate[];
      /** The honest next-step sentence. */
      readonly detail: string;
    }
  | {
      /** The composition offers no peer copy for this item. */
      kind: "not-offered";
      readonly detail: string;
    }
  | {
      /** The copy is not authorized — never offered as playback. */
      kind: "requires-authorization";
      readonly detail: string;
    }
  | {
      /** The engine refused a step (its typed code + honest detail). */
      kind: "engine-refused";
      readonly code: string;
      readonly detail: string;
    }
  | {
      /** The native playback failed to engage (the runtime's typed failure). */
      kind: "playback-failed";
      readonly code: string;
      readonly detail: string;
    };

// ---------------------------------------------------------------------------
// The binding
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopTorrentPlaybackBinding}. */
export interface DesktopTorrentPlaybackOptions {
  /** The shared client runtime (playback resolution + watch state + acquisition views). */
  readonly runtime: ClientRuntime;
  /** The truthful Desktop capability bundle (the native-rung truth). */
  readonly capabilities: PlatformCapabilities;
  /** The R11-R13 torrent engine (authorized ingestion + sessions). */
  readonly engine: TorrentEngine;
  /** The R13 narrow-seam adapter (the offline-ready exposure read). */
  readonly adapter: TorrentEngineAdapter;
  /** The R14 acquisition source (the canonical-identity `bindSession` seam). */
  readonly source: DesktopAcquisitionSource;
  /** The composition's authorized-realization truth per canonical item. */
  readonly realizationOf: DesktopTorrentRealizationSource;
  /**
   * The authorized-provenance mint (the composition's authorized-source
   * registry — the ONLY lawful `AuthorizedProvenance` construction path;
   * the binding never fabricates one).
   */
  readonly mintProvenance: DesktopProvenanceMint;
  /**
   * The R04 effective-profile key of the acquiring identity — the
   * composition root's own derivation (authenticated: the effective
   * profile; anonymous: the SESSION-scoped key, never durable identity —
   * the R23-B progress law; the acquisition identity is the composition's
   * truth, this binding never guesses it).
   */
  readonly profileKeyOf: () => string;
}

/** The Desktop torrent realization binding (the R23-C native integration). */
export interface DesktopTorrentPlaybackBinding {
  /**
   * The rung decision for one item's peer copy (the R23-C contract over
   * the truthful platform): `satisfies-native-rung` when authorized,
   * `requires-authorization` for an unlawful copy, `null` when the
   * composition offers none. THE input the Where-to-watch surface renders.
   */
  peerCopyRung(itemId: string): TorrentRungSatisfaction | null;
  /** The composition's realization truth (inspection; null when none). */
  realizationOf(itemId: string): DesktopTorrentRealization | null;
  /**
   * THE PLAY FLOW (the J38 walk's start): rung decision → authorized
   * ingestion → file selection (the J22 step when needed) → session →
   * canonical-identity bind → NATIVE playback resolution + engagement.
   * Playback-before-completion is the engine/runtime's own law; the
   * ready-offline replay opens the VERIFIED asset's local path instead
   * (the J27 law — the earned copy plays without the swarm).
   */
  playPeerCopy(
    itemId: string,
    options?: {
      /** The caller's explicit file selection (the file-choice resolution). */
      readonly fileIndexes?: readonly number[];
      /** The resume position in ms (defaults to the watch state's own truth). */
      readonly resumePositionMs?: number;
    },
  ): Promise<DesktopPeerCopyPlayOutcome>;
  /**
   * The file-choice view over a live ingestion's metadata (the candidates
   * once the engine knows the files; null before metadata resolves).
   */
  fileChoice(ingestionId: string): readonly DesktopTorrentFileCandidate[] | null;
  /**
   * THE RECOVERY CONTINUITY (the J25 doctrine, the J38 interruption step):
   * after a restart, re-bind a journaled session to its canonical identity
   * and run the engine's recovery. The report feeds the acquisition
   * surface's refresh (resumed with retained progress — never a false
   * completion); the answer is the honest recovery outcome.
   */
  recoverSession(input: {
    readonly sessionId: string;
    readonly identity: AcquisitionIdentity;
  }): Promise<TorrentResult<{ readonly sessionId: string; readonly resumed: boolean }>>;
}

/**
 * Bind the authorized torrent realization to the Desktop's NATIVE playback
 * rung. The binding owns NO product policy: the rung decision is the
 * frozen R23-C contract, the playback semantics are the runtime's, the
 * acquisition lifecycle is the R14 source's — this module composes them
 * (the adapter's layering law).
 */
export function createDesktopTorrentPlaybackBinding(
  options: DesktopTorrentPlaybackOptions,
): DesktopTorrentPlaybackBinding {
  const { runtime, engine, adapter, source, realizationOf, mintProvenance, profileKeyOf } = options;

  const identityOf = (realization: DesktopTorrentRealization): AcquisitionIdentity => ({
    profileKey: profileKeyOf(),
    canonicalItemId: realization.itemId,
    ...(realization.title.length > 0 ? { title: realization.title } : {}),
  });

  /**
   * THE RETRY RECIPE the binding binds with every session (the parity
   * contract's error-recovery dimension — the same composition-root
   * wiring the R14 acquire recipe performs, made first-class here): a
   * FRESH ingestion + session over the same authorized source (the
   * engine's own guidance for terminal sessions; the retained-progress
   * resume is the recovery path, a different flow). Typed failures
   * propagate honestly — never a fake fresh start.
   */
  const retryRecipeOf = (
    realization: DesktopTorrentRealization,
    fileIndexes: readonly number[] | undefined,
  ): AcquisitionRetryRecipe => {
    return async () => {
      const provenanceResult = mintProvenance(realization.provenance.sourceId);
      if (!provenanceResult.ok) {
        return {
          ok: false,
          error: { code: provenanceResult.error.code, detail: provenanceResult.error.message },
        };
      }
      const ingestionResult =
        realization.torrentBytes !== undefined
          ? await engine.ingestTorrentFile(realization.torrentBytes, provenanceResult.value)
          : realization.magnet !== undefined
            ? await engine.ingestMagnet(realization.magnet, provenanceResult.value)
            : null;
      if (ingestionResult === null) {
        return {
          ok: false,
          error: {
            code: "INVALID_INPUT",
            detail: "the peer copy carries no open input (neither a magnet nor torrent bytes)",
          },
        };
      }
      if (!ingestionResult.ok) {
        return {
          ok: false,
          error: { code: ingestionResult.error.code, detail: ingestionResult.error.message },
        };
      }
      const sessionResult = await engine.createSession(ingestionResult.value.id, {
        ...(fileIndexes !== undefined && fileIndexes.length > 0
          ? { selection: { fileIndexes } }
          : realization.knownFilePaths !== undefined && realization.knownFilePaths.length > 0
            ? { selection: { filePaths: realization.knownFilePaths } }
            : {}),
      });
      if (!sessionResult.ok) {
        return {
          ok: false,
          error: { code: sessionResult.error.code, detail: sessionResult.error.message },
        };
      }
      return { ok: true, value: { sessionId: sessionResult.value.sessionId } };
    };
  };

  return {
    peerCopyRung(itemId: string): TorrentRungSatisfaction | null {
      return desktopTorrentRungSatisfaction(realizationOf(itemId));
    },

    realizationOf(itemId: string): DesktopTorrentRealization | null {
      return realizationOf(itemId);
    },

    async playPeerCopy(
      itemId: string,
      playOptions?: {
        readonly fileIndexes?: readonly number[];
        readonly resumePositionMs?: number;
      },
    ): Promise<DesktopPeerCopyPlayOutcome> {
      const realization = realizationOf(itemId);
      if (realization === null) {
        return {
          kind: "not-offered",
          detail:
            "No authorized peer copy is offered for this title — the other ways to watch are the honest paths here.",
        };
      }

      // THE AUTHORIZATION GATE (the R23-C law): an unauthorized copy is
      // never offered as playback — the typed refusal, never a silent drop.
      const rung = desktopTorrentRungSatisfaction(realization);
      if (rung === null || rung.kind === "requires-authorization") {
        return {
          kind: "requires-authorization",
          detail: rung?.detail ?? TORRENT_REALIZATION_VIEW.detail,
        };
      }
      if (rung.kind !== "satisfies-native-rung") {
        // Desktop truthfully satisfies the native rung for every authorized
        // realization — any other outcome is an incoherent platform bundle.
        return {
          kind: "playback-failed",
          code: "unsupported-capability",
          detail: `the Desktop platform did not answer the native rung for this copy (${rung.kind}) — the capability bundle is incoherent`,
        };
      }

      // The ready-offline replay: the EARNED verified asset plays through
      // its local path (the J27 law) — same canonical item, same rung.
      const offline = offlineAssetOf(adapter, itemId);
      if (offline !== null) {
        return engageNativePlayback(runtime, itemId, {
          nativeOpen: { localPath: offline.contentPath },
          resumePositionMs: playOptions?.resumePositionMs,
          detail:
            "Playing your verified copy — it plays straight from this device, no peers needed.",
          sessionId: `offline:${offline.assetId}`,
        });
      }

      // THE AUTHORIZED INGESTION (the registry mint — the engine's own gate).
      const provenanceResult = mintProvenance(realization.provenance.sourceId);
      if (!provenanceResult.ok) {
        return {
          kind: "engine-refused",
          code: provenanceResult.error.code,
          detail: provenanceResult.error.message,
        };
      }
      const ingestionResult =
        realization.torrentBytes !== undefined
          ? await engine.ingestTorrentFile(realization.torrentBytes, provenanceResult.value)
          : realization.magnet !== undefined
            ? await engine.ingestMagnet(realization.magnet, provenanceResult.value)
            : null;
      if (ingestionResult === null) {
        return {
          kind: "engine-refused",
          code: "INVALID_INPUT",
          detail:
            "the peer copy carries no open input (neither a magnet nor torrent bytes) — the composition's realization truth is incomplete",
        };
      }
      if (!ingestionResult.ok) {
        return {
          kind: "engine-refused",
          code: ingestionResult.error.code,
          detail: ingestionResult.error.message,
        };
      }
      const ingestion: TorrentIngestion = ingestionResult.value;

      // THE FILE SELECTION (the J22 step — auto when unambiguous).
      const knownFiles = ingestion.files;
      let selection: readonly number[] | undefined = playOptions?.fileIndexes;
      if (selection === undefined && knownFiles.length > 0) {
        const resolved = resolvePeerCopySelection(knownFiles, undefined);
        if (resolved.kind === "file-choice-required") {
          return {
            kind: "file-choice-required",
            ingestionId: ingestion.id,
            candidates: resolved.candidates,
            detail:
              "This peer copy carries several files — choose the one to watch and playback starts right away.",
          };
        }
        selection = resolved.fileIndexes;
      }

      // THE SESSION (the engine's own duplicate-live-session law applies).
      const sessionResult = await engine.createSession(ingestion.id, {
        selection:
          selection !== undefined
            ? { fileIndexes: selection }
            : realization.knownFilePaths !== undefined && realization.knownFilePaths.length > 0
              ? { filePaths: realization.knownFilePaths }
              : {},
      });
      if (!sessionResult.ok) {
        return {
          kind: "engine-refused",
          code: sessionResult.error.code,
          detail: sessionResult.error.message,
        };
      }
      const sessionId = sessionResult.value.sessionId;

      // THE CANONICAL-IDENTITY BIND (the R04 composition — the same wiring
      // the R14 acquire recipe performs; the parity contract's identity
      // law) WITH the typed RETRY recipe (the error-recovery dimension:
      // the failed view's retry action executes through the same surface
      // as any realization's).
      source.bindSession(
        sessionId,
        identityOf(realization),
        retryRecipeOf(realization, selection),
      );

      // THE NATIVE PLAYBACK ENGAGEMENT (the rung the peer copy satisfies).
      // R26-W3 (the wire-law fix this lane's real-composition journey
      // surfaced): the native open input is the MAGNET — the
      // wire-transportable source (the v1 engine wire protocol carries
      // JSON DTOs; torrent BYTES cannot cross it, and the engine's own
      // ingestion lane has already consumed them for the file-selection
      // truth). A realization without an explicit magnet derives it from
      // the INGESTION's own infohash (the swarm identity the engine just
      // parsed — never invented).
      const openMagnet =
        realization.magnet !== undefined
          ? realization.magnet
          : `magnet:?xt=urn:btih:${ingestion.infoHash}${
              ingestion.displayName !== undefined
                ? `&dn=${encodeURIComponent(ingestion.displayName)}`
                : ""
            }`;
      return engageNativePlayback(runtime, itemId, {
        nativeOpen: { magnet: openMagnet },
        resumePositionMs: playOptions?.resumePositionMs,
        detail: rung.detail,
        sessionId,
      });
    },

    fileChoice(ingestionId: string): readonly DesktopTorrentFileCandidate[] | null {
      const ingestion = engine.ingestions().find((candidate) => candidate.id === ingestionId);
      if (ingestion === undefined || ingestion.files.length === 0) return null;
      return torrentFileCandidates(ingestion.files);
    },

    async recoverSession(input: {
      readonly sessionId: string;
      readonly identity: AcquisitionIdentity;
    }): Promise<TorrentResult<{ readonly sessionId: string; readonly resumed: boolean }>> {
      // The journaled session re-binds to its canonical identity (the
      // composition root's recovery wiring — the J25/J38 continuity) WITH
      // the same typed RETRY recipe the play flow binds (the recovery path
      // keeps the error-recovery dimension's wiring — never a downgrade),
      // then the engine's recovery report feeds the acquisition surface's
      // refresh (the resumed/retained-progress proof). The engine owns the
      // truth.
      const realization = realizationOf(input.identity.canonicalItemId);
      source.bindSession(
        input.sessionId,
        input.identity,
        realization !== null ? retryRecipeOf(realization, undefined) : undefined,
      );
      const recovery = await engine.recover();
      if (!recovery.ok) return recovery;
      const resumed =
        recovery.value.recovered.some((entry) => entry.sessionId === input.sessionId) ||
        recovery.value.rearmed.some((entry) => entry.sessionId === input.sessionId);
      return { ok: true, value: { sessionId: input.sessionId, resumed } };
    },
  };
}

// ---------------------------------------------------------------------------
// The native-playback engagement (the shared runtime's own laws)
// ---------------------------------------------------------------------------

/** The engagement input (the open input + the honest detail). */
interface EngageInput {
  readonly nativeOpen: { magnet?: string; localPath?: string };
  readonly resumePositionMs: number | undefined;
  readonly detail: string;
  /** The acquisition session id (the offline replay carries `offline:<assetId>`). */
  readonly sessionId: string;
}

/**
 * Resolve + engage the NATIVE playback session for the peer copy: the
 * composed realization (the native rung — never a torrent mode), the
 * watch state's own resume truth, the port's authorized open input. The
 * controller's laws apply verbatim (prepare → play → seek → pause/resume
 * → stop; the observation stream is the only progress source).
 */
async function engageNativePlayback(
  runtime: ClientRuntime,
  itemId: string,
  input: EngageInput,
): Promise<DesktopPeerCopyPlayOutcome> {
  const resumePositionMs =
    input.resumePositionMs !== undefined
      ? input.resumePositionMs
      : (runtime.watchState.get(itemId)?.lastPositionMs ?? 0);
  let playbackSession: Awaited<ReturnType<typeof runtime.resolvePlayback>>;
  try {
    playbackSession = await runtime.resolvePlayback({
      itemId,
      realization: peerCopyPlaybackRealization(),
      resumePositionMs,
    });
  } catch (thrown) {
    return {
      kind: "playback-failed",
      code: "unresolvable",
      detail: `the native playback session could not be resolved: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    };
  }
  const controller = runtime.playback.controller(playbackSession.id);
  if (controller === undefined) {
    return {
      kind: "playback-failed",
      code: "unresolvable",
      detail: "the resolved playback session has no controller — the runtime wiring is incoherent",
    };
  }
  const prepared = await controller.prepare({ nativeOpen: input.nativeOpen });
  if (!prepared.ok) {
    return {
      kind: "playback-failed",
      code: prepared.kind,
      detail: prepared.detail,
    };
  }
  return {
    kind: "started",
    sessionId: input.sessionId,
    playbackSessionId: playbackSession.id,
    controller,
    detail: input.detail,
  };
}

/**
 * The item's EARNED offline asset (the verified local path), read through
 * the R13 adapter's own exposure law — the only source of Ready offline.
 * Answers null when no verified exposure exists for the canonical item.
 */
function offlineAssetOf(
  adapter: TorrentEngineAdapter,
  itemId: string,
): { readonly assetId: string; readonly contentPath: string } | null {
  const listed = adapter.listOfflineReady();
  if (!listed.ok) return null;
  const entry = listed.value.find((candidate) => candidate.library?.canonicalItemId === itemId);
  if (entry === undefined) return null;
  const asset = entry.assets.find((candidate) => candidate.integrity === "verified");
  return asset !== undefined ? { assetId: asset.assetId, contentPath: asset.contentPath } : null;
}
