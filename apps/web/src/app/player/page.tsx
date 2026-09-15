/**
 * @wfx/app-web — the player route (WFX-051).
 *
 * Starts a REAL playback session through the Experience API (port resolve →
 * the WFX-025 device gate → the WFX-005 session + "start" event) and renders
 * the resolved Media Surface mode — embed iframe / browser panel / external
 * handoff, never fake playback. The up-next queue comes from a real feed
 * load (never fabricated). `force-dynamic`: playback sessions are
 * request-time state.
 */

import { AppShell } from "@/components/shell/AppShell";
import { PlayerSurface } from "@/components/player/PlayerSurface";
import { bootExperienceHost, FOR_YOU_QUERY } from "@/host/experience";
import { loadCardViews, startPlayerView } from "@/host/views";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function positiveIntParam(value: string | string[] | undefined): number | undefined {
  const raw = firstParam(value);
  if (raw.length === 0) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function PlayerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const connectorId = firstParam(params.connector);
  const externalRef = firstParam(params.ref);
  const title = firstParam(params.title);
  const canonicalType = firstParam(params.type);
  const durationMs = positiveIntParam(params.duration);
  const resumePositionMs = positiveIntParam(params.resume);

  const host = bootExperienceHost();

  if (connectorId.length === 0 || externalRef.length === 0 || title.length === 0) {
    return (
      <AppShell mode={host.mode}>
        <div data-wfx-surface="player" data-wfx-player-state="missing-params">
          <h1 className="wfx-page-title">Player</h1>
          <p className="wfx-page-subtitle">
            This link does not name playable content. Pick something from your feeds.
          </p>
          <a className="wfx-btn" href="/">
            Go home
          </a>
        </div>
      </AppShell>
    );
  }

  // The up-next queue: a real feed load through the same law every surface
  // uses (the seed browse pool, minus the playing item — never fabricated).
  const queue = await loadCardViews(host, "watch", FOR_YOU_QUERY);

  const view = await startPlayerView(host, {
    connectorId,
    externalRef,
    title,
    canonicalType: canonicalType.length > 0 ? canonicalType : "video",
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(resumePositionMs !== undefined ? { resumePositionMs } : {}),
    queue,
  });

  return (
    <AppShell mode={host.mode}>
      <PlayerSurface view={view} />
    </AppShell>
  );
}
