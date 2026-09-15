/**
 * WFX-057 PWA manifest + layout wiring tests (bun:test).
 *
 * Pins the installability contract to the TRUTH:
 *
 * - the manifest is valid JSON with every required field (name, icons,
 *   start_url, scope, display) and an honest description;
 * - every declared icon size matches the ACTUAL PNG dimensions — parsed
 *   from the file's IHDR bytes right here (no PIL, no image library, no
 *   trusting the declaration);
 * - the manifest colors match the shell's design system EXACTLY: both are
 *   `--wfx-bg` from globals.css, and the topbar's translucent tint
 *   (rgba(11,10,16,0.92)) is proven to be the same base color — the solid
 *   equivalent theme_color stands for;
 * - the root layout (the REAL `metadata`/`viewport` exports Next builds
 *   with) wires manifest, theme-color, apple-touch-icon, and the iOS
 *   standalone meta set — and cannot drift from the manifest's colors;
 * - the favicon is the tiny hand-written SVG carrying the same mark
 *   (rose-gradient play triangle = --wfx-accent / --wfx-accent-strong).
 *
 * Deterministic: file reads + pure parsing. No network, no browser.
 */

import { describe, expect, it } from "bun:test";

import { metadata, viewport } from "../src/app/layout";

const manifestFile = Bun.file(new URL("../public/manifest.webmanifest", import.meta.url));
const manifest = (await manifestFile.json()) as {
  name: string;
  short_name: string;
  id?: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
};

const css = await Bun.file(new URL("../src/app/globals.css", import.meta.url)).text();

/** Parse one `--wfx-*: value;` custom property out of the stylesheet. */
function cssVariable(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (match === null || match[1] === undefined) throw new Error(`globals.css has no --${name}`);
  return match[1].trim();
}

/** Parse a PNG's IHDR chunk and return the TRUE pixel dimensions. */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index++) {
    if (bytes[index] !== signature[index]) throw new Error("not a PNG (bad signature)");
  }
  const chunkType = String.fromCharCode(...bytes.slice(12, 16));
  if (chunkType !== "IHDR") throw new Error(`first chunk is ${chunkType}, not IHDR`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("WFX-057 manifest: required fields + honest content", () => {
  it("is valid JSON with the installability-required fields", () => {
    expect(manifest.name).toBe("WebFlix");
    expect(manifest.short_name).toBe("WebFlix");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.id).toBe("/");
  });

  it("describes the product honestly (universal entertainment surface, no fake claims)", () => {
    expect(manifest.description).toContain("entertainment");
    expect(manifest.description).toContain("sources");
    // "free movies included!"-style lies must not appear.
    expect(manifest.description).not.toMatch(/free|unlimited/i);
  });
});

describe("WFX-057 manifest: icon truth (declared sizes == actual PNG IHDR dimensions)", () => {
  it("declares exactly the two provided icons with honest purposes", () => {
    expect(manifest.icons).toHaveLength(2);
    const purposes = manifest.icons.map((icon) => icon.purpose).sort();
    expect(purposes).toEqual(["any", "maskable"]);
    expect(manifest.icons.map((icon) => icon.src).sort()).toEqual([
      "/icon-main.png",
      "/icon-maskable.png",
    ]);
  });

  for (const icon of manifest.icons) {
    it(`${icon.src}: declared ${icon.sizes} matches the actual PNG dimensions`, async () => {
      expect(icon.type).toBe("image/png");
      const bytes = new Uint8Array(await Bun.file(new URL(`../public${icon.src}`, import.meta.url)).arrayBuffer());
      const { width, height } = pngDimensions(bytes);
      expect(icon.sizes).toBe(`${width}x${height}`);
      // No fabricated sizes: a 1024×1024 file must be declared 1024x1024.
      expect(width).toBe(1024);
      expect(height).toBe(1024);
    });
  }
});

describe("WFX-057 manifest: colors match the shell's design system", () => {
  it("background_color + theme_color are --wfx-bg from globals.css", () => {
    const bg = cssVariable("wfx-bg");
    expect(manifest.background_color).toBe(bg);
    expect(manifest.theme_color).toBe(bg);
    expect(bg).toBe("#0b0a10");
  });

  it("theme_color is the solid equivalent of the shell topbar's tint (same base color)", () => {
    // The topbar is rgba(11, 10, 16, 0.92) — the same rgb triple as
    // --wfx-bg (#0b0a10) with alpha. The manifest's solid theme_color
    // therefore stands for exactly what the chrome paints over.
    const hex = cssVariable("wfx-bg").replace("#", "");
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    expect(css).toMatch(new RegExp(`background:\\s*rgba\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*,`));
  });
});

/** The layout's `icons.icon` entries (narrowed from Next's metadata type). */
function iconLinks(key: "icon" | "apple"): Array<{ url: string; type?: string; sizes?: string }> {
  const icons = metadata.icons;
  if (icons === undefined || icons === null || typeof icons === "string") return [];
  if (Array.isArray(icons) || icons instanceof URL) return [];
  const entries = icons[key];
  if (entries === undefined || entries === null || typeof entries === "string") return [];
  if (!Array.isArray(entries)) return [];
  return entries as Array<{ url: string; type?: string; sizes?: string }>;
}

describe("WFX-057 root layout wiring (the real metadata Next builds with)", () => {
  it("links the manifest and the favicon", () => {
    expect(metadata.manifest).toBe("/manifest.webmanifest");
    const iconLinksForFavicon = iconLinks("icon");
    expect(iconLinksForFavicon[0]?.url).toBe("/favicon.svg");
    expect(iconLinksForFavicon[0]?.type).toBe("image/svg+xml");
  });

  it("declares the apple-touch-icon as the 1024×1024 main icon (iOS accepts PNG 1024)", () => {
    const apple = iconLinks("apple");
    expect(apple[0]?.url).toBe("/icon-main.png");
    expect(apple[0]?.sizes).toBe("1024x1024");
    expect(apple[0]?.type).toBe("image/png");
  });

  it("sets the iOS standalone meta set (capable / status bar / title)", () => {
    expect(metadata.appleWebApp).toEqual({
      capable: true,
      statusBarStyle: "black",
      title: "WebFlix",
    });
  });

  it("sets the theme-color meta to the manifest value (no drift between the two)", async () => {
    const themeColor = typeof viewport.themeColor === "string" ? viewport.themeColor : undefined;
    expect(themeColor).toBe(manifest.theme_color);
  });

  it("keeps the responsive viewport defaults while adding themeColor (no mobile regression)", () => {
    expect(viewport.width).toBe("device-width");
    expect(viewport.initialScale).toBe(1);
  });
});

describe("WFX-057 favicon: tiny, hand-written, same mark", () => {
  it("exists, is tiny, and carries the rose-gradient play mark", async () => {
    const favicon = await Bun.file(new URL("../public/favicon.svg", import.meta.url)).text();
    const size = favicon.length;
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(2000); // "keep it tiny and honest"
    // The mark = the shell's logo: rounded square, accent gradient, play triangle.
    expect(favicon).toContain(cssVariable("wfx-accent"));
    expect(favicon).toContain(cssVariable("wfx-accent-strong"));
    expect(favicon).toMatch(/<path[^>]*fill="#fff"/);
    expect(favicon).toMatch(/rx="14"/);
  });
});
