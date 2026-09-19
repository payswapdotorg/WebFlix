/**
 * @wfx/app-web — the Bring Your Feed route's loading skeleton.
 *
 * Mirrors the surface's final layout (the design language's skeleton law:
 * loading never visually jumps between unrelated structures): the page
 * title block, the mode-tab row, one summary row, and the record list's
 * first rows.
 */

import { SkeletonRow } from "@/components/ui/StateViews";

export default function BringYourFeedLoading(): React.ReactElement {
  return (
    <div data-wfx-surface="byof" data-wfx-byof-loading>
      <div className="wfx-skeleton-row__title" style={{ width: "40%", height: "2rem" }} />
      <div style={{ height: "1rem", width: "70%", marginBottom: "1rem" }} />
      <SkeletonRow cards={4} />
      <SkeletonRow cards={3} />
    </div>
  );
}
