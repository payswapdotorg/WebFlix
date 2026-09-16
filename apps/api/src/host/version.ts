/**
 * @wfx/app-api — service version constants (WFX-055A).
 *
 * Single source of truth for the `version` field reported by
 * `GET /api/health` (the WFX-056 deployment-verification convention,
 * mirrored from the web host) and by the fan-out connector descriptor this
 * service presents.
 *
 * The value mirrors `apps/api/package.json` `version`. It is a CONSTANT —
 * no build-time injection, no environment reads — so the health answer is
 * deterministic for a given commit.
 */

/** The Experience API service's version (mirrors apps/api/package.json `version`). */
export const API_SERVICE_VERSION = "0.1.0";

/** The service identity reported by `GET /api/health`. */
export const API_SERVICE_NAME = "webflix-api";
