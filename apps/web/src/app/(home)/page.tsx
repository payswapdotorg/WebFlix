/**
 * @wfx/app-web — the home route (WFX-050; the WFX-051 experience shell).
 *
 * A SERVER component: the experience host boot (the 050 environment law,
 * unchanged — `WFX_DEV_FIXTURES=1` dev-only fixtures, otherwise the
 * `WFX_API_BASE` remote ports, otherwise the typed `HostConfigError`), the
 * view pipelines (feeds, recorded watch state, identity join), and the React
 * tree all run on the server — environment variables never reach the client
 * bundle. Interactivity lives in the small client islands the surfaces mount
 * (like/save controls, watch-state reports, the short-feed stack).
 *
 * `force-dynamic`: content depends on the environment and the configured
 * service's answer at request time — a static prerender would either bake
 * dev fixtures into a build artifact or fail the build in environments
 * without `WFX_API_BASE` (same law as WFX-050).
 */

import { AppShell } from "@/components/shell/AppShell";
import { HomeSurface } from "@/components/home/HomeSurface";
import { bootExperienceHost } from "@/host/experience";
import { loadHomeView } from "@/host/views";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const host = bootExperienceHost();
  const view = await loadHomeView(host);
  return (
    <AppShell mode={host.mode} active="/">
      <HomeSurface view={view} />
    </AppShell>
  );
}
