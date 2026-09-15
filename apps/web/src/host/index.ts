/**
 * @wfx/app-web — the host boot surface (WFX-050).
 *
 * Public entry for the Next.js App Router (and any future host): the
 * config law, the port selection, the remote service ports, and the home
 * surface data pipeline. Everything a request path needs to boot honestly.
 */

export * from "./config";
export * from "./default-ports";
export * from "./remote-ports";
export * from "./boot";
export * from "./home";
export * from "./version";
