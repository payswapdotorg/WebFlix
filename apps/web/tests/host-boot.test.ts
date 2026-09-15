/**
 * WFX-050 host boot law tests (bun:test).
 *
 * THE law, machine-checked: port selection is by environment, fixtures
 * are reachable ONLY behind the explicit `WFX_DEV_FIXTURES=1` opt-in, and
 * a misconfigured production boot fails LOUDLY with the typed
 * `HostConfigError` naming the offending variables — never a silent
 * fixture fallback.
 *
 * Deterministic: every case injects a fully-controlled env record (or
 * mutates and restores `process.env`); no network, no wall clock, no
 * randomness in the assertions.
 */

import { describe, expect, it } from "bun:test";

import { FakeConnectorPort } from "@wfx/experience";

import { bootWebClient } from "../src/main";
import { HostConfigError, resolveHostConfig } from "../src/host/config";
import { resolveDefaultPorts } from "../src/host/default-ports";
import { REMOTE_CONNECTOR_ID } from "../src/host/remote-ports";
import { bootWebHost } from "../src/host/boot";
import { WEB_HOST_SERVICE, WEB_HOST_VERSION } from "../src/host/version";

/** The variables the host law touches. */
const LAW_VARS = ["WFX_DEV_FIXTURES", "WFX_API_BASE", "NODE_ENV"] as const;

type LawVar = (typeof LAW_VARS)[number];

/** Run `body` with a controlled environment, restoring the real one after. */
function withEnv(overrides: Partial<Record<LawVar, string>>, body: () => void): void {
  const env = process.env as Record<string, string | undefined>;
  const saved = new Map<string, string | undefined>();
  for (const name of LAW_VARS) saved.set(name, env[name]);
  try {
    for (const name of LAW_VARS) delete env[name];
    for (const [name, value] of Object.entries(overrides)) {
      env[name] = value;
    }
    body();
  } finally {
    for (const name of LAW_VARS) {
      const value = saved.get(name);
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  }
}

describe("WFX-050 host boot law", () => {
  describe("resolveHostConfig (the one selection law)", () => {
    it("service mode: valid WFX_API_BASE resolves with a normalized base URL", () => {
      const config = resolveHostConfig({ WFX_API_BASE: "https://experience.example.com/" });
      expect(config).toEqual({ mode: "service", apiBase: new URL("https://experience.example.com") });
    });

    it("production boot without WFX_API_BASE fails LOUDLY, naming the variable", () => {
      let thrown: unknown;
      try {
        resolveHostConfig({});
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HostConfigError);
      const configError = thrown as HostConfigError;
      expect(configError.missing).toEqual(["WFX_API_BASE"]);
      expect(configError.message).toContain("WFX_API_BASE");
      expect(configError.message).toContain("WFX_DEV_FIXTURES");
      expect(configError.name).toBe("HostConfigError");
    });

    it("a malformed WFX_API_BASE is a typed error naming the variable (never silent service)", () => {
      for (const bad of ["not-a-url", "ftp://experience.example.com"]) {
        let thrown: unknown;
        try {
          resolveHostConfig({ WFX_API_BASE: bad });
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(HostConfigError);
        expect((thrown as HostConfigError).invalid).toEqual(["WFX_API_BASE"]);
      }
      // Whitespace-only is ABSENT (missing), not invalid.
      let thrown: unknown;
      try {
        resolveHostConfig({ WFX_API_BASE: "   " });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HostConfigError);
      expect((thrown as HostConfigError).missing).toEqual(["WFX_API_BASE"]);
    });

    it("fixtures mode requires the EXPLICIT flag value — anything else is a typed error", () => {
      const config = resolveHostConfig({ WFX_DEV_FIXTURES: "1" });
      expect(config.mode).toBe("fixtures");

      const alsoTrue = resolveHostConfig({ WFX_DEV_FIXTURES: "true" });
      expect(alsoTrue.mode).toBe("fixtures");

      let thrown: unknown;
      try {
        resolveHostConfig({ WFX_DEV_FIXTURES: "yes" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HostConfigError);
      expect((thrown as HostConfigError).invalid).toEqual(["WFX_DEV_FIXTURES"]);
    });

    it("WFX_DEV_FIXTURES in a production environment is a typed error — never a downgrade", () => {
      let thrown: unknown;
      try {
        resolveHostConfig({ WFX_DEV_FIXTURES: "1", NODE_ENV: "production" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HostConfigError);
      expect((thrown as HostConfigError).invalid).toEqual(["WFX_DEV_FIXTURES"]);
      expect((thrown as HostConfigError).message).toContain("production");
    });
  });

  describe("the fixture path is IMPOSSIBLE without the explicit flag", () => {
    it("bootWebHost with no env at all throws HostConfigError naming WFX_API_BASE — never fixtures", () => {
      withEnv({}, () => {
        let thrown: unknown;
        try {
          bootWebHost();
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(HostConfigError);
        expect((thrown as HostConfigError).missing).toEqual(["WFX_API_BASE"]);
      });
    });

    it("bootWebHost with NODE_ENV=production and no WFX_API_BASE throws the typed loud error", () => {
      withEnv({ NODE_ENV: "production" }, () => {
        let thrown: unknown;
        try {
          bootWebHost();
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(HostConfigError);
        const configError = thrown as HostConfigError;
        expect(configError.missing).toEqual(["WFX_API_BASE"]);
        expect(configError.message).toContain("WFX_API_BASE");
      });
    });

    it("bootWebClient with OMITTED ports follows the same law — no silent fixture default remains", () => {
      withEnv({}, () => {
        let thrown: unknown;
        try {
          bootWebClient();
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(HostConfigError);
        expect((thrown as HostConfigError).missing).toEqual(["WFX_API_BASE"]);
      });
    });

    it("resolveDefaultPorts without the flag never yields the fixture connector", () => {
      withEnv({}, () => {
        let thrown: unknown;
        try {
          resolveDefaultPorts();
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(HostConfigError);
      });
    });
  });

  describe("the flagged dev path and the service path", () => {
    it("WFX_DEV_FIXTURES=1 (dev) boots fixture ports through the shared runtime", () => {
      withEnv({ WFX_DEV_FIXTURES: "1" }, () => {
        const host = bootWebHost();
        expect(host.mode).toBe("fixtures");
        expect(host.client.platform).toBe("web");
        expect(host.client.runtime.platform).toBe("web");
        expect(host.client.runtime.ports.connector).toBeInstanceOf(FakeConnectorPort);
        expect(host.client.runtime.ports.connector.descriptor().id).toBe("fake-source");
      });
    });

    it("a valid WFX_API_BASE boots the remote service ports — NOT fixtures", () => {
      withEnv({ WFX_API_BASE: "https://experience.example.com" }, () => {
        const host = bootWebHost();
        expect(host.mode).toBe("service");
        const connector = host.client.runtime.ports.connector;
        expect(connector).not.toBeInstanceOf(FakeConnectorPort);
        expect(connector.descriptor().id).toBe(REMOTE_CONNECTOR_ID);
        // The web platform profile is intact on both paths.
        expect(host.client.runtime.profile.device.playbackModes).toEqual([
          "embed",
          "browser",
          "external",
        ]);
      });
    });

    it("the fixture flag takes precedence for local UX work (documented dev override)", () => {
      withEnv({ WFX_DEV_FIXTURES: "1", WFX_API_BASE: "https://experience.example.com" }, () => {
        expect(bootWebHost().mode).toBe("fixtures");
      });
    });
  });

  describe("host version identity", () => {
    it("the version constant mirrors apps/web/package.json (health endpoint truth)", async () => {
      const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
      expect(WEB_HOST_VERSION).toBe(pkg.version);
      expect(WEB_HOST_SERVICE).toBe("webflix-web");
    });
  });
});
