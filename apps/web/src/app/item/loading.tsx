/**
 * @wfx/app-web — the item route loading surface (WFX-051).
 *
 * The skeleton the detail route streams while the connector metadata loads.
 * The boot is the SAME environment law every surface funnels through; the
 * segment is force-dynamic (its page boots per request), so this skeleton
 * renders per request too — never prerendered into a build artifact.
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
