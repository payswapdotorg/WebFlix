/**
 * @wfx/app-web — the search route (WFX-051).
 *
 * The real search flow: `?q=<query>` → the Experience API search through the
 * runtime (both surfaces browsed, watch first) → the results grid. Server
 * component — the search BOX is the plain form in the shell top bar, so the
 * whole flow works without client JS. Typed states: empty query, no
 * matches, results (`SearchSurface`).
 */

import { AppShell } from "@/components/shell/AppShell";
import { SearchSurface } from "@/components/search/SearchSurface";
import { bootExperienceHost } from "@/host/experience";
import { loadSearchView } from "@/host/views";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.q;
  const query = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
  const host = bootExperienceHost();
  const view = await loadSearchView(host, query);
  return (
    <AppShell mode={host.mode} active="/search">
      <SearchSurface view={view} />
    </AppShell>
  );
}
