/**
 * @wfx/app-web — the Library's imported-feeds section (R20-D).
 *
 * The BYOF entry in the LIBRARY context of the existing product IA (the
 * frozen UX law: no new navigation system — the Library is one of the two
 * entry surfaces, Settings the other). Renders the import summaries
 * (counts + freshness truth) and the "Bring your feed" entry link to the
 * wizard. Empty state is the honest invitation — never a stale
 * "arrives later" placeholder.
 *
 * Server component.
 */

import type { JSX } from "react";

import type { ByofImportView } from "@/host/byof/service";
import { FEED_FRESHNESS_LABELS } from "@/host/byof/view-models";

/** The Library surface's imported-feeds section. */
export function ByofLibrarySection({
  imports,
}: {
  /** The import rows (the summaries + freshness truth). */
  readonly imports: readonly ByofImportView[];
}): JSX.Element {
  const confirmed = imports.filter((row) => row.status !== "preview" && row.status !== "failed");
  const totalRecords = confirmed.reduce((total, row) => total + row.recordCount, 0);
  return (
    <section className="wfx-detail__section" aria-label="Your imported feeds" data-wfx-library-byof>
      <h2>Your imported feeds</h2>
      {confirmed.length === 0 ? (
        <p className="wfx-row__reason" data-wfx-library-byof-empty>
          No feed imported yet.{" "}
          <a href="/library/bring-feed" data-wfx-byof-entry-link>
            Bring your feed
          </a>{" "}
          — your follows, playlists, and likes from a connected source, kept in the source&apos;s
          own order.
        </p>
      ) : (
        <>
          <p className="wfx-row__reason" data-wfx-library-byof-summary>
            {totalRecords} imported items across {confirmed.length}{" "}
            {confirmed.length === 1 ? "feed" : "feeds"} — in your sources&apos; own order, never
            re-ranked.{" "}
            <a href="/library/bring-feed" data-wfx-byof-entry-link>
              Open your feeds
            </a>
          </p>
          <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }} data-wfx-library-byof-imports>
            {confirmed.map((row) => (
              <li
                key={row.id}
                className="wfx-queue__item"
                data-wfx-byof-import={row.id}
                data-wfx-byof-import-status={row.status}
              >
                <span className="wfx-card__meta">
                  <span className="wfx-badge wfx-badge--type">
                    {row.connectorId === "fake-source" ? "Connected source" : row.connectorId} ·{" "}
                    {row.method === "api" ? "authorized connection" : "official export"}
                  </span>
                  <span className="wfx-capchip" data-wfx-byof-freshness={row.syncState}>
                    {FEED_FRESHNESS_LABELS[row.syncState] ?? row.syncState}
                  </span>
                </span>
                <p className="wfx-card__meta">
                  {row.recordCount} items ·{" "}
                  {Object.entries(row.relationshipCounts)
                    .map(([relationship, count]) => `${count} ${relationship}${count === 1 ? "" : "s"}`)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
