/**
 * @wfx/app-web — the host boot surface (WFX-050; WFX-051 experience shell).
 *
 * Public entry for the Next.js App Router (and any future host): the config
 * law, the port selection, the remote service ports, and the experience
 * surface pipelines (views, shorts projection, identity join, watch-state
 * recording). Everything a request path needs to boot honestly.
 *
 * WFX-051 note: the 050 minimal home pipeline (`host/home.ts`) was
 * superseded by the experience view pipelines (`host/views.ts` +
 * `host/experience.ts` — the same 050 boot law, richer projections). The
 * fixed anonymous context lives on as `EXPERIENCE_CONTEXT`.
 */

export * from "./config";
export * from "./default-ports";
export * from "./remote-ports";
export * from "./boot";
export * from "./experience";
export * from "./canon";
export * from "./watch-state";
export * from "./shorts";
export * from "./views";
export * from "./version";
