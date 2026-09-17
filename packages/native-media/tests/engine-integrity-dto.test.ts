/**
 * R10 — the v1 DTO `integrity` extension tests (lead-authorized).
 *
 * The wire contract extension: `EngineSessionDto.integrity` is OPTIONAL
 * (legacy six-field DTOs still pass every guard — backward compatibility),
 * validated when present, round-trips through JSON with the session
 * mappers, and `PROTOCOL_VERSION` STAYS 1 (the optional-additive decision
 * documented in engine/process.ts).
 */

import { describe, expect, it } from "bun:test";

import type { NativeMediaSession } from "@wfx/domain";

import {
  isEngineEvent,
  isEngineSessionDto,
  isSessionIntegrity,
  PROTOCOL_VERSION,
  sessionFromDto,
  sessionToDto,
  type EngineSessionDto,
} from "../src/engine/process";

const BASE_DTO: EngineSessionDto = {
  id: "s1",
  assetId: "a1",
  fileId: "f1",
  state: "buffering",
  bufferedMs: 0,
  positionMs: 0,
};

function sessionWith(integrity: NativeMediaSession["integrity"]): NativeMediaSession {
  return {
    id: "s1",
    assetId: "a1",
    fileId: "f1",
    state: "background",
    bufferedMs: 12_000,
    positionMs: 3_000,
    integrity,
  };
}

describe("R10 — the v1 integrity DTO extension", () => {
  it("PROTOCOL_VERSION stays 1 (optional-additive is not a breaking change)", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("isSessionIntegrity accepts exactly the three frozen verdicts", () => {
    expect(isSessionIntegrity("unknown")).toBe(true);
    expect(isSessionIntegrity("verified")).toBe(true);
    expect(isSessionIntegrity("failed")).toBe(true);
    expect(isSessionIntegrity("nope")).toBe(false);
    expect(isSessionIntegrity(42)).toBe(false);
    expect(isSessionIntegrity(undefined)).toBe(false);
    expect(isSessionIntegrity(null)).toBe(false);
  });

  it("isEngineSessionDto accepts the LEGACY six-field form (v1 senders)", () => {
    expect(isEngineSessionDto({ ...BASE_DTO })).toBe(true);
    expect(isEngineSessionDto(JSON.parse(JSON.stringify(BASE_DTO)))).toBe(true);
  });

  it("isEngineSessionDto accepts all three verdicts when present", () => {
    for (const integrity of ["unknown", "verified", "failed"] as const) {
      expect(isEngineSessionDto({ ...BASE_DTO, integrity })).toBe(true);
    }
  });

  it("isEngineSessionDto REJECTS a present-but-invalid verdict", () => {
    expect(isEngineSessionDto({ ...BASE_DTO, integrity: "corrupt" })).toBe(false);
    expect(isEngineSessionDto({ ...BASE_DTO, integrity: 1 })).toBe(false);
    expect(isEngineSessionDto({ ...BASE_DTO, integrity: null })).toBe(false);
    expect(isEngineSessionDto({ ...BASE_DTO, integrity: ["verified"] })).toBe(false);
  });

  it("sessionToDto carries the session's verdict; sessionFromDto adopts it", () => {
    for (const integrity of ["unknown", "verified", "failed"] as const) {
      const session = sessionWith(integrity);
      const wire = JSON.parse(JSON.stringify(sessionToDto(session))) as EngineSessionDto;
      expect(wire.integrity).toBe(integrity);
      expect(isEngineSessionDto(wire)).toBe(true);
      const back = sessionFromDto(wire);
      expect(back).toEqual(session);
      expect(back.integrity).toBe(integrity);
    }
  });

  it("sessionFromDto defaults an ABSENT verdict to the honest 'unknown'", () => {
    const legacy = JSON.parse(JSON.stringify(BASE_DTO)) as EngineSessionDto;
    const session = sessionFromDto(legacy);
    expect(session.integrity).toBe("unknown");
  });

  it("state-changed events validate with and without the integrity field", () => {
    expect(
      isEngineEvent({
        protocolVersion: 1,
        kind: "state-changed",
        session: { ...BASE_DTO },
      }),
    ).toBe(true);
    expect(
      isEngineEvent({
        protocolVersion: 1,
        kind: "state-changed",
        session: { ...BASE_DTO, integrity: "verified" },
      }),
    ).toBe(true);
    expect(
      isEngineEvent({
        protocolVersion: 1,
        kind: "state-changed",
        session: { ...BASE_DTO, integrity: "bogus" },
      }),
    ).toBe(false);
  });
});
