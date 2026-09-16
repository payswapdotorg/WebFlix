/**
 * R08 — SharingPort over the OS share sheet (shell simulator).
 *
 * The honesty laws: shared/dismissed/failed are distinct (a dismissal is
 * NOT a failure), canShare is truthful per request and per platform, and
 * a platform without a share sheet answers honestly unsupported — never a
 * fake share.
 */

import { describe, expect, it } from "bun:test";

import { createShellSharingPort } from "../src/platform/sharing";
import { SimShell } from "./shell-simulator";

describe("R08 — desktop OS sharing", () => {
  it("a real handoff answers shared; the request reaches the OS sheet", async () => {
    const shell = new SimShell();
    const sharing = createShellSharingPort(shell);
    const request = {
      title: "The Signal",
      url: "https://provider.example/watch/42",
      itemId: "wfxitm_0000000000000000000000ABCD",
    };
    expect(await sharing.canShare(request)).toBe(true);
    const outcome = await sharing.share(request);
    expect(outcome).toEqual({ outcome: "shared" });
    expect(shell.shareRequests[0]?.title).toBe("The Signal");
  });

  it("a user dismissal of the sheet is the distinct dismissed outcome — not a failure", async () => {
    const shell = new SimShell();
    shell.nextShareOutcome = { outcome: "dismissed" };
    const sharing = createShellSharingPort(shell);
    const outcome = await sharing.share({ title: "The Signal", url: "https://provider.example/w" });
    expect(outcome).toEqual({ outcome: "dismissed" });
  });

  it("a broken channel answers failed with the honest detail", async () => {
    const shell = new SimShell();
    shell.nextShareOutcome = { outcome: "failed", detail: "the OS share service crashed" };
    const sharing = createShellSharingPort(shell);
    const outcome = await sharing.share({ title: "The Signal", url: "https://provider.example/w" });
    expect(outcome).toEqual({ outcome: "failed", detail: "the OS share service crashed" });
  });

  it("canShare is truthful per request: nothing to present answers false", async () => {
    const sharing = createShellSharingPort(new SimShell());
    expect(await sharing.canShare({ title: "Only a title" })).toBe(false);
    expect(await sharing.canShare({ title: "", url: "https://provider.example/w" })).toBe(false);
    expect(await sharing.canShare({ title: "OK", text: "watch this" })).toBe(true);
  });

  it("sharing without presentable content fails honestly (never a fake share)", async () => {
    const sharing = createShellSharingPort(new SimShell());
    const outcome = await sharing.share({ title: "Only a title" });
    expect(outcome.outcome).toBe("failed");
    if (outcome.outcome === "failed") {
      expect(outcome.detail).toContain("non-empty title plus text or url");
    }
  });

  it("a platform without an OS share sheet answers honest unsupported through canShare", async () => {
    // The Linux-like truth: no standard share sheet exists.
    const shell = new SimShell({ shareSheetPresent: false });
    const sharing = createShellSharingPort(shell);
    const request = { title: "The Signal", url: "https://provider.example/w" };
    expect(await sharing.canShare(request)).toBe(false);
    // Reaching share anyway surfaces the honest failed-with-detail (the
    // caller that pre-checked canShare never lands here).
    const outcome = await sharing.share(request);
    expect(outcome.outcome).toBe("failed");
    if (outcome.outcome === "failed") {
      expect(outcome.detail).toContain("no OS share sheet");
    }
  });
});
