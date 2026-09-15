/**
 * @wfx/app-web — the home surface component (WFX-050).
 *
 * A pure, presentational SERVER component (no "use client", no hooks, no
 * browser APIs): it renders the `HomeView` the host pipeline produced.
 * The composition test (`tests/home-surface.test.ts`) renders it with
 * `react-dom/server` `renderToStaticMarkup` and asserts the feed data is
 * present in the markup — the same component the route serves.
 *
 * Full UI polish (player surfaces, short-feed stack, search, chrome) is
 * WFX-051's lane; this is the minimal-but-real surface.
 */

import type { CSSProperties, JSX } from "react";
import type { HomeView } from "../host/home";

const styles: Record<string, CSSProperties> = {
  page: {
    maxWidth: "72rem",
    margin: "0 auto",
    padding: "2rem 1.25rem 4rem",
    fontFamily:
      "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    color: "#e7e5e4",
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "0.75rem",
    borderBottom: "1px solid #44403c",
    paddingBottom: "1rem",
    marginBottom: "1.5rem",
  },
  title: { fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 },
  modeBadge: {
    fontSize: "0.75rem",
    fontWeight: 600,
    padding: "0.2rem 0.6rem",
    borderRadius: "999px",
    border: "1px solid #78716c",
    color: "#d6d3d1",
  },
  surfaceLabel: { fontSize: "0.875rem", color: "#a8a29e", margin: "0 0 1rem" },
  list: { display: "grid", gap: "0.75rem", gridTemplateColumns: "1fr", padding: 0, margin: 0 },
  card: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "0.5rem 1rem",
    padding: "0.9rem 1.1rem",
    borderRadius: "0.6rem",
    background: "#1c1917",
    border: "1px solid #292524",
  },
  cardTitle: { fontSize: "1.05rem", fontWeight: 600, margin: 0 },
  cardMeta: { fontSize: "0.8rem", color: "#a8a29e", display: "flex", gap: "0.6rem", flexWrap: "wrap" },
  empty: {
    padding: "2rem 1.25rem",
    borderRadius: "0.6rem",
    border: "1px dashed #57534e",
    color: "#a8a29e",
  },
  footer: { marginTop: "2.5rem", fontSize: "0.75rem", color: "#78716c" },
};

/** Format a duration in milliseconds as `Hh Mm` / `Mm Ss` (deterministic). */
function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function HomeSurface({ view }: { readonly view: HomeView }): JSX.Element {
  return (
    <main style={styles.page} data-wfx-surface={view.surface} data-wfx-mode={view.mode}>
      <header style={styles.header}>
        <h1 style={styles.title}>WebFlix</h1>
        <span style={styles.modeBadge} data-wfx-mode-badge>
          {view.mode === "fixtures" ? "dev fixtures" : "live service"}
        </span>
      </header>
      <p style={styles.surfaceLabel}>
        {view.surface === "watch" ? "Watch feed" : "Short feed"} — minimal home surface (WFX-050)
      </p>
      {view.cards.length === 0 ? (
        <p style={styles.empty}>
          No content — the configured source answered with no cards for this feed.
        </p>
      ) : (
        <ol style={styles.list} data-wfx-cards>
          {view.cards.map((card) => (
            <li key={card.itemId} style={styles.card} data-wfx-card={card.itemId}>
              <p style={styles.cardTitle} data-wfx-card-title>
                {card.title}
              </p>
              <p style={styles.cardMeta}>
                <span data-wfx-card-type>{card.canonicalType}</span>
                {card.durationMs !== undefined ? <span>{formatDuration(card.durationMs)}</span> : null}
                <span data-wfx-card-availability>{card.availability}</span>
                <span data-wfx-card-source>{card.connectorId}</span>
              </p>
            </li>
          ))}
        </ol>
      )}
      <footer style={styles.footer}>
        Universal Entertainment OS — web host. Full experience surfaces arrive with WFX-051.
      </footer>
    </main>
  );
}
