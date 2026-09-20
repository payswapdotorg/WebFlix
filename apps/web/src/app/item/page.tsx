/**
 * @wfx/app-web — the content detail route (R07).
 *
 * `?id=<canonical id>&connector=<id>&ref=<ref>` (deep links without an id
 * are joined through the per-process canonical seam) → the adapter's
 * transport metadata read + the runtime's watch state → the detail surface.
 * The typed states are honest: missing params render the honest missing
 * state; a metadata 404 answers `null` (the honest not-found — no card is
 * fabricated from a bare reference); a transport failure renders the typed
 * error state with the failure detail.
 */

import { AppShell } from "@/components/shell/AppShell";
import { ItemDetailSurface } from "@/components/item/ItemDetailSurface";
import { EmptyState, ErrorState } from "@/components/ui/StateViews";
import { getWebRequestHost } from "@/host/request-session";
import { canonicalIdFor } from "@/host/web-host";
import { DetailLoadError, loadDetailView } from "@/host/view-models";
import { syncNavigationToRoute } from "@/app/routing";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function ItemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const host = await getWebRequestHost();
  const { invalidReason } = syncNavigationToRoute(host.runtime, "/item", params);
  const connectorId = firstParam(params.connector);
  const externalRef = firstParam(params.ref);

  if (invalidReason !== null) {
    return (
      <AppShell mode={host.mode} session={host.session.state}>
        <div data-wfx-surface="item" data-wfx-item-state="invalid">
          <h1 className="wfx-page-title">Content</h1>
          <ErrorState
            title="This link does not name content"
            detail={`${invalidReason}. Open content from home, watch, or search.`}
            retry={
              <a className="wfx-btn" href="/">
                Go home
              </a>
            }
          />
        </div>
      </AppShell>
    );
  }

  if (connectorId.length === 0 || externalRef.length === 0) {
    return (
      <AppShell mode={host.mode} session={host.session.state}>
        <div data-wfx-surface="item" data-wfx-item-state="missing-params">
          <h1 className="wfx-page-title">Content</h1>
          <EmptyState
            title="Nothing to show"
            detail="This link does not name a source reference. Open content from home, watch, or search."
            action={
              <a className="wfx-btn" href="/">
                Go home
              </a>
            }
          />
        </div>
      </AppShell>
    );
  }

  // The navigation state's canonical id (validated by the sync); deep links
  // without one were joined through the per-process seam inside the sync.
  const itemId = host.runtime.navigation.current().surface === "item"
    ? (host.runtime.navigation.current() as { itemId: string }).itemId
    : canonicalIdFor(connectorId, externalRef);

  try {
    const view = await loadDetailView(host, { connectorId, externalRef, itemId });
    if (view === null) {
      return (
        <AppShell mode={host.mode} session={host.session.state}>
          <div data-wfx-surface="item" data-wfx-item-state="not-found">
            <h1 className="wfx-page-title">Content</h1>
            <EmptyState
              title="No metadata for this reference"
              detail={`The source answered with no metadata for '${externalRef}'. WebFlix does not fabricate detail pages.`}
              action={
                <a className="wfx-btn" href="/search">
                  Try search
                </a>
              }
            />
          </div>
        </AppShell>
      );
    }
    return (
      <AppShell mode={host.mode} session={host.session.state}>
        <ItemDetailSurface view={view} />
      </AppShell>
    );
  } catch (thrown) {
    const failure = thrown instanceof DetailLoadError ? thrown : null;
    return (
      <AppShell mode={host.mode} session={host.session.state}>
        <div data-wfx-surface="item" data-wfx-item-state="error">
          <h1 className="wfx-page-title">Content</h1>
          <ErrorState
            title="The details could not load"
            detail={
              failure !== null
                ? `${failure.kind}: ${failure.message}`
                : thrown instanceof Error
                  ? thrown.message
                  : String(thrown)
            }
            retry={
              <a className="wfx-btn" href={`/item?id=${encodeURIComponent(itemId)}&connector=${encodeURIComponent(connectorId)}&ref=${encodeURIComponent(externalRef)}`}>
                Retry
              </a>
            }
          />
        </div>
      </AppShell>
    );
  }
}
