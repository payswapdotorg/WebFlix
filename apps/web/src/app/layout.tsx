/**
 * @wfx/app-web — the root layout (WFX-050; WFX-051 restyle).
 *
 * Server component: the global document shell. The WFX-051 visual identity
 * lives in `globals.css` (custom properties + component classes, dark theme
 * with the WebFlix rose accent — no CSS framework, no runtime CSS-in-JS).
 * No client JS at this level; the persistent chrome (`AppShell`) renders
 * per-route so every surface can bind its active nav entry and main layout.
 */

import type { Metadata } from "next";
import type { JSX, ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "WebFlix",
  description: "WebFlix — Universal Entertainment OS, web host.",
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
