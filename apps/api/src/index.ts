/**
 * @wfx/app-api — the Experience API service (WFX-055A).
 *
 * The service-lane Next.js host: route handlers ONLY (no pages), all
 * `force-dynamic`, Node.js runtime. The public surface of the package is
 * its host layer — the boot law, the fan-out connector, and the version
 * constants — so tests (and curious operators) can import the exact
 * pieces the routes compose.
 */

export * from "./host/config";
export * from "./host/version";
export * from "./host/fan-out";
export * from "./host/boot";
export * from "./host/relay";
