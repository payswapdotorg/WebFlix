/**
 * @wfx/app-web — R37 — the live route's loading surface (the same shape
 * as the loaded page, so the chrome never jumps — the R07 loading law).
 */

import { AppShell } from "@/components/shell/AppShell";
import { PageSkeleton } from "@/components/ui/StateViews";
import { getWebRuntimeHost } from "@/host/web-host";

export default async function Loading() {
  const host = await getWebRuntimeHost();
  return (
    <AppShell mode={host.mode} session={host.session.state}>
      <PageSkeleton />
    </AppShell>
  );
}
