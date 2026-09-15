/**
 * @wfx/app-web — the experience host boot (WFX-051).
 *
 * The composition root of the experience shell. It selects ports through
 * THE 050 BOOT LAW — unchanged, via the same `resolveDefaultPorts` every
 * 050 boot path funnels through (`WFX_DEV_FIXTURES=1` dev-only fixtures,
 * otherwise the `WFX_API_BASE` remote ports, otherwise the typed
 * `HostConfigError` — never a silent fallback) — and layers the ONE
 * addition the experience surfaces need: the watch-state recording seam
 * (`host/watch-state.ts`), which wraps the event sink so continue-watching
 * can be derived from the events this host emits.
 *
 * What this module owns (and what it deliberately does NOT):
 * - OWNS: the fixed experience context (the 050 anonymous-identity stopgap,
 *   reused verbatim — auth is WFX-052's service lane), the home/search/
 *   shorts seed queries (typed stopgaps for the real recommendation OS —
 *   WFX-055's lane; the frozen feed use-case is search-driven by
 *   contract), and the session `RecommendationPolicy` VALUE the short
 *   feed's re-rank decision consumes (a fixed balanced policy — a policy
 *   value, never a second ranking architecture).
 * - DOES NOT: select a different port bundle, read any environment beyond
 *   `resolveDefaultPorts`, or add domain logic. The runtime stays the
 *   shared frozen façade.
 */

import type { RecommendationPolicy } from "@wfx/domain";
import type { WebClient } from "../main";
import { bootWebClient } from "../main";
import type { HostMode } from "./config";
import { resolveDefaultPorts } from "./default-ports";
import { withWatchStateRecording } from "./watch-state";

/**
 * The fixed anonymous experience context — the SAME 050 stopgap
 * (`host/home.ts` `HOME_CONTEXT`), reused by every experience surface so
 * identity remains one visible, typed constant until the auth lane ships.
 */
export const EXPERIENCE_CONTEXT = {
  userId: "wfx-anonymous",
  sessionId: "wfx-web-host",
  locale: "en",
} as const;

/**
 * Home row seed queries — typed stopgaps. The frozen feed use-case is
 * search-driven (its contract), and the real home feed composition (the
 * Recommendation OS) is WFX-055's lane; these constants are the honest,
 * deterministic seeds the shell browses until then. "rain" is the 050 seed
 * (continuity); "a" matches broadly across the fixture catalog (a
 * defensible stand-in for a trending row); "n" is the short-surface seed
 * that reaches the vertical shorts in the fixture catalog.
 */
export const FOR_YOU_QUERY = "rain";
export const TRENDING_QUERY = "a";
export const SHORTS_QUERY = "n";

/**
 * The fixed session policy the short feed's session-aware re-rank consumes
 * (`shouldRerank` — a frozen pure function). A POLICY VALUE ONLY: balanced
 * attention, no objectives, no session-extension objective — engagement is
 * not the hidden objective (product invariant 7). User-controlled policy
 * selection is the settings surface's lane (WFX-055+).
 */
export const SESSION_POLICY: RecommendationPolicy = {
  id: "wfx-web-session-default",
  userId: EXPERIENCE_CONTEXT.userId,
  objectives: [],
  exploration: 0.1,
  novelty: 0.1,
  socialInfluence: 0,
  attentionMode: "balanced",
};

/** A booted experience host: the boot mode plus the shared client. */
export interface ExperienceHost {
  /** The boot mode the environment selected (fixtures / service). */
  readonly mode: HostMode;
  /** The booted web client (platform profile + shared runtime). */
  readonly client: WebClient;
}

/**
 * Boot the experience host from the environment: the 050 port-selection
 * law, plus the watch-state recording seam around the event sink.
 *
 * @param env the environment to read (defaults to `process.env`).
 * @throws {@link import("./config").HostConfigError} when the environment
 * cannot honestly select a mode — never a silent fixture fallback.
 */
export function bootExperienceHost(env: Record<string, string | undefined> = process.env): ExperienceHost {
  const { config, ports } = resolveDefaultPorts(env);
  const client = bootWebClient({ ports: withWatchStateRecording(ports) });
  return { mode: config.mode, client };
}
