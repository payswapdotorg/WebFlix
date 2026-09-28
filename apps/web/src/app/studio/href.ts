/**
 * @wfx/app-web — R38-B — THE STUDIO HREF BUILDERS (pure, zero host
 * imports — the @/app/href law verbatim: the URL grammar is pure and
 * importable from CLIENT components; the state-derivation stays in the
 * host seam).
 *
 * The studio routes (all presentation routes under `/studio` — the
 * /player + /channel law: the runtime's frozen `SurfaceId` set is
 * untouched, and the studio pages never call `syncNavigationToRoute`,
 * which is the exact semantic the presentation-route class gives the
 * channel route — the runtime's navigation keeps the state the user
 * came from, achieved without editing the frozen routing adapter).
 *
 * | Route | Parameters |
 * |---|---|
 * | `/studio` | `?channel=<handle>` (the managed channel; default = the catalog's first source) |
 * | `/studio/video` | the `ItemRouteTarget` grammar (`id`/`connector`/`ref`/`title`/`type`) + `channel?` |
 * | `/studio/comments` | `?channel=<handle>` + `?id=<canonical item id>` (the selected video) |
 * | `/studio/analytics` | `?channel=<handle>` + `?id=<canonical item id>` (the focused video) |
 * | `/studio/customization` | `?channel=<handle>` |
 */

/** The item identity the studio's per-video routes carry (the /player grammar). */
export interface StudioVideoTarget {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly durationMs?: number;
}

/** The studio sections (the tab bar's own vocabulary). */
export type StudioSection = "content" | "analytics" | "comments" | "customization";

export const STUDIO_SECTIONS: readonly StudioSection[] = [
  "content",
  "analytics",
  "comments",
  "customization",
];

/** The studio section's label (the tab bar's own names). */
export function studioSectionLabel(section: StudioSection): string {
  switch (section) {
    case "content":
      return "Content";
    case "analytics":
      return "Analytics";
    case "comments":
      return "Comments";
    case "customization":
      return "Customization";
  }
}

/** The studio section's route (parameterized by the managed channel). */
export function studioSectionHref(
  section: StudioSection,
  params: { readonly channel?: string } = {},
): string {
  const search = new URLSearchParams();
  if (params.channel !== undefined && params.channel.length > 0) {
    search.set("channel", params.channel);
  }
  const query = search.toString();
  const base = section === "content" ? "/studio" : `/studio/${section}`;
  return query.length > 0 ? `${base}?${query}` : base;
}

/** The details editor's href for one video (the ItemRouteTarget grammar + the channel). */
export function studioVideoHref(
  target: StudioVideoTarget,
  params: { readonly channel?: string } = {},
): string {
  const search = new URLSearchParams({
    id: target.itemId,
    connector: target.connectorId,
    ref: target.externalRef,
    title: target.title,
    type: target.canonicalType,
  });
  if (target.durationMs !== undefined) search.set("duration", String(target.durationMs));
  if (params.channel !== undefined && params.channel.length > 0) {
    search.set("channel", params.channel);
  }
  return `/studio/video?${search.toString()}`;
}

/** The comments management's href (optionally with the selected video). */
export function studioCommentsHref(
  params: { readonly channel?: string; readonly itemId?: string } = {},
): string {
  const search = new URLSearchParams();
  if (params.channel !== undefined && params.channel.length > 0) {
    search.set("channel", params.channel);
  }
  if (params.itemId !== undefined && params.itemId.length > 0) {
    search.set("id", params.itemId);
  }
  const query = search.toString();
  return query.length > 0 ? `/studio/comments?${query}` : "/studio/comments";
}

/** The analytics' href (optionally with the focused video). */
export function studioAnalyticsHref(
  params: { readonly channel?: string; readonly itemId?: string } = {},
): string {
  const search = new URLSearchParams();
  if (params.channel !== undefined && params.channel.length > 0) {
    search.set("channel", params.channel);
  }
  if (params.itemId !== undefined && params.itemId.length > 0) {
    search.set("id", params.itemId);
  }
  const query = search.toString();
  return query.length > 0 ? `/studio/analytics?${query}` : "/studio/analytics";
}

/** The customization's href. */
export function studioCustomizationHref(params: { readonly channel?: string } = {}): string {
  return studioSectionHref("customization", params);
}
