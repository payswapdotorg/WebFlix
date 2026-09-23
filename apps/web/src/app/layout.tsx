/**
 * @wfx/app-web — the root layout (WFX-050; WFX-051 restyle; WFX-057 PWA).
 *
 * Server component: the global document shell. The WFX-051 visual identity
 * lives in `globals.css` (custom properties + component classes, dark theme
 * with the WebFlix rose accent — no CSS framework, no runtime CSS-in-JS).
 * No client JS at this level; the persistent chrome (`AppShell`) renders
 * per-route so every surface can bind its active nav entry and main layout.
 *
 * WFX-057 (installable surfaces), extending — never replacing — the existing
 * metadata:
 *
 * - `manifest` → `/manifest.webmanifest` (name/icons/colors match this
 *   shell's design system exactly — see the manifest file header notes and
 *   tests/pwa-manifest.test.ts, which pins the colors to the globals.css
 *   custom properties).
 * - `icons.icon` → the hand-written SVG favicon (the same rose-gradient
 *   play-mark the shell's logo uses); `icons.apple` → the 1024×1024 PNG
 *   (iOS accepts a single square PNG for Add to Home Screen).
 * - `appleWebApp` → the iOS standalone wiring (`apple-mobile-web-app-capable`
 *   / `-status-bar-style` / `-title` meta tags Next generates from it).
 * - `viewport.themeColor` → the meta theme-color (Next 16 metadata
 *   convention — themeColor lives on the `viewport` export). `#0b0a10` is
 *   `--wfx-bg`, the solid equivalent of the shell topbar's
 *   `rgba(11, 10, 16, 0.92)` over the page background.
 * - the tiny before-interactive script stashes `beforeinstallprompt` the
 *   moment Chrome/Edge fire it (it can fire before hydration), so the
 *   `InstallPrompt` island can offer the REAL deferred prompt instead of
 *   missing it. It never fabricates an event.
 */

import type { Metadata, Viewport } from "next";
import type { JSX, ReactNode } from "react";
import Script from "next/script";

import "./globals.css";

export const metadata: Metadata = {
  title: "WebFlix",
  description: "WebFlix — Universal Entertainment OS, web host.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon-main.png", sizes: "1024x1024", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "WebFlix",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f0f0f",
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/*
         * R27-W2 — the theme seam's before-paint script: the persisted
         * choice (localStorage `wfx-theme`, "dark" | "light") is applied to
         * `data-theme` BEFORE the first paint (no flash); the server render
         * stays dark (the default product theme — the corpus law). The
         * `suppressHydrationWarning` on <html> covers the one-attribute
         * client-side divergence this honest seam produces.
         */}
        <Script id="wfx-theme-seam" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem("wfx-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}}catch(e){}`}
        </Script>
      </head>
      <body>
        {children}
        <Script id="wfx-install-prompt-capture" strategy="beforeInteractive">
          {`window.__wfxBip=null;addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__wfxBip=e;});`}
        </Script>
      </body>
    </html>
  );
}
