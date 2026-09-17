/**
 * @wfx/app-web — the Settings route (R07): honest capability truth.
 *
 * The settings destination over the ONE runtime: `?section=<sources|
 * model|general>` → the settings surface rendering the adapter's truthful
 * capability declaration (no torrent/native on Web, plainly named), the
 * honest source-management and model-controls absent states (R03/R06
 * lanes), and the session state. Server component.
 */

import { AppShell } from "@/components/shell/AppShell";
import { SettingsSurface } from "@/components/settings/SettingsSurface";
import { getWebRuntimeHost } from "@/host/web-host";
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
  return (
    <AppShell mode={host.mode} active="settings" session={host.session.state}>
      <SettingsSurface
        capabilities={host.capabilities}
        session={host.session.state}
        mode={host.mode}
        {...(section !== undefined ? { section } : {})}
      />
    </AppShell>
  );
}
