/**
 * @wfx/app-web — the long-form Watch browse surface (R07).
 *
 * The watch browsing page over the RUNTIME's search models: every row
 * carries its typed section status (an error row renders as the error
 * state — never a fake empty row), and the cards are the runtime's
 * canonical-joined hits. Server component.
 */

import type { JSX } from "react";

import type { WatchBrowseView } from "@/host/view-models";
import { Row } from "@/components/home/HomeSurface";
import { EmptyState } from "@/components/ui/StateViews";

/** The watch browse surface. */
export function WatchBrowseSurface({ view }: { readonly view: WatchBrowseView }): JSX.Element {
  const hasContent = view.rows.some((row) => row.cards.length > 0);
  const allFailed = view.rows.length > 0 && view.rows.every((row) => row.status.state === "error");
  return (
    <div data-wfx-surface="watch" data-wfx-watch>
      <h1 className="wfx-page-title" data-wfx-watch-title>
        Watch
      </h1>
      <p className="wfx-page-subtitle">Long-form browsing — your sources&apos; movies, series, and episodes.</p>
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
