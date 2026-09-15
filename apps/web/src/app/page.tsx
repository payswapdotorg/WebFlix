/**
 * @wfx/app-web — the home route (WFX-050).
 *
 * A SERVER component (React Server Components): the host boot, the feed
 * call, and the projection all run on the server — no client JS ships for
 * this surface. That is the right call for the minimal home: the boot law
 * reads server-side environment variables (`WFX_API_BASE`,
 * `WFX_DEV_FIXTURES`) that must NEVER reach the browser bundle, and a
 * content list needs no interactivity. (Interactive surfaces — player
 * controls, the short-feed stack — are WFX-051's lane and will add client
 * components where the interaction lives.)
 *
 * `force-dynamic`: the home content depends on the ENVIRONMENT and the
 * configured service's answer at request time — a static prerender would
 * either bake dev fixtures into a build artifact or fail the build in
 * environments without `WFX_API_BASE`. Every request boots through the
 * host law: fixtures ONLY behind `WFX_DEV_FIXTURES=1` (dev), the real
 * service ports against `WFX_API_BASE` otherwise, and a misconfigured
 * environment throws the typed `HostConfigError` → HTTP 500 with the
 * offending variables named in the server log (loud, never silent).
 */

import { HomeSurface } from "@/components/HomeSurface";
import { bootWebHost, loadHomeView } from "@/host";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const host = bootWebHost();
  const view = await loadHomeView(host);
  return <HomeSurface view={view} />;
}
