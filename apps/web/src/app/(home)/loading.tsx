/**
 * @wfx/app-web — the home route loading surface (WFX-051).
 *
 * The skeleton the home route streams while its feeds load: the persistent
 * shell (its own cheap env-only boot — no data fetches) plus the page
 * skeleton. Same shape as the loaded page, so the chrome never jumps.
 */

import { AppShell } from "@/components/shell/AppShell";
import { PageSkeleton } from "@/components/ui/StateViews";
import { bootExperienceHost } from "@/host/experience";

export default function Loading() {
  const host = bootExperienceHost();
  return (
    <AppShell mode={host.mode} active="/">
      <PageSkeleton />
    </AppShell>
  );
}
