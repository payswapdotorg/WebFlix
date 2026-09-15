/**
 * @wfx/app-web — the search route loading surface (WFX-051).
 */

import { AppShell } from "@/components/shell/AppShell";
import { PageSkeleton } from "@/components/ui/StateViews";
import { bootExperienceHost } from "@/host/experience";

export default function Loading() {
  const host = bootExperienceHost();
  return (
    <AppShell mode={host.mode} active="/search">
      <PageSkeleton />
    </AppShell>
  );
}
