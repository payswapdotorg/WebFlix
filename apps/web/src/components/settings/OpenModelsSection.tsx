/**
 * @wfx/app-web — the open-models section of Model & AI (R23-J
 * consumption, the J39 registration walk).
 *
 * The researched open-model catalog's honest rows: the R2T2 live-speech
 * route (with its REAL license truth — code Apache 2.0, weights the
 * NetEase Model Use License Agreement — exactly the distinction, never
 * an assumed Apache dependency), the batch companions, each with its
 * registration truth (a catalog row is NOT a provider until registered)
 * and the R23-J model-authority boundary rendered as product truth.
 *
 * Server component; the register/unregister drive is the client
 * `OpenModelActions` island (fixtures mode only — the loud dev badge;
 * service mode renders the honest platform truth).
 */

import type { JSX } from "react";

import { R2T2_OPEN_MODEL } from "@wfx/model-fabric";

import { OpenModelActions } from "@/components/settings/OpenModelActions";

/** One open-model row's view. */
export interface OpenModelRowView {
  readonly providerId: string;
  readonly modelId: string;
  readonly licenseSentence: string;
  readonly tasks: readonly string[];
  readonly latencyProfile: string;
  /** One honest sentence about what the model contributes. */
  readonly detail: string;
  readonly registered: boolean;
  /** The one-sentence registration truth. */
  readonly registrationSentence: string;
  /** Whether the register drive is available (fixtures mode only). */
  readonly driveAvailable: boolean;
}

/** Build the catalog rows' views from the current registry read (pure). */
export function openModelRowsOf(
  registeredProviderIds: readonly string[],
  mode: "fixtures" | "service",
): readonly OpenModelRowView[] {
  const registered = new Set(registeredProviderIds);
  const rows: readonly {
    providerId: string;
    modelId: string;
    license: { codeLicense: string; weightsLicense: string };
    tasks: readonly string[];
    latencyProfile: string;
    detail: string;
  }[] = [
    {
      providerId: R2T2_OPEN_MODEL.providerId,
      modelId: R2T2_OPEN_MODEL.modelId,
      license: R2T2_OPEN_MODEL.license,
      tasks: R2T2_OPEN_MODEL.supportedTasks,
      latencyProfile: "live streaming (low latency)",
      detail:
        "The live-captions and voice-input route: true streaming with committed output, typically well under a second behind the audio.",
    },
    {
      providerId: "open-model:moss-transcribe-diarize",
      modelId: "OpenMOSS-Team/MOSS-Transcribe-Diarize",
      license: { codeLicense: "Apache-2.0", weightsLicense: "Apache-2.0" },
      tasks: ["transcription"],
      latencyProfile: "batch",
      detail:
        "The long-form companion: multi-speaker transcription with speaker labels, timestamps, and acoustic-event awareness.",
    },
  ];
  return rows.map((row) => ({
    providerId: row.providerId,
    modelId: row.modelId,
    licenseSentence: `Code ${row.license.codeLicense} · weights ${row.license.weightsLicense}`,
    tasks: row.tasks,
    latencyProfile: row.latencyProfile,
    detail: row.detail,
    registered: registered.has(row.providerId),
    registrationSentence: registered.has(row.providerId)
      ? "Registered — this model serves its tasks through your registry."
      : "Not registered — a catalog row is not a provider until registered.",
    driveAvailable: mode === "fixtures",
  }));
}

/** The open-models section. */
export function OpenModelsSection({
  rows,
}: {
  readonly rows: readonly OpenModelRowView[];
}): JSX.Element {
  return (
    <section className="wfx-detail__section" aria-label="Open models" data-wfx-openmodels>
      <h2>Open models</h2>
      <p className="wfx-row__reason" data-wfx-openmodels-intro>
        Researched open models with their honest licenses, tasks, and registration truth — no model
        authorizes a playback or acquisition action; your policy and choices stay yours.
      </p>
      <ul>
        {rows.map((row) => (
          <li
            key={row.providerId}
            className="wfx-queue__item"
            data-wfx-openmodel={row.providerId}
            data-wfx-openmodel-registered={row.registered ? "true" : "false"}
          >
            <p className="wfx-detail__meta">
              <strong data-wfx-openmodel-name>{row.modelId}</strong>
              <span className="wfx-capchip" data-wfx-openmodel-license>
                {row.licenseSentence}
              </span>
              <span className="wfx-capchip">{row.latencyProfile}</span>
              {row.registered ? (
                <span className="wfx-badge wfx-badge--state" data-wfx-openmodel-state>
                  Registered
                </span>
              ) : (
                <span className="wfx-badge wfx-badge--type" data-wfx-openmodel-state>
                  Catalog only
                </span>
              )}
            </p>
            <p className="wfx-row__reason" data-wfx-openmodel-detail>
              {row.detail} Serves: {row.tasks.join(", ")}. {row.registrationSentence}
            </p>
            {row.driveAvailable ? (
              <OpenModelActions providerId={row.providerId} registered={row.registered} />
            ) : (
              <p className="wfx-row__reason" data-wfx-openmodel-platform-truth>
                Registration is served by the platform&apos;s model runtime — this surface carries
                the registry truth.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
