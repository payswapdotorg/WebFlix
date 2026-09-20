/**
 * @wfx/app-web — the Home source strip (R21-D, server).
 *
 * The CONNECTED-SOURCES discovery strip of the Home orientation zone:
 * every source's authorization truth in one compact row (Connected /
 * Sign-in expired / …), the typed recovery action as a link into the
 * EXISTING management surface (Settings → Sources — where the real
 * connect/reconnect flow lives), and the two orientation calls to
 * action: Connect a source and Bring your feed. Honest by construction:
 * a failed sources read renders the typed error state (never a fake
 * empty strip), and the strip never fabricates a connected source.
 *
 * Server component (links only — the flows themselves live in Settings,
 * the detailed management center).
 */

import type { JSX } from "react";

import type { SourceStripView } from "@/host/discoverability";
import { Icon } from "@/components/shell/Icon";

export function SourceStrip({ view }: { readonly view: SourceStripView }): JSX.Element {
  return (
    <div className="wfx-disc__sources" data-wfx-source-strip>
      {view.state === "ready" ? (
        view.sources.length > 0 ? (
          <ul className="wfx-disc__sourcechips" data-wfx-source-chips>
            {view.sources.map((source) => (
              <li
                key={source.connectorId}
                className={`wfx-disc__sourcechip wfx-disc__sourcechip--${source.authState}`}
                data-wfx-source-chip={source.connectorId}
                data-wfx-source-chip-auth={source.authState}
              >
                <span className="wfx-disc__sourcename">{source.displayName}</span>
                <span className="wfx-disc__sourceauth" data-wfx-source-chip-label>
                  {source.authLabel}
                </span>
                {source.recoveryLabel.length > 0 ? (
                  <a
                    className="wfx-disc__sourcelink"
                    href="/settings?section=sources"
                    data-wfx-source-recovery={source.connectorId}
                  >
                    {source.recoveryLabel}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="wfx-disc__sourcenote" data-wfx-source-strip-empty>
            No sources connected yet — WebFlix browses whatever its configured service carries.
          </p>
        )
      ) : (
        <p className="wfx-disc__sourcenote" data-wfx-source-strip-error>
          Source states are unavailable right now —{" "}
          {view.errorDetail ?? "the read did not complete"}. The last observed states stand.
        </p>
      )}
      <div className="wfx-disc__sourceactions">
        <a className="wfx-btn wfx-btn--sm" href="/settings?section=sources" data-wfx-source-connect-cta>
          <Icon name="browser" size={14} />
          Connect a source
        </a>
        <a className="wfx-disc__link" href="/settings?section=sources" data-wfx-byof-cta>
          Bring your feed
        </a>
      </div>
    </div>
  );
}
