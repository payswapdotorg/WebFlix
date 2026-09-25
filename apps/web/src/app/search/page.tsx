/**
 * @wfx/app-web — the search route (R07).
 *
 * The real search flow over the ONE runtime: `?q=<query>` → the runtime's
 * search model (canonical-joined results, typed statuses). An empty query
 * renders the typed empty state WITHOUT asking the runtime (the state
 * machine's invalid-target law — an empty query is not a search). Server
 * component; the search BOX is the plain form in the shell top bar.
 */

import { AppShell } from "@/components/shell/AppShell";
import { SearchSurface } from "@/components/search/SearchSurface";
import { getWebRuntimeHost } from "@/host/web-host";
// R30-B — the account chrome view (the request's sign-in truth + the
// rail subscriptions + the notification truth).
import { loadAccountChrome } from "@/host/account-chrome";

import { loadSearchView, type SearchFilterSelection } from "@/host/view-models";
import { syncNavigationToRoute } from "@/app/routing";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.q;
  const query = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  // R29-B — the URL-driven filter selection (N23): only the honestly
  // wireable kinds (type/duration); anything else in the URL is ignored,
  // never guessed.
  const rawType = Array.isArray(params.type) ? params.type[0] : params.type;
  const rawDuration = Array.isArray(params.duration) ? params.duration[0] : params.duration;
  const filters: SearchFilterSelection = {
    ...(rawType === "video" || rawType === "short" ? { type: rawType } : {}),
    ...(rawDuration === "under-3" || rawDuration === "3-20" || rawDuration === "over-20"
      ? { duration: rawDuration }
      : {}),
  };
  const host = await getWebRuntimeHost();
  syncNavigationToRoute(host.runtime, "/search", params);
  const [view, account] = await Promise.all([loadSearchView(host, query, filters), loadAccountChrome()]);
  return (
    <AppShell mode={host.mode} active="search" session={host.session.state} account={account}>
      <SearchSurface view={view} />
    </AppShell>
  );
}
