/**
 * @wfx/app-web — R38-B — THE STUDIO STORE'S STORAGE SEAM.
 *
 * THE SEAM LAW (the task packet's own words): the studio truth store's
 * persistence follows "the existing subscription-list/reactions seam law:
 * reload-durable, the R30 law". For WebFlix's own creator/social truth —
 * the class the comments store (`wfx-comments-v1`), the reactions store
 * (`wfx-reactions-v1`), and the bell record (`wfx-channel-bells-v1`)
 * established — the honest transport is the BROWSER'S OWN localStorage:
 * reload-durable per device, defensively read, best-effort written, and
 * honestly labeled on every surface ("stored locally on this device").
 * No server-side studio service exists at this base (apps/api carries no
 * studio routes); a second, fabricated "synced" claim is forbidden (the
 * R28 law).
 *
 * The storage seam is INJECTABLE (the fake-web.ts law): production binds
 * `window.localStorage`; the colocated lane tests inject an in-memory
 * double — the store logic itself stays pure and deterministic.
 */

/** The minimal storage surface the studio stores consume (localStorage's own shape). */
export interface StudioStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** An in-memory storage double (tests + SSR-safe defaults). */
export function createInMemoryStudioStorage(): StudioStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** The browser's own localStorage when reachable, else null (SSR / private mode). */
function browserStorage(): StudioStorage | null {
  if (typeof window === "undefined") return null;
  try {
    const probeKey = "__wfx_studio_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The default storage binding: the browser's own localStorage. The
 * returned record is read FRESH per call (never a cached handle — the
 * tab's storage can become unavailable mid-session; each read/write
 * degrades honestly).
 */
export function defaultStudioStorage(): StudioStorage | null {
  return browserStorage();
}

/** Read + parse a JSON record defensively (absent/corrupt ⇒ null — never a throw). */
export function readStudioRecord<T>(storage: StudioStorage | null, key: string): T | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Serialize + write a JSON record best-effort (a failed write stays view-local). */
export function writeStudioRecord(storage: StudioStorage | null, key: string, value: unknown): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Private mode / quota: the in-view state stands (the reactions law).
    return false;
  }
}
