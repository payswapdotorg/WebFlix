/**
 * @wfx/app-web — the Library route (R07): watchlist + history.
 *
 * The library destination over the ONE runtime: `?section=<watchlist|
 * history>` (default both) → the runtime's library read model (canonical-
 * keyed saves with typed sync states + the watch-state fold) → the library
 * surface. Section statuses render verbatim: an error read is an error
 * state, never a fake empty list. Server component.
 *
 * R20-D: the Library is where an imported feed APPEARS (the J33 flow's
 * landing step — the frozen UX law keeps the entry in the existing
 * Library/Settings IA). The BYOF feed region renders above the watchlist,
 * driven by the honest byof host seam; `?byof=imported` is the post-confirm
 * landing's adapter render hint (the runtime's `section` vocabulary is
 * untouched — no new navigation system).
 */

import { AppShell } from "@/components/shell/AppShell";
import { LibrarySurface } from "@/components/library/LibrarySurface";
import { getWebRuntimeHost } from "@/host/web-host";
// R30-B — the account chrome view (the request's sign-in truth + the
// rail subscriptions + the notification truth).
import { loadAccountChrome } from "@/host/account-chrome";
import { loadByofFeedView, byofHostBinding } from "@/host/byof/byof-host";
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
  const [view, account] = await Promise.all([loadLibraryView(host), loadAccountChrome()]);
  // R20-D/R20-H — the imported feeds region (the "feed appears" step). The
  // post-confirm landing hint rides as an adapter param, never a
  // navigation-section change. Service mode binds the HTTP transport
  // through the host binding (the one-place seam).
  const byof = await loadByofFeedView(byofHostBinding(host));
  const byofParam = params.byof;
  const justImported =
    (Array.isArray(byofParam) ? (byofParam[0] ?? "") : (byofParam ?? "")) === "imported";
  return (
    <AppShell mode={host.mode} active="library" session={host.session.state} account={account}>
      <LibrarySurface
        view={view}
        byof={byof}
        session={host.session.state}
        {...(justImported ? { justImported } : {})}
      />
    </AppShell>
  );
}
