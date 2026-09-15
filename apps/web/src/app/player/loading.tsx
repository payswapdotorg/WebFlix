/**
 * @wfx/app-web — the player route loading surface (WFX-051).
 *
 * The skeleton the player route streams while the playback session starts
 * (port resolve → device gate → session). Same law as every loading
 * segment: the page is force-dynamic, the skeleton renders per request.
 */

import { AppShell } from "@/components/shell/AppShell";
import { PageSkeleton } from "@/components/ui/StateViews";
import { bootExperienceHost } from "@/host/experience";

export default function Loading() {
  const host = bootExperienceHost();
  return (
    <AppShell mode={host.mode}>
      <PageSkeleton />
    </AppShell>
  );
}
