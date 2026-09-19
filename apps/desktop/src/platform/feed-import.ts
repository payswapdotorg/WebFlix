/**
 * @wfx/app-desktop — the Desktop BYOF file-import surface (R20-F).
 *
 * THE native import path bound to the frozen shared feed contract
 * (`FeedPort`, contracts.md "Bring Your Own Feed"):
 *
 * ```text
 * native file dialog (ShellIpc filePick*)  →  the REAL OS open-file dialog
 *        | picked file (shell-truth metadata)
 *        v
 * fileRead (the read-root law)             →  the artifact's REAL bytes
 *        | artifact: Uint8Array — VERBATIM, never re-encoded
 *        v
 * FeedPort.previewImport({ connectorId, method, artifact })  →  the preview
 *        | the user previews + confirms
 *        v
 * FeedPort.confirmImport(importId)         →  the idempotent import
 * ```
 *
 * WHAT THIS MODULE OWNS vs WHAT IT DOES NOT:
 * - OWNS: the platform half — picking the file through the native shell,
 *   reading its bytes, the typed verdicts of every platform outcome
 *   (dismissed / unsupported / failed), and handing the artifact to the
 *   shared port EXACTLY as picked.
 * - DOES NOT own: parsing the export artifact, connector capability
 *   discovery, preview staging, or import persistence — those are the
 *   shared `FeedPort` seam's (Worker 1's R20-B/R20-C lanes; the frozen
 *   contract is this lane's seam, per the plan's "R20-F/G can start
 *   against frozen contract stubs" doctrine).
 *
 * Truth laws kept here (byof-architecture.md + the R20 truth laws):
 * - PLATFORM-HONEST: a dialog-less platform answers the TYPED
 *   `unsupported` verdict (queried cheaply up front, confirmed by the
 *   pick attempt) — never a silent no-op, never a fabricated pick.
 * - METHOD-HONEST: a connector that does not declare the file import
 *   method never even reaches the port — the typed `unsupported` verdict
 *   answers BEFORE the dialog opens (the offer is the connector's
 *   declared capability truth, intersected with the file vocabulary).
 * - NO ARTIFACT FORGERY: the bytes that cross `previewImport` are the
 *   bytes the shell read (test-pinned); a read failure is a typed
 *   `failed` verdict, never empty bytes or a retry in disguise.
 * - SNAPSHOT TRUTH: a file import is a SNAPSHOT capture by definition
 *   (`FeedImportMethod` 'official-export'/'user-file'); nothing here
 *   labels it live (the sync state machine grants `live` only to a
 *   successfully continuously-synced route — feeds/model.ts).
 * - The import's IDEMPOTENCE is the shared port's law (the
 *   deterministic `feedImportKey`); this surface's job is to route the
 *   SAME artifact to the SAME seam every time — the parity tests prove
 *   the native path end-to-end against the real domain semantics.
 */

import type {
  FeedImport,
  FeedImportCapability,
  FeedImportMethod,
  FeedImportPreview,
  FeedPort,
  FeedRelationship,
} from "@wfx/domain";
import { FEED_IMPORT_METHODS, isFeedImportMethod } from "@wfx/domain";

import type { ShellIpc } from "./shell-ipc";

// ---------------------------------------------------------------------------
// The capability truth
// ---------------------------------------------------------------------------

/**
 * The file-import capability truth of this platform's shell:
 * `supported` (a native open-file dialog exists) or the typed
 * `unsupported` verdict with the platform's honest reason.
 */
export type DesktopFileImportCapability =
  | { readonly supported: true; readonly kind: "native-dialog" }
  | { readonly supported: false; readonly reason: "unsupported"; readonly detail: string };

/** The import methods a native FILE dialog can serve (the frozen union's file subset). */
export const FILE_FEED_IMPORT_METHODS: readonly FeedImportMethod[] = [
  "official-export",
  "user-file",
];

// ---------------------------------------------------------------------------
// The typed verdict of one import attempt
// ---------------------------------------------------------------------------

/** One staged native import attempt's input (all fields validated before any dialog opens). */
export interface DesktopFeedImportInput {
  /** The connector the artifact belongs to (the preview's seam routing). */
  readonly connectorId: string;
  /**
   * The import method — must be a FILE method (`official-export` |
   * `user-file`); the API-driven methods are not the dialog's to serve.
   */
  readonly method: FeedImportMethod;
  /** The relationship/container filters the preview should carry (the frozen FeedImportRequest subset). */
  readonly relationships?: readonly FeedRelationship[];
  /** The container/source ref, when the artifact addresses one (the frozen FeedImportRequest subset). */
  readonly sourceRef?: string;
  /**
   * The connector's declared feed-import capabilities, when the caller
   * knows them: a method the connector does NOT declare answers the typed
   * `unsupported` verdict BEFORE the dialog opens (capability truth,
   * never an attempt that silently degrades).
   */
  readonly connectorCapabilities?: readonly FeedImportCapability[];
}

/**
 * The typed verdict of one native import attempt — every non-preview
 * outcome names its honest reason; there is NO silent no-op path.
 */
export type DesktopFeedImportResult =
  | { readonly outcome: "preview"; readonly preview: FeedImportPreview }
  | { readonly outcome: "dismissed"; readonly detail: string }
  | { readonly outcome: "unsupported"; readonly detail: string }
  | { readonly outcome: "failed"; readonly code: "file-read" | "preview" | "invalid-input"; readonly detail: string };

// ---------------------------------------------------------------------------
// The binding
// ---------------------------------------------------------------------------

/** Options for {@link createDesktopFeedImportBinding}. */
export interface DesktopFeedImportBindingOptions {
  /** The live native shell (the file dialog + read root). */
  readonly shell: ShellIpc;
  /** The frozen shared feed port (preview/confirm are its seam). */
  readonly feedPort: FeedPort;
}

/** The Desktop BYOF file-import surface (the R20-F platform binding). */
export interface DesktopFeedImportBinding {
  /** The shell's file-dialog capability truth (queried once and cached — never a dialog-opening probe). */
  fileImportCapability(): Promise<DesktopFileImportCapability>;
  /**
   * The first-class import path: open the native dialog, read the picked
   * file's bytes, and stage the preview through the shared FeedPort.
   * The typed verdict carries every honest outcome.
   */
  importFromFile(input: DesktopFeedImportInput): Promise<DesktopFeedImportResult>;
  /** Confirm a previewed import (delegates to the shared port — idempotent by its law). */
  confirmImport(importId: string): Promise<FeedImport>;
}

/** Validate the caller's input BEFORE any platform surface is touched (typed misuse verdicts). */
function validateInput(input: DesktopFeedImportInput): string | null {
  if (typeof input.connectorId !== "string" || input.connectorId.trim().length === 0) {
    return `connectorId: expected a non-empty string, got ${String(input.connectorId)}`;
  }
  if (!isFeedImportMethod(input.method)) {
    return `method: expected one of ${FEED_IMPORT_METHODS.join(" | ")}, got ${String(input.method)}`;
  }
  if (!FILE_FEED_IMPORT_METHODS.includes(input.method)) {
    return `method: '${input.method}' is not a file import method — the native dialog serves ${FILE_FEED_IMPORT_METHODS.join(" | ")} (the API-driven methods belong to the connector lane)`;
  }
  return null;
}

/** Whether the connector declares the file method (absent capabilities = the port's call to make). */
function connectorDeclaresMethod(
  capabilities: readonly FeedImportCapability[] | undefined,
  method: FeedImportMethod,
): boolean {
  if (capabilities === undefined) return true; // no declared truth supplied — attempt honestly
  return capabilities.some((capability) => capability.method === method);
}

/**
 * Build the Desktop BYOF file-import binding over the live shell + the
 * frozen shared feed port.
 */
export function createDesktopFeedImportBinding(
  options: DesktopFeedImportBindingOptions,
): DesktopFeedImportBinding {
  const { shell, feedPort } = options;

  // The capability query runs once and is cached — the same truth the
  // shell's pick attempts would answer, asked cheaply (never a dialog).
  let capabilityCache: DesktopFileImportCapability | undefined;

  return {
    async fileImportCapability(): Promise<DesktopFileImportCapability> {
      if (capabilityCache === undefined) {
        const support = await shell.filePickAvailable();
        capabilityCache = support.available
          ? { supported: true, kind: "native-dialog" }
          : { supported: false, reason: "unsupported", detail: support.detail };
      }
      return capabilityCache;
    },

    async importFromFile(input: DesktopFeedImportInput): Promise<DesktopFeedImportResult> {
      const invalid = validateInput(input);
      if (invalid !== null) {
        return { outcome: "failed", code: "invalid-input", detail: invalid };
      }

      // METHOD-HONEST: the connector's declared truth answers before the
      // platform is touched (the offer is the connector's, not a guess).
      if (!connectorDeclaresMethod(input.connectorCapabilities, input.method)) {
        return {
          outcome: "unsupported",
          detail: `connector '${input.connectorId}' does not declare the '${input.method}' import capability — the file import offer is honestly unavailable for it`,
        };
      }

      // PLATFORM-HONEST: the shell's dialog truth, typed.
      const capability = await this.fileImportCapability();
      if (!capability.supported) {
        return { outcome: "unsupported", detail: capability.detail };
      }

      // THE DIALOG: the request's filters stay in plain product language.
      const pick = await shell.filePickOpen({
        title: "Choose your feed export file",
        filters: [{ name: "Feed export", extensions: ["json", "csv", "zip", "txt"] }],
      });
      if (!pick.picked) {
        if (pick.reason === "unsupported") {
          // The query said available but the attempt says otherwise — the
          // attempt is the fuller truth; the cache refreshes to it.
          capabilityCache = { supported: false, reason: "unsupported", detail: pick.detail };
          return { outcome: "unsupported", detail: pick.detail };
        }
        return { outcome: "dismissed", detail: pick.detail };
      }

      // THE READ: real bytes from the read-root law, or the typed failure.
      let artifact: Uint8Array;
      try {
        artifact = await shell.fileRead(pick.file.path);
      } catch (thrown) {
        const detail = thrown instanceof Error ? thrown.message : String(thrown);
        return {
          outcome: "failed",
          code: "file-read",
          detail: `the file '${pick.file.fileName}' could not be read: ${detail}`,
        };
      }

      // THE SHARED SEAM: the artifact passes VERBATIM — the preview is
      // the port's staging, the bytes are exactly the shell's bytes.
      try {
        const preview = await feedPort.previewImport({
          connectorId: input.connectorId,
          method: input.method,
          ...(input.relationships !== undefined ? { relationships: input.relationships } : {}),
          ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
          artifact,
        });
        return { outcome: "preview", preview };
      } catch (thrown) {
        const detail = thrown instanceof Error ? thrown.message : String(thrown);
        return {
          outcome: "failed",
          code: "preview",
          detail: `the feed preview failed: ${detail}`,
        };
      }
    },

    confirmImport(importId: string): Promise<FeedImport> {
      return feedPort.confirmImport(importId);
    },
  };
}
