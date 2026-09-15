/**
 * @wfx/app-web — the watch route loading surface (WFX-051).
 */

import { AppShell } from "@/components/shell/AppShell";
import { PageSkeleton } from "@/components/ui/StateViews";
import { bootExperienceHost } from "@/host/experience";

export default function Loading() {
  const host = bootExperienceHost();
  return (
    <AppShell mode={host.mode} active="/watch">
      <PageSkeleton />
    </AppShell>
  );
}
