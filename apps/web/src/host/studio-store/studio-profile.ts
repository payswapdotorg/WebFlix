/**
 * @wfx/app-web — R38-B — THE STUDIO PROFILE STORE (the channel
 * customization writes).
 *
 * THE CUSTOMIZATION LAW (the task packet): channel customization
 * (banner/avatar/handle/description) "writes real persisted profile
 * state through the additive domain-graph seam." This store is the
 * PERSISTENCE side of that law: the edit records are the domain graph's
 * own `ChannelProfileEdit` (@wfx/domain — packages/domain/src/graph/
 * channel-profile.ts, the validating constructor + the pure compose),
 * and this module reads/writes them through the studio storage seam
 * (`wfx-studio-profile-v1`) — the browser's own record, reload-durable,
 * honestly labeled. The graph's no-I/O boundary law is honored: the
 * record's LAW lives in the domain; the transport lives here.
 *
 * COMPOSITION (never a second identity): the edit is keyed by the
 * channel's stable connectorId — the same key the R36 derivation, the
 * sources model, and the studio's channel resolution use. The studio's
 * customized preview composes the edit over R36's derived identity
 * through the graph seam's `composeChannelProfile` (the overlay law);
 * R36's own read surfaces stay byte-compatible (the merge-time channel-
 * page binding is recorded in evidence/r38b/DIVERGENCES.md).
 */

import {
  channelProfileEditOf,
  parseChannelProfileEdit,
  type ChannelProfileEdit,
} from "@wfx/domain";

import {
  defaultStudioStorage,
  readStudioRecord,
  writeStudioRecord,
  type StudioStorage,
} from "./studio-storage";

/** The profile store's localStorage key. */
export const STUDIO_PROFILE_STORE_KEY = "wfx-studio-profile-v1";

/** The store's serialized shape: connectorId → the edit record. */
export type StudioProfileStoreShape = Record<string, ChannelProfileEdit>;

/** The customization form's input (all fields optional — absent keeps the current truth). */
export interface StudioProfileInput {
  readonly handle: string | null;
  readonly description: string | null;
  readonly bannerUrl: string | null;
  readonly avatarUrl: string | null;
}

/**
 * The typed outcome of a customization write: the graph seam's own
 * field-level details on refusal (never a silent coercion), the stored
 * record on success.
 */
export type StudioProfileOutcome =
  | { readonly ok: true; readonly edit: ChannelProfileEdit }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Read the full profile store defensively (absent/corrupt ⇒ the empty truth). */
export function readStudioProfileStore(
  storage: StudioStorage | null = defaultStudioStorage(),
): StudioProfileStoreShape {
  const raw = readStudioRecord<unknown>(storage, STUDIO_PROFILE_STORE_KEY);
  if (typeof raw !== "object" || raw === null) return {};
  const store: StudioProfileStoreShape = {};
  for (const [connectorId, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = parseChannelProfileEdit(value);
    if (parsed !== null && parsed.connectorId === connectorId) store[connectorId] = parsed;
  }
  return store;
}

/** Persist the full profile store best-effort. */
function persistStore(storage: StudioStorage | null, store: StudioProfileStoreShape): boolean {
  return writeStudioRecord(storage, STUDIO_PROFILE_STORE_KEY, store);
}

/** One channel's persisted edit (null when none is stored). */
export function readStudioProfileEdit(
  connectorId: string,
  storage: StudioStorage | null = defaultStudioStorage(),
): ChannelProfileEdit | null {
  return readStudioProfileStore(storage)[connectorId] ?? null;
}

/**
 * Save one channel's customization through THE DOMAIN SEAM: the input
 * goes through `channelProfileEditOf` (the graph's validating
 * constructor — its typed GraphError details are the refusal's field
 * problems, one law two layers), then persists. A failed persist is an
 * honest refusal (the record is NOT kept).
 */
export function writeStudioProfileEdit(
  connectorId: string,
  input: StudioProfileInput,
  storage: StudioStorage | null = defaultStudioStorage(),
  now: Date = new Date(),
): StudioProfileOutcome {
  try {
    const edit = channelProfileEditOf({
      connectorId,
      handle: input.handle,
      description: input.description,
      bannerUrl: input.bannerUrl,
      avatarUrl: input.avatarUrl,
      editedAt: now.toISOString(),
    });
    const store = readStudioProfileStore(storage);
    store[connectorId] = edit;
    if (!persistStore(storage, store)) {
      return {
        ok: false,
        problems: ["the customization could not be written to this device's storage — nothing was saved"],
      };
    }
    return { ok: true, edit };
  } catch (thrown) {
    // The graph seam's typed failure (GraphError — kind invalid-input,
    // field-level details): surfaced verbatim, never a silent coercion.
    const problems =
      typeof thrown === "object" && thrown !== null && Array.isArray((thrown as { details?: unknown }).details)
        ? ((thrown as { details: readonly string[] }).details as readonly string[])
        : [String(thrown)];
    return { ok: false, problems };
  }
}

/** Clear one channel's customization (the base derivation's truth stands again). */
export function clearStudioProfileEdit(
  connectorId: string,
  storage: StudioStorage | null = defaultStudioStorage(),
): { ok: boolean; problem: string | null } {
  const store = readStudioProfileStore(storage);
  if (store[connectorId] === undefined) {
    return { ok: false, problem: "no customization is stored for this channel on this device" };
  }
  delete store[connectorId];
  if (!persistStore(storage, store)) {
    return { ok: false, problem: "the change could not be written to this device's storage" };
  }
  return { ok: true, problem: null };
}
