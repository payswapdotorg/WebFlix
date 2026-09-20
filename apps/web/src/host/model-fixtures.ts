/**
 * @wfx/app-web — the DEV-ONLY model-controls fixture state (R22-F journey
 * truth; the file-backed twin of source-auth-fixtures.ts).
 *
 * THE DEV-SERVER SPLIT-MODULE REALITY (the same law the acquisition and
 * source-auth fixtures follow): the Turbopack dev server compiles route
 * modules and page modules as SEPARATE module graphs — in-memory Maps do
 * not cross them. The R22-F bind route (apps/web/src/app/api/model/byom/*)
 * and the settings page's providers read resolve DIFFERENT module
 * instances of the fixture port, so a binding written to an in-memory Map
 * by the route would be invisible to the page's read. The state therefore
 * lives in a small JSON file at a FIXED tmpdir path every module agrees
 * on (the file is the truth; reads are fresh per call; only the typed
 * actions write).
 *
 * HONESTY LAWS (mirrored from the source-auth fixtures):
 * - READS NEVER ADVANCE THE STATE: the state is read fresh from the shared
 *   file per call; only the typed POST actions move it.
 * - THE STATE IS DATA: bindings answer the REAL `ModelProviderInfo` row
 *   shape (byomBound: true) the runtime validates exactly as it validates
 *   the real transport's rows — never a fabricated first-party claim.
 * - SECRET DISCIPLINE: the provider KEY never enters this state (the bind
 *   route seals it server-side; the fixture stores the binding handle's
 *   shape only — providerId, endpoint, binding id, capabilities, stamps).
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelPolicy, ModelTask } from "@wfx/domain";

/** The shared dev-state file (fixed path: the page + route modules agree). */
export const MODEL_FIXTURE_STATE_FILE = join(
  tmpdir(),
  "wfx-dev-model-fixtures.json",
);

/** One stored BYOM binding (the handle's shape — NO key material). */
export interface FixtureByomBinding {
  readonly bindingId: string;
  readonly endpointUrl: string;
  readonly capabilities: readonly ModelTask[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The fixture persona's whole model-controls state (the file's schema). */
export interface ModelFixtureState {
  readonly byomBindings: Readonly<Record<string, FixtureByomBinding>>;
  readonly policies: Readonly<Record<string, ModelPolicy>>;
  /**
   * R23-J — the persona's REGISTERED open models (the registration truth
   * the R23-G live-ASR route consumes: a catalog row is not a provider
   * until an adapter binds an executor and registers it — the fixtures'
   * typed register/unregister actions move this list).
   */
  readonly openModelRegistrations: readonly string[];
}

/** The empty state (a missing or corrupt file reads as EMPTY, never fatal). */
export function emptyModelFixtureState(): ModelFixtureState {
  return { byomBindings: {}, policies: {}, openModelRegistrations: [] };
}

/** Read the state FRESH from the shared file (per call — the file is truth). */
export function readModelFixtureState(): ModelFixtureState {
  try {
    if (!existsSync(MODEL_FIXTURE_STATE_FILE)) return emptyModelFixtureState();
    const parsed: unknown = JSON.parse(readFileSync(MODEL_FIXTURE_STATE_FILE, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return emptyModelFixtureState();
    const record = parsed as Record<string, unknown>;
    if (typeof record.byomBindings !== "object" || record.byomBindings === null) {
      return emptyModelFixtureState();
    }
    if (typeof record.policies !== "object" || record.policies === null) {
      return emptyModelFixtureState();
    }
    const openModelRegistrations = Array.isArray(record.openModelRegistrations)
      ? record.openModelRegistrations.filter((entry): entry is string => typeof entry === "string")
      : [];
    return {
      byomBindings: record.byomBindings as Record<string, FixtureByomBinding>,
      policies: record.policies as Record<string, ModelPolicy>,
      openModelRegistrations,
    };
  } catch {
    return emptyModelFixtureState();
  }
}

/** Write the state (only the typed actions call this). */
export function writeModelFixtureState(state: ModelFixtureState): void {
  writeFileSync(MODEL_FIXTURE_STATE_FILE, JSON.stringify(state), "utf8");
}

/** The typed bind (the handle's shape only — the key is sealed server-side). */
export function bindFixtureByom(input: {
  readonly providerId: string;
  readonly endpointUrl: string;
  readonly capabilities: readonly ModelTask[];
  readonly now: string;
}): { readonly bindingId: string; readonly binding: FixtureByomBinding } {
  const state = readModelFixtureState();
  const bindingId = `wfxbyom_${input.providerId}`;
  const binding: FixtureByomBinding = {
    bindingId,
    endpointUrl: input.endpointUrl,
    capabilities: [...input.capabilities],
    createdAt: input.now,
    updatedAt: input.now,
  };
  writeModelFixtureState({
    ...state,
    byomBindings: { ...state.byomBindings, [input.providerId]: binding },
  });
  return { bindingId, binding };
}

/** The typed unbind (false when no such binding — never a fabricated ok). */
export function unbindFixtureByom(providerId: string): boolean {
  const state = readModelFixtureState();
  if (!(providerId in state.byomBindings)) return false;
  const next: Record<string, FixtureByomBinding> = { ...state.byomBindings };
  delete next[providerId];
  writeModelFixtureState({ ...state, byomBindings: next });
  return true;
}

/** The dev-reset hook (the journey runner deletes the file per run). */
export function resetModelFixtureState(): void {
  try {
    rmSync(MODEL_FIXTURE_STATE_FILE, { force: true });
  } catch {
    // A missing file IS the empty state — never fatal.
  }
}

// ---------------------------------------------------------------------------
// R23-J — the open-model registration drive (the live route's truth)
// ---------------------------------------------------------------------------

/** The registrable open-model catalog ids the fixtures expose (the R2T2 live route + the batch companions). */
export const FIXTURE_OPEN_MODEL_IDS: readonly string[] = [
  "open-model:r2t2",
  "open-model:moss-transcribe-diarize",
  "open-model:whisper-large-v3-turbo",
] as const;

/**
 * Register one open model for the persona (the typed drive; idempotent).
 * The registered rows answer the REAL `ModelProviderInfo` shape in
 * `dev-fixture-server-port.ts`'s providers read — the registry a user
 * sees is the honest file truth.
 */
export function registerFixtureOpenModel(providerId: string): boolean {
  if (!FIXTURE_OPEN_MODEL_IDS.includes(providerId)) return false;
  const state = readModelFixtureState();
  if (state.openModelRegistrations.includes(providerId)) return true;
  writeModelFixtureState({
    ...state,
    openModelRegistrations: [...state.openModelRegistrations, providerId],
  });
  return true;
}

/** Unregister one open model (the typed removal; idempotent). */
export function unregisterFixtureOpenModel(providerId: string): boolean {
  const state = readModelFixtureState();
  if (!state.openModelRegistrations.includes(providerId)) return true;
  writeModelFixtureState({
    ...state,
    openModelRegistrations: state.openModelRegistrations.filter((id) => id !== providerId),
  });
  return true;
}
