/**
 * @wfx/app-web — the long-form Watch browse surface (R07; R21-D controls).
 *
 * The watch browsing page over the RUNTIME's search models: every row
 * carries its typed section status (an error row renders as the error
 * state — never a fake empty row), and the cards are the runtime's
 * canonical-joined hits.
 *
 * R21-D — the contextual discovery band: the compact feed-mode +
 * Personalize controls (the everyday session changes live HERE — the
 * user is never forced into Settings to switch mode, state an intent,
 * or change attention mode; the frozen UX law). Server component; the
 * controls themselves are the discovery islands.
 */

import type { JSX } from "react";

import type { WatchBrowseView } from "@/host/view-models";
import type { DiscoveryBundle } from "@/host/discoverability";
import { CompactDiscoveryControls } from "@/components/discovery/DiscoveryHeader";
import { Row } from "@/components/home/HomeSurface";
import { EmptyState } from "@/components/ui/StateViews";

/** The watch browse surface. */
export function WatchBrowseSurface({
  view,
  discovery,
}: {
  readonly view: WatchBrowseView;
  /** The R21-D discovery bundle (the compact session controls). */
  readonly discovery?: DiscoveryBundle;
}): JSX.Element {
  const hasContent = view.rows.some((row) => row.cards.length > 0);
  const allFailed = view.rows.length > 0 && view.rows.every((row) => row.status.state === "error");
  return (
    <div data-wfx-surface="watch" data-wfx-watch>
      <h1 className="wfx-page-title" data-wfx-watch-title>
        Watch
      </h1>
      <p className="wfx-page-subtitle">Long-form browsing — your sources&apos; movies, series, and episodes.</p>
      {discovery !== undefined ? <CompactDiscoveryControls bundle={discovery} surface="watch" /> : null}
      {view.rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
      {!hasContent && !allFailed ? (
        <EmptyState
          title="Nothing to browse yet"
          detail="The configured source answered with no long-form cards. WebFlix never fabricates content."
          action={
            <a className="wfx-btn" href="/search">
              Try search
            </a>
          }
        />
      ) : null}
    </div>
  );
}
