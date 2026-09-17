/**
 * @wfx/app-web — the Library route (R07): watchlist + history.
 *
 * The library destination over the ONE runtime: `?section=<watchlist|
 * history>` (default both) → the runtime's library read model (canonical-
 * keyed saves with typed sync states + the watch-state fold) → the library
 * surface. Section statuses render verbatim: an error read is an error
 * state, never a fake empty list. Server component.
 */

import { AppShell } from "@/components/shell/AppShell";
import { LibrarySurface } from "@/components/library/LibrarySurface";
import { getWebRuntimeHost } from "@/host/web-host";
import { loadLibraryView } from "@/host/view-models";
import { syncNavigationToRoute } from "@/app/routing";

export const dynamic = "force-dynamic";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const host = await getWebRuntimeHost();
  syncNavigationToRoute(host.runtime, "/library", params);
  const view = await loadLibraryView(host);
  return (
    <AppShell mode={host.mode} active="library" session={host.session.state}>
      <LibrarySurface view={view} />
    </AppShell>
  );
}
