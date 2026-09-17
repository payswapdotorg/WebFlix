/**
 * R11 — the session state machine (the honest status surface).
 *
 * The frozen `TorrentState` union's transition table: `metadata →
 * checking → downloading ⇄ paused`, with `playing` as a playback-driven
 * projection (R12), `complete` requiring verified integrity, and `failed`
 * reachable from every live state. The `statusFromSession` projection
 * names the stall truthfully — `failed(stalled)` for a peer-starved
 * session, never a fake "downloading" progress.
 */

import { describe, expect, it } from "bun:test";

import {
  ALLOWED_TORRENT_TRANSITIONS,
  canTransition,
  isTorrentSessionState,
  statusFromSession,
  TORRENT_SESSION_STATES,
  transition,
} from "../src/session";
import { InvalidTransitionError } from "../src/errors";

describe("R11 — the torrent session state machine", () => {
  it("the frozen state union is the closed 8-state vocabulary", () => {
    expect(TORRENT_SESSION_STATES).toEqual([
      "metadata",
      "checking",
      "buffering",
      "playing",
      "downloading",
      "paused",
      "complete",
      "failed",
    ]);
    for (const s of TORRENT_SESSION_STATES) {
      expect(isTorrentSessionState(s)).toBe(true);
    }
    expect(isTorrentSessionState("unknown")).toBe(false);
    expect(isTorrentSessionState(42)).toBe(false);
    expect(isTorrentSessionState(null)).toBe(false);
  });

  it("the transition graph admits the honest status surface", () => {
    // The linear progression: metadata → checking → downloading → complete.
    expect(canTransition("metadata", "checking")).toBe(true);
    expect(canTransition("checking", "downloading")).toBe(true);
    expect(canTransition("downloading", "complete")).toBe(true);
    // Pause/resume: downloading ⇄ paused.
    expect(canTransition("downloading", "paused")).toBe(true);
    expect(canTransition("paused", "downloading")).toBe(true);
    // The playback projection (R12): playing ⇄ downloading, playing ⇄ paused.
    expect(canTransition("downloading", "playing")).toBe(true);
    expect(canTransition("paused", "playing")).toBe(true);
    expect(canTransition("playing", "downloading")).toBe(true);
    expect(canTransition("playing", "paused")).toBe(true);
    // Failure from every live state.
    for (const s of ["metadata", "checking", "buffering", "playing", "downloading", "paused"] as const) {
      expect(canTransition(s, "failed")).toBe(true);
    }
    // Terminal states: no outgoing transitions.
    expect(ALLOWED_TORRENT_TRANSITIONS.complete).toEqual([]);
    expect(ALLOWED_TORRENT_TRANSITIONS.failed).toEqual([]);
    expect(canTransition("complete", "downloading")).toBe(false);
    expect(canTransition("failed", "metadata")).toBe(false);
    // Illegal hops.
    expect(canTransition("metadata", "complete")).toBe(false);
    expect(canTransition("checking", "paused")).toBe(true); // checking → paused (resume before download)
  });

  it("transition returns the new state (pure — no input mutation)", () => {
    expect(transition("metadata", "checking")).toBe("checking");
    expect(transition("downloading", "paused")).toBe("paused");
    expect(transition("paused", "downloading")).toBe("downloading");
  });

  it("transition throws InvalidTransitionError for illegal hops", () => {
    expect(() => transition("complete", "downloading")).toThrow(InvalidTransitionError);
    expect(() => transition("failed", "metadata")).toThrow(InvalidTransitionError);
    expect(() => transition("metadata", "complete")).toThrow(InvalidTransitionError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => transition("garbage" as any, "downloading")).toThrow(InvalidTransitionError);
  });
});

describe("R11 — the honest status projection (statusFromSession)", () => {
  it("complete state → completed status", () => {
    const status = statusFromSession({
      state: "complete",
      peerCount: 0,
      verifiedPieces: 4,
      totalPieces: 4,
      stallWindowMs: 60_000,
    });
    expect(status.kind).toBe("completed");
  });

  it("metadata state → discovering-metadata status", () => {
    const status = statusFromSession({
      state: "metadata",
      peerCount: 0,
      verifiedPieces: 0,
      totalPieces: 4,
      stallWindowMs: 60_000,
    });
    expect(status.kind).toBe("discovering-metadata");
  });

  it("paused state → seeding-paused status (the honest paused-with-verified-pieces answer)", () => {
    const status = statusFromSession({
      state: "paused",
      peerCount: 5,
      verifiedPieces: 2,
      totalPieces: 4,
      stallWindowMs: 60_000,
    });
    expect(status.kind).toBe("seeding-paused");
  });

  it("downloading with peers → downloading status (the honest progress answer)", () => {
    const status = statusFromSession({
      state: "downloading",
      peerCount: 5,
      verifiedPieces: 2,
      totalPieces: 4,
      stallWindowMs: 60_000,
    });
    expect(status.kind).toBe("downloading");
  });

  it("downloading with 0 peers past the stall window → failed(stalled) (NEVER fake progress)", () => {
    const status = statusFromSession({
      state: "downloading",
      peerCount: 0,
      verifiedPieces: 0,
      totalPieces: 4,
      stalledSinceMs: 120_000,
      stallWindowMs: 60_000,
    });
    expect(status.kind).toBe("failed");
    if (status.kind === "failed") {
      expect(status.reason).toContain("peer starvation");
      expect(status.reason).toContain("0 peers");
    }
  });

  it("downloading with 0 peers within the stall window → downloading (still in grace)", () => {
    const status = statusFromSession({
      state: "downloading",
      peerCount: 0,
      verifiedPieces: 0,
      totalPieces: 4,
      stalledSinceMs: 30_000,
      stallWindowMs: 60_000,
    });
    expect(status.kind).toBe("downloading");
  });

  it("all pieces verified but state not complete → verifying (the J24 step's projection)", () => {
    const status = statusFromSession({
      state: "downloading",
      peerCount: 5,
      verifiedPieces: 4,
      totalPieces: 4,
      stallWindowMs: 60_000,
    });
    expect(status.kind).toBe("verifying");
  });

  it("failed state → failed status with the engine's recorded reason", () => {
    const status = statusFromSession({
      state: "failed",
      peerCount: 0,
      verifiedPieces: 0,
      totalPieces: 4,
      stallWindowMs: 60_000,
      error: "disk full",
    });
    expect(status.kind).toBe("failed");
    if (status.kind === "failed") {
      expect(status.reason).toBe("disk full");
    }
  });

  it("failed state without an error string → the honest default reason", () => {
    const status = statusFromSession({
      state: "failed",
      peerCount: 0,
      verifiedPieces: 0,
      totalPieces: 4,
      stallWindowMs: 60_000,
    });
    expect(status.kind).toBe("failed");
    if (status.kind === "failed") {
      expect(status.reason).toContain("no detail recorded");
    }
  });
});
