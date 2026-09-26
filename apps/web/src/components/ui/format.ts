/**
 * @wfx/app-web — deterministic display helpers for the experience shell
 * (WFX-051). Pure formatting only: no clocks, no randomness, no locale
 * drift (fixed `en-US`-neutral formatting by construction).
 */

/** Format a duration in milliseconds as `Hh Mm` / `Mm Ss` (deterministic). */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Deterministic `m:ss` / `h:mm:ss` position text (the watch-feed format). */
export function formatPosition(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value: number): string => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/**
 * Deterministic placeholder-art hue for one item id (char-code fold into
 * the hue wheel). Placeholder art ONLY — no provider branding, no fake
 * covers; the same id always paints the same hue.
 */
export function placeholderHue(id: string): number {
  let fold = 0;
  for (let index = 0; index < id.length; index += 1) {
    fold = (fold * 31 + id.charCodeAt(index)) % 360;
  }
  return fold;
}

/** The placeholder art CSS background for one item id (deterministic). */
export function placeholderArt(id: string): string {
  const hue = placeholderHue(id);
  return `linear-gradient(135deg, hsl(${hue} 42% 24%) 0%, hsl(${(hue + 46) % 360} 48% 11%) 100%)`;
}

/**
 * The first code POINT of a word (UTF-16-safe — an emoji-leading title
 * yields the whole emoji, never a lone surrogate).
 *
 * R26-W2 (corrective fix, real-catalog reproduction): `charAt(0)` answers
 * the first UTF-16 CODE UNIT, so a title leading with an astral character
 * (🌧️, 🔴, ⚡ — the real catalog carries many) produced a LONE SURROGATE,
 * which the server's HTML encodes as U+FFFD while the client's hydration
 * render kept the raw lone surrogate — a hydration mismatch that killed
 * the whole page on the REAL production catalog (the ASCII fixture
 * catalog never exercised it). Code-point extraction is deterministic and
 * byte-identical on server and client — the hydration law holds.
 */
export function firstCodePointOf(word: string): string {
  const first = word.codePointAt(0);
  return first === undefined ? "" : String.fromCodePoint(first);
}

/** The placeholder monogram of a title (first grapheme pair, uppercased). */
export function placeholderMonogram(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return "··";
  const words = trimmed.split(/\s+/).slice(0, 2);
  return words.map(firstCodePointOf).join("").toUpperCase();
}

/** Percent text for a completion ratio (`"45% watched"`); null when unknown. */
export function percentWatched(ratio: number | null): string | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  return `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}% watched`;
}

/** URL-query-encode one value (defensive wrapper, always defined). */
export function encodeParam(value: string): string {
  return encodeURIComponent(value);
}

/**
 * R30-B (CORPUS §8/§9) — the playlist header's "Last updated on" date:
 * the corpus format ("Last updated on Sep 16, 2026") from the playlist's
 * most recent save timestamp. Deterministic: the fixed month names (no
 * locale drift — the module's own law); an unparseable timestamp answers
 * null (the line renders only with a real date, never a fabricated one).
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Format one ISO timestamp as the corpus "MMM D, YYYY" (null when unparseable). */
export function formatPlaylistDate(iso: string): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  const month = MONTHS[date.getUTCMonth()];
  if (month === undefined) return null;
  return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}
