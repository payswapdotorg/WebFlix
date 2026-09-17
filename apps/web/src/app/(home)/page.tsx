/**
 * @wfx/app-web — the home route (R07).
 *
 * A SERVER component over the ONE runtime: the host boot (the 050
 * environment law — fixtures/service/misconfigured-loud), the runtime's
 * navigation synced to this route (the deep-link law), the home view
 * (Continue Watching + seeded rows), and the React tree. Environment
 * variables never reach the client bundle; interactivity lives in the
 * small client islands the surfaces mount.
 */

import { AppShell } from "@/components/shell/AppShell";
import { HomeSurface } from "@/components/home/HomeSurface";
import { getWebRuntimeHost } from "@/host/web-host";
import { loadHomeView } from "@/host/view-models";
import { syncNavigationToRoute } from "@/app/routing";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const host = await getWebRuntimeHost();
  syncNavigationToRoute(host.runtime, "/", {});
  const view = await loadHomeView(host);
  return (
    <AppShell mode={host.mode} active="home" session={host.session.state}>
      <HomeSurface view={view} />
    </AppShell>
  );
}
