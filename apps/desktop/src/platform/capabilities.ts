/**
 * @wfx/app-desktop — the truthful Desktop capability bundle (R08).
 *
 * The Desktop adapter's `PlatformCapabilities`: the FULL reference
 * capability set of the frozen remediation architecture ("Desktop is the
 * full-power reference client"), with every declared level BACKED by a
 * real port over the native shell:
 *
 * | Area           | Declaration        | Backed by                                        |
 * |----------------|--------------------|--------------------------------------------------|
 * | storage        | `"filesystem"`     | StoragePort over the shell's app-data filesystem |
 * | browserHost    | `"contained"`      | BrowserHostPort over isolated webview surfaces   |
 * | nativeMedia    | `"native-service"` | NativeMediaPort over the spawned engine process  |
 * | backgroundWork | `"full"`           | BackgroundWorkPort over the shell task registry  |
 * | sharing        | `true`             | SharingPort over the OS share sheet (per-OS truth)|
 * | notifications  | `true`             | NotificationPort over the OS channel             |
 *
 * The bundle is constructed by `assembleDesktopCapabilities` from a live
 * shell + engine binding, and `checkCapabilityTruth` is run AT BOOT (the
 * runtime re-runs it at `createRuntime` — an incoherent bundle never
 * boots; the adapter self-check fails fast with the honest issues).
 *
 * Torrent-capability truth: `supportsTorrentAcquisition(desktop bundle)`
 * is `true` (native-service media + full background work) — the frozen
 * Desktop reference capability; the WEB bundle is honestly `false`
 * (`nativeMedia: "none"`), so native/torrent flows gate correctly across
 * the two adapters (tested).
 */

import {
  checkCapabilityTruth,
  supportsTorrentAcquisition,
  type CapabilityDescriptor,
  type PlatformCapabilities,
} from "@wfx/platform-contracts";

import type { ShellIpc } from "./shell-ipc";
import { createShellLifecyclePort, type ShellLifecyclePort } from "./lifecycle";
import { createShellStoragePort } from "./storage";
import { createShellBrowserHostPort } from "./browser-host";
import { createShellNotificationPort } from "./notifications";
import { createShellBackgroundWorkPort } from "./background-work";
import { createShellSharingPort } from "./sharing";
import type { NativeMediaBinding } from "./native-media-binding";

/** The Desktop adapter's stable identity (surfaced in the descriptor). */
export const DESKTOP_ADAPTER_ID = "wfx-desktop-adapter";

/** The Desktop adapter's version (kept in lockstep with package.json). */
export const DESKTOP_ADAPTER_VERSION = "0.1.0";

/**
 * The truthful Desktop `CapabilityDescriptor`. `limitations` carries the
 * honest per-area notes — the OS-share-sheet availability truth (Linux
 * desktops have no standard sheet; `canShare` answers false there and the
 * UI renders the honest unsupported state) and the background-work
 * shutdown truth (durable resumption of interrupted acquisition is R13's
 * recovery lane).
 */
export function desktopCapabilityDescriptor(): CapabilityDescriptor {
  return {
    platform: "desktop",
    adapterId: DESKTOP_ADAPTER_ID,
    adapterVersion: DESKTOP_ADAPTER_VERSION,
    limitations: {
      sharing:
        "the OS share sheet is consulted per platform (macOS NSSharingServicePicker, Windows WinRT share UI); Linux desktops have no standard sheet — canShare answers false there, honestly",
      backgroundWork:
        "background tasks run while the app lives (full); durable resumption of interrupted acquisition after app exit is the R13 recovery lane",
      nativeMedia:
        "torrent protocol internals stay behind the native-media engine boundary (R10/R11); the adapter binds the service, never the protocol",
    },
  };
}

/** What `assembleDesktopCapabilities` builds from one live shell. */
export interface DesktopCapabilityPorts {
  readonly lifecycle: ShellLifecyclePort;
  readonly storage: ReturnType<typeof createShellStoragePort>;
  readonly browserHost: ReturnType<typeof createShellBrowserHostPort>;
  readonly nativeMedia: NativeMediaBinding;
  readonly notifications: ReturnType<typeof createShellNotificationPort>;
  readonly backgroundWork: ReturnType<typeof createShellBackgroundWorkPort>;
  readonly sharing: ReturnType<typeof createShellSharingPort>;
}

/** The assembled Desktop bundle (the truthful declaration + the live ports). */
export interface DesktopCapabilities extends PlatformCapabilities {
  readonly ports: PlatformCapabilities["ports"] & DesktopCapabilityPorts;
}

/**
 * Assemble the TRUTHFUL Desktop capability bundle over a live shell and
 * the engine binding. Every port is real (no fixture, no stub); the
 * declaration matches what the ports provide, rule for rule.
 */
export function assembleDesktopCapabilities(
  shell: ShellIpc,
  nativeMedia: NativeMediaBinding,
): DesktopCapabilities {
  return {
    platform: "desktop",
    storage: "filesystem",
    browserHost: "contained",
    nativeMedia: "native-service",
    backgroundWork: "full",
    sharing: true,
    notifications: true,
    descriptor: desktopCapabilityDescriptor(),
    ports: {
      lifecycle: createShellLifecyclePort(shell),
      storage: createShellStoragePort(shell),
      browserHost: createShellBrowserHostPort(shell),
      nativeMedia,
      notifications: createShellNotificationPort(shell),
      backgroundWork: createShellBackgroundWorkPort(shell),
      sharing: createShellSharingPort(shell),
    },
  };
}

/**
 * The adapter's own boot truth-check: run `checkCapabilityTruth` on the
 * assembled bundle and THROW with every issue named when it is incoherent
 * (the runtime re-checks at `createRuntime`; this fails fast at the
 * adapter boundary with the adapter's own message). Returns the honest
 * torrent-acquisition verdict for callers that render capability truth.
 */
export function assertDesktopCapabilityTruth(capabilities: DesktopCapabilities): boolean {
  const issues = checkCapabilityTruth(capabilities);
  if (issues.length > 0) {
    throw new Error(
      `the desktop capability bundle violates the truth law: ${issues
        .map((issue) => `${issue.area}: ${issue.detail}`)
        .join("; ")}`,
    );
  }
  return supportsTorrentAcquisition(capabilities);
}

export { supportsTorrentAcquisition };
