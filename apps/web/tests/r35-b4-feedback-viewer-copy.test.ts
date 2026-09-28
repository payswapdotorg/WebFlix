/**
 * R35 — the B4 regression test (the anonymous feedback failure's
 * viewer-facing copy + the sign-in recovery path; the
 * adapter-api-routes.test.ts service-stub house style).
 *
 * THE R34-A LEDGER'S B4 ROW: the anonymous recommendation-feedback submit
 * rendered the service's raw typed error VERBATIM in the failure element
 * — `{"error":"invalid-request","detail":"x-wfx-user-id: required
 * identity header is absent (identity travels as headers, never in
 * URLs)"}` — honest (never a fake success — the honesty law held) but
 * ENGINEERING-GRADE copy on a viewer-facing surface, with no
 * user-facing recovery path (the sign-in upgrade) offered.
 *
 * THE R35 LAW THIS TEST PINS (both sides of the transport):
 *   1. THE ROUTE: the service's identity-absent 400 maps to the closed
 *      `identity-required` code (status stays the honest 400 — never a
 *      fake success); the typed detail rides the response's `detail`
 *      field (the network tab keeps the engineer's evidence). On main
 *      the raw service body rode `error` VERBATIM — the exact string the
 *      failure element rendered.
 *   2. THE ROUTE: a non-identity service failure answers the honest
 *      viewer prose — never the raw JSON body.
 *   3. THE CLIENT: the failure element renders the viewer copy + the
 *      SIGN-IN RECOVERY PATH (the `/settings?section=general` entry);
 *      the raw typed error NEVER renders; a raw-JSON body (a shape the
 *      law never wrote) renders the honest generic prose instead.
 *
 * THE SERVICE STUB answers EXACTLY what the production API service
 * answered in the R34-A walk (the ledger's verbatim quote — the API's
 * own `badRequest` shape), through the REAL route handler.
 *
 * The route-side blocks import only main-existing modules (the regression
 * fails at the defect assertion on main); the client-side rendering
 * blocks dynamically import the lane-new `FeedbackFailure` export (on
 * main that block errors with export-not-found — the law did not exist —
 * recorded honestly here).
 *
 * Determinism: the service-mode boot under a controlled env + the fetch
 * stub (restored), no real network.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { resetWebHostProcessState } from "../src/host/testing";
import { getWebRuntimeHost } from "../src/host/web-host";
import { POST as postFeedback } from "../src/app/api/feedback/route";
import { withEnv, withFetchStub } from "./fake-web";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The service's identity-absent 400 — EXACTLY the body the production
 * API answered in the R34-A walk (the ledger's verbatim quote: the API's
 * own `badRequest` shape, `x-wfx-user-id: required identity header is
 * absent (identity travels as headers, never in URLs)`).
 */
function identityAbsent400(): Response {
  return new Response(
    JSON.stringify({
      error: "invalid-request",
      detail:
        "x-wfx-user-id: required identity header is absent (identity travels as headers, never in URLs)",
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

/** A syntactically-valid canonical item id (the control's target shape). */
const TARGET = "wfxitm_01j8tg2h7qkx4z9d3v6nme0a5b";

/** POST one JSON body to a route handler (the real handler, no network). */
async function post(handler: (request: Request) => Promise<Response>, body: unknown): Promise<Response> {
  return handler(
    new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  resetWebHostProcessState();
});

// ---------------------------------------------------------------------------
// The regression probe — the route side (fails on main at the defect)
// ---------------------------------------------------------------------------

describe("R35 (B4) — the anonymous feedback failure answers viewer-facing copy (never the raw typed error)", () => {
  it("the service's identity-absent 400 → the closed code + the typed detail rides the body (status stays the honest 400)", async () => {
    await withEnv({ WFX_API_BASE: "https://api.example" }, async () => {
      await withFetchStub(
        () => identityAbsent400(),
        async () => {
          await getWebRuntimeHost(); // the service-mode boot (the stub answers its transport)
          const response = await post(postFeedback, { kind: "not-interested", target: TARGET });
          // The honest typed failure — NEVER a fake success.
          expect(response.status).toBe(400);
          const body = (await response.json()) as { error: string; detail?: string };
          // THE B4 DEFECT: on main `error` WAS the raw service JSON
          // verbatim — the exact string the failure element rendered.
          expect(body.error).not.toContain("x-wfx-user-id"); // ← FAILS ON MAIN
          expect(body.error).not.toContain("{"); // ← FAILS ON MAIN (the raw JSON body)
          // The closed code the client's copy law maps.
          expect(body.error).toBe("identity-required");
          // The typed truth rides `detail` (the network tab keeps the
          // engineer's evidence — the ledger's own quote, verbatim).
          expect(body.detail).toContain("x-wfx-user-id");
          expect(body.detail).toContain("identity travels as headers");
        },
      );
    });
  });

  it("a non-identity service failure answers the honest viewer prose — never the raw JSON body", async () => {
    await withEnv({ WFX_API_BASE: "https://api.example" }, async () => {
      await withFetchStub(
        () =>
          new Response(JSON.stringify({ ok: false, detail: "service boot failed" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          }),
        async () => {
          await getWebRuntimeHost();
          const response = await post(postFeedback, { kind: "not-interested", target: TARGET });
          expect(response.status).toBe(502); // the service's own typed status
          const body = (await response.json()) as { error: string; detail?: string };
          // On main `error` was the raw `{"ok":false,"detail":"service boot failed"}`.
          expect(body.error).toBe("the feedback control could not be saved right now — retry in a moment"); // ← FAILS ON MAIN
          expect(body.error).not.toContain("{");
          // The typed detail still rides along (the engineer's evidence).
          expect(body.detail).toContain("service boot failed");
        },
      );
    });
  });

  // -------------------------------------------------------------------------
  // The client side — the failure element's copy + recovery path (the
  // FeedbackFailure export is lane-new: on main these blocks error with
  // export-not-found — the law did not exist — recorded honestly).
  // -------------------------------------------------------------------------

  it("the failure element renders the viewer copy + the sign-in recovery path (never the raw typed error)", async () => {
    const { FeedbackFailure } = await import("../src/components/discovery/FeedbackControls");
    const markup = renderToStaticMarkup(
      createElement(FeedbackFailure, {
        failure: {
          error: "identity-required",
          detail:
            "x-wfx-user-id: required identity header is absent (identity travels as headers, never in URLs)",
        },
      }),
    );
    // The failure element's own laws: alert semantics + the B4 markers.
    expect(markup).toContain("data-wfx-feedback-failure");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-wfx-feedback-identity-required="true"');
    // THE SIGN-IN RECOVERY PATH (the ledger's missing half): the entry
    // the player's progress-scope row offers — the app's one sign-in surface.
    expect(markup).toContain("data-wfx-feedback-signin");
    expect(markup).toContain('href="/settings?section=general"');
    expect(markup).toContain("Sign in");
    // The honest copy: what failed + what the recovery does.
    expect(markup).toContain("This feedback wasn&#x27;t recorded");
    expect(markup).toContain("WebFlix saves recommendation feedback with a session");
    // THE B4 DEFECT'S OTHER HALF: the raw typed error NEVER renders.
    expect(markup).not.toContain("x-wfx-user-id");
    expect(markup).not.toContain("invalid-request");
    expect(markup).not.toContain("{");
  });

  it("a raw-JSON body (a shape the law never wrote) renders the honest generic prose — never raw JSON on the surface", async () => {
    const { FeedbackFailure } = await import("../src/components/discovery/FeedbackControls");
    const markup = renderToStaticMarkup(
      createElement(FeedbackFailure, {
        // The pre-R35 passthrough shape: the whole service body in `error`.
        failure: { error: '{"error":"invalid-request","detail":"x-wfx-user-id: absent"}' },
      }),
    );
    expect(markup).toContain("data-wfx-feedback-failure");
    expect(markup).toContain("the feedback could not be saved right now");
    expect(markup).not.toContain("x-wfx-user-id");
    expect(markup).not.toContain("invalid-request");
    // No sign-in offer on the generic path (the recovery path is the
    // identity class's own — never a wrong-class fabrication).
    expect(markup).not.toContain("data-wfx-feedback-signin");
  });
});
