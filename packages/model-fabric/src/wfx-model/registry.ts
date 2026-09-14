/**
 * WFX-031 — registration glue: the first-party model into the Model Fabric
 * registry (Lane A — intelligence).
 *
 * `registerWfxModel(fabric)` registers the first-party provider with the
 * MERGED WFX-030 public registry API (`ModelFabricRegistry.register`) under
 * BOTH served tasks — `recommendation` and `ranking` — via the provider's
 * declared capabilities (the registry indexes a registration under every
 * declared task).
 *
 * Registration facts (all enforced by the merged registry, none re-implemented):
 *
 * - PRIVACY: the provider registers with `privacy: "local"` — the WFX-030
 *   registry vocabulary meaning "executes on the user's device; input never
 *   leaves the machine". This is what makes the provider eligible for
 *   `local-only` model policies (the WFX-031 packet's privacy class): the
 *   router excludes non-local providers under local-only policies, and the
 *   adapter is local-only by construction (no network capability exists in
 *   its source at all).
 * - COST: first-party, no metering — `costPerOperation` reports a TYPED ZERO
 *   (the number 0, never undefined) for both served tasks, so fabric
 *   invocations through this provider record `trace.cost === 0` and no cost
 *   ceiling can ever exclude it on price.
 * - DUPLICATES: provider ids are stable identities — registering twice
 *   throws the merged registry's typed `DuplicateProviderError` (the typed
 *   refusal; the first registration is never overwritten). The error
 *   propagates untouched: it is the registry's own typed answer, never
 *   rebranded.
 */

import type { ModelFabricRegistry } from "../registry";
import {
  createWfxModelProvider,
  type WfxModelProviderOptions,
  type WfxRegisteredModelProvider,
} from "./provider";

/**
 * Register the WebFlix first-party recommendation model provider with the
 * fabric's provider registry, under BOTH served tasks
 * (`recommendation` + `ranking`), privacy `"local"`, and a typed zero cost.
 *
 * @param fabric the fabric's provider registry (the WFX-030 public
 *        registration surface — the `ModelFabric` gateway itself exposes no
 *        registration API, by design).
 * @param options forwarded to `createWfxModelProvider` (version / injected
 *        model — the test seam). Default: the first-party model at
 *        `WFX_MODEL_VERSION`.
 * @returns the registered provider (for introspection and assertions).
 *
 * @throws DuplicateProviderError (merged WFX-030 registry) when
 *         `"wfx-first-party"` is already registered — the typed refusal.
 */
export function registerWfxModel(
  fabric: ModelFabricRegistry,
  options: WfxModelProviderOptions = {},
): WfxRegisteredModelProvider {
  const provider = createWfxModelProvider(options);
  fabric.register(provider); // indexed under every declared capability
  return provider;
}
