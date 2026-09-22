/**
 * @wfx/app-web — inline SVG icon set (WFX-051).
 *
 * Minimal hand-rolled 24px stroke icons (no icon dependency — the closure
 * stays react/next only). Every icon is `aria-hidden` decoration: the
 * controls that carry them provide their own accessible names.
 */

import type { JSX } from "react";

export type IconName =
  | "home"
  | "search"
  | "shorts"
  | "film"
  | "library"
  | "settings"
  | "like"
  | "save"
  | "share"
  | "play"
  | "external"
  | "browser"
  | "arrowUp"
  | "arrowDown"
  | "check"
  | "skip"
  | "sparkle"
  | "pause"
  | "volume"
  | "mute"
  | "fullscreen"
  | "fullscreenExit"
  | "miniplayer"
  | "captions"
  | "translate"
  | "link";

const PATHS: Readonly<Record<IconName, JSX.Element>> = {
  home: (
    <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-8.5Z" />
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  shorts: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="3" />
      <path d="m10.5 9.5 4.5 2.5-4.5 2.5v-5Z" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 4v16M16 4v16M3 12h18M3 8h5M16 8h5M3 16h5M16 16h5" />
    </>
  ),
  library: (
    <>
      <path d="M4 5h4v14H4zM10 5h4v14h-4z" />
      <path d="m16.6 5.6 3.7 13.1" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2.5 12h3M18.5 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  like: (
    <path d="M7 10.5V20H4.5A1.5 1.5 0 0 1 3 18.5V12a1.5 1.5 0 0 1 1.5-1.5H7Zm0 0 3.6-6.7c.3-.6 1.1-.8 1.6-.4.4.3.6.8.5 1.3L12.2 9h5.3c1.2 0 2.1 1.1 1.8 2.3l-1.8 7A1.9 1.9 0 0 1 15.7 20H7" />
  ),
  save: (
    <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1Z" />
  ),
  share: (
    <>
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="M12 15V3m0 0-4 4m4-4 4 4" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />,
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M19 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5.5" />
    </>
  ),
  browser: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01" />
    </>
  ),
  arrowUp: <path d="M12 20V4m0 0-6 6m6-6 6 6" />,
  arrowDown: <path d="M12 4v16m0 0 6-6m-6 6-6-6" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  skip: <path d="M6 5v14m2 0 10.5-7L8 5v14Z" />,
  sparkle: (
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
  ),
  pause: (
    <>
      <path d="M8 5v14" />
      <path d="M16 5v14" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" />
      <path d="m16 9.5 5 5m0-5-5 5" />
    </>
  ),
  fullscreen: (
    <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
  ),
  fullscreenExit: (
    <path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M9 20v-4a1 1 0 0 0-1-1H4M15 20v-4a1 1 0 0 1 1-1h4" />
  ),
  miniplayer: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="12" width="7" height="5" rx="1" />
    </>
  ),
  captions: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 11.5h3.5M14.5 11.5H17M7 14.5h4M14 14.5h3" />
    </>
  ),
  link: (
    <>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M8 11l-2.8 2.8a3.8 3.8 0 0 0 5.4 5.4L13.5 16.2" />
      <path d="M16 13l2.8-2.8a3.8 3.8 0 0 0-5.4-5.4L10.5 7.8" />
    </>
  ),
  translate: (
    <>
      <path d="M3 5h12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-4 3v-3H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      <path d="M14 14.5h.01M12 18h6M15 13.5l1.8 4.5 1.7-4.5" />
    </>
  ),
};

/** One decorative 24px icon (stroke, currentColor). */
export function Icon({ name, size = 24 }: { readonly name: IconName; readonly size?: number }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
    >
      {PATHS[name]}
    </svg>
  );
}
