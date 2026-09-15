/**
 * @wfx/app-web — the root layout (WFX-050).
 *
 * Server component: global document shell. No CSS imports (the minimal
 * home surface styles are inline in `HomeSurface`), no client JS.
 */

import type { Metadata } from "next";
import type { JSX, ReactNode } from "react";

export const metadata: Metadata = {
  title: "WebFlix",
  description: "WebFlix — Universal Entertainment OS, web host.",
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#0c0a09",
          color: "#e7e5e4",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
