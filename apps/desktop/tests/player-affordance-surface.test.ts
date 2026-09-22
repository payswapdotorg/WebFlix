/**
 * R24-W3 — the native player affordance parity battery (the plan's R24-C
 * Watch/player grammar on the NATIVE path).
 *
 * THE LAW TESTED (docs/plans/
 * 2026-09-20-webflix-youtube-parity-performance-plan.md R24-C + the design
 * language's familiar-grammar law): the Desktop player carries the control
 * grammar a mature video product's viewer already knows — control
 * placement, keyboard behavior, direct-manipulation seek/scrub, the
 * settings cluster, up-next/queue — with every affordance's backing being
 * HONEST capability truth:
 *
 * - the transport affordances execute through the shared controller (the
 *   SAME commands every realization uses — proven against a REAL
 *   peer-copy playback session, not a mock controller);
 * - volume/mute/speed answer the honest not-exposed-yet truth on the
 *   native rung (never a dead button, never a fake execution);
 * - cast is HONESTLY ABSENT (the reference Desktop declares no cast sink);
 * - the scrub model answers the honest needs-verified-range truth for
 *   ranges the in-progress copy has not fetched yet;
 * - the autoplay affordance DERIVES from the attention policy (mindful
 *   keeps it off — never a raw always-on switch);
 * - the session queue composes runtime operations only (play-through
 *   delegates to the composition's own play action; save-queue writes the
 *   Library's own watchlist).
 */

import { describe, expect, it } from "bun:test";

import {
  KEYBOARD_SEEK_JUMP_MS,
  KEYBOARD_SEEK_STEP_MS,
  PLAYER_AFFORDANCE_KINDS,
  PLAYER_KEYBOARD_BINDINGS,
  castAffordanceOf,
  createDesktopPlayerAffordanceSurface,
  createDesktopPlayerSessionQueue,
  formatPlaybackTime,
  playerAffordanceMap,
  playerAutoplayAffordanceOf,
  playerKeyboardCommandOf,
  playerScrubModelOf,
  playerScrubPlayability,
  playerScrubPreview,
  playerUpNextView,
} from "../src/surface/player-affordance-surface";
import { bootR23, lastNativeSessionId, nativeEvent, R23_ITEM, R23_PROVENANCE, R23_TITLE } from "./r23-harness";
import { desktopDeviceCapabilities } from "../src/platform/media-surface";

// ---------------------------------------------------------------------------
// The affordance map (control placement + honest backing)
// ---------------------------------------------------------------------------

describe("R24 native player affordance parity — the affordance map", () => {
  it("projects the closed affordance grammar on the native rung", () => {
    const map = playerAffordanceMap("native");
    const kinds = map.map((view) => view.kind);
    for (const kind of PLAYER_AFFORDANCE_KINDS) {
      expect(kinds).toContain(kind);
    }
    expect(new Set(kinds).size).toBe(kinds.length); // no duplicates
  });

  it("routes the transport affordances through the shared runtime commands", () => {
    const map = playerAffordanceMap("native");
    const playPause = map.find((view) => view.kind === "play-pause");
    const seek = map.find((view) => view.kind === "seek-scrub");
    expect(playPause?.backing).toBe("runtime-command");
    expect(seek?.backing).toBe("runtime-command");
  });

  it("answers the honest not-exposed-yet truth for native volume/mute/speed (never dead buttons)", () => {
    const map = playerAffordanceMap("native");
    for (const kind of ["volume", "mute", "speed"] as const) {
      const view = map.find((candidate) => candidate.kind === kind);
      expect(view?.backing).toBe("not-exposed-yet");
      expect(view?.detail.length ?? 0).toBeGreaterThan(20); // the honest next path is named
    }
  });

  it("answers quality as the realization's own truth on the native rung (the file IS the quality decision)", () => {
    const map = playerAffordanceMap("native");
    const quality = map.find((view) => view.kind === "quality");
    expect(quality?.backing).toBe("realization-exposed");
    expect(quality?.detail).toContain("file");
  });

  it("answers the settings cluster as realization-exposed on the provider rungs", () => {
    for (const mode of ["embed", "browser"] as const) {
      const map = playerAffordanceMap(mode);
      for (const kind of ["volume", "mute", "speed", "quality"] as const) {
        const view = map.find((candidate) => candidate.kind === kind);
        expect(view?.backing).toBe("realization-exposed");
      }
    }
  });

  it("keeps the platform affordances honest (fullscreen/miniplayer = the shell window's own state)", () => {
    const map = playerAffordanceMap("native");
    const fullscreen = map.find((view) => view.kind === "fullscreen");
    const miniplayer = map.find((view) => view.kind === "miniplayer");
    expect(fullscreen?.backing).toBe("platform-affordance");
    expect(miniplayer?.backing).toBe("platform-affordance");
  });

  it("keeps the shared-surface affordances on the shared surfaces (captions/transcript/chapters/autoplay/save/feedback)", () => {
    const map = playerAffordanceMap("native");
    for (const kind of ["captions", "transcript", "chapters", "autoplay", "watchlist-save", "feedback"] as const) {
      const view = map.find((candidate) => candidate.kind === kind);
      expect(view?.backing).toBe("shared-surface");
    }
  });

  it("carries the session affordances as session-scoped compositions (up-next/queue)", () => {
    const map = playerAffordanceMap("native");
    for (const kind of ["up-next", "queue"] as const) {
      const view = map.find((candidate) => candidate.kind === kind);
      expect(view?.backing).toBe("session-affordance");
    }
  });

  it("never includes a cast affordance kind (the honest-absence law: the union is closed without it)", () => {
    expect(PLAYER_AFFORDANCE_KINDS as readonly string[]).not.toContain("cast");
    for (const mode of ["native", "embed", "browser", "external"] as const) {
      const map = playerAffordanceMap(mode);
      expect(map.find((view) => (view.kind as string) === "cast")).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// The cast truth (the honest absence)
// ---------------------------------------------------------------------------

describe("R24 native player affordance parity — the honest cast absence", () => {
  it("answers the honest absence for the reference Desktop (casting: false)", () => {
    const capabilities = bootR23().capabilities;
    const device = desktopDeviceCapabilities(capabilities);
    expect(device.casting).toBe(false); // the frozen surface matrix's own truth
    const cast = castAffordanceOf(capabilities, device.casting);
    expect(cast.available).toBe(false);
    expect(cast.detail).toContain("no cast sink");
    expect(cast.detail).toContain("another device"); // the honest next path is named
  });

  it("answers the honest availability when a platform truthfully declares a sink", () => {
    const cast = castAffordanceOf({ platform: "desktop" }, true);
    expect(cast.available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The keyboard grammar
// ---------------------------------------------------------------------------

describe("R24 native player affordance parity — the keyboard grammar", () => {
  it("binds the familiar transport keys (Space/K play-pause, J/L ten seconds, arrows five)", () => {
    expect(playerKeyboardCommandOf({ key: " " })).toEqual({ kind: "toggle-play-pause" });
    expect(playerKeyboardCommandOf({ key: "k" })).toEqual({ kind: "toggle-play-pause" });
    expect(playerKeyboardCommandOf({ key: "j" })).toEqual({ kind: "seek", deltaMs: -KEYBOARD_SEEK_JUMP_MS });
    expect(playerKeyboardCommandOf({ key: "l" })).toEqual({ kind: "seek", deltaMs: KEYBOARD_SEEK_JUMP_MS });
    expect(playerKeyboardCommandOf({ key: "ArrowLeft" })).toEqual({
      kind: "seek",
      deltaMs: -KEYBOARD_SEEK_STEP_MS,
    });
    expect(playerKeyboardCommandOf({ key: "ArrowRight" })).toEqual({
      kind: "seek",
      deltaMs: KEYBOARD_SEEK_STEP_MS,
    });
    expect(KEYBOARD_SEEK_JUMP_MS).toBe(10_000);
    expect(KEYBOARD_SEEK_STEP_MS).toBe(5_000);
  });

  it("binds the number keys to the tenth-percent jumps", () => {
    expect(playerKeyboardCommandOf({ key: "0" })).toEqual({ kind: "seek-percent", percent: 0 });
    expect(playerKeyboardCommandOf({ key: "5" })).toEqual({ kind: "seek-percent", percent: 50 });
    expect(playerKeyboardCommandOf({ key: "9" })).toEqual({ kind: "seek-percent", percent: 90 });
  });

  it("binds the player-state keys (M mute, F fullscreen, Escape exit, I miniplayer, C captions, T transcript)", () => {
    expect(playerKeyboardCommandOf({ key: "m" })).toEqual({ kind: "toggle-mute" });
    expect(playerKeyboardCommandOf({ key: "f" })).toEqual({ kind: "toggle-fullscreen" });
    expect(playerKeyboardCommandOf({ key: "Escape" })).toEqual({ kind: "exit-fullscreen" });
    expect(playerKeyboardCommandOf({ key: "i" })).toEqual({ kind: "toggle-miniplayer" });
    expect(playerKeyboardCommandOf({ key: "c" })).toEqual({ kind: "toggle-captions" });
    expect(playerKeyboardCommandOf({ key: "t" })).toEqual({ kind: "toggle-transcript" });
  });

  it("answers null for OS/accessibility chords and unbound keys (never a guess)", () => {
    expect(playerKeyboardCommandOf({ key: "k", ctrlKey: true })).toBeNull();
    expect(playerKeyboardCommandOf({ key: "k", metaKey: true })).toBeNull();
    expect(playerKeyboardCommandOf({ key: "k", altKey: true })).toBeNull();
    expect(playerKeyboardCommandOf({ key: "x" })).toBeNull();
    expect(playerKeyboardCommandOf({ key: "F1" })).toBeNull();
  });

  it("carries a user-facing description for every binding (the shortcut sheet's truth)", () => {
    expect(PLAYER_KEYBOARD_BINDINGS.length).toBeGreaterThanOrEqual(24);
    for (const binding of PLAYER_KEYBOARD_BINDINGS) {
      expect(binding.description.length).toBeGreaterThan(3);
    }
  });
});

// ---------------------------------------------------------------------------
// The command execution against a REAL peer-copy playback session
// ---------------------------------------------------------------------------

describe("R24 native player affordance parity — command execution over the real composition", () => {
  it("executes pause/play through the shared controller on a real peer-copy session", async () => {
    const boot = bootR23();
    const surface = createDesktopPlayerAffordanceSurface({
      runtime: boot.runtime,
      capabilities: boot.capabilities,
      casting: desktopDeviceCapabilities(boot.capabilities).casting,
    });

    // Start the peer copy through the Where-to-watch primary play (the same
    // path a user drives) and pump honest playback evidence.
    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 1_000, 30_000);

    // Space → pause (the controller's own command, executed through the surface).
    const pause = await surface.execute({ kind: "toggle-play-pause" });
    expect(pause.kind).toBe("executed");
    const state = outcome.controller.state();
    expect(state.phase).toBe("paused");

    // Space again → play (the controller's own resume; the evidence pump
    // then proves the playing phase — never a fake transition).
    const play = await surface.execute({ kind: "toggle-play-pause" });
    expect(play.kind).toBe("executed");
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 1_000, 30_000);
    expect(outcome.controller.state().phase).toBe("playing");
  });

  it("executes the keyboard seeks (J/L relative, number-key percent) through the controller", async () => {
    const boot = bootR23();
    const surface = createDesktopPlayerAffordanceSurface({
      runtime: boot.runtime,
      capabilities: boot.capabilities,
      casting: false,
    });
    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 60_000, 120_000);

    // L (+10s) — the surface routes to the controller's typed seek.
    const forward = await surface.execute({ kind: "seek", deltaMs: KEYBOARD_SEEK_JUMP_MS });
    expect(forward.kind).toBe("executed");
    expect(outcome.controller.state().positionMs).toBe(70_000);

    // J (-10s).
    const back = await surface.execute({ kind: "seek", deltaMs: -KEYBOARD_SEEK_JUMP_MS });
    expect(back.kind).toBe("executed");
    expect(outcome.controller.state().positionMs).toBe(60_000);

    // 5 → the midpoint: the duration is NOT registered for this item in
    // this composition, so the percent jump answers the HONEST
    // no-duration-yet truth (never a guessed target).
    const noDuration = await surface.execute({ kind: "seek-percent", percent: 50 });
    expect(noDuration.kind).toBe("unsupported");
    if (noDuration.kind === "unsupported") {
      expect(noDuration.detail).toContain("duration isn't known yet");
    }
    expect(outcome.controller.state().positionMs).toBe(60_000);
  });

  it("executes the percent jump once the duration evidence exists (the registry's own truth)", async () => {
    // The searched item's canonical id is discovered through the search
    // itself; the peer-copy realization follows it (the composition's own
    // dynamic truth — the realization answers for whatever the search
    // canonical-joined).
    let searchedItemId: string | null = null;
    const boot = bootR23({
      realizationOf: (itemId) =>
        itemId === searchedItemId
          ? {
              itemId,
              title: R23_TITLE,
              magnet: `magnet:?xt=urn:btih:${"ab".repeat(20)}`,
              provenance: R23_PROVENANCE,
              browserCapable: false,
            }
          : null,
    });
    // Register the item WITH a duration through the runtime's own path: a
    // scripted search hit carrying durationMs canonical-joins the item.
    boot.server.scriptSearch("family archive", {
      ok: true,
      value: [
        {
          connectorId: "authorized-peer-copy",
          externalRef: "vault:family-media:feature",
          title: R23_TITLE,
          canonicalType: "video",
          durationMs: 600_000,
        },
      ],
    });
    const search = await boot.runtime.search({ query: "family archive" });
    expect(search.status.state).toBe("ready");
    expect(search.hits.length).toBe(1);
    searchedItemId = search.hits[0]?.canonicalItemId ?? null;
    expect(searchedItemId).not.toBeNull();

    const surface = createDesktopPlayerAffordanceSurface({
      runtime: boot.runtime,
      capabilities: boot.capabilities,
      casting: false,
    });
    const outcome = await boot.whereToWatch.playPeerCopy(searchedItemId!);
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 60_000, 120_000);

    // The duration evidence now exists → the percent jump executes through
    // the controller's typed seek (5 → the 5-minute midpoint).
    expect(outcome.controller.state().durationMs).toBe(600_000);
    const midpoint = await surface.execute({ kind: "seek-percent", percent: 50 });
    expect(midpoint.kind).toBe("executed");
    expect(outcome.controller.state().positionMs).toBe(300_000);
  });

  it("answers the honest not-exposed truth for volume/mute commands on the native rung", async () => {
    const boot = bootR23();
    const surface = createDesktopPlayerAffordanceSurface({
      runtime: boot.runtime,
      capabilities: boot.capabilities,
      casting: false,
    });
    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 1_000, 30_000);

    const volume = await surface.execute({ kind: "step-volume", direction: 1 });
    expect(volume.kind).toBe("unsupported");
    if (volume.kind === "unsupported") {
      expect(volume.reason).toBe("not-exposed-on-rung");
      expect(volume.detail).toContain("device volume");
    }

    const mute = await surface.execute({ kind: "toggle-mute" });
    expect(mute.kind).toBe("unsupported");
    if (mute.kind === "unsupported") {
      expect(mute.reason).toBe("not-exposed-on-rung");
    }
  });

  it("answers the honest no-active-session truth when nothing is playing", async () => {
    const boot = bootR23();
    const surface = createDesktopPlayerAffordanceSurface({
      runtime: boot.runtime,
      capabilities: boot.capabilities,
      casting: false,
    });
    const result = await surface.execute({ kind: "toggle-play-pause" });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("no-active-session");
    }
  });

  it("executes the stop command honestly (the session ends, the place is kept)", async () => {
    const boot = bootR23();
    const surface = createDesktopPlayerAffordanceSurface({
      runtime: boot.runtime,
      capabilities: boot.capabilities,
      casting: false,
    });
    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 42_000, 90_000);
    const stop = await surface.execute({ kind: "stop" });
    expect(stop.kind).toBe("executed");
    expect(["stopped", "failed"]).toContain(outcome.controller.state().phase);
  });
});

// ---------------------------------------------------------------------------
// The scrub model (direct manipulation over truthful evidence)
// ---------------------------------------------------------------------------

describe("R24 native player affordance parity — the scrub model", () => {
  const playingState = {
    sessionId: "wfxps_1",
    itemId: R23_ITEM,
    mode: "native" as const,
    realization: {
      mode: "native" as const,
      connectorId: "authorized-peer-copy",
      capabilities: ["playNative"],
    },
    phase: "playing" as const,
    positionMs: 120_000,
    bufferedMs: 60_000,
    durationMs: 600_000,
    createdAt: "2026-09-21T10:00:00.000Z",
  };

  it("derives the model from the playback state's own numbers", () => {
    const model = playerScrubModelOf(playingState, [
      { title: "Opening", startMs: 0 },
      { title: "The middle chapter", startMs: 300_000 },
    ]);
    expect(model.positionMs).toBe(120_000);
    expect(model.bufferedMs).toBe(60_000);
    expect(model.durationMs).toBe(600_000);
    expect(model.chapters.length).toBe(2);
  });

  it("previews the scrub target with the current chapter (the last marker at/before the target)", () => {
    const model = playerScrubModelOf(playingState, [
      { title: "Opening", startMs: 0 },
      { title: "The middle chapter", startMs: 300_000 },
      { title: "Finale", startMs: 500_000 },
    ]);
    const before = playerScrubPreview(model, 150_000);
    expect(before.chapter?.title).toBe("Opening");
    const middle = playerScrubPreview(model, 420_000);
    expect(middle.chapter?.title).toBe("The middle chapter");
    const finale = playerScrubPreview(model, 999_999);
    expect(finale.targetMs).toBe(600_000); // clamped to the duration
    expect(finale.chapter?.title).toBe("Finale");
    expect(finale.label).toContain("10:00");
  });

  it("answers playable inside the verified runway and behind the position", () => {
    const model = playerScrubModelOf(playingState);
    expect(playerScrubPlayability(model, 130_000).kind).toBe("playable"); // inside the runway
    expect(playerScrubPlayability(model, 60_000).kind).toBe("playable"); // behind the position
    expect(playerScrubPlayability(model, 180_000).kind).toBe("playable"); // the runway's edge
  });

  it("answers the honest needs-verified-range truth beyond the runway on the native rung", () => {
    const model = playerScrubModelOf(playingState);
    const beyond = playerScrubPlayability(model, 400_000);
    expect(beyond.kind).toBe("needs-verified-range");
    if (beyond.kind === "needs-verified-range") {
      expect(beyond.detail).toContain("isn't fetched yet");
      expect(beyond.detail).toContain("download");
    }
  });

  it("answers playable on the provider rungs (the provider's scrub truth is the provider's own)", () => {
    const providerState = { ...playingState, mode: "embed" as const };
    const model = playerScrubModelOf(providerState);
    expect(playerScrubPlayability(model, 400_000).kind).toBe("playable");
  });

  it("formats the familiar time labels", () => {
    expect(formatPlaybackTime(0)).toBe("0:00");
    expect(formatPlaybackTime(65_000)).toBe("1:05");
    expect(formatPlaybackTime(3_661_000)).toBe("1:01:01");
  });
});

// ---------------------------------------------------------------------------
// The autoplay law (attention-policy-derived)
// ---------------------------------------------------------------------------

describe("R24 native player affordance parity — the autoplay law", () => {
  it("keeps autoplay OFF under Mindful (the user chose restraint — never a silent maximize-time behavior)", () => {
    const view = playerAutoplayAffordanceOf("mindful");
    expect(view.enabledByDefault).toBe(false);
    expect(view.detail).toContain("Mindful");
  });

  it("keeps the familiar default ON under Balanced", () => {
    expect(playerAutoplayAffordanceOf("balanced").enabledByDefault).toBe(true);
  });

  it("keeps autoplay ON under Immersive", () => {
    expect(playerAutoplayAffordanceOf("immersive").enabledByDefault).toBe(true);
  });

  it("answers the user's explicit choice under Custom (off until chosen)", () => {
    expect(playerAutoplayAffordanceOf("custom").enabledByDefault).toBe(false);
    expect(playerAutoplayAffordanceOf("custom").detail).toContain("custom");
  });
});

// ---------------------------------------------------------------------------
// The session queue + the up-next projection
// ---------------------------------------------------------------------------

describe("R24 native player affordance parity — the session queue", () => {
  it("enqueues in order, deduplicates, removes, and reorders within bounds", () => {
    const boot = bootR23();
    const queue = createDesktopPlayerSessionQueue({ runtime: boot.runtime });

    queue.enqueue({ itemId: "wfxitm_a", title: "First" });
    queue.enqueue({ itemId: "wfxitm_b", title: "Second" });
    queue.enqueue({ itemId: "wfxitm_c", title: "Third" });
    expect(queue.view().map((entry) => entry.itemId)).toEqual(["wfxitm_a", "wfxitm_b", "wfxitm_c"]);

    // Deduplicate: the same item never queues twice.
    const dup = queue.enqueue({ itemId: "wfxitm_b", title: "Second" });
    expect(dup.position).toBe(2);
    expect(queue.view().length).toBe(3);

    // Reorder with clamped bounds.
    const moved = queue.move("wfxitm_c", 1);
    expect(moved.moved).toBe(true);
    expect(queue.view().map((entry) => entry.itemId)).toEqual(["wfxitm_c", "wfxitm_a", "wfxitm_b"]);
    const clamped = queue.move("wfxitm_a", 99);
    expect(clamped.view.map((entry) => entry.itemId)).toEqual(["wfxitm_c", "wfxitm_b", "wfxitm_a"]);

    // Remove.
    const removed = queue.remove("wfxitm_b");
    expect(removed.removed).toBe(true);
    expect(queue.view().map((entry) => entry.itemId)).toEqual(["wfxitm_c", "wfxitm_a"]);
    expect(queue.remove("wfxitm_zzz").removed).toBe(false);
  });

  it("plays the head through the composition's own play action and shifts it (the queue owns ordering only)", async () => {
    const boot = bootR23();
    const queue = createDesktopPlayerSessionQueue({ runtime: boot.runtime });
    queue.enqueue({ itemId: "wfxitm_a", title: "First" });
    queue.enqueue({ itemId: "wfxitm_b", title: "Second" });

    const played: string[] = [];
    const outcome = await queue.playNext({
      play: async (entry) => {
        played.push(entry.itemId);
        // The composition's own play action resolves through the runtime —
        // the SAME path the primary play performs (here: the peer copy).
        const started = await boot.whereToWatch.playPeerCopy(entry.itemId === R23_ITEM ? R23_ITEM : "wfxitm_nothing");
        return started.kind === "started"
          ? { ok: true, detail: "Playing through the same path." }
          : { ok: false, detail: `no way to watch '${entry.title}'` };
      },
    });
    // wfxitm_a is not offered as a peer copy → the honest failure, and the
    // entry STAYS queued (a failed play-through never drops the entry).
    expect(outcome.kind).toBe("failed");
    expect(queue.view().map((entry) => entry.itemId)).toEqual(["wfxitm_a", "wfxitm_b"]);

    // Now queue the REAL peer-copy item: the play-through succeeds through
    // the composition's own action and the head shifts.
    queue.enqueue({ itemId: R23_ITEM, title: R23_TITLE });
    queue.move(R23_ITEM, 1);
    const started = await queue.playNext({
      play: async (entry) => {
        const result = await boot.whereToWatch.playPeerCopy(entry.itemId);
        return result.kind === "started"
          ? { ok: true, detail: `Playing ${entry.title} through the authorized peer copy.` }
          : { ok: false, detail: result.kind };
      },
    });
    expect(started.kind).toBe("started");
    if (started.kind === "started") {
      expect(started.entry.itemId).toBe(R23_ITEM);
      expect(started.detail).toContain("peer copy");
    }
    expect(queue.view().map((entry) => entry.itemId)).toEqual(["wfxitm_a", "wfxitm_b"]);
  });

  it("answers the honest empty truth when nothing is queued", async () => {
    const boot = bootR23();
    const queue = createDesktopPlayerSessionQueue({ runtime: boot.runtime });
    const outcome = await queue.playNext({
      play: async () => ({ ok: true, detail: "never called" }),
    });
    expect(outcome.kind).toBe("empty");
  });

  it("saves the queue into the Library watchlist through the runtime's own write (the durable bridge)", async () => {
    const boot = bootR23();
    // Register both items through the runtime's own path (a scripted search
    // hit per item — the library's own law: unknown items cannot be saved),
    // capturing the canonical ids the search itself joined them to.
    boot.server.scriptSearch("queued one", {
      ok: true,
      value: [{ connectorId: "authorized-peer-copy", externalRef: "vault:q1", title: "Queued one" }],
    });
    boot.server.scriptSearch("queued two", {
      ok: true,
      value: [{ connectorId: "authorized-peer-copy", externalRef: "vault:q2", title: "Queued two" }],
    });
    const searchOne = await boot.runtime.search({ query: "queued one" });
    const searchTwo = await boot.runtime.search({ query: "queued two" });
    const queuedOne = searchOne.hits[0]?.canonicalItemId;
    const queuedTwo = searchTwo.hits[0]?.canonicalItemId;
    expect(queuedOne).toBeString();
    expect(queuedTwo).toBeString();

    const queue = createDesktopPlayerSessionQueue({ runtime: boot.runtime });
    queue.enqueue({ itemId: queuedOne!, title: "Queued one" });
    queue.enqueue({ itemId: queuedTwo!, title: "Queued two" });

    const save = await queue.saveQueueToWatchlist();
    expect(save.saved.length).toBe(2);
    expect(save.saved.every((item) => item.ok)).toBe(true);
    expect(save.detail).toContain("Library");

    // The watchlist carries the entries (the runtime's own local view).
    const entryIds = boot.runtime.libraryOps.entries().map((entry) => entry.itemId);
    expect(entryIds).toContain(queuedOne!);
    expect(entryIds).toContain(queuedTwo!);

    // The queue itself stays (saving is additive, the session keeps its order).
    expect(queue.view().length).toBe(2);
  });

  it("answers the honest per-item failure when a queued item was never browsed (never a silent success)", async () => {
    const boot = bootR23();
    const queue = createDesktopPlayerSessionQueue({ runtime: boot.runtime });
    const neverBrowsed = "wfxitm_0000000000000000000000X999";
    queue.enqueue({ itemId: neverBrowsed, title: "Never browsed" });

    const save = await queue.saveQueueToWatchlist();
    expect(save.saved.length).toBe(1);
    expect(save.saved[0]?.ok).toBe(false);
    expect(save.detail).toContain("stayed honest");
  });
});

describe("R24 native player affordance parity — the up-next projection", () => {
  it("projects the queue head with the autoplay truth", () => {
    const autoplay = playerAutoplayAffordanceOf("balanced");
    const withNext = playerUpNextView(
      [
        { position: 1, itemId: "wfxitm_next", title: "The next thing" },
        { position: 2, itemId: "wfxitm_after", title: "After that" },
      ],
      autoplay,
      true,
    );
    expect(withNext.next?.title).toBe("The next thing");
    expect(withNext.detail).toContain("plays automatically");

    const withoutAutoplay = playerUpNextView(
      [{ position: 1, itemId: "wfxitm_next", title: "The next thing" }],
      autoplay,
      false,
    );
    expect(withoutAutoplay.detail).not.toContain("automatically");

    const empty = playerUpNextView([], autoplay, true);
    expect(empty.next).toBeNull();
    expect(empty.detail).toContain("Nothing is queued");
  });
});

// ---------------------------------------------------------------------------
// The composed surface (the composition root's binding)
// ---------------------------------------------------------------------------

describe("R24 native player affordance parity — the composed surface", () => {
  it("binds the affordance map, the keyboard grammar, the scrub model, the queue, and the cast truth over one runtime", async () => {
    const boot = bootR23();
    const surface = createDesktopPlayerAffordanceSurface({
      runtime: boot.runtime,
      capabilities: boot.capabilities,
      casting: desktopDeviceCapabilities(boot.capabilities).casting,
    });

    expect(surface.affordances("native").length).toBe(PLAYER_AFFORDANCE_KINDS.length);
    expect(surface.keyboardBindings().length).toBeGreaterThanOrEqual(24);
    expect(surface.keyboardCommandOf({ key: "k" })).toEqual({ kind: "toggle-play-pause" });
    expect(surface.castAffordance().available).toBe(false);
    expect(surface.queue.view()).toEqual([]);

    const autoplay = surface.autoplayAffordance("mindful");
    expect(autoplay.enabledByDefault).toBe(false);

    const upNext = surface.upNext(autoplay, false);
    expect(upNext.next).toBeNull();

    // The scrub model over a real session (null before one exists).
    expect(surface.scrubModel("wfxps_nonexistent")).toBeNull();
    const outcome = await boot.whereToWatch.playPeerCopy(R23_ITEM);
    expect(outcome.kind).toBe("started");
    if (outcome.kind !== "started") return;
    nativeEvent(boot.nativeMedia, lastNativeSessionId(boot.nativeMedia), "playing", 10_000, 45_000);
    const model = surface.scrubModel(outcome.playbackSessionId);
    expect(model).not.toBeNull();
    expect(model?.positionMs).toBe(10_000);
    expect(model?.bufferedMs).toBe(45_000);
  });

  it("exposes the same surface through the r24 composition (the audit's verification target)", () => {
    const boot = bootR23();
    const surface = createDesktopPlayerAffordanceSurface({
      runtime: boot.runtime,
      capabilities: boot.capabilities,
      casting: desktopDeviceCapabilities(boot.capabilities).casting,
    });
    // The familiar grammar is COMPLETE on the native path: every affordance
    // kind has an honest view, every binding parses, the cast absence is
    // the platform's own truth.
    const map = surface.affordances("native");
    expect(map.length).toBe(PLAYER_AFFORDANCE_KINDS.length);
    for (const view of map) {
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.detail.length).toBeGreaterThan(20);
      expect(view.placement.length).toBeGreaterThan(0);
    }
  });
});
