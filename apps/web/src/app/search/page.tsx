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
import { getWebRequestHost } from "@/host/request-session";
import { loadSearchView } from "@/host/view-models";
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
  const host = await getWebRequestHost();
  syncNavigationToRoute(host.runtime, "/search", params);
  const view = await loadSearchView(host, query);
  return (
    <AppShell mode={host.mode} active="search" session={host.session.state}>
      <SearchSurface view={view} />
    </AppShell>
  );
}
