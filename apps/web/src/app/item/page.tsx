/**
 * @wfx/app-web — the content detail route (WFX-051).
 *
 * `?connector=<id>&ref=<external ref>` → the connector's metadata through
 * the port (the single-item read of the transport contract) → the detail
 * surface (capabilities, actions, resume, related). When the source has no
 * metadata for the ref, the honest not-found state renders — never a card
 * fabricated from a bare reference.
 */

import { AppShell } from "@/components/shell/AppShell";
import { ItemDetailSurface } from "@/components/item/ItemDetailSurface";
import { EmptyState } from "@/components/ui/StateViews";
import { bootExperienceHost } from "@/host/experience";
import { loadDetailView } from "@/host/views";

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
  const connectorId = firstParam(params.connector);
  const externalRef = firstParam(params.ref);
  const host = bootExperienceHost();

  if (connectorId.length === 0 || externalRef.length === 0) {
    return (
      <AppShell mode={host.mode}>
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

  const view = await loadDetailView(host, connectorId, externalRef);
  if (view === null) {
    return (
      <AppShell mode={host.mode}>
        <div data-wfx-surface="item" data-wfx-item-state="not-found">
          <h1 className="wfx-page-title">Content</h1>
          <EmptyState
            title="No metadata for this reference"
            detail={`The source '${connectorId}' answered with no metadata for '${externalRef}'. WebFlix does not fabricate detail pages.`}
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
    <AppShell mode={host.mode}>
      <ItemDetailSurface view={view} />
    </AppShell>
  );
}
