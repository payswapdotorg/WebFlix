/**
 * @wfx/app-web — the Settings surface (R07): capability TRUTH, honestly.
 *
 * The settings destination renders the adapter's truthful capability
 * declaration (the `PlatformCapabilities` bundle the runtime booted on)
 * as the user-facing truth table — the UI honesty law: unsupported
 * capabilities render as unsupported, NEVER as success or hidden:
 *
 * - SOURCES (R17): the runtime's sources model — each connected source's
 *   card states its authorization truth (Connected / Sign-in expired /
 *   Not connected / Connection failed) with its typed recovery action
 *   (reconnect / connect / disconnect). An EXPIRED source is its own
 *   named state — never a silent fallback to "not connected", never a
 *   fake "connected". When the transport cannot read sources (the service
 *   transport has not implemented the R03 read yet), the section renders
 *   the honest not-wired state — never a fabricated connected source.
 * - MODEL: model/AI controls arrive with R06; the honest absent state.
 * - GENERAL: the capability table (storage/browser host/native media/
 *   background work/sharing/notifications), each with its level and the
 *   honest limitation reason from the descriptor, plus the session state.
 *
 * Server component.
 */

import type { JSX } from "react";

import type { SourcesModel, SourceInfo } from "@wfx/client-runtime";
import { sourceRecoveryAction } from "@wfx/client-runtime";
import type { WebPlatformBundle } from "@/platform/capabilities";
import type { WebSessionState } from "@/host/session";
import { describeWebBackgroundWork } from "@/platform/background-work";
import { Icon } from "@/components/shell/Icon";
import { SourceActions } from "@/components/settings/SourceActions";

/** The auth-state chip vocabulary (the honest per-state truth). */
const AUTH_STATE_LABELS: Readonly<Record<string, string>> = {
  signedIn: "Connected",
  signedOut: "Not connected",
  expired: "Sign-in expired",
  authorizing: "Connecting…",
  failed: "Connection failed",
};

/** One source's card: the authorization truth + its typed recovery action. */
function SourceCard({
  source,
  mode,
}: {
  readonly source: SourceInfo;
  readonly mode: "fixtures" | "service";
}): JSX.Element {
  const recovery = sourceRecoveryAction(source);
  const expired = source.authState === "expired";
  return (
    <li
      className="wfx-queue__item"
      data-wfx-source={source.connectorId}
      data-wfx-source-auth-state={source.authState}
      {...(expired ? { "data-wfx-source-expired": "true" } : {})}
    >
      <span className="wfx-card__meta">
        <span className="wfx-badge wfx-badge--type">{source.displayName}</span>
        <span
          className="wfx-badge wfx-badge--type"
          data-wfx-source-auth-chip={source.authState}
        >
          {AUTH_STATE_LABELS[source.authState] ?? source.authState}
        </span>
      </span>
      <p className="wfx-row__reason" data-wfx-source-recovery-detail>
        {recovery.detail}
      </p>
      {source.availabilityNotes.length > 0 ? (
        <ul className="wfx-row__reason" data-wfx-source-notes>
          {source.availabilityNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      <SourceActions
        connectorId={source.connectorId}
        action={{ kind: recovery.kind, label: recovery.label }}
        mode={mode}
      />
    </li>
  );
}

/** One capability row of the truth table. */
function CapabilityRow({
  area,
  level,
  supported,
  limitation,
}: {
  readonly area: string;
  readonly level: string;
  readonly supported: boolean;
  readonly limitation?: string;
}): JSX.Element {
  return (
    <li className="wfx-queue__item" data-wfx-capability={area.toLowerCase()}>
      <span className="wfx-card__meta">
        <span className="wfx-badge wfx-badge--type">{area}</span>
        <span data-wfx-capability-level>{level}</span>
        {supported ? (
          <span className="wfx-capchip" data-wfx-capability-supported>
            Available
          </span>
        ) : (
          <span className="wfx-capchip" data-wfx-capability-unsupported>
            Not available on Web
          </span>
        )}
      </span>
      {limitation !== undefined ? (
        <p className="wfx-row__reason" data-wfx-capability-limitation>
          {limitation}
        </p>
      ) : null}
    </li>
  );
}

/** The settings surface. */
export function SettingsSurface({
  capabilities,
  session,
  mode,
  section,
  sources,
}: {
  /** The truthful platform bundle (the runtime's own declaration). */
  readonly capabilities: WebPlatformBundle;
  /** The honest session state (the R02 seam's view). */
  readonly session: WebSessionState;
  /** The boot mode badge context. */
  readonly mode: "fixtures" | "service";
  /** The active settings section (the runtime's navigation payload). */
  readonly section?: "sources" | "model" | "general";
  /** The runtime's sources model (R17: the sources section's data). */
  readonly sources?: SourcesModel;
}): JSX.Element {
  const descriptor = capabilities.descriptor;
  const limitations = descriptor.limitations ?? {};
  const storageDescription = capabilities.ports.storage.describe();
  return (
    <div data-wfx-surface="settings" data-wfx-settings>
      <h1 className="wfx-page-title" data-wfx-settings-title>
        Settings
      </h1>
      <p className="wfx-page-subtitle">
        The web adapter&apos;s capability truth — what this platform can and cannot do, stated
        plainly (never guessed, never hidden).
      </p>

      <nav aria-label="Settings sections" data-wfx-settings-sections>
        <a
          className={`wfx-btn wfx-btn--sm${section === "sources" ? " wfx-btn--primary" : ""}`}
          href="/settings?section=sources"
          {...(section === "sources" ? { "aria-current": "page" as const } : {})}
        >
          Sources
        </a>
        <a
          className={`wfx-btn wfx-btn--sm${section === "model" ? " wfx-btn--primary" : ""}`}
          href="/settings?section=model"
          {...(section === "model" ? { "aria-current": "page" as const } : {})}
        >
          Model &amp; AI
        </a>
        <a
          className={`wfx-btn wfx-btn--sm${section === "general" ? " wfx-btn--primary" : ""}`}
          href="/settings?section=general"
          {...(section === "general" ? { "aria-current": "page" as const } : {})}
        >
          General
        </a>
      </nav>

      {section === "sources" ? (
        <section className="wfx-detail__section" aria-label="Sources" data-wfx-settings-sources>
          <h2>Sources</h2>
          {sources !== undefined && sources.status.state === "ready" && sources.sources.length > 0 ? (
            <>
              <p className="wfx-detail__meta">
                The authorization truth of every connected source — an expired sign-in is its own
                named state with its reconnect path (never a silent fallback, never a fake
                connection).
              </p>
              <ul
                className="wfx-queue__list"
                style={{ listStyle: "none", padding: 0 }}
                data-wfx-sources-list
              >
                {sources.sources.map((source) => (
                  <SourceCard key={source.connectorId} source={source} mode={mode} />
                ))}
              </ul>
            </>
          ) : sources !== undefined && sources.status.state === "error" ? (
            <div className="wfx-state" data-wfx-sources-error>
              <span className="wfx-state__icon">
                <Icon name="browser" />
              </span>
              <p className="wfx-state__title">Source states are unavailable right now</p>
              <p className="wfx-state__detail">
                {sources.status.error?.detail ??
                  "the source read did not complete — the last observed states stand"}
                . This host browses whatever its configured service carries — and never pretends a
                source is connected.
              </p>
            </div>
          ) : (
            <div className="wfx-state" data-wfx-sources-empty>
              <span className="wfx-state__icon">
                <Icon name="browser" />
              </span>
              <p className="wfx-state__title">No sources connected</p>
              <p className="wfx-state__detail">
                Source management (connect, reauthorize, disconnect, per-source capabilities and
                authorization state) arrives with the source-management lane (R03). Until then this
                host browses whatever its configured service carries — and never pretends a source
                is connected.
              </p>
            </div>
          )}
        </section>
      ) : null}

      {section === "model" ? (
        <section className="wfx-detail__section" aria-label="Model and AI" data-wfx-settings-model>
          <h2>Model &amp; AI</h2>
          <div className="wfx-state" data-wfx-model-empty>
            <span className="wfx-state__icon">
              <Icon name="sparkle" />
            </span>
            <p className="wfx-state__title">Model controls arrive with the model lane (R06)</p>
            <p className="wfx-state__detail">
              WebFlix model selection, BYOM providers, local-model policy, privacy/cost
              constraints, and AI media operations (transcription, subtitles, translation,
              dubbing, commentary) are the model-controls lane. This adapter renders their honest
              absence rather than placeholder controls.
            </p>
          </div>
        </section>
      ) : null}

      {section === undefined || section === "general" ? (
        <>
          <section className="wfx-detail__section" aria-label="Session" data-wfx-settings-session>
            <h2>Session</h2>
            <p className="wfx-card__meta">
              <span className="wfx-badge wfx-badge--type" data-wfx-session-label>
                {session.label}
              </span>
              <span data-wfx-session-state>{session.description}</span>
            </p>
            <p className="wfx-row__reason" data-wfx-session-durability>
              Session stability:{" "}
              {session.sessionDurability === "browser-sessions"
                ? "kept across browser sessions on this device"
                : "kept for this server process (browser storage is not available in this boot context)"}
              . Boot mode: {mode}.
            </p>
          </section>

          <section className="wfx-detail__section" aria-label="Platform capabilities" data-wfx-settings-capabilities>
            <h2>Platform capabilities (the web adapter&apos;s truth)</h2>
            <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }}>
              <CapabilityRow
                area="Storage"
                level={`browser (${storageDescription.kv.backend} kv, ${storageDescription.blobs.backend} blobs)`}
                supported
                limitation={`Durability: kv ${storageDescription.kv.durability}, blobs ${storageDescription.blobs.durability}. ${
                  limitations.storage ?? ""
                }`}
              />
              <CapabilityRow
                area="Contained browser"
                level={capabilities.browserHost}
                supported={capabilities.browserHost === "contained"}
                {...(limitations.browserHost !== undefined ? { limitation: limitations.browserHost } : {})}
              />
              <CapabilityRow
                area="Native media & torrent acquisition"
                level={capabilities.nativeMedia}
                supported={capabilities.nativeMedia !== "none"}
                {...(limitations.nativeMedia !== undefined ? { limitation: limitations.nativeMedia } : {})}
              />
              <CapabilityRow
                area="Background work"
                level={capabilities.backgroundWork}
                supported={capabilities.backgroundWork !== "none"}
                limitation={describeWebBackgroundWork()}
              />
              <CapabilityRow
                area="Sharing"
                level={capabilities.sharing ? "web share api" : "absent in this context"}
                supported={capabilities.sharing}
                {...(capabilities.sharing
                  ? {}
                  : {
                      limitation:
                        "the Web Share API is not present in this boot context — the honest unsupported state (copy-link affordances are plain UI, never a fake OS share)",
                    })}
              />
              <CapabilityRow
                area="Notifications"
                level={capabilities.notifications ? "permission-gated" : "absent in this context"}
                supported={capabilities.notifications}
                limitation={
                  capabilities.notifications
                    ? "delivery requires the user's permission — never fabricated"
                    : "the Web Notifications API is not present in this boot context"
                }
              />
            </ul>
            <p className="wfx-row__reason" data-wfx-capability-descriptor>
              Adapter {descriptor.adapterId} v{descriptor.adapterVersion} on platform &apos;
              {descriptor.platform}&apos; — the runtime booted on this declaration and re-checks
              it (a lying bundle cannot boot).
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
