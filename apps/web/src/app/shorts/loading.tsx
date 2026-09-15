/**
 * @wfx/app-web — the shorts route loading surface (WFX-051).
 *
 * The skeleton the shorts route streams while the OS short page composes.
 * Same law as every loading segment: the page is force-dynamic, the
 * skeleton renders per request.
 */

import { AppShell } from "@/components/shell/AppShell";
import { PageSkeleton } from "@/components/ui/StateViews";
import { bootExperienceHost } from "@/host/experience";

export default function Loading() {
  const host = bootExperienceHost();
  return (
    <AppShell mode={host.mode} active="/shorts" mainClass="wfx-main--flush">
      <PageSkeleton />
    </AppShell>
  );
}
