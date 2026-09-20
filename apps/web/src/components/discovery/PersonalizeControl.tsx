"use client";

/**
 * @wfx/app-web — the Personalize control (R21-D, client).
 *
 * The everyday RECOMMENDATION control of the Home / Watch / Shorts
 * surfaces: state a temporary intent for this session ("what are you in
 * the mood for?"), switch attention mode (mindful / balanced / immersive
 * / custom — the frozen vocabulary), and set the exploration dial. All
 * writes go through `/api/personalize` (the RUNTIME's intent + policy
 * seams — never a second policy owner); the honest answer is the
 * runtime's typed result:
 *
 * - a session intent is SESSION-SCOPED (it never persists as long-term
 *   preference — the IntentStore law) and CLEARABLE on the spot (the
 *   recovery path the R21-A matrix binds);
 * - an attention-mode switch changes policy BEHAVIOR (the short feed's
 *   re-rank thresholds follow the mode — mode is policy, not cosmetics);
 * - every failure answers the typed detail (never a fake success), and
 *   the detailed management path (Settings) is one link away.
 *
 * Progressive disclosure (two laws at once): the panel is a native
 * `<details>` disclosure — quiet until invoked (the frozen design
 * language), keyboard-operable for free, and its CONTENT renders in the
 * server HTML (no hydration gate on discoverability). The exploration
 * dial commits on pointer/key release (never a POST per drag step).
 */

import { useCallback, useState, type JSX } from "react";

import type { PersonalizeView } from "@/host/discoverability";

/** The typed result of one personalize write. */
interface PersonalizeResult {
  readonly ok: boolean;
  readonly detail: string | null;
}

export function PersonalizeControl({
  view,
  surface,
}: {
  /** The Personalize view (the runtime's policy + intent read). */
  readonly view: PersonalizeView;
  /** The surface the control renders on (aria + analytics vocabulary). */
  readonly surface: "home" | "watch" | "shorts";
}): JSX.Element {
  const [objective, setObjective] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<PersonalizeResult | null>(null);

  const post = useCallback(async (body: Record<string, unknown>, label: string) => {
    setPending(label);
    setResult(null);
    try {
      const response = await fetch("/api/personalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        setResult({ ok: false, detail: errorBody?.error ?? "the change could not be saved" });
      } else {
        if (typeof window !== "undefined") window.location.reload();
      }
    } catch (thrown) {
      setResult({
        ok: false,
        detail: thrown instanceof Error ? thrown.message : "the change could not be saved",
      });
    } finally {
      setPending(null);
    }
  }, []);

  const currentMode =
    view.attentionModes.find((mode) => mode.selected) ??
    view.attentionModes.find((mode) => mode.id === "balanced") ??
    view.attentionModes[0];
  const currentModeLabel = currentMode !== undefined ? currentMode.label : view.attentionMode;

  return (
    <details className="wfx-disc__personalize" data-wfx-personalize-control data-wfx-personalize-surface={surface}>
      <summary className="wfx-disc__personalize-toggle" data-wfx-personalize-toggle>
        <span className="wfx-disc__personalize-summary">
          Personalize · {currentModeLabel}
          {view.intents.length > 0 ? (
            <span className="wfx-disc__intentmark" data-wfx-personalize-intent-mark>
              intent set
            </span>
          ) : null}
        </span>
      </summary>
      <div className="wfx-disc__personalize-panel" data-wfx-personalize-panel>
        <section aria-label="Session intent" className="wfx-disc__psection">
          <p className="wfx-disc__plabel">Tell WebFlix what you&apos;re in the mood for</p>
          {view.intents.length > 0 ? (
            <ul className="wfx-disc__intents" data-wfx-personalize-intents>
              {view.intents.map((intent) => (
                <li key={`${intent.scope}:${intent.objective}`} data-wfx-personalize-intent>
                  <span>&ldquo;{intent.objective}&rdquo;</span>
                  <span className="wfx-disc__intentexpiry">— {intent.expiryLabel}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wfx-disc__phint">
              A session intent shapes what surfaces next — it stays for this session and never
              becomes a permanent preference.
            </p>
          )}
          <form
            className="wfx-disc__intentform"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = objective.trim();
              if (trimmed.length === 0) return;
              void post({ kind: "intent", objective: trimmed }, "intent");
            }}
          >
            <input
              className="wfx-disc__input"
              type="text"
              value={objective}
              maxLength={120}
              placeholder="e.g. cozy documentaries tonight"
              aria-label="What are you in the mood for?"
              data-wfx-personalize-objective
              onChange={(event) => {
                setObjective(event.target.value);
              }}
            />
            <button
              type="submit"
              className="wfx-btn wfx-btn--sm"
              disabled={pending !== null || objective.trim().length === 0}
              data-wfx-personalize-set-intent
            >
              Set for this session
            </button>
            {view.intents.length > 0 ? (
              <button
                type="button"
                className="wfx-disc__linkbtn"
                disabled={pending !== null}
                data-wfx-personalize-clear-intent
                onClick={() => {
                  void post({ kind: "clear-intent" }, "clear");
                }}
              >
                Clear intent
              </button>
            ) : null}
          </form>
        </section>
        <section aria-label="Attention mode" className="wfx-disc__psection">
          <p className="wfx-disc__plabel">How this session treats your time</p>
          <div className="wfx-disc__moderow" role="radiogroup" aria-label="Attention mode">
            {view.attentionModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={mode.selected}
                className={`wfx-disc__modechip${mode.selected ? " wfx-disc__modechip--active" : ""}`}
                data-wfx-attention-mode={mode.id}
                {...(mode.selected ? { "data-wfx-attention-current": "true" } : {})}
                title={mode.description}
                disabled={pending !== null}
                onClick={() => {
                  void post({ kind: "attention", attentionMode: mode.id }, mode.id);
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="wfx-disc__phint" data-wfx-attention-description>
            {currentMode !== undefined ? currentMode.description : "How this session treats your time."}
          </p>
        </section>
        <section aria-label="Exploration" className="wfx-disc__psection">
          <label className="wfx-disc__plabel" htmlFor="wfx-disc-exploration">
            Explore beyond what you watch
          </label>
          <input
            id="wfx-disc-exploration"
            className="wfx-disc__range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={view.exploration}
            data-wfx-exploration-dial
            onPointerUp={(event) => {
              const value = Number.parseFloat((event.target as HTMLInputElement).value);
              if (Number.isFinite(value)) {
                void post({ kind: "exploration", value }, "exploration");
              }
            }}
            onKeyUp={(event) => {
              const value = Number.parseFloat((event.target as HTMLInputElement).value);
              if (Number.isFinite(value)) {
                void post({ kind: "exploration", value }, "exploration");
              }
            }}
          />
          <p className="wfx-disc__phint">
            Higher values surface more titles outside your usual lanes — your watch history is
            one signal, never a permanent identity.
          </p>
        </section>
        {result !== null ? (
          <p className="wfx-disc__failure" data-wfx-personalize-failure role="alert">
            {result.detail}
          </p>
        ) : null}
        <a className="wfx-disc__link" href={view.manageHref} data-wfx-personalize-manage>
          Recommendation &amp; intent settings
        </a>
      </div>
    </details>
  );
}
