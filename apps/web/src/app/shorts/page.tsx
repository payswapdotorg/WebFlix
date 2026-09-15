/**
 * @wfx/app-web — the Short Feed route (WFX-051).
 *
 * The WFX-028 surface: the server composes the boot payload (the projected
 * OS short page + the session policy + identity through the 050 host law)
 * and the CLIENT island (`components/shorts/ShortsFeed`) builds the stack
 * through the SAME frozen presenter — one law, two runtimes. The main
 * region renders flush (the vertical feed owns the viewport).
 */

import { AppShell } from "@/components/shell/AppShell";
import { ShortsFeed } from "@/components/shorts/ShortsFeed";
import { bootExperienceHost } from "@/host/experience";
import { loadShortsPayload } from "@/host/shorts";

export const dynamic = "force-dynamic";

export default async function ShortsPage() {
  const host = bootExperienceHost();
  const payload = await loadShortsPayload(host);
  return (
    <AppShell mode={host.mode} active="/shorts" mainClass="wfx-main--flush">
      <ShortsFeed payload={payload} />
    </AppShell>
  );
}
