/**
 * @wfx/app-web — typed state surfaces (WFX-051): loading skeletons, empty
 * states, and error states with actionable messages. Server components —
 * the loading variants back the route `loading.tsx` files.
 */

import type { JSX } from "react";

import { Icon } from "@/components/shell/Icon";

/** One shimmering skeleton row (the loading surface for a content row). */
export function SkeletonRow({ cards = 4 }: { readonly cards?: number }): JSX.Element {
  return (
    <div className="wfx-skeleton-row" aria-hidden="true" data-wfx-skeleton>
      <div className="wfx-skeleton-row__title" />
      <div className="wfx-skeleton-row__cards">
        {Array.from({ length: cards }, (_, index) => (
          <div key={index}>
            <div className="wfx-skeleton-card__thumb" />
            <div className="wfx-skeleton-card__line wfx-skeleton-card__line--wide" />
            <div className="wfx-skeleton-card__line wfx-skeleton-card__line--narrow" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The full-page loading skeleton (hero + rows). */
export function PageSkeleton(): JSX.Element {
  return (
    <div data-wfx-loading>
      <SkeletonRow cards={1} />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  );
}

/** One typed empty state (icon + title + honest detail). */
export function EmptyState({
  title,
  detail,
  action,
}: {
  readonly title: string;
  readonly detail: string;
  readonly action?: JSX.Element;
}): JSX.Element {
  return (
    <div className="wfx-state" data-wfx-empty>
      <span className="wfx-state__icon">
        <Icon name="sparkle" />
      </span>
      <p className="wfx-state__title">{title}</p>
      <p className="wfx-state__detail">{detail}</p>
      {action}
    </div>
  );
}

/** One typed error state (actionable message, retry affordance). */
export function ErrorState({
  title,
  detail,
  retry,
}: {
  readonly title: string;
  readonly detail: string;
  readonly retry?: JSX.Element;
}): JSX.Element {
  return (
    <div className="wfx-state wfx-state--error" data-wfx-error role="alert">
      <span className="wfx-state__icon">
        <Icon name="skip" />
      </span>
      <p className="wfx-state__title">{title}</p>
      <p className="wfx-state__detail">{detail}</p>
      {retry}
    </div>
  );
}
