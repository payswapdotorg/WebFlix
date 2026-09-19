/**
 * @wfx/app-web — the Settings route (R07): honest capability truth.
 *
 * The settings destination over the ONE runtime: `?section=<sources|
 * model|general>` → the settings surface rendering the adapter's truthful
 * capability declaration (no torrent/native on Web, plainly named), the
 * honest source-management and model-controls states (R03/R06 lanes), and
 * the session state. R17: the sources section renders the runtime's
 * sources model (the fixtures' scripted authorization lifecycle in dev —
 * J28's surface; the honest not-wired state in service mode).
 *
 * R20-D: the sources section additionally renders the BYOF panel (the
 * Bring Your Own Feed flow: choose source → connect/import → preview →
 * confirm) through the honest byof host seam. The staged-preview step is
 * addressed by `?byof=preview&import=<id>` — an adapter render hint on
 * the existing settings surface (the runtime's `section` vocabulary is
 * untouched — no new navigation system, the frozen UX law). Server
 * component.
 */

import { AppShell } from "@/components/shell/AppShell";
import { SettingsSurface } from "@/components/settings/SettingsSurface";
import { getWebRuntimeHost } from "@/host/web-host";
import { loadByofPanelView } from "@/host/byof/byof-host";
import { syncNavigationToRoute } from "@/app/routing";
import type { SettingsSection } from "@wfx/client-runtime";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const host = await getWebRuntimeHost();
  const { state } = syncNavigationToRoute(host.runtime, "/settings", params);
  const section =
    state.surface === "settings" ? (state as { section?: SettingsSection }).section : undefined;
  // R17 — the sources section's data: the runtime's own sources read (the
  // fixtures' scripted authorization truth in dev; the honest transport
  // answer in service mode — never a fabricated list).
  const sources = section === "sources" ? await host.runtime.sources.refresh() : undefined;
  // R20-D — the BYOF panel view (the sources section's feed-import flow),
  // with the staged-preview address (`?byof=preview&import=<id>`) when the
  // flow's preview step is open. An adapter render hint: the runtime's
  // navigation state is untouched.
  const byofImportParam = params.import;
  const byofPreviewImportId =
    Array.isArray(byofImportParam) ? (byofImportParam[0] ?? "") : (byofImportParam ?? "");
  const byof =
    section === "sources"
      ? await loadByofPanelView(host.mode, byofPreviewImportId.length > 0 ? byofPreviewImportId : undefined)
      : undefined;
  return (
    <AppShell mode={host.mode} active="settings" session={host.session.state}>
      <SettingsSurface
        capabilities={host.capabilities}
        session={host.session.state}
        mode={host.mode}
        {...(section !== undefined ? { section } : {})}
        {...(sources !== undefined ? { sources } : {})}
        {...(byof !== undefined ? { byof } : {})}
      />
    </AppShell>
  );
}
