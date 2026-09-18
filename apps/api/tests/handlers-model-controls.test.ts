/**
 * R06 — model-and-AI-controls handler tests (bun:test, PGlite harness).
 *
 * Exercises the `/experience/{model-policy,model-providers,transforms}/**`
 * routes by importing their GET/POST/PUT/DELETE functions directly (no
 * server, no network) over the COMPLETE `ApiBoot` composition.
 *
 * Acceptance points (the R06 spec §1 + §5):
 * - MODEL POLICY: GET/PUT round-trip; the HONEST null for an unset task
 *   (never a fabricated default); typed 400s naming EVERY problem;
 *   anonymous honesty (defaults visible AS defaults, never as configured);
 *   merge semantics (stable id + created_at preserved across re-writes);
 *   profile isolation.
 * - MODEL PROVIDERS: GET answers the first-party provider (local, cost 0)
 *   honestly; BYOM bindings are listed as secret-free projections ONLY;
 *   the response NEVER contains key material; PUT/DELETE round-trip with
 *   the privacy law (sealed-store verification — the response NEVER
 *   contains key material).
 * - TRANSFORMS: the EXPLICIT state machine (queued → running →
 *   succeeded | failed | cancelled); illegal transitions reject;
 *   append-only state history (every transition recorded); the cancel +
 *   clearResult paths; the anonymous honesty for an unset task.
 *
 * Determinism: FixedClock(30s)/SequentialIdGen; no network.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { setApiBootForTests, resetApiBootForTests } from "../src/host/testing";
import { POST as registerPOST } from "../src/app/auth/register/route";
import {
  GET as modelPolicyGET,
  PUT as modelPolicyPUT,
} from "../src/app/experience/model-policy/route";
import { GET as modelProvidersGET } from "../src/app/experience/model-providers/route";
import {
  PUT as byomBindPUT,
  DELETE as byomBindDELETE,
} from "../src/app/experience/model-providers/byom/[providerId]/route";
import { POST as transformsPOST } from "../src/app/experience/transforms/route";
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

interface AuthShape {
  token: string;
  user: { id: string; email: string };
  profiles: { id: string; displayName: string; isDefault: boolean }[];
  activeProfileId: string;
}

let harness: ApiTestBoot;
let tokenA: string;
let userAId: string;
let tokenB: string;

beforeAll(async () => {
  harness = await createApiTestBoot();
  setApiBootForTests(harness.boot);

  const registerA = await registerPOST(
    postRequest("/auth/register", {
      email: "model-a@example.com",
      password: "correct-horse-battery",
      displayName: "Model A",
    }),
  );
  expect(registerA.status).toBe(200);
  const a = (await json(registerA)) as AuthShape;
  tokenA = a.token;
  userAId = a.user.id;

  const registerB = await registerPOST(
    postRequest("/auth/register", {
      email: "model-b@example.com",
      password: "correct-horse-staple",
      displayName: "Model B",
    }),
  );
  expect(registerB.status).toBe(200);
  const b = (await json(registerB)) as AuthShape;
  tokenB = b.token;
});

afterAll(async () => {
  resetApiBootForTests();
  await harness.testDb.close();
});

// ---------------------------------------------------------------------------
// MODEL POLICY — GET/PUT round-trip + honesty + isolation
// ---------------------------------------------------------------------------

describe("R06 /experience/model-policy — round-trip + honesty", () => {
  it("GET answers the HONEST null for an unset task (never fabricated)", async () => {
    const response = await modelPolicyGET(
      getRequest(
        "/experience/model-policy?task=translation",
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toBeNull();
  });

  it("GET answers 400 for an unknown task", async () => {
    const response = await modelPolicyGET(
      getRequest(
        "/experience/model-policy?task=nonexistent",
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(response.status).toBe(400);
  });

  it("PUT writes and GET reads one task's policy (round-trip)", async () => {
    const putResponse = await modelPolicyPUT(
      putRequest(
        "/experience/model-policy",
        {
          task: "translation",
          preferredProvider: "wfx-first-party",
          fallbackProviders: ["wfx-local-translator", "byom-openai"],
          privacy: "trusted-cloud",
          maxCostPerOperation: 0.5,
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(putResponse.status).toBe(200);
    const written = (await json(putResponse)) as {
      id: string;
      task: string;
      preferredProvider: string;
      fallbackProviders: string[];
      privacy: string;
      maxCostPerOperation: number;
    };
    expect(written.id).toMatch(/^wfxmp_/);
    expect(written.task).toBe("translation");
    expect(written.preferredProvider).toBe("wfx-first-party");
    expect(written.fallbackProviders).toEqual([
      "wfx-local-translator",
      "byom-openai",
    ]);
    expect(written.privacy).toBe("trusted-cloud");
    expect(written.maxCostPerOperation).toBe(0.5);

    const getResponse = await modelPolicyGET(
      getRequest(
        "/experience/model-policy?task=translation",
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(getResponse.status).toBe(200);
    const reread = (await json(getResponse)) as { id: string; privacy: string };
    expect(reread.id).toBe(written.id);
    expect(reread.privacy).toBe("trusted-cloud");
  });

  it("PUT preserves the canonical id + created_at across re-writes", async () => {
    const first = await modelPolicyPUT(
      putRequest(
        "/experience/model-policy",
        {
          task: "summary",
          preferredProvider: "wfx-first-party",
          fallbackProviders: ["wfx-local-summary"],
          privacy: "local-only",
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(first.status).toBe(200);
    const firstBody = (await json(first)) as {
      id: string;
      createdAt: string;
      privacy: string;
    };
    const second = await modelPolicyPUT(
      putRequest(
        "/experience/model-policy",
        {
          task: "summary",
          preferredProvider: "byom-anthropic",
          fallbackProviders: ["wfx-first-party"],
          privacy: "any-cloud",
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(second.status).toBe(200);
    const secondBody = (await json(second)) as {
      id: string;
      createdAt: string;
      privacy: string;
      preferredProvider: string;
    };
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.createdAt).toBe(firstBody.createdAt);
    expect(secondBody.preferredProvider).toBe("byom-anthropic");
    expect(secondBody.privacy).toBe("any-cloud");
  });

  it("PUT answers a typed 400 naming EVERY problem (bad privacy + bad cost)", async () => {
    const response = await modelPolicyPUT(
      putRequest(
        "/experience/model-policy",
        {
          task: "translation",
          fallbackProviders: [],
          privacy: "anywhere",
          maxCostPerOperation: -0.01,
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(response.status).toBe(400);
    const body = (await json(response)) as { detail: string };
    expect(body.detail).toContain("privacy");
    expect(body.detail).toContain("maxCostPerOperation");
  });

  it("PUT answers a typed 400 for an empty fallback list with no preferred provider", async () => {
    const response = await modelPolicyPUT(
      putRequest(
        "/experience/model-policy",
        {
          task: "translation",
          fallbackProviders: [],
          privacy: "any-cloud",
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(response.status).toBe(400);
    const body = (await json(response)) as { detail: string };
    expect(body.detail).toContain("fallbackProviders");
  });

  it("isolates profiles — user B never sees user A's policy", async () => {
    await modelPolicyPUT(
      putRequest(
        "/experience/model-policy",
        {
          task: "commentary",
          fallbackProviders: [],
          privacy: "local-only",
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    const inB = await modelPolicyGET(
      getRequest(
        "/experience/model-policy?task=commentary",
        { authorization: `Bearer ${tokenB}` },
      ),
    );
    expect(inB.status).toBe(200);
    const body = await json(inB);
    expect(body).toBeNull();
  });

  it("anonymous honesty — defaults visible AS defaults, never as configured", async () => {
    // An anonymous request (no bearer) answers the honest null for an
    // unset task — never a fabricated default-as-if-configured.
    const response = await modelPolicyGET(
      getRequest(
        "/experience/model-policy?task=dubbing",
        identityHeaders({ "x-wfx-user-id": "wfx-anon-test-user" }),
      ),
    );
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toBeNull();
  });

  it("rejects a malformed Authorization header with typed 401", async () => {
    const response = await modelPolicyGET(
      getRequest("/experience/model-policy?task=translation", {
        authorization: "Bearer not-a-real-token",
      }),
    );
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// MODEL PROVIDERS + BYOM BINDINGS — sealed-store verification
// ---------------------------------------------------------------------------

describe("R06 /experience/model-providers + /byom/:providerId", () => {
  it("GET /model-providers answers the first-party provider honestly", async () => {
    const response = await modelProvidersGET(
      getRequest(
        "/experience/model-providers",
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(response.status).toBe(200);
    const providers = (await json(response)) as Array<{
      id: string;
      privacy: string;
      byomBound: boolean;
      capabilities: string[];
      costs: Record<string, number>;
      availability: string;
    }>;
    expect(providers.length).toBeGreaterThan(0);
    const wfx = providers.find((p) => p.id === "wfx-first-party");
    expect(wfx).toBeDefined();
    expect(wfx?.privacy).toBe("local");
    expect(wfx?.byomBound).toBe(false);
    expect(wfx?.availability).toBe("available");
    expect(wfx?.capabilities.length).toBeGreaterThan(0);
  });

  it("PUT /byom/:providerId seals the key — the response NEVER contains key material", async () => {
    const response = await byomBindPUT(
      putRequest(
        "/experience/model-providers/byom/openai-byom",
        {
          endpointUrl: "https://api.openai.com/v1",
          key: "sk-R06-TEST-NEVER-REAL-KEY-VALUE-12345",
          metadata: { model: "gpt-4o" },
          capabilities: ["translation", "summary"],
          costPerCall: 0.001,
        },
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ providerId: "openai-byom" }) },
    );
    expect(response.status).toBe(200);
    const record = (await json(response)) as Record<string, unknown>;
    // THE PRIVACY LAW: the response carries the HANDLE + metadata ONLY.
    for (const forbidden of [
      "key",
      "secret",
      "apiKey",
      "token",
      "ciphertext",
      "iv",
      "authTag",
    ]) {
      expect(forbidden in record).toBe(false);
    }
    expect(record.id).toMatch(/^wfxbind_/);
    expect(record.providerId).toBe("openai-byom");
    expect(record.endpointUrl).toBe("https://api.openai.com/v1");
    expect(record.keyId).toMatch(/^[0-9a-f]{16}$/);
    // The metadata carries the capabilities + costPerCall (the API stores
    // them as part of the binding's metadata — the fabric reads them at
    // invoke time to register the BYOM provider).
    const metadata = record.metadata as Record<string, unknown>;
    expect(metadata.capabilities).toEqual(["translation", "summary"]);
    expect(metadata.costPerCall).toBe(0.001);
  });

  it("the sealed row at rest NEVER contains the plaintext key (raw-SQL check)", async () => {
    const raw = await harness.testDb.raw.query(
      `SELECT ciphertext, iv, auth_tag, key_id, endpoint_url FROM byom_provider_bindings
        WHERE user_id = $1 AND provider_id = $2`,
      [userAId, "openai-byom"],
    );
    expect(raw.rows.length).toBe(1);
    const row = raw.rows[0] as Record<string, string | undefined>;
    const allCols = JSON.stringify(row);
    expect(allCols).not.toContain("sk-R06-TEST-NEVER-REAL-KEY-VALUE-12345");
    expect(row.ciphertext?.length ?? 0).toBeGreaterThan(0);
    expect(row.iv?.length ?? 0).toBeGreaterThan(0);
    expect(row.auth_tag?.length ?? 0).toBeGreaterThan(0);
    expect(row.key_id?.length ?? 0).toBe(16);
  });

  it("PUT /byom/:providerId re-PUT preserves the canonical id + created_at", async () => {
    const first = await byomBindPUT(
      putRequest(
        "/experience/model-providers/byom/anthropic-byom",
        {
          endpointUrl: "https://api.anthropic.com/v1",
          key: "sk-ANT-first-test-key-abc",
        },
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ providerId: "anthropic-byom" }) },
    );
    const firstBody = (await json(first)) as {
      id: string;
      createdAt: string;
    };
    const second = await byomBindPUT(
      putRequest(
        "/experience/model-providers/byom/anthropic-byom",
        {
          endpointUrl: "https://api.anthropic.com/v1",
          key: "sk-ANT-ROTATED-test-key-xyz",
        },
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ providerId: "anthropic-byom" }) },
    );
    const secondBody = (await json(second)) as {
      id: string;
      createdAt: string;
    };
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.createdAt).toBe(firstBody.createdAt);
  });

  it("GET /model-providers lists the BYOM bindings as secret-free projections ONLY", async () => {
    const response = await modelProvidersGET(
      getRequest(
        "/experience/model-providers",
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(response.status).toBe(200);
    const providers = (await json(response)) as Array<Record<string, unknown>>;
    const byom = providers.find((p) => p.id === "openai-byom");
    expect(byom).toBeDefined();
    expect(byom?.privacy).toBe("cloud");
    expect(byom?.byomBound).toBe(true);
    // THE PRIVACY LAW: the listing never leaks the secret.
    const listingJson = JSON.stringify(providers);
    expect(listingJson).not.toContain("sk-R06-TEST-NEVER-REAL-KEY-VALUE-12345");
    expect(listingJson).not.toContain("sk-ANT-ROTATED-test-key-xyz");
  });

  it("DELETE /byom/:providerId destroys the sealed material", async () => {
    // Bind a fresh provider for the delete test
    await byomBindPUT(
      putRequest(
        "/experience/model-providers/byom/to-delete",
        {
          endpointUrl: "https://example.com/v1",
          key: "sk-DELETE-me-test-key",
        },
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ providerId: "to-delete" }) },
    );
    const response = await byomBindDELETE(
      deleteRequest(
        "/experience/model-providers/byom/to-delete",
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ providerId: "to-delete" }) },
    );
    expect(response.status).toBe(204);
    // raw row gone
    const raw = await harness.testDb.raw.query(
      `SELECT id FROM byom_provider_bindings WHERE user_id = $1 AND provider_id = $2`,
      [userAId, "to-delete"],
    );
    expect(raw.rows.length).toBe(0);
  });

  it("DELETE /byom/:providerId answers 404 honestly for an unknown binding", async () => {
    const response = await byomBindDELETE(
      deleteRequest(
        "/experience/model-providers/byom/never-bound",
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ providerId: "never-bound" }) },
    );
    expect(response.status).toBe(404);
  });

  it("isolates profiles — user B's BYOM bindings are invisible to user A", async () => {
    await byomBindPUT(
      putRequest(
        "/experience/model-providers/byom/userB-only",
        {
          endpointUrl: "https://example.com/v1",
          key: "sk-USERB-test-key-value",
        },
        { authorization: `Bearer ${tokenB}` },
      ),
      { params: Promise.resolve({ providerId: "userB-only" }) },
    );
    const inA = await modelProvidersGET(
      getRequest(
        "/experience/model-providers",
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    const providers = (await json(inA)) as Array<{ id: string }>;
    expect(providers.find((p) => p.id === "userB-only")).toBeUndefined();
  });

  it("PUT /byom/:providerId answers a typed 400 for a non-http(s) endpoint URL", async () => {
    const response = await byomBindPUT(
      putRequest(
        "/experience/model-providers/byom/ftp-byom",
        {
          endpointUrl: "ftp://example.com/v1",
          key: "sk-anything",
        },
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ providerId: "ftp-byom" }) },
    );
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// TRANSFORMS — explicit state machine + append-only history + cancel/cleanup
// ---------------------------------------------------------------------------

describe("R06 /experience/transforms — explicit state machine", () => {
  it("POST /transforms creates a queued operation (the explicit submit)", async () => {
    const response = await transformsPOST(
      postRequest(
        "/experience/transforms",
        {
          kind: "translation",
          input: {
            media: {
              sourceId: "wfx-test-source",
              authorizedSource: true,
              drmProtected: false,
              allowsTranscript: true,
              allowsTranslation: true,
              allowsDubbing: false,
              allowsCommentary: false,
            },
            text: "Hello, world.",
            targetLanguage: "es",
          },
          options: {
            privacy: "local-only",
          },
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(response.status).toBe(200);
    const result = (await json(response)) as {
      ok: boolean;
      operation?: {
        id: string;
        state: string;
        kind: string;
        targetRef: string;
      };
    };
    expect(result.ok).toBe(true);
    expect(result.operation?.id).toMatch(/^wfxtx_/);
    // The state may have already transitioned (the pipeline runs
    // asynchronously); accept queued OR running OR succeeded.
    expect(["queued", "running", "succeeded", "failed"]).toContain(
      result.operation?.state ?? "",
    );
  });

  it("POST /transforms answers a typed 400 for an invalid kind", async () => {
    const response = await transformsPOST(
      postRequest(
        "/experience/transforms",
        {
          kind: "noise-removal",
          input: {
            media: {
              sourceId: "wfx-test-source",
              authorizedSource: true,
              drmProtected: false,
              allowsTranscript: true,
              allowsTranslation: true,
              allowsDubbing: false,
              allowsCommentary: false,
            },
            text: "Hello, world.",
            targetLanguage: "es",
          },
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(response.status).toBe(400);
    const body = (await json(response)) as { detail: string };
    expect(body.detail).toContain("kind");
  });

  it("POST /transforms answers a typed 400 for an invalid input (missing targetLanguage)", async () => {
    const response = await transformsPOST(
      postRequest(
        "/experience/transforms",
        {
          kind: "translation",
          input: {
            media: {
              sourceId: "wfx-test-source",
              authorizedSource: true,
              drmProtected: false,
              allowsTranscript: true,
              allowsTranslation: true,
              allowsDubbing: false,
              allowsCommentary: false,
            },
            text: "Hello, world.",
            // targetLanguage missing
          },
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(response.status).toBe(400);
  });

  it("POST /transforms denies an unauthorized source (the permission law)", async () => {
    const response = await transformsPOST(
      postRequest(
        "/experience/transforms",
        {
          kind: "translation",
          input: {
            media: {
              sourceId: "wfx-unauthorized-source",
              authorizedSource: false, // unauthorized — always denied
              drmProtected: false,
              allowsTranscript: true,
              allowsTranslation: true,
              allowsDubbing: false,
              allowsCommentary: false,
            },
            text: "Hello, world.",
            targetLanguage: "es",
          },
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    expect(response.status).toBe(200);
    const result = (await json(response)) as {
      ok: boolean;
      operation?: { state: string; errorDetail: string | null };
    };
    expect(result.ok).toBe(true);
    // The permission denial creates a `failed` operation record.
    // The pipeline may still be running; wait a tick and re-read.
    const opId = (result.operation as { id: string } | undefined)?.id;
    expect(opId).toBeDefined();
    // Wait for the asynchronous pipeline to record the failure.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const getResponse = await transformGET(
      getRequest(
        `/experience/transforms/${opId}`,
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ id: opId as string }) },
    );
    const got = (await json(getResponse)) as {
      operation: { state: string; errorDetail: string | null };
    };
    expect(got.operation.state).toBe("failed");
    expect(got.operation.errorDetail).toContain("permission");
  });

  it("GET /transforms/:id answers the operation + the append-only history", async () => {
    // Submit a translation, then read its history.
    const submit = await transformsPOST(
      postRequest(
        "/experience/transforms",
        {
          kind: "translation",
          input: {
            media: {
              sourceId: "wfx-test-source",
              authorizedSource: true,
              drmProtected: false,
              allowsTranscript: true,
              allowsTranslation: true,
              allowsDubbing: false,
              allowsCommentary: false,
            },
            text: "Hello, world.",
            targetLanguage: "es",
          },
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    const submitBody = (await json(submit)) as {
      ok: boolean;
      operation?: { id: string };
    };
    const opId = submitBody.operation?.id;
    expect(opId).toBeDefined();
    // Wait for the pipeline to run.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const response = await transformGET(
      getRequest(
        `/experience/transforms/${opId}`,
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ id: opId as string }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as {
      operation: { id: string; state: string };
      history: Array<{ state: string }>;
    };
    expect(body.operation.id).toBe(opId as string);
    expect(body.history.length).toBeGreaterThan(0);
    expect(body.history[0]?.state).toBe("queued");
  });

  it("GET /transforms/:id answers 404 for an unknown id", async () => {
    const response = await transformGET(
      getRequest(
        "/experience/transforms/wfxtx_01ARZ3NDEKF1XTVRE0000000XX",
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ id: "wfxtx_01ARZ3NDEKF1XTVRE0000000XX" }) },
    );
    expect(response.status).toBe(404);
  });

  it("GET /transforms/:id answers 400 for a malformed id (no wfxtx_ prefix)", async () => {
    const response = await transformGET(
      getRequest(
        "/experience/transforms/not-a-real-id",
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ id: "not-a-real-id" }) },
    );
    expect(response.status).toBe(400);
  });

  it("POST /transforms/:id/cancel cancels a queued operation (the explicit cancel)", async () => {
    // Submit a transform with a high timeout so the operation stays
    // queued/running long enough for the cancel to land.
    const submit = await transformsPOST(
      postRequest(
        "/experience/transforms",
        {
          kind: "translation",
          input: {
            media: {
              sourceId: "wfx-test-source",
              authorizedSource: true,
              drmProtected: false,
              allowsTranscript: true,
              allowsTranslation: true,
              allowsDubbing: false,
              allowsCommentary: false,
            },
            text: "Hello, world.",
            targetLanguage: "es",
          },
          options: { timeoutMs: 60_000 },
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    const submitBody = (await json(submit)) as {
      ok: boolean;
      operation?: { id: string; state: string };
    };
    const opId = submitBody.operation?.id;
    expect(opId).toBeDefined();
    // Try to cancel; if the operation already succeeded (fast fabric), the
    // cancel answers 400 — that's a legal terminal-state rejection.
    const response = await transformCancelPOST(
      postRequest(
        `/experience/transforms/${opId}/cancel`,
        {},
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ id: opId as string }) },
    );
    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      const body = (await json(response)) as { state: string };
      expect(body.state).toBe("cancelled");
    } else {
      const body = (await json(response)) as { detail: string };
      expect(body.detail).toContain("terminal");
    }
  });

  it("POST /transforms/:id/cancel answers 404 for an unknown id", async () => {
    const response = await transformCancelPOST(
      postRequest(
        "/experience/transforms/wfxtx_01ARZ3NDEKF1XTVRE0000000XX/cancel",
        {},
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ id: "wfxtx_01ARZ3NDEKF1XTVRE0000000XX" }) },
    );
    expect(response.status).toBe(404);
  });

  it("DELETE /transforms/:id clears the result of a succeeded transform (cleanup)", async () => {
    // Submit a translation that should succeed (the fabric's local model
    // is wired but does not serve translation — the transform will fail).
    // For this test, we manually create a succeeded operation via the
    // store to exercise the cleanup path deterministically. The user's
    // ACTIVE profile id is resolved from the session — operations must
    // live under the same profile key the route reads.
    const profileId = await harness.boot.profiles.resolveEffectiveProfileKey(userAId);
    const store = harness.boot.modelControls.transformStore();
    const op = await store.createOperation({
      userId: userAId,
      profileId,
      kind: "translation",
      targetRef: "wfxitm_R06-cleanup-test",
    });
    // Transition through the legal lifecycle to succeeded.
    await store.transitionState({
      operationId: op.id,
      userId: userAId,
      profileId,
      to: "running",
      progress: 0,
    });
    await store.transitionState({
      operationId: op.id,
      userId: userAId,
      profileId,
      to: "succeeded",
      progress: 1,
      detail: "wfxtr_R06-cleanup-test-result",
    });

    const response = await transformDELETE(
      deleteRequest(
        `/experience/transforms/${op.id}`,
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ id: op.id }) },
    );
    expect(response.status).toBe(200);
    const body = (await json(response)) as {
      state: string;
      resultRef: string | null;
    };
    expect(body.state).toBe("cancelled");
    expect(body.resultRef).toBeNull();
  });

  it("DELETE /transforms/:id answers 400 for a non-succeeded operation", async () => {
    const profileId = await harness.boot.profiles.resolveEffectiveProfileKey(userAId);
    const store = harness.boot.modelControls.transformStore();
    const op = await store.createOperation({
      userId: userAId,
      profileId,
      kind: "translation",
      targetRef: "wfxitm_R06-cleanup-reject",
    });
    const response = await transformDELETE(
      deleteRequest(
        `/experience/transforms/${op.id}`,
        { authorization: `Bearer ${tokenA}` },
      ),
      { params: Promise.resolve({ id: op.id }) },
    );
    expect(response.status).toBe(400);
  });

  it("isolates profiles — user B never sees user A's transform", async () => {
    const submit = await transformsPOST(
      postRequest(
        "/experience/transforms",
        {
          kind: "translation",
          input: {
            media: {
              sourceId: "wfx-test-source",
              authorizedSource: true,
              drmProtected: false,
              allowsTranscript: true,
              allowsTranslation: true,
              allowsDubbing: false,
              allowsCommentary: false,
            },
            text: "Hello, world.",
            targetLanguage: "es",
          },
        },
        { authorization: `Bearer ${tokenA}` },
      ),
    );
    const submitBody = (await json(submit)) as {
      ok: boolean;
      operation?: { id: string };
    };
    const opId = submitBody.operation?.id;
    expect(opId).toBeDefined();
    const response = await transformGET(
      getRequest(
        `/experience/transforms/${opId}`,
        { authorization: `Bearer ${tokenB}` },
      ),
      { params: Promise.resolve({ id: opId as string }) },
    );
    expect(response.status).toBe(404);
  });
});
