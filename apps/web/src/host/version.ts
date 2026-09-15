/**
 * @wfx/app-web — host version constant (WFX-050).
 *
 * Single source of truth for the `version` field reported by
 * `GET /api/health` (the WFX-056 deployment-verification endpoint) and by
 * the remote connector descriptor this host presents.
 *
 * The value mirrors `apps/web/package.json` `version`. It is asserted
 * against that file by `tests/host-boot.test.ts` so the two can never drift
 * silently. It is a CONSTANT — no build-time injection, no environment
 * reads — so the health answer is deterministic for a given commit.
 */

/** The web host's version (mirrors apps/web/package.json `version`). */
export const WEB_HOST_VERSION = "0.1.0";

/** The service identity reported by `GET /api/health`. */
export const WEB_HOST_SERVICE = "webflix-web";
