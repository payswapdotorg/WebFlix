/**
 * R11 — the provenance law (invariant 5's structural enforcement).
 *
 * The structural law: the public `ingestMagnet`/`ingestTorrentFile` API
 * requires a `Provenance` argument — the branded nominal type that the
 * call site cannot construct without `provenanceFromAuthorizedSource`.
 * Missing/unknown provenance is a TYPED REJECTION (`UNAUTHORIZED_SOURCE`),
 * never a warning; the runtime guard refuses every non-branded value.
 */

import { describe, expect, it } from "bun:test";

import {
  AUTHORIZATION_KINDS,
  assertAuthorized,
  isAuthorizationKind,
  isProvenance,
  provenanceFromAuthorizedSource,
  UNKNOWN_PROVENANCE,
  type AuthorizationKind,
  type Provenance,
} from "../src/provenance";
import { TorrentEngineError, isTorrentEngineError } from "../src/errors";

describe("R11 — the provenance law (invariant 5)", () => {
  it("the authorization vocabulary is closed (5 known kinds)", () => {
    expect(AUTHORIZATION_KINDS).toEqual([
      "user-owned",
      "licensed",
      "public-domain",
      "creative-commons",
      "authorized-vault",
    ]);
    for (const kind of AUTHORIZATION_KINDS) {
      expect(isAuthorizationKind(kind)).toBe(true);
    }
    expect(isAuthorizationKind("unknown")).toBe(false);
    expect(isAuthorizationKind("")).toBe(false);
    expect(isAuthorizationKind(42)).toBe(false);
    expect(isAuthorizationKind(null)).toBe(false);
  });

  it("provenanceFromAuthorizedSource constructs a provenance with the brand", () => {
    const p = provenanceFromAuthorizedSource({
      sourceId: "vault-1",
      authorizationKind: "authorized-vault",
      context: { vaultPath: "/nas/media" },
    });
    expect(isProvenance(p)).toBe(true);
    expect(p.sourceId).toBe("vault-1");
    expect(p.authorizationKind).toBe("authorized-vault");
    expect(p.context).toEqual({ vaultPath: "/nas/media" });
  });

  it("the structural guard rejects every non-branded value at runtime", () => {
    // Defensive: even if untyped code reaches the boundary, the runtime
    // guard rejects everything that is not a branded Provenance.
    expect(isProvenance(null)).toBe(false);
    expect(isProvenance(undefined)).toBe(false);
    expect(isProvenance("vault-1")).toBe(false);
    expect(isProvenance({ sourceId: "vault-1", authorizationKind: "authorized-vault" })).toBe(false);
    expect(isProvenance({ sourceId: "", authorizationKind: "authorized-vault" })).toBe(false);
    expect(isProvenance({ sourceId: "vault-1", authorizationKind: "unknown" })).toBe(false);
  });

  it("provenanceFromAuthorizedSource throws a typed UNAUTHORIZED_SOURCE on bad input", () => {
    expect(() => provenanceFromAuthorizedSource({ sourceId: "", authorizationKind: "user-owned" }))
      .toThrow(/sourceId must be a non-empty string/);
    expect(() => provenanceFromAuthorizedSource({ sourceId: "vault-1", authorizationKind: "unknown" as AuthorizationKind }))
      .toThrow(/authorizationKind must be one of/);
    expect(() =>
      provenanceFromAuthorizedSource({
        sourceId: "vault-1",
        authorizationKind: "user-owned",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        context: { bad: 42 } as any,
      }),
    ).toThrow(/context\['bad'\] must be a string/);
  });

  it("assertAuthorized throws the typed UNAUTHORIZED_SOURCE for non-provenance values", () => {
    expect(() => assertAuthorized(null)).toThrow(TorrentEngineError);
    try {
      assertAuthorized({ sourceId: "x", authorizationKind: "user-owned" });
    } catch (e) {
      expect(isTorrentEngineError(e)).toBe(true);
      if (isTorrentEngineError(e)) {
        expect(e.code).toBe("UNAUTHORIZED_SOURCE");
        expect(e.detail).toContain("invariant 5's structural enforcement");
      }
    }
  });

  it("UNKNOWN_PROVENANCE is a unique symbol (the runtime marker for the typed rejection)", () => {
    expect(typeof UNKNOWN_PROVENANCE).toBe("symbol");
    expect(UNKNOWN_PROVENANCE).not.toBe(Symbol("UNKNOWN_PROVENANCE"));
  });

  it("a Provenance is assignable to the structural type but only via the constructor", () => {
    // The compile-time check: passing a non-Provenance to a function that
    // takes Provenance fails TypeScript — this test asserts the RUNTIME
    // mirror (the guard) refuses everything that is not branded.
    const p: Provenance = provenanceFromAuthorizedSource({
      sourceId: "personal-rip",
      authorizationKind: "user-owned",
    });
    expect(isProvenance(p)).toBe(true);
    // The branded symbol is never enumerable; the guard checks it.
    const keys = Object.keys(p as unknown as Record<string, unknown>);
    expect(keys).not.toContain("__brand");
  });
});
