/**
 * @wfx/app-web — the Settings surface (R07): capability TRUTH, honestly.
 *
 * The settings destination renders the adapter's truthful capability
 * declaration (the `PlatformCapabilities` bundle the runtime booted on)
 * as the user-facing truth table — the UI honesty law: unsupported
 * capabilities render as unsupported, NEVER as success or hidden:
 *
 * - SOURCES (R17): the runtime's sources model — each connected source's
 *   card states its authorization truth (Connected / Sign-in expired /
 *   Not connected / Connection failed) with its typed recovery action
 *   (reconnect / connect / disconnect). An EXPIRED source is its own
 *   named state — never a silent fallback to "not connected", never a
 *   fake "connected". When the transport cannot read sources, the
 *   section renders the honest typed error state — never a fabricated
 *   connected source (R21-B: the transport now IMPLEMENTS the read —
 *   the stale "arrives with R03" copy died at its source).
 * - MODEL (R21-B/R21-C): the REAL Model & AI truth — the provider
 *   registry (first-party + BYOM + local with per-task capability
 *   truth) and every task's policy state (the honest null = Not
 *   configured, never a fabricated default). The stale "arrives with
 *   R06" copy is gone: R06 is an accepted lane whose transport this
 *   app now speaks.
 * - GENERAL: the capability table (storage/browser host/native media/
 *   background work/sharing/notifications), each with its level and the
 *   honest limitation reason from the descriptor, plus the session state
 *   (R21-B: the REAL signed-in truth + the sign-in/profile/sign-out
 *   controls over the completed identity transport).
 *
 * Server component.
 */

import type { JSX } from "react";

import type {
  ModelPolicyModel,
  ModelProvidersModel,
  SourcesModel,
  SourceCatalogView,
  SourceInfo,
} from "@wfx/client-runtime";
import type { ModelPolicy, ModelTask } from "@wfx/domain";
import {
  byomManagementView,
  sourceCatalogView,
  sourceRecoveryAction,
} from "@wfx/client-runtime";
import type { WebPlatformBundle } from "@/platform/capabilities";
import type { WebSessionState } from "@/host/session";
import type { PersonalizeView } from "@/host/discoverability";
import type { ByofPanelView } from "@/host/byof/byof-view";
import { describeWebBackgroundWork } from "@/platform/background-work";
import { Icon } from "@/components/shell/Icon";
import { ByofPanel } from "@/components/byof/ByofPanel";
import { ByomManagementPanel } from "@/components/settings/ByomManagementPanel";
import { OpenModelsSection, openModelRowsOf } from "@/components/settings/OpenModelsSection";
import { LocalInferenceProbe } from "@/components/settings/LocalInferenceProbe";
import { SourceActions } from "@/components/settings/SourceActions";
import { SourceChooser } from "@/components/settings/SourceChooser";
import { SessionControls } from "@/components/settings/SessionControls";

/** The auth-state chip vocabulary (the honest per-state truth). */
const AUTH_STATE_LABELS: Readonly<Record<string, string>> = {
  signedIn: "Connected",
  signedOut: "Not connected",
  expired: "Sign-in expired",
  authorizing: "Connecting…",
  failed: "Connection failed",
};

/** One source's card: the authorization truth + its typed recovery action. */
function SourceCard({
  source,
  mode,
}: {
  readonly source: SourceInfo;
  readonly mode: "fixtures" | "service";
}): JSX.Element {
  const recovery = sourceRecoveryAction(source);
  const expired = source.authState === "expired";
  return (
    <li
      className="wfx-queue__item"
      data-wfx-source={source.connectorId}
      data-wfx-source-auth-state={source.authState}
      {...(expired ? { "data-wfx-source-expired": "true" } : {})}
    >
      <span className="wfx-card__meta">
        <span className="wfx-badge wfx-badge--type">{source.displayName}</span>
        <span
          className="wfx-badge wfx-badge--type"
          data-wfx-source-auth-chip={source.authState}
        >
          {AUTH_STATE_LABELS[source.authState] ?? source.authState}
        </span>
      </span>
      <p className="wfx-row__reason" data-wfx-source-recovery-detail>
        {recovery.detail}
      </p>
      {source.availabilityNotes.length > 0 ? (
        <ul className="wfx-row__reason" data-wfx-source-notes>
          {source.availabilityNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      <SourceActions
        connectorId={source.connectorId}
        action={{ kind: recovery.kind, label: recovery.label }}
        mode={mode}
      />
    </li>
  );
}

/** One capability row of the truth table. */
function CapabilityRow({
  area,
  level,
  supported,
  limitation,
}: {
  readonly area: string;
  readonly level: string;
  readonly supported: boolean;
  readonly limitation?: string;
}): JSX.Element {
  return (
    <li className="wfx-queue__item" data-wfx-capability={area.toLowerCase()}>
      <span className="wfx-card__meta">
        <span className="wfx-badge wfx-badge--type">{area}</span>
        <span data-wfx-capability-level>{level}</span>
        {supported ? (
          <span className="wfx-capchip" data-wfx-capability-supported>
            Available
          </span>
        ) : (
          <span className="wfx-capchip" data-wfx-capability-unsupported>
            Not available on Web
          </span>
        )}
      </span>
      {limitation !== undefined ? (
        <p className="wfx-row__reason" data-wfx-capability-limitation>
          {limitation}
        </p>
      ) : null}
    </li>
  );
}

/** The privacy-class vocabulary in user words (the frozen ModelPolicy privacy union). */
const PRIVACY_LABELS: Readonly<Record<string, string>> = {
  "local-only": "Local only",
  "trusted-cloud": "Trusted cloud",
  "any-cloud": "Any cloud",
};

/** One provider row of the Model & AI registry truth table. */
function ProviderRow({ provider }: { readonly provider: ModelProvidersModel["providers"][number] }): JSX.Element {
  return (
    <li className="wfx-queue__item" data-wfx-model-provider={provider.id}>
      <span className="wfx-card__meta">
        <span className="wfx-badge wfx-badge--type">{provider.id}</span>
        <span data-wfx-model-provider-privacy>{provider.privacy === "local" ? "Runs locally" : "Cloud"}</span>
        {provider.byomBound ? (
          <span className="wfx-capchip" data-wfx-model-provider-byom>
            Your provider
          </span>
        ) : null}
        {provider.availability === "available" ? (
          <span className="wfx-capchip" data-wfx-model-provider-available>
            Available
          </span>
        ) : (
          <span className="wfx-capchip" data-wfx-model-provider-unsupported>
            Not available here
          </span>
        )}
      </span>
      <p className="wfx-row__reason" data-wfx-model-provider-capabilities>
        Tasks: {provider.capabilities.join(", ")}
        {provider.byomBound ? " — bound by you (the key stays sealed; never shown)" : ""}
      </p>
    </li>
  );
}

/** One task's policy chip (the honest current state — null = not configured). */
function PolicyChip({ model }: { readonly model: ModelPolicyModel }): JSX.Element {
  const configured = model.status.state === "ready" && model.policy !== null;
  return (
    <li
      className="wfx-queue__item"
      data-wfx-model-policy={model.task}
      data-wfx-model-policy-configured={configured ? "true" : "false"}
    >
      <span className="wfx-card__meta">
        <span className="wfx-badge wfx-badge--type">{model.task}</span>
        {model.status.state === "error" ? (
          <span className="wfx-capchip" data-wfx-model-policy-error>
            Unavailable right now
          </span>
        ) : configured ? (
          <span className="wfx-capchip" data-wfx-model-policy-privacy>
            {PRIVACY_LABELS[model.policy?.privacy ?? ""] ?? model.policy?.privacy}
          </span>
        ) : (
          <span className="wfx-capchip" data-wfx-model-policy-unset>
            Not configured
          </span>
        )}
      </span>
      {configured && model.policy !== null ? (
        <p className="wfx-row__reason" data-wfx-model-policy-detail>
          Preferred: {model.policy.preferredProvider ?? "(first available)"} · fallbacks:
          {" "}
          {model.policy.fallbackProviders.length > 0 ? model.policy.fallbackProviders.join(", ") : "none"}
        </p>
      ) : model.status.state === "error" ? (
        <p className="wfx-row__reason" data-wfx-model-policy-error-detail>
          {model.status.error?.detail ?? "the policy read did not complete"}
        </p>
      ) : (
        <p className="wfx-row__reason" data-wfx-model-policy-unset-detail>
          No model policy configured for this task yet — the first available provider runs it
          when you use an AI action.
        </p>
      )}
    </li>
  );
}

/** The settings surface. */
export function SettingsSurface({
  capabilities,
  session,
  mode,
  section,
  sources,
  byof,
  personalize,
  modelProviders,
  modelPolicies,
}: {
  /** The truthful platform bundle (the runtime's own declaration). */
  readonly capabilities: WebPlatformBundle;
  /** The honest session state (the R02 seam's view). */
  readonly session: WebSessionState;
  /** The boot mode badge context. */
  readonly mode: "fixtures" | "service";
  /** The active settings section (the runtime's navigation payload). */
  readonly section?: "sources" | "model" | "general";
  /** The runtime's sources model (R17: the sources section's data). */
  readonly sources?: SourcesModel;
  /** The BYOF panel view (R20-D: the sources section's feed-import flow). */
  readonly byof?: ByofPanelView;
  /** The R21-D Personalize view (the general section's recommendation management). */
  readonly personalize?: PersonalizeView;
  /** The provider registry model (R21-C: the model section's data). */
  readonly modelProviders?: ModelProvidersModel;
  /** Every task's policy model (R21-C: the model section's data). */
  readonly modelPolicies?: readonly ModelPolicyModel[];
}): JSX.Element {
  const descriptor = capabilities.descriptor;
  const limitations = descriptor.limitations ?? {};
  const storageDescription = capabilities.ports.storage.describe();
  return (
    <div data-wfx-surface="settings" data-wfx-settings>
      <h1 className="wfx-page-title" data-wfx-settings-title>
        Settings
      </h1>
      <p className="wfx-page-subtitle">
        The web adapter&apos;s capability truth — what this platform can and cannot do, stated
        plainly (never guessed, never hidden).
      </p>

      <nav aria-label="Settings sections" data-wfx-settings-sections>
        <a
          className={`wfx-btn wfx-btn--sm${section === "sources" ? " wfx-btn--primary" : ""}`}
          href="/settings?section=sources"
          {...(section === "sources" ? { "aria-current": "page" as const } : {})}
        >
          Sources
        </a>
        <a
          className={`wfx-btn wfx-btn--sm${section === "model" ? " wfx-btn--primary" : ""}`}
          href="/settings?section=model"
          {...(section === "model" ? { "aria-current": "page" as const } : {})}
        >
          Model &amp; AI
        </a>
        <a
          className={`wfx-btn wfx-btn--sm${section === "general" ? " wfx-btn--primary" : ""}`}
          href="/settings?section=general"
          {...(section === "general" ? { "aria-current": "page" as const } : {})}
        >
          General
        </a>
      </nav>

      {section === "sources" ? (
        <section className="wfx-detail__section" aria-label="Sources" data-wfx-settings-sources>
          <h2>Sources</h2>
          {sources !== undefined && sources.status.state === "ready" && sources.sources.length > 0 ? (
            <>
              <p className="wfx-detail__meta">
                The authorization truth of every connected source — an expired sign-in is its own
                named state with its reconnect path (never a silent fallback, never a fake
                connection).
              </p>
              <ul
                className="wfx-queue__list"
                style={{ listStyle: "none", padding: 0 }}
                data-wfx-sources-list
              >
                {sources.sources.map((source) => (
                  <SourceCard key={source.connectorId} source={source} mode={mode} />
                ))}
              </ul>
            </>
          ) : sources !== undefined && sources.status.state === "error" ? (
            <div className="wfx-state" data-wfx-sources-error>
              <span className="wfx-state__icon">
                <Icon name="browser" />
              </span>
              <p className="wfx-state__title">Source states are unavailable right now</p>
              <p className="wfx-state__detail">
                {sources.status.error?.detail ??
                  "the source read did not complete — the last observed states stand"}
                . This host browses whatever its configured service carries — and never pretends a
                source is connected.
              </p>
            </div>
          ) : (
            <div className="wfx-state" data-wfx-sources-empty>
              <span className="wfx-state__icon">
                <Icon name="browser" />
              </span>
              <p className="wfx-state__title">No sources connected</p>
              <p className="wfx-state__detail">
                Choose a supported connector below to connect it — every connected source states its
                authorization truth here (connect, reauthorize, disconnect, per-source
                capabilities). You can also bring your existing feed with the import flow below.
                This host never pretends a source is connected.
              </p>
              <div className="wfx-state__actions">
                <a
                  className="wfx-btn wfx-btn--sm"
                  href="#wfx-source-chooser"
                  data-wfx-sources-connect-cta
                >
                  Connect a source
                </a>
              </div>
            </div>
          )}
          {/* R22-D — the first-connect source chooser (the F2 dead-end
              killer): the empty state now carries the connector chooser
              itself — every supported connector the deployment wires, each
              with its honest state truth + typed action. The CTA above
              scrolls to the chooser; it never loops to the same empty state.
              The initial catalog is the SAME R22-A derivation the chooser
              would fetch (the convergence law: Home and Settings render the
              SAME shared source state — no second navigation system). */}
          <SourceChooser
            mode={mode}
            {...(sources !== undefined
              ? {
                  initialCatalog: sourceCatalogView({
                    sources: sources.sources,
                    authenticated: session.signedIn,
                    status: sources.status,
                  }) as SourceCatalogView,
                }
              : {})}
          />
          {byof !== undefined ? <ByofPanel view={byof} mode={mode} /> : null}
        </section>
      ) : null}

      {section === "model" ? (
        <section className="wfx-detail__section" aria-label="Model and AI" data-wfx-settings-model>
          <h2>Model &amp; AI</h2>
          <p className="wfx-detail__meta">
            The truth about which models can run your AI actions — subtitles, translation,
            transcription, dubbing, and commentary — across first-party, your own providers
            (BYOM), and local models, with each task&apos;s current policy. Provider keys stay
            sealed; they are never shown or sent to a model. AI actions launch from the tray
            where you watch — any title or player; local-model execution runs in the Desktop app.
          </p>
          <p className="wfx-row__reason" data-wfx-model-tray-path>
            <a href="/search">Find a title to transform — the AI action tray lives on every title and player</a>
          </p>
          {modelProviders !== undefined && modelProviders.status.state === "ready" ? (
            <>
              <h3>Providers</h3>
              <ul
                className="wfx-queue__list"
                style={{ listStyle: "none", padding: 0 }}
                data-wfx-model-providers-list
              >
                {modelProviders.providers.map((provider) => (
                  <ProviderRow key={provider.id} provider={provider} />
                ))}
              </ul>
            </>
          ) : modelProviders !== undefined && modelProviders.status.state === "error" ? (
            <div className="wfx-state" data-wfx-model-error>
              <span className="wfx-state__icon">
                <Icon name="sparkle" />
              </span>
              <p className="wfx-state__title">Model controls are unavailable right now</p>
              <p className="wfx-state__detail">
                {modelProviders.status.error?.detail ??
                  "the model-controls read did not complete"}{" "}
                — the AI actions keep their last known truth; retry from this page.
              </p>
            </div>
          ) : (
            <div className="wfx-state" data-wfx-model-loading>
              <span className="wfx-state__icon">
                <Icon name="sparkle" />
              </span>
              <p className="wfx-state__title">Reading the model truth…</p>
              <p className="wfx-state__detail">The provider registry and your task policies load here.</p>
            </div>
          )}
          {modelPolicies !== undefined ? (
            <>
              <h3>Task policies</h3>
              <ul
                className="wfx-queue__list"
                style={{ listStyle: "none", padding: 0 }}
                data-wfx-model-policies-list
              >
                {modelPolicies.map((model) => (
                  <PolicyChip key={model.task} model={model} />
                ))}
              </ul>
            </>
          ) : null}
          {/* R22-F — the BYOM management panel (the F8 closer): the
              normal management entry point over the existing runtime
              operations. The contextual AI tray remains the place to
              USE AI; this panel is the place to MANAGE model providers.
              Consumes Worker 1's R22-C `byomManagementView` derivation
              (the typed binding summary + supported task capabilities +
              privacy mode + availability + add/bind + verify/usable +
              remove/unbind + typed errors/recovery). The provider key
              is the SECRET on its way IN (POST /api/model/byom/bind);
              the transport seals it server-side, answers the secret-free
              handle ONLY — this panel never renders the key. */}
          {modelProviders !== undefined && modelPolicies !== undefined ? (
            <ByomManagementPanel
              view={byomManagementView({
                providers: modelProviders.providers,
                policies: modelPolicies.reduce(
                  (acc, model) => {
                    if (model.policy !== null) {
                      acc[model.task] = model.policy;
                    } else {
                      acc[model.task] = null;
                    }
                    return acc;
                  },
                  {} as Partial<Record<ModelTask, ModelPolicy | null>>,
                ),
                status: modelProviders.status,
              })}
              authenticated={session.signedIn}
            />
          ) : null}

          {/* R23-J — the open-model catalog rows with their REAL license
              truth + the registration truth (a catalog row is not a
              provider until registered); the register/unregister drive is
              the fixtures persona's typed action (loudly badged). */}
          {modelProviders !== undefined && modelProviders.status.state === "ready" ? (
            <OpenModelsSection
              rows={openModelRowsOf(
                modelProviders.providers.map((provider) => provider.id),
                mode,
              )}
            />
          ) : null}

          {/* R23-I — the WebGPU-optional local-inference probe: the frozen
              fallback-chain truth (WebGPU → WASM → remote) with each hop's
              honest privacy impact. */}
          <section className="wfx-detail__section" aria-label="Local inference" data-wfx-local-inference>
            <h2>Private local inference</h2>
            <p className="wfx-row__reason">
              Query understanding can run privately in your browser — WebGPU when available, the
              slower in-browser fallback otherwise, remote only under your policy. WebGPU is
              optional; the chain below is this browser&apos;s honest truth.
            </p>
            <LocalInferenceProbe privacyPolicy="local-only" />
          </section>
        </section>
      ) : null}

      {section === undefined || section === "general" ? (
        <>
          <section
            className="wfx-detail__section"
            aria-label="Profile and identity"
            data-wfx-settings-profile
            data-wfx-settings-session
          >
            <h2>Profile &amp; identity</h2>
            <p className="wfx-card__meta">
              <span className="wfx-badge wfx-badge--type" data-wfx-session-label>
                {session.label}
              </span>
              <span data-wfx-session-state>{session.description}</span>
            </p>
            <p className="wfx-row__reason" data-wfx-session-durability>
              Session stability:{" "}
              {session.sessionDurability === "browser-sessions"
                ? "kept across browser sessions on this device"
                : "kept for this server process (browser storage is not available in this boot context)"}
              . Boot mode: {mode}.
            </p>
            <p className="wfx-row__reason" data-wfx-profile-path>
              Profiles and sign-in travel with your WebFlix service account — a durable profile
              keeps the same watchlist, history, and personalization on every device.
            </p>
            <SessionControls
              signedIn={session.signedIn}
              profiles={session.profile?.profiles ?? []}
              {...(session.profile?.activeProfileId !== undefined
                ? { activeProfileId: session.profile.activeProfileId }
                : {})}
              mode={mode}
            />
          </section>

          <section
            className="wfx-detail__section"
            aria-label="Recommendation and intent"
            data-wfx-settings-recommendation
          >
            <h2>Recommendation &amp; intent</h2>
            {personalize !== undefined ? (
              <p className="wfx-card__meta">
                <span className="wfx-badge wfx-badge--type" data-wfx-attention-mode-label>
                  {personalize.attentionModes.find((entry) => entry.selected)?.label ??
                    personalize.attentionMode}{" "}
                  attention
                </span>
                <span data-wfx-exploration-label>
                  Exploration dial at {Math.round(personalize.exploration * 100)}%
                </span>
                {personalize.intents.length > 0 ? (
                  <span data-wfx-active-intents>
                    {personalize.intents.length} session intent
                    {personalize.intents.length === 1 ? "" : "s"} active
                  </span>
                ) : (
                  <span data-wfx-active-intents>no session intent set</span>
                )}
              </p>
            ) : null}
            <p className="wfx-row__reason">
              The everyday controls live where you browse: Personalize on Home, Watch, and Shorts
              sets a session intent, switches attention mode, and tunes exploration. Session
              intents end with the session — a recent watch is one signal, never permanent
              identity.
            </p>
            <p className="wfx-row__reason">
              <a href="/" data-wfx-recommendation-entry>
                Open Personalize on Home
              </a>
            </p>
          </section>

          <section className="wfx-detail__section" aria-label="Platform capabilities" data-wfx-settings-capabilities>
            <h2>Platform capabilities (the web adapter&apos;s truth)</h2>
            <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }}>
              <CapabilityRow
                area="Storage"
                level={`browser (${storageDescription.kv.backend} kv, ${storageDescription.blobs.backend} blobs)`}
                supported
                limitation={`Durability: kv ${storageDescription.kv.durability}, blobs ${storageDescription.blobs.durability}. ${
                  limitations.storage ?? ""
                }`}
              />
              <CapabilityRow
                area="Contained browser"
                level={capabilities.browserHost}
                supported={capabilities.browserHost === "contained"}
                {...(limitations.browserHost !== undefined ? { limitation: limitations.browserHost } : {})}
              />
              <CapabilityRow
                area="Native media & torrent acquisition"
                level={capabilities.nativeMedia}
                supported={capabilities.nativeMedia !== "none"}
                {...(limitations.nativeMedia !== undefined ? { limitation: limitations.nativeMedia } : {})}
              />
              <CapabilityRow
                area="Background work"
                level={capabilities.backgroundWork}
                supported={capabilities.backgroundWork !== "none"}
                limitation={describeWebBackgroundWork()}
              />
              <CapabilityRow
                area="Sharing"
                level={capabilities.sharing ? "web share api" : "absent in this context"}
                supported={capabilities.sharing}
                {...(capabilities.sharing
                  ? {}
                  : {
                      limitation:
                        "the Web Share API is not present in this boot context — the honest unsupported state (copy-link affordances are plain UI, never a fake OS share)",
                    })}
              />
              <CapabilityRow
                area="Notifications"
                level={capabilities.notifications ? "permission-gated" : "absent in this context"}
                supported={capabilities.notifications}
                limitation={
                  capabilities.notifications
                    ? "delivery requires the user's permission — never fabricated"
                    : "the Web Notifications API is not present in this boot context"
                }
              />
            </ul>
            <p className="wfx-row__reason" data-wfx-capability-descriptor>
              Adapter {descriptor.adapterId} v{descriptor.adapterVersion} on platform &apos;
              {descriptor.platform}&apos; — the runtime booted on this declaration and re-checks
              it (a lying bundle cannot boot).
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
