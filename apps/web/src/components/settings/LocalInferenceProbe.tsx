"use client";

/**
 * @wfx/app-web — the local-inference environment probe (R23-I, the
 * WebGPU-optional law).
 *
 * A CLIENT island: probes the viewer's browser for WebGPU (the OPTIONAL
 * fast local hop) and renders the frozen fallback-chain truth through
 * `localInferenceRoute` (WebGPU → WASM → remote, each hop with its
 * honest privacy impact; a local-only policy refuses the remote hop —
 * the task stays local or stays off, never silently leaving the device).
 *
 * WebGPU is OPTIONAL and never assumed: a browser without it renders the
 * honest WASM/remote/`local-unavailable` route, never a fabricated
 * capability.
 */

import type { JSX } from "react";
import { useEffect, useState } from "react";

import { localInferenceRoute } from "@wfx/model-fabric";
import type { LocalInferenceTaskKind } from "@wfx/model-fabric";

/** The probe's typed state (the environment read is client-side only). */
type ProbeState =
  | { readonly kind: "probing" }
  | { readonly kind: "read"; readonly webgpu: boolean; readonly wasm: boolean };

/** The local-inference probe (renders on the Model & AI surface). */
export function LocalInferenceProbe({
  privacyPolicy = "local-only",
}: {
  /** The governing privacy policy (the frozen ModelPolicy vocabulary). */
  readonly privacyPolicy?: "local-only" | "trusted-cloud" | "any-cloud";
}): JSX.Element {
  const [state, setState] = useState<ProbeState>({ kind: "probing" });

  useEffect(() => {
    const globals = globalThis as { gpu?: unknown; WebAssembly?: unknown };
    setState({
      kind: "read",
      webgpu: typeof globals.gpu === "object" && globals.gpu !== null,
      wasm: typeof globals.WebAssembly === "object" && globals.WebAssembly !== null,
    });
  }, []);

  // The frozen derivation, verbatim — for the private search task (the
  // R23-I lane's flagship: query embeddings stay on this device).
  const task: LocalInferenceTaskKind = "query-embeddings";
  const route =
    state.kind === "read"
      ? localInferenceRoute(
          task,
          { webgpuAvailable: state.webgpu, wasmAvailable: state.wasm },
          privacyPolicy,
        )
      : null;

  return (
    <div
      data-wfx-local-inference-probe={state.kind}
      data-wfx-local-inference-route={route?.kind ?? "probing"}
    >
      {route !== null ? (
        <>
          <p className="wfx-row__reason" data-wfx-local-inference-detail>
            {route.detail}
          </p>
          {"privacyImpact" in route ? (
            <p className="wfx-player__trace" data-wfx-local-inference-privacy>
              Privacy impact:{" "}
              {route.privacyImpact === "local-only"
                ? "local-only — nothing leaves this device"
                : "input leaves this device"}
              .
            </p>
          ) : null}
          {route.kind === "local-unavailable" ? (
            <p className="wfx-row__reason" data-wfx-local-inference-recovery>
              {route.recovery}
            </p>
          ) : null}
        </>
      ) : (
        <p className="wfx-row__reason">Checking this browser&apos;s local-inference support…</p>
      )}
    </div>
  );
}
