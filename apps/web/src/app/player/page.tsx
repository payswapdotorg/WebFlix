/**
 * @wfx/app-web — the player route (R07).
 *
 * The playback presentation surface over the ONE runtime:
 * `?id&connector&ref&title&type&duration&resume` → `resolvePlayback` (the
 * capability-filtered frozen precedence) → `prepare` (engaging the surface
 * for the resolved mode) → the stage rendered by mode. The runtime's
 * playback phase is rendered truthfully (buffering until evidence — no
 * fake progress); a resolution failure renders the typed failure with the
 * capability-skipped reasons, never a fake stage.
 */

import { AppShell } from "@/components/shell/AppShell";
import { PlayerSurface } from "@/components/player/PlayerSurface";
import { EmptyState } from "@/components/ui/StateViews";
import { getWebRuntimeHost } from "@/host/web-host";
import { canonicalIdFor } from "@/host/web-host";
import { loadPlayerView } from "@/host/view-models";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function numberParam(value: string | string[] | undefined): number | undefined {
  const raw = firstParam(value);
  if (raw.length === 0) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export default async function PlayerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const host = await getWebRuntimeHost();
  const connectorId = firstParam(params.connector);
  const externalRef = firstParam(params.ref);
  const title = firstParam(params.title);
  const canonicalType = firstParam(params.type) || "video";
  const durationMs = numberParam(params.duration);
  const resumePositionMs = numberParam(params.resume);
  const idParam = firstParam(params.id);

  if (connectorId.length === 0 || externalRef.length === 0 || title.length === 0) {
    return (
      <AppShell mode={host.mode} session={host.session.state}>
        <div data-wfx-surface="player" data-wfx-player-state="missing-params">
          <h1 className="wfx-page-title">Playback</h1>
          <EmptyState
            title="Nothing to play"
            detail="This link does not name playable content. Open content from home, watch, search, or a detail page."
            action={
              <a className="wfx-btn" href="/">
                Go home
              </a>
            }
          />
        </div>
      </AppShell>
    );
  }

  const itemId = idParam.length > 0 ? idParam : canonicalIdFor(connectorId, externalRef);
  // R21-E: the Where-to-watch switch — `&mode=` names the realization to
  // prefer (validated against the frozen vocabulary; anything else is
  // ignored, never guessed).
  const rawMode = firstParam(params.mode);
  const preferredMode =
    rawMode === "embed" || rawMode === "browser" || rawMode === "external" || rawMode === "native"
      ? rawMode
      : undefined;
  const view = await loadPlayerView(host, {
    itemId,
    connectorId,
    externalRef,
    title,
    canonicalType,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(resumePositionMs !== undefined ? { resumePositionMs } : {}),
    ...(preferredMode !== undefined ? { preferredMode } : {}),
  });

  return (
    <AppShell mode={host.mode} session={host.session.state}>
      <PlayerSurface view={view} />
    </AppShell>
  );
}
