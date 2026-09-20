/**
 * R07 session-module tests (bun:test) — the anonymous-mode SEAM.
 *
 * Proves the session honesty laws:
 * - the anonymous identity (`x-wfx-user-id: wfx-anonymous`) lives in ONE
 *   module (the R02 swap seam — no consumer touches the constant);
 * - the session id is STABLE within the storage window (the kv seam) and
 *   per-boot minted without one;
 * - a storage failure falls back to a MINTED id with the honest
 *   process-lifetime durability (never a fabricated "stable" one);
 * - the locale law: WFX_LOCALE override → navigator language → "en";
 * - the session state is the honest signed-out state (R07 truthfully has
 *   no signed-in profile).
 *
 * Deterministic: a sequential id seam, fake storage, no network.
 */

import { describe, expect, it } from "bun:test";

import { ANONYMOUS_USER_ID, resolveWebSession } from "../src/host/session";
import { makeBrowserEnvironment, makeServerEnvironment } from "./fake-web";

function sequentialIds() {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      return String(counter).padStart(26, "0");
    },
  };
}

function memoryKv(
  overrides: { readonly failWrites?: boolean } = {},
): { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> } {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      if (overrides.failWrites === true) throw new Error("quota full");
      map.set(key, value);
    },
  };
}

describe("R07 web session — the anonymous-mode seam", () => {
  it("the anonymous identity is the module's ONE constant (the R02 swap point)", async () => {
    const session = await resolveWebSession({ ids: sequentialIds() });
    expect(session.context.userId).toBe(ANONYMOUS_USER_ID);
    expect(session.context.userId).toBe("wfx-anonymous");
  });

  it("the session state is the honest signed-out state — never a fake profile", async () => {
    const session = await resolveWebSession({ ids: sequentialIds() });
    expect(session.state.signedIn).toBe(false);
    expect(session.state.label).toBe("Signed out");
    expect(session.state.description).toContain("anonymous session");
    // R21-B stale-copy law: a COMPLETED lane never renders "arrives later"
    // copy — the anonymous state names the real path (signing in), and
    // the stale "identity lane (R02)" wording is gone for good.
    expect(session.state.description).not.toMatch(/arrive|R02|later/i);
    expect(session.state.description).toContain("Sign in");
  });

  it("R21-B — an authenticated identity binds the account + active profile (the real session path)", async () => {
    const session = await resolveWebSession({
      ids: sequentialIds(),
      identity: {
        user: { id: "wfxuser_1", displayName: "Ada", email: "ada@example.com" },
        profiles: [
          { id: "wfxprof_main", displayName: "Main" },
          { id: "wfxprof_kids", displayName: "Kids" },
        ],
        activeProfileId: "wfxprof_kids",
      },
    });
    expect(session.state.signedIn).toBe(true);
    expect(session.context.userId).toBe("wfxuser_1");
    expect(session.context.profileId).toBe("wfxprof_kids");
    expect(session.state.label).toBe("Kids");
    expect(session.state.description).toContain("Signed in as Ada");
    expect(session.state.profile?.profiles).toHaveLength(2);
    expect(session.state.profile?.activeProfileName).toBe("Kids");
  });

  it("R21-B — no identity supplied answers the honest anonymous binding (profileId absent)", async () => {
    const session = await resolveWebSession({ ids: sequentialIds() });
    expect(session.context.userId).toBe(ANONYMOUS_USER_ID);
    expect(session.context.profileId).toBeUndefined();
    expect(session.state.profile).toBeUndefined();
  });

  it("the session id is STABLE within the storage window (the kv seam)", async () => {
    const ids = sequentialIds();
    const kv = memoryKv();
    const first = await resolveWebSession({ ids, kv, kvDurability: "browser-sessions" });
    const second = await resolveWebSession({ ids, kv, kvDurability: "browser-sessions" });
    expect(first.context.sessionId).toBe(second.context.sessionId);
    expect(first.state.sessionDurability).toBe("browser-sessions");
  });

  it("without storage the session id is per-boot minted (process-lifetime honesty)", async () => {
    const ids = sequentialIds();
    const first = await resolveWebSession({ ids });
    const second = await resolveWebSession({ ids });
    expect(first.context.sessionId).not.toBe(second.context.sessionId);
    expect(first.state.sessionDurability).toBe("process-lifetime");
  });

  it("a storage failure falls back to a MINTED id — never a fabricated stable one", async () => {
    const ids = sequentialIds();
    const session = await resolveWebSession({
      ids,
      kv: memoryKv({ failWrites: true }),
      kvDurability: "browser-sessions",
    });
    // The honest fallback: a minted sequential id (never a fabricated
    // "stable" one), with the process-lifetime durability and the note.
    expect(session.context.sessionId).toMatch(/^0{24}0[12]$/);
    expect(session.state.sessionDurability).toBe("process-lifetime");
    expect(session.state.description).toContain("unavailable"); // the honest note
  });

  it("the locale law: env override beats navigator language beats the default", async () => {
    const overridden = await resolveWebSession({
      ids: sequentialIds(),
      env: { WFX_LOCALE: "de" },
      environment: makeBrowserEnvironment({}),
    });
    expect(overridden.context.locale).toBe("de");

    const navigated = await resolveWebSession({
      ids: sequentialIds(),
      environment: makeBrowserEnvironment({}), // navigator.language = "en-US"
    });
    expect(navigated.context.locale).toBe("en");

    const defaulted = await resolveWebSession({
      ids: sequentialIds(),
      environment: makeServerEnvironment(),
    });
    expect(defaulted.context.locale).toBe("en");
  });
});
