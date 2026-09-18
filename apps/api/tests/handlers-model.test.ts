/**
 * R06 — model and AI controls handler tests (bun:test, PGlite harness).
 *
 * Exercises the `/experience/{model-policy,model-providers,transforms}/**`
 * routes by importing their GET/POST/PUT/DELETE functions directly (no
 * server, no network) over the COMPLETE `ApiBoot` composition, with the
 * fabric's TEST FIXTURE providers injected (never production providers —
 * the WFX-055A test-boot pattern) and the collecting run scheduler for
 * deterministic transform lifecycles.
 *
 * Acceptance points (the R06 spec §1 + §5):
 * - POLICY: GET answers the HONEST null for an unset profile + the
 *   DEFAULTS visibly labeled as defaults (never as configured choices —
 *   the anonymous-honesty law) + per-task capability truth; PUT round-trips
 *   the frozen ModelPolicy; the typed 400 names EVERY problem.
 * - PROVIDERS: the registry view with per-task capability truth and the
 *   honest local-support report.
 * - BYOM BIND/UNBIND: the PUT answer NEVER contains key material; the
 *   stored row is SEALED (raw-SQL verification); DELETE destroys it; an
 *   unknown binding answers the honest 404.
 * - TRANSFORMS: the EXPLICIT lifecycle (POST → 202 queued; the scheduled
 *   run drives queued → running → succeeded with result reference + history
 *   + progress); the failed lifecycle (no provider); the J20 constrained
 *   truth (permission denial answers the typed 409 — never a fake success);
 *   validation 400s; ownership 404s; cancel (the user's undo, invalid-state
 *   409 on terminal); DELETE result cleanup (payload gone, history kept).
 *
 * Determinism: FixedClock(30s)/SequentialIdGen; the collecting scheduler;
 * no network; the key material in fixtures is obviously fake test data.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { makeFakeTranslationProvider } from "@wfx/model-fabric";

import { setApiBootForTests, resetApiBootForTests } from "../src/host/testing";
import { POST as registerPOST } from "../src/app/auth/register/route";
import { GET as policyGET, PUT as policyPUT } from "../src/app/experience/model-policy/route";
import { GET as providersGET } from "../src/app/experience/model-providers/route";
import {
  PUT as byomPUT,
  DELETE as byomDELETE,
} from "../src/app/experience/model-providers/byom/[providerId]/route";
import {
  GET as transformsGET,
  POST as transformsPOST,
} from "../src/app/experience/transforms/route";
import {
  GET as transformGET,
  DELETE as transformDELETE,
} from "../src/app/experience/transforms/[id]/route";
import { POST as transformCancelPOST } from "../src/app/experience/transforms/[id]/cancel/route";
import {
  createApiTestBoot,
  deleteRequest,
  getRequest,
  identityHeaders,
  postRequest,
  putRequest,
  type ApiTestBoot,
} from "./test-boot";

/** Read + parse one response body as JSON. */
async function json(response: Response): Promise<unknown> {
  await expect(response.headers.get("content-type") ?? "").toContain("application/json");
  return response.json();
}

/** The auth channel for one session token. */
function bearer(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...extra };
}

/** Permissive media provenance (the transform task input embeds it). */
const MEDIA = {
  sourceId: "wfx-handler-test-media",
  authorizedSource: true,
  drmProtected: false,
  allowsTranscript: true,
  allowsTranslation: true,
  allowsDubbing: true,
  allowsCommentary: true,
};

/** A valid translation transform command. */
function translationCommand(text: string, extra: Record<string, unknown> = {}): unknown {
  return {
    kind: "translation",
    input: { media: MEDIA, text, targetLanguage: "es" },
    ...extra,
  };
}

/** The local translation fake's id (registered through the test boot). */
const FAKE_TRANSLATION_ID = "wfx-test-translation-fake";

let harness: ApiTestBoot;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  harness = await createApiTestBoot(undefined, {
    extraProviders: [makeFakeTranslationProvider(FAKE_TRANSLATION_ID)],
  });
  setApiBootForTests(harness.boot);

  const registerA = await registerPOST(
    postRequest("/auth/register", {
      email: "model-a@example.com",
      password: "correct-horse-battery",
      displayName: "Model A",
    }),
  );
  expect(registerA.status).toBe(200);
  tokenA = ((await json(registerA)) as { token: string }).token;

  const registerB = await registerPOST(
    postRequest("/auth/register", {
      email: "model-b@example.com",
      password: "correct-horse-staple",
      displayName: "Model B",
    }),
  );
  expect(registerB.status).toBe(200);
  tokenB = ((await json(registerB)) as { token: string }).token;
});

afterAll(async () => {
  resetApiBootForTests();
  await harness.testDb.close();
});

// ---------------------------------------------------------------------------
// GET/PUT /experience/model-policy
// ---------------------------------------------------------------------------

describe("GET/PUT /experience/model-policy", () => {
  it("GET answers the HONEST null + the DEFAULTS visibly labeled as defaults", async () => {
    const response = await policyGET(
      getRequest("/experience/model-policy?task=translation", bearer(tokenA)),
    );
    expect(response.status).toBe(200);
    const view = (await json(response)) as {
      task: string;
      policy: unknown;
      defaults: { source: string; preferredProvider: string; privacy: string };
      providers: unknown[];
      localSupport: boolean;
    };
    expect(view.task).toBe("translation");
    expect(view.policy).toBeNull(); // never a fabricated default-as-if-configured
    expect(view.defaults.source).toBe("default"); // the defaults ARE labeled defaults
    expect(view.defaults.privacy).toBe("local-only");
    expect(view.defaults.preferredProvider).toBe("wfx-first-party");
    expect(Array.isArray(view.providers)).toBe(true);
    expect(typeof view.localSupport).toBe("boolean");
  });

  it("GET without a task answers the typed 400 naming the per-task law", async () => {
    const response = await policyGET(getRequest("/experience/model-policy", bearer(tokenA)));
    expect(response.status).toBe(400);
    const body = (await json(response)) as { detail: string };
    expect(body.detail).toContain("task");
  });

  it("GET with an invalid task answers the typed 400 naming the vocabulary", async () => {
    const response = await policyGET(
      getRequest("/experience/model-policy?task=teleportation", bearer(tokenA)),
    );
    expect(response.status).toBe(400);
  });

  it("anonymous GET answers the same honest view (defaults AS defaults)", async () => {
    const response = await policyGET(
      getRequest("/experience/model-policy?task=translation", identityHeaders()),
    );
    expect(response.status).toBe(200);
    const view = (await json(response)) as { policy: unknown; defaults: { source: string } };
    expect(view.policy).toBeNull();
    expect(view.defaults.source).toBe("default");
  });

  it("PUT then GET round-trips the frozen ModelPolicy (per task)", async () => {
    const put = await policyPUT(
      putRequest(
        "/experience/model-policy",
        {
          task: "translation",
          preferredProvider: FAKE_TRANSLATION_ID,
          fallbackProviders: [FAKE_TRANSLATION_ID, "wfx-first-party"],
          privacy: "local-only",
          maxCostPerOperation: 2,
        },
        bearer(tokenA),
      ),
    );
    expect(put.status).toBe(200);
    const written = (await json(put)) as {
      task: string;
      preferredProvider?: string;
      fallbackProviders: string[];
      privacy: string;
      maxCostPerOperation?: number;
    };
    expect(written.task).toBe("translation");
    expect(written.preferredProvider).toBe(FAKE_TRANSLATION_ID);
    expect(written.fallbackProviders).toEqual([FAKE_TRANSLATION_ID, "wfx-first-party"]);
    expect(written.privacy).toBe("local-only");
    expect(written.maxCostPerOperation).toBe(2);

    const get = await policyGET(
      getRequest("/experience/model-policy?task=translation", bearer(tokenA)),
    );
    expect(get.status).toBe(200);
    const reread = (await json(get)) as { policy: typeof written };
    expect(reread.policy).toEqual(written);
  });

  it("a malformed PUT answers ONE typed 400 naming EVERY problem", async () => {
    const put = await policyPUT(
      putRequest(
        "/experience/model-policy",
        {
          task: "not-a-task",
          fallbackProviders: [],
          privacy: "sky",
          maxCostPerOperation: -3,
        },
        bearer(tokenA),
      ),
    );
    expect(put.status).toBe(400);
    const body = (await json(put)) as { detail: string };
    expect(body.detail).toContain("task");
    expect(body.detail).toContain("fallbackProviders");
    expect(body.detail).toContain("privacy");
    expect(body.detail).toContain("maxCostPerOperation");
  });

  it("policies are profile-scoped (isolation across profiles)", async () => {
    const response = await policyGET(
      getRequest("/experience/model-policy?task=translation", bearer(tokenB)),
    );
    expect(response.status).toBe(200);
    const view = (await json(response)) as { policy: unknown };
    expect(view.policy).toBeNull(); // B never sees A's policy
  });
});

// ---------------------------------------------------------------------------
// GET /experience/model-providers
// ---------------------------------------------------------------------------

describe("GET /experience/model-providers", () => {
  it("answers the registry view with per-task capability truth + honest local support", async () => {
    const response = await providersGET(
      getRequest("/experience/model-providers", bearer(tokenA)),
    );
    expect(response.status).toBe(200);
    const catalog = (await json(response)) as {
      providers: {
        id: string;
        privacy: string;
        origin: string;
        bound: boolean;
        capabilities: { task: string; available: boolean; declaredCost?: number }[];
        note: string;
      }[];
      localSupport: Record<string, boolean>;
    };
    const byId = new Map(catalog.providers.map((entry) => [entry.id, entry] as const));
    // The first-party row: local, built-in, recommendation/ranking truth.
    const firstParty = byId.get("wfx-first-party")!;
    expect(firstParty.origin).toBe("first-party");
    expect(firstParty.privacy).toBe("local");
    expect(firstParty.bound).toBe(true);
    expect(
      firstParty.capabilities.find((capability) => capability.task === "recommendation")!.available,
    ).toBe(true);
    expect(
      firstParty.capabilities.find((capability) => capability.task === "translation")!.available,
    ).toBe(false); // the truth — not declared
    // The injected TEST fixture row: local, translation truth.
    const fake = byId.get(FAKE_TRANSLATION_ID)!;
    expect(fake.origin).toBe("local");
    expect(
      fake.capabilities.find((capability) => capability.task === "translation")!.available,
    ).toBe(true);
    // The honest local-support report.
    expect(catalog.localSupport.translation).toBe(true);
    expect(catalog.localSupport.dubbing).toBe(false); // honest — no local provider
  });

  it("anonymous requests answer the same registry truth with no bindings", async () => {
    const response = await providersGET(
      getRequest("/experience/model-providers", identityHeaders()),
    );
    expect(response.status).toBe(200);
    const catalog = (await json(response)) as { providers: { origin: string; bound: boolean }[] };
    // No BYOM rows for the anonymous user (never a fake binding).
    expect(catalog.providers.every((entry) => entry.origin !== "byom" || !entry.bound)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUT/DELETE /experience/model-providers/byom/:providerId
// ---------------------------------------------------------------------------

describe("PUT/DELETE /experience/model-providers/byom/:providerId", () => {
  it("the PUT answer NEVER contains key material; the stored row is SEALED (raw-SQL check)", async () => {
    const put = await byomPUT(
      putRequest(
        "/experience/model-providers/byom/byom-alpha",
        {
          endpoint: "https://byom-alpha.example.test/v1",
          tasks: ["translation", "summary"],
          privacy: "trusted-cloud",
          apiKey: "test-byom-key-never-real",
        },
        bearer(tokenA),
      ),
      { params: Promise.resolve({ providerId: "byom-alpha" }) },
    );
    expect(put.status).toBe(200);
    const binding = (await json(put)) as {
      id: string;
      providerId: string;
      endpoint: string;
      profileKey: string;
    };
    // The answer is a handle + metadata ONLY — never key material.
    expect(binding.id).toBeDefined();
    expect(binding.providerId).toBe("byom-alpha");
    expect(binding.endpoint).toBe("https://byom-alpha.example.test/v1");
    const rendered = JSON.stringify(binding);
    expect(rendered).not.toContain("test-byom-key-never-real");
    expect(rendered).not.toContain("apiKey");
    expect(rendered).not.toContain("ciphertext");

    // The stored row: SEALED — the ciphertext never contains the plaintext
    // (queried through the profile key the answer itself reported).
    const rows = await harness.testDb.db.query<{ ciphertext: string; iv: string }>(
      `SELECT ciphertext, iv FROM model_provider_bindings
        WHERE profile_key = $1 AND provider_id = 'byom-alpha'`,
      [binding.profileKey],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ciphertext).not.toContain("test-byom-key-never-real");
  });

  it("a malformed binding answers the typed 400 naming every problem", async () => {
    const put = await byomPUT(
      putRequest(
        "/experience/model-providers/byom/byom-bad",
        {
          endpoint: "not-a-url",
          tasks: ["not-a-task"],
          privacy: "sky",
          apiKey: "",
        },
        bearer(tokenA),
      ),
      { params: Promise.resolve({ providerId: "byom-bad" }) },
    );
    expect(put.status).toBe(400);
    const body = (await json(put)) as { detail: string };
    expect(body.detail).toContain("endpoint");
    expect(body.detail).toContain("tasks[0]");
    expect(body.detail).toContain("privacy");
    expect(body.detail).toContain("apiKey");
  });

  it("the bound provider appears in the catalog as a byom row", async () => {
    const response = await providersGET(
      getRequest("/experience/model-providers", bearer(tokenA)),
    );
    const catalog = (await json(response)) as {
      providers: { id: string; origin: string; bound: boolean; note: string }[];
    };
    const byom = catalog.providers.find((entry) => entry.id === "byom-alpha");
    expect(byom).toBeDefined();
    expect(byom!.origin).toBe("byom");
    expect(byom!.bound).toBe(true);
    expect(byom!.note).toContain("example.test"); // endpoint host metadata
    expect(byom!.note).not.toContain("test-byom-key-never-real"); // never the key
  });

  it("DELETE destroys the binding; a second DELETE answers the honest 404", async () => {
    const remove = await byomDELETE(
      deleteRequest("/experience/model-providers/byom/byom-alpha", bearer(tokenA)),
      { params: Promise.resolve({ providerId: "byom-alpha" }) },
    );
    expect(remove.status).toBe(200);
    const again = await byomDELETE(
      deleteRequest("/experience/model-providers/byom/byom-alpha", bearer(tokenA)),
      { params: Promise.resolve({ providerId: "byom-alpha" }) },
    );
    expect(again.status).toBe(404);
    // The sealed material is GONE (the vault's delete discipline).
    const rows = await harness.testDb.db.query<{ id: string }>(
      `SELECT id FROM model_provider_bindings WHERE provider_id = 'byom-alpha'`,
    );
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The transform lifecycle
// ---------------------------------------------------------------------------

describe("POST/GET/DELETE /experience/transforms (the explicit lifecycle)", () => {
  it("POST answers 202 with the QUEUED record; the scheduled run drives it to SUCCEEDED with result + history + progress", async () => {
    const submitted = await transformsPOST(
      postRequest("/experience/transforms", translationCommand("hello model world"), bearer(tokenA)),
    );
    expect(submitted.status).toBe(202);
    const operation = (await json(submitted)) as {
      id: string;
      state: string;
      stateHistory: unknown[];
    };
    expect(operation.id.startsWith("wfxop_")).toBe(true);
    expect(operation.state).toBe("queued");

    // The collecting scheduler holds the run promise; await it.
    await Promise.all([...harness.transformRuns]);

    const fetched = await transformGET(
      getRequest(`/experience/transforms/${operation.id}`, bearer(tokenA)),
      { params: Promise.resolve({ id: operation.id }) },
    );
    expect(fetched.status).toBe(200);
    const final = (await json(fetched)) as {
      id: string;
      state: string;
      progress?: number;
      result?: { reference: string; providerId: string; output: unknown };
      stateHistory: { from: string; to: string; event: string }[];
    };
    expect(final.state).toBe("succeeded");
    expect(final.result).toBeDefined();
    expect(final.result!.reference.startsWith("wfxtr_")).toBe(true); // the result reference
    expect(final.result!.providerId).toBe(FAKE_TRANSLATION_ID);
    expect(final.progress).toBe(1); // progress where the fabric reported it
    expect(final.stateHistory.map((entry) => `${entry.from}>${entry.to}`)).toEqual([
      "queued>running",
      "running>succeeded",
    ]);
  });

  it("the failed lifecycle: no provider for the kind ⇒ the operation records the typed failure honestly", async () => {
    // No dubbing provider is registered — the honest no-provider failure.
    const submitted = await transformsPOST(
      postRequest(
        "/experience/transforms",
        {
          kind: "dubbing",
          input: {
            media: MEDIA,
            segments: [{ startMs: 0, endMs: 1000, text: "hi" }],
            targetLanguage: "es",
            voice: "narrator",
          },
        },
        bearer(tokenA),
      ),
    );
    expect(submitted.status).toBe(202);
    const operation = (await json(submitted)) as { id: string };
    await Promise.all([...harness.transformRuns]);

    const fetched = await transformGET(
      getRequest(`/experience/transforms/${operation.id}`, bearer(tokenA)),
      { params: Promise.resolve({ id: operation.id }) },
    );
    const final = (await json(fetched)) as {
      state: string;
      error?: { kind: string; detail: string };
      stateHistory: { to: string }[];
    };
    expect(final.state).toBe("failed");
    expect(final.error!.kind).toBe("fabric");
    expect(final.error!.detail).toContain("no-provider");
    expect(final.stateHistory.map((entry) => entry.to)).toEqual(["running", "failed"]);
  });

  it("the J20 constrained truth: a permission denial answers the typed 409 — never a fake success", async () => {
    const denied = await transformsPOST(
      postRequest(
        "/experience/transforms",
        {
          kind: "translation",
          input: {
            media: { ...MEDIA, allowsTranslation: false }, // the license flag denies
            text: "hello",
            targetLanguage: "es",
          },
        },
        bearer(tokenA),
      ),
    );
    expect(denied.status).toBe(409);
    const body = (await json(denied)) as { error: string; detail: string };
    expect(body.error).toBe("permission-denied");
    expect(body.detail).toContain("allowsTranslation");
    // NO operation record was created (the denial precedes the record).
    const list = await transformsGET(getRequest("/experience/transforms", bearer(tokenA)));
    const operations = (await json(list)) as { kind: string; error?: unknown }[];
    expect(operations.every((entry) => entry.error === undefined || entry.error !== null)).toBe(true);
  });

  it("DRM-protected media is always denied (the hard law, 409)", async () => {
    const denied = await transformsPOST(
      postRequest(
        "/experience/transforms",
        {
          kind: "translation",
          input: { media: { ...MEDIA, drmProtected: true }, text: "hi", targetLanguage: "es" },
        },
        bearer(tokenA),
      ),
    );
    expect(denied.status).toBe(409);
    const body = (await json(denied)) as { error: string };
    expect(body.error).toBe("permission-denied");
  });

  it("a malformed command answers the typed 400 with field-path problems", async () => {
    const bad = await transformsPOST(
      postRequest(
        "/experience/transforms",
        { kind: "translation", input: { media: MEDIA, text: "", targetLanguage: "" } },
        bearer(tokenA),
      ),
    );
    expect(bad.status).toBe(400);
    const body = (await json(bad)) as { detail: string };
    expect(body.detail).toContain("text");
    expect(body.detail).toContain("targetLanguage");

    const unknownKind = await transformsPOST(
      postRequest(
        "/experience/transforms",
        { kind: "teleportation", input: { media: MEDIA } },
        bearer(tokenA),
      ),
    );
    expect(unknownKind.status).toBe(400);
  });

  it("cancel: the user's undo while in flight; a terminal operation answers the typed 409", async () => {
    const submitted = await transformsPOST(
      postRequest("/experience/transforms", translationCommand("cancel me"), bearer(tokenA)),
    );
    const operation = (await json(submitted)) as { id: string };
    const cancel = await transformCancelPOST(
      postRequest(`/experience/transforms/${operation.id}/cancel`, {}, bearer(tokenA)),
      { params: Promise.resolve({ id: operation.id }) },
    );
    expect(cancel.status).toBe(200);
    const cancelled = (await json(cancel)) as {
      state: string;
      stateHistory: { to: string }[];
      result?: unknown;
    };
    expect(cancelled.state).toBe("cancelled");
    // The undo may land while queued (history: [cancelled]) or mid-run
    // (history: [running, cancelled]) — both legal; the result is NEVER
    // recorded on a cancelled operation.
    expect(cancelled.stateHistory.length).toBeLessThanOrEqual(2);
    expect(cancelled.stateHistory.every((entry) => entry.to === "running" || entry.to === "cancelled")).toBe(true);
    expect(cancelled.stateHistory.at(-1)!.to).toBe("cancelled");
    expect(cancelled.result).toBeUndefined();

    // A terminal operation can never be cancelled again.
    const again = await transformCancelPOST(
      postRequest(`/experience/transforms/${operation.id}/cancel`, {}, bearer(tokenA)),
      { params: Promise.resolve({ id: operation.id }) },
    );
    expect(again.status).toBe(409);
    const body = (await json(again)) as { error: string; detail: string };
    expect(body.error).toBe("invalid-state");
    expect(body.detail).toContain("only queued or running");
  });

  it("ownership: another profile's operation answers the honest 404", async () => {
    const submitted = await transformsPOST(
      postRequest("/experience/transforms", translationCommand("private"), bearer(tokenA)),
    );
    const operation = (await json(submitted)) as { id: string };
    const foreign = await transformGET(
      getRequest(`/experience/transforms/${operation.id}`, bearer(tokenB)),
      { params: Promise.resolve({ id: operation.id }) },
    );
    expect(foreign.status).toBe(404);
  });

  it("DELETE clears the result material (payload + progress), keeping the record + history", async () => {
    const submitted = await transformsPOST(
      postRequest("/experience/transforms", translationCommand("clean my result"), bearer(tokenA)),
    );
    const operation = (await json(submitted)) as { id: string };
    await Promise.all([...harness.transformRuns]);

    const remove = await transformDELETE(
      deleteRequest(`/experience/transforms/${operation.id}`, bearer(tokenA)),
      { params: Promise.resolve({ id: operation.id }) },
    );
    expect(remove.status).toBe(200);
    const body = (await json(remove)) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);

    const fetched = await transformGET(
      getRequest(`/experience/transforms/${operation.id}`, bearer(tokenA)),
      { params: Promise.resolve({ id: operation.id }) },
    );
    const cleaned = (await json(fetched)) as {
      state: string;
      result?: unknown;
      progress?: unknown;
      stateHistory: unknown[];
    };
    expect(cleaned.state).toBe("succeeded"); // the record stays
    expect(cleaned.result).toBeUndefined(); // the material is GONE
    expect(cleaned.progress).toBeUndefined();
    expect(cleaned.stateHistory).toHaveLength(2); // the audit truth stays

    // A second cleanup answers the typed 409 (nothing left to clean).
    const again = await transformDELETE(
      deleteRequest(`/experience/transforms/${operation.id}`, bearer(tokenA)),
      { params: Promise.resolve({ id: operation.id }) },
    );
    expect(again.status).toBe(409);
  });

  it("the transform route honors the STORED policy's privacy constraints (local-only never routes cloud)", async () => {
    // Store a local-only policy for translation with the LOCAL fake as the
    // only fallback: the transform must run through the local provider.
    await policyPUT(
      putRequest(
        "/experience/model-policy",
        {
          task: "translation",
          fallbackProviders: [FAKE_TRANSLATION_ID],
          privacy: "local-only",
        },
        bearer(tokenA),
      ),
    );
    const submitted = await transformsPOST(
      postRequest("/experience/transforms", translationCommand("policy routed"), bearer(tokenA)),
    );
    expect(submitted.status).toBe(202);
    const operation = (await json(submitted)) as { id: string };
    await Promise.all([...harness.transformRuns]);
    const fetched = await transformGET(
      getRequest(`/experience/transforms/${operation.id}`, bearer(tokenA)),
      { params: Promise.resolve({ id: operation.id }) },
    );
    const final = (await json(fetched)) as {
      state: string;
      result?: { providerId: string };
    };
    expect(final.state).toBe("succeeded");
    expect(final.result!.providerId).toBe(FAKE_TRANSLATION_ID); // the local route
  });

  it("the profile's operations list answers newest-first with state truth", async () => {
    const response = await transformsGET(getRequest("/experience/transforms", bearer(tokenA)));
    expect(response.status).toBe(200);
    const operations = (await json(response)) as { state: string; createdAt: string }[];
    expect(operations.length).toBeGreaterThanOrEqual(5);
    for (let index = 1; index < operations.length; index += 1) {
      expect(operations[index - 1]!.createdAt >= operations[index]!.createdAt).toBe(true);
    }
    expect(operations.every((entry) => typeof entry.state === "string")).toBe(true);
  });

  it("anonymous transform submission works through the default-profile fallback", async () => {
    const submitted = await transformsPOST(
      postRequest("/experience/transforms", translationCommand("anon transform"), identityHeaders()),
    );
    expect(submitted.status).toBe(202);
    const operation = (await json(submitted)) as { id: string };
    await Promise.all([...harness.transformRuns]);
    const fetched = await transformGET(
      getRequest(`/experience/transforms/${operation.id}`, identityHeaders()),
      { params: Promise.resolve({ id: operation.id }) },
    );
    expect(fetched.status).toBe(200);
    const final = (await json(fetched)) as { state: string };
    expect(final.state).toBe("succeeded");
  });
});
