/**
 * @wfx/app-web — the Settings route (R07): honest capability truth.
 *
 * The settings destination over the ONE runtime: `?section=<sources|
 * model|general>` → the settings surface rendering the adapter's truthful
 * capability declaration (no torrent/native on Web, plainly named), the
 * honest source-management and model-controls states (R03/R06 lanes), and
 * the session state. R17: the sources section renders the runtime's
 * sources model (the fixtures' scripted authorization lifecycle in dev —
 * J28's surface; the honest not-wired state in service mode).
 *
 * R20-D: the sources section additionally renders the BYOF panel (the
 * Bring Your Own Feed flow: choose source → connect/import → preview →
 * confirm) through the honest byof host seam. The staged-preview step is
 * addressed by `?byof=preview&import=<id>` — an adapter render hint on
 * the existing settings surface (the runtime's `section` vocabulary is
 * untouched — no new navigation system, the frozen UX law). Server
 * component.
 *
 * R21-B: the route consumes the REQUEST-SCOPED host (the per-identity
 * host map): an authenticated session's cookie binds the account's
 * runtime (the Session section renders the real signed-in state + the
 * real sign-in/sign-out/profile-switch controls); no cookie answers the
 * anonymous singleton exactly as before. The model section renders the
 * REAL Model & AI truth (the R21-C model-controls read models over the
 * completed transport) — the stale "arrives with the model lane" copy
 * died at its source.
 */

import { AppShell } from "@/components/shell/AppShell";
import { SettingsSurface } from "@/components/settings/SettingsSurface";
import { getWebRequestHost } from "@/host/request-session";
import { byofHostBinding, loadByofPanelView } from "@/host/byof/byof-host";
import { syncNavigationToRoute } from "@/app/routing";
import type { ModelTask } from "@wfx/domain";
import type {
  ModelPolicyModel,
  ModelProvidersModel,
  SettingsSection,
} from "@wfx/client-runtime";

export const dynamic = "force-dynamic";

/** The frozen ModelTask vocabulary (the policy chips' task set). */
const MODEL_TASKS: readonly ModelTask[] = [
  "recommendation",
  "ranking",
  "summary",
  "translation",
  "transcription",
  "speechToText",
  "textToSpeech",
  "dubbing",
  "commentary",
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const host = await getWebRequestHost();
  const { state } = syncNavigationToRoute(host.runtime, "/settings", params);
  const section =
    state.surface === "settings" ? (state as { section?: SettingsSection }).section : undefined;
  // R17 — the sources section's data: the runtime's own sources read (the
  // fixtures' scripted authorization truth in dev; the honest transport
  // answer in service mode — never a fabricated list).
  const sources = section === "sources" ? await host.runtime.sources.refresh() : undefined;
  // R21-C — the model section's data: the REAL model-controls read models
  // (the provider registry + every task's policy truth) over the
  // completed R06 transport.
  let modelProviders: ModelProvidersModel | undefined;
  let modelPolicies: readonly ModelPolicyModel[] | undefined;
  if (section === "model") {
    const [providers, ...policies] = await Promise.all([
      host.runtime.modelControls.refreshProviders(),
      ...MODEL_TASKS.map((task) => host.runtime.modelControls.refreshPolicy(task)),
    ]);
    modelProviders = providers;
    modelPolicies = policies;
  }
  // R20-D/R20-H — the BYOF panel view (the sources section's feed-import
  // flow), with the staged-preview address (`?byof=preview&import=<id>`)
  // when the flow's preview step is open. An adapter render hint: the
  // runtime's navigation state is untouched. Service mode binds the HTTP
  // transport through the host binding (the one-place seam).
  const byofImportParam = params.import;
  const byofPreviewImportId =
    Array.isArray(byofImportParam) ? (byofImportParam[0] ?? "") : (byofImportParam ?? "");
  const byof =
    section === "sources"
      ? await loadByofPanelView(
          byofHostBinding(host),
          byofPreviewImportId.length > 0 ? byofPreviewImportId : undefined,
        )
      : undefined;
  return (
    <AppShell mode={host.mode} active="settings" session={host.session.state}>
      <SettingsSurface
        capabilities={host.capabilities}
        session={host.session.state}
        mode={host.mode}
        {...(section !== undefined ? { section } : {})}
        {...(sources !== undefined ? { sources } : {})}
        {...(byof !== undefined ? { byof } : {})}
        {...(modelProviders !== undefined ? { modelProviders } : {})}
        {...(modelPolicies !== undefined ? { modelPolicies } : {})}
      />
    </AppShell>
  );
}
