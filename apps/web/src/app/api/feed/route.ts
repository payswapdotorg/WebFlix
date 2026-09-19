/**
 * @wfx/app-web — the BYOF feed API route (R20-D).
 *
 * `GET /api/feed?mode=<byof|following|webflix|hybrid>` → the imported feed
 * view under the mode (the mode-truth law: `webflix` is always an EMPTY
 * record list — imported source-native records are never re-labeled as
 * WebFlix-ranked content) + the import summaries (status + freshness +
 * the last reconciliation report).
 *
 * `POST /api/feed` `{ action, ... }` — the typed BYOF actions:
 * - `preview` `{ connectorId, method?, artifactB64? }` — capture + stage
 *   the preview the user confirms (the artifacts' method needs the
 *   user-supplied artifact — base64 in fixtures mode it is the scripted
 *   export; the field is accepted and validated honestly either way);
 * - `confirm` `{ importId }` — promote EXACTLY the staged preview (never
 *   re-fetches); continuous route → `live`, one-time artifact →
 *   `snapshot` (never presented as live);
 * - `discard` `{ importId }` — drop an unconfirmed preview (non-destructive);
 * - `sync` `{ importId }` — the incremental reconciliation (the shared
 *   domain engine); a one-time artifact or a disconnected import answers
 *   the typed `unsupported` verdict — never a fake refresh;
 * - `disconnect` `{ importId }` — STOP syncing, records + provenance
 *   RETAINED (the survival law; deletion is the separate explicit action);
 * - `reconnect` `{ importId }` — stage a FRESH preview for a disconnected
 *   import (the user re-confirms; nothing silently re-imports);
 * - `delete-records` `{ importId }` — the EXPLICIT destructive deletion of
 *   the imported feed records (touches feed records only);
 * - `revise-source` — the CLEARLY-LABELED dev fixtures drive (the source
 *   changed; a sync has something honest to reconcile) — fixtures mode
 *   only, exactly like the acquisition `advance` and source `expire`.
 *
 * Service mode: the capture/action verbs answer the honest typed 503
 * (this host's BYOF transport is the lead's R20-H wiring step — reads and
 * the catalog stay honest, never a fake import, never a silent no-op).
 *
 * Deterministic: reads never advance the scripted state; only the typed
 * POST moves it (the fixtures-drive law).
 */

import { getWebRuntimeHost } from "@/host/web-host";
import { ByofFeedService } from "@/host/byof/service";
import { driveReviseFixtureSource } from "@/host/byof/fixture-state";
import type { FeedImportMethod } from "@wfx/domain";

/** The closed action vocabulary the POST accepts. */
const ACTIONS = new Set([
  "preview",
  "confirm",
  "discard",
  "sync",
  "disconnect",
  "reconnect",
  "delete-records",
  "revise-source",
]);

/** The closed mode vocabulary the GET accepts. */
const MODES = new Set(["webflix", "following", "byof", "hybrid"]);

/** The service bound to this process's boot mode (the one-runtime law). */
async function service(): Promise<{ host: Awaited<ReturnType<typeof getWebRuntimeHost>>; byof: ByofFeedService }> {
  const host = await getWebRuntimeHost();
  return { host, byof: new ByofFeedService(host.mode) };
}

export async function GET(request: Request): Promise<Response> {
  const { host, byof } = await service();
  const mode = new URL(request.url).searchParams.get("mode") ?? "byof";
  if (!MODES.has(mode)) {
    return Response.json(
      { error: `mode: expected one of ${[...MODES].join(" | ")} (got '${mode}')` },
      { status: 400 },
    );
  }
  const [imports, records] = await Promise.all([
    byof.listImports(),
    byof.readFeed(mode as "webflix" | "following" | "byof" | "hybrid"),
  ]);
  return Response.json({
    mode: host.mode,
    feedMode: mode,
    imports,
    records,
    sources: byof.sources(),
  });
}

export async function POST(request: Request): Promise<Response> {
  const { host, byof } = await service();
  const body: unknown = await request.json().catch(() => null);
  const action =
    typeof body === "object" && body !== null ? (body as { action?: unknown }).action : undefined;
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return Response.json(
      { error: `expected { action: one of ${[...ACTIONS].join(" | ")} }` },
      { status: 400 },
    );
  }

  const connectorId =
    typeof body === "object" && body !== null
      ? (body as { connectorId?: unknown }).connectorId
      : undefined;
  const method =
    typeof body === "object" && body !== null ? (body as { method?: unknown }).method : undefined;
  const importId =
    typeof body === "object" && body !== null ? (body as { importId?: unknown }).importId : undefined;
  const artifactB64 =
    typeof body === "object" && body !== null ? (body as { artifactB64?: unknown }).artifactB64 : undefined;

  switch (action) {
    case "preview": {
      if (typeof connectorId !== "string" || connectorId.length === 0) {
        return Response.json({ error: "preview: expected { connectorId: string }" }, { status: 400 });
      }
      if (method !== undefined && typeof method !== "string") {
        return Response.json({ error: "preview: method must be a string when present" }, { status: 400 });
      }
      let artifact: Uint8Array | undefined;
      if (typeof artifactB64 === "string" && artifactB64.length > 0) {
        try {
          artifact = new Uint8Array(Buffer.from(artifactB64, "base64"));
        } catch {
          return Response.json({ error: "preview: artifactB64 must be valid base64" }, { status: 400 });
        }
      }
      const result = await byof.previewFeedImport({
        connectorId,
        ...(method !== undefined ? { method: method as FeedImportMethod } : {}),
        ...(artifact !== undefined ? { artifact } : {}),
      });
      if (!result.ok) {
        return Response.json(result.error, { status: failureStatus(result.error.kind) });
      }
      return Response.json({ preview: result.value });
    }
    case "confirm":
    case "discard":
    case "sync":
    case "disconnect":
    case "reconnect":
    case "delete-records": {
      if (typeof importId !== "string" || importId.length === 0) {
        return Response.json({ error: `${action}: expected { importId: string }` }, { status: 400 });
      }
      const result = await runImportAction(byof, action, importId);
      if (!result.ok) {
        return Response.json(result.error, { status: failureStatus(result.error.kind) });
      }
      return Response.json(result.value);
    }
    case "revise-source": {
      // The clearly-labeled DEV drive (fixtures mode only — the same law as
      // the acquisition `advance` and the source `expire`).
      if (host.mode !== "fixtures") {
        return Response.json(
          {
            error:
              "the scripted source revision is a dev fixtures drive — service mode reads the real source",
          },
          { status: 503 },
        );
      }
      const outcome = driveReviseFixtureSource();
      return Response.json({ revised: true, revision: outcome.revision });
    }
    default:
      return Response.json({ error: `unknown action '${String(action)}'` }, { status: 400 });
  }
}

/** Run one import-addressed action through the service. */
async function runImportAction(
  byof: ByofFeedService,
  action: string,
  importId: string,
): Promise<{ ok: true; value: unknown } | { ok: false; error: { kind: string; detail: string } }> {
  switch (action) {
    case "confirm": {
      const result = await byof.confirmFeedImport(importId);
      return result.ok ? { ok: true, value: { import: result.value } } : { ok: false, error: result.error };
    }
    case "discard": {
      const result = await byof.discardPreview(importId);
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
    }
    case "sync": {
      const result = await byof.syncFeedImport(importId);
      return result.ok ? { ok: true, value: { report: result.value } } : { ok: false, error: result.error };
    }
    case "disconnect": {
      const result = await byof.disconnectImport(importId);
      return result.ok ? { ok: true, value: { import: result.value } } : { ok: false, error: result.error };
    }
    case "reconnect": {
      const result = await byof.reconnectImport(importId);
      return result.ok ? { ok: true, value: { preview: result.value } } : { ok: false, error: result.error };
    }
    case "delete-records": {
      const result = await byof.deleteImportedRecords(importId);
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
    }
    default:
      return { ok: false, error: { kind: "invalid-input", detail: `unknown action '${action}'` } };
  }
}

/** The HTTP status of one typed failure kind (deterministic mapping). */
function failureStatus(kind: string): number {
  switch (kind) {
    case "invalid-input":
      return 400;
    case "not-found":
      return 404;
    case "unknown-connector":
    case "unsupported":
    case "unauthorized":
      return 409;
    case "unavailable":
      return 503;
    default:
      return 500;
  }
}
