/**
 * R07 web-host composition tests (bun:test).
 *
 * Proves the composition root's laws:
 * - the 050 BOOT LAW: `WFX_DEV_FIXTURES=1` (dev only) boots the
 *   fixture-backed ServerPort; `WFX_API_BASE` boots the REAL ServerPort;
 *   neither throws the typed `HostConfigError` naming the variables —
 *   never a silent fixture fallback (and the dev flag in production is a
 *   typed crime);
 * - the ONE-RUNTIME law: `getWebRuntimeHost` caches the boot (concurrent
 *   callers share one instance);
 * - the runtime boots on the truthful bundle (the runtime's truth check);
 * - the session seam binds the anonymous context to BOTH the runtime and
 *   the transport (the headers the ServerPort stamps);
 * - the canonical join mints valid `wfxitm_` ids, stably per process.
 *
 * Deterministic: controlled env (restored), no network (the service-mode
 * boots construct the port but never call it).
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { HostConfigError } from "../src/host/config";
import { bootWebRuntimeHost, canonicalIdFor, getWebRuntimeHost } from "../src/host/web-host";
import { resetWebHostProcessState } from "../src/host/testing";
import { withEnv, withFetchStub } from "./fake-web";

beforeEach(() => {
  resetWebHostProcessState();
});

describe("R07 web host — the boot law (the 050 law, unchanged)", () => {
  it("WFX_DEV_FIXTURES=1 (dev only) boots the fixture-backed transport", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = await bootWebRuntimeHost();
      expect(host.mode).toBe("fixtures");
      expect(host.serverPort.serviceId).toBe("wfx-dev-fixture-service");
      expect(host.runtime.platform).toBe("web");
    });
  });

  it("WFX_API_BASE boots the REAL ServerPort transport", async () => {
    await withEnv({ WFX_API_BASE: "https://experience.example" }, async () => {
      const host = await bootWebRuntimeHost();
      expect(host.mode).toBe("service");
      expect(host.serverPort.serviceId).toBe("wfx-experience-service");
    });
  });

  it("a misconfigured environment throws the typed HostConfigError naming the variable", async () => {
    await withEnv({}, async () => {
      let thrown: unknown = null;
      try {
        await bootWebRuntimeHost();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HostConfigError);
      expect((thrown as HostConfigError).missing).toContain("WFX_API_BASE");
    });
  });

  it("the dev fixture flag in production is a typed configuration crime", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1", NODE_ENV: "production" }, async () => {
      let thrown: unknown = null;
      try {
        await bootWebRuntimeHost();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HostConfigError);
      expect((thrown as HostConfigError).invalid).toContain("WFX_DEV_FIXTURES");
    });
  });

  it("a malformed WFX_API_BASE is a typed error naming the variable", async () => {
    await withEnv({ WFX_API_BASE: "not a url" }, async () => {
      let thrown: unknown = null;
      try {
        await bootWebRuntimeHost();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HostConfigError);
      expect((thrown as HostConfigError).invalid).toContain("WFX_API_BASE");
    });
  });
});

describe("R07 web host — the ONE runtime law", () => {
  it("getWebRuntimeHost caches the boot: concurrent callers share ONE instance", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const [first, second, third] = await Promise.all([
        getWebRuntimeHost(),
        getWebRuntimeHost(),
        getWebRuntimeHost(),
      ]);
      expect(first).toBe(second);
      expect(second).toBe(third);
      // And the runtime instance is the same object throughout.
      expect(first.runtime).toBe(second.runtime);
    });
  });

  it("the runtime boots on the truthful bundle and serves runtime state", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = await getWebRuntimeHost();
      expect(host.runtime.platform).toBe("web");
      expect(host.capabilities.nativeMedia).toBe("none");
      expect(host.capabilities.backgroundWork).toBe("none");
      // The runtime's navigation state machine is live (the runtime owns it).
      expect(host.runtime.navigation.current()).toEqual({ surface: "home" });
    });
  });

  it("the session seam binds the anonymous context to the runtime AND the transport", async () => {
    await withEnv({ WFX_DEV_FIXTURES: "1" }, async () => {
      const host = await getWebRuntimeHost();
      expect(host.session.context.userId).toBe("wfx-anonymous");
      // The REAL transport stamps the same identity as headers — proven
      // through a service boot with the fetch stub (deterministic).
    });
    await withEnv({ WFX_API_BASE: "https://experience.example" }, async () => {
      const { calls } = await withFetchStub(
        () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
        async () => {
          const host = await bootWebRuntimeHost();
          const outcome = await host.serverPort.search("anything");
          expect(outcome.ok).toBe(true);
        },
      );
      expect(calls.length).toBe(1);
      expect(calls[0]!.headers["x-wfx-user-id"]).toBe("wfx-anonymous");
      expect(typeof calls[0]!.headers["x-wfx-session-id"]).toBe("string");
    });
  });
});

describe("R07 web host — the canonical join (the R04 seam)", () => {
  it("mints valid canonical wfxitm_ ids, stably per process", () => {
    const first = canonicalIdFor("conn-1", "ref-1");
    const second = canonicalIdFor("conn-1", "ref-1");
    expect(first).toBe(second);
    expect(first.startsWith("wfxitm_")).toBe(true);
    expect(first.length).toBe("wfxitm_".length + 26);

    const other = canonicalIdFor("conn-1", "ref-2");
    expect(other).not.toBe(first);
    const sameRefOtherConnector = canonicalIdFor("conn-2", "ref-1");
    expect(sameRefOtherConnector).not.toBe(first);
  });
});
