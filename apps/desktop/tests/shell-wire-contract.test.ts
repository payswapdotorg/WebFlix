/**
 * R20-W3 — the shell WIRE-contract law (source inspection).
 *
 * WHY THIS TEST EXISTS: the native shell is source-delivered (no cargo in
 * this sandbox — the documented R08-R19 doctrine), so the Rust serde wire
 * shapes cannot be EXECUTED here; the shell simulator proves the TS side
 * against the frozen `ShellIpc` contract, not the Rust serialization.
 * The R20-W3 verification pass found exactly the defect class that gap
 * hides:
 *
 * serde's DERIVED internally-tagged enum (a `serde(tag = "...")`
 * attribute) serializes the VARIANT NAME as the tag's value — the wire
 * would carry `"picked": "notPicked"`, but the frozen TS
 * `ShellFilePickOutcome` union discriminates on a BOOLEAN. The TS fold
 * `if (!pick.picked)` reads ANY truthy tag as a pick, so a DISMISSED
 * dialog would dereference a missing `file` and surface as a spurious
 * `failed` verdict on the real shell. The same idiom on
 * `ShellNotifyOutcome` (`"delivered": "notDelivered"`) would fabricate
 * `{ delivered: true }` for permission-denied notifications — the exact
 * opposite of the delivery truth law.
 *
 * THE LAW (ipc.rs, enforced here): a BOOLEAN-discriminant TS union
 * crossing the seam is serialized by a MANUAL `Serialize` impl that
 * emits the boolean tag exactly — never a derived tagged enum. More
 * generally, ipc.rs carries NO tagged enum at all: every wire shape is
 * either a plain struct (possibly with a string discriminant field, like
 * `ShellShareOutcome`) or a manual boolean-union impl. If a future type
 * needs a tagged enum, it must be proven to match its frozen TS union
 * and THIS test extended consciously — never silently.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const IPC_RS = fileURLToPath(new URL("../shell/src-tauri/src/ipc.rs", import.meta.url));

function ipcSource(): string {
  return readFileSync(IPC_RS, "utf8");
}

describe("R20-W3 — the shell wire-contract law (boolean-discriminant unions)", () => {
  it("the pick outcome serializes the frozen TS boolean union (manual Serialize, boolean tag)", () => {
    const source = ipcSource();

    // The broken derived idiom is absent for this union...
    expect(source).not.toContain('serde(tag = "picked"');
    // ...and the manual impl emits the boolean discriminant EXACTLY.
    expect(source).toContain("impl Serialize for ShellFilePickOutcome");
    expect(source).toContain('serialize_entry("picked", &true)');
    expect(source).toContain('serialize_entry("picked", &false)');
  });

  it("the notify outcome serializes the frozen TS boolean union (manual Serialize, boolean tag)", () => {
    const source = ipcSource();

    expect(source).not.toContain('serde(tag = "delivered"');
    expect(source).toContain("impl Serialize for ShellNotifyOutcome");
    expect(source).toContain('serialize_entry("delivered", &true)');
    expect(source).toContain('serialize_entry("delivered", &false)');
  });

  it("NO serde tagged enum rides the seam uninspected (the closed inventory law)", () => {
    const source = ipcSource();
    const tagged = source.match(/#\[serde\(tag = /g) ?? [];

    // The seam's wire shapes are plain structs (string discriminants
    // included — see ShellShareOutcome/ShellTaskOutcome) plus the two
    // manual boolean-union impls above. A derived tagged enum is never
    // the shell's idiom for this seam: its string tag cannot match a
    // boolean union, and matching a string-discriminant union exactly is
    // a decision this test forces into the open. Zero by law.
    expect(tagged.length).toBe(0);
  });
});
