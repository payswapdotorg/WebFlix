/**
 * @wfx/app-web — the host surface (R07).
 *
 * Public entry for the Next.js App Router (and any future host): the boot
 * law (config), the ONE runtime composition root (`web-host.ts`), the
 * session seam, the view pipelines, the shorts projection, and the
 * platform bundle. Everything a request path needs to boot the adapter
 * honestly.
 */

export * from "./config";
export * from "./session";
export * from "./web-host";
export * from "./view-models";
export * from "./shorts";
export * from "./version";
