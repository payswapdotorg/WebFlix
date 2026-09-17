/**
 * @wfx/app-web — a route loading surface (R07).
 *
 * The skeleton the route streams while its data loads: the persistent
 * shell (the shared boot — the same cached host promise the page awaits)
 * plus the page skeleton. Same shape as the loaded page, so the chrome
 * never jumps. Async server component: it awaits the ONE runtime boot.
 */

import { AppShell } from "@/components/shell/AppShell";
import { PageSkeleton } from "@/components/ui/StateViews";
import { getWebRuntimeHost } from "@/host/web-host";

export default async function Loading() {
  const host = await getWebRuntimeHost();
  return (
    <AppShell mode={host.mode} session={host.session.state} active="library">
      <PageSkeleton />
    </AppShell>
  );
}
