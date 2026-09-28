/**
 * @wfx/app-web — the feedback failure's VIEWER-FACING COPY law (R35, the
 * R34-A ledger's B4 copy/recovery fix).
 *
 * THE B4 ROW (verbatim from evidence/r34a/LEDGER.md): the anonymous
 * recommendation-feedback submit rendered the service's raw typed error
 * verbatim in the failure element — `{"error":"invalid-request",
 * "detail":"x-wfx-user-id: required identity header is absent (identity
 * travels as headers, never in URLs)"}` — honest (never a fake success —
 * the honesty law held) but ENGINEERING-GRADE copy on a viewer-facing
 * surface, with no user-facing recovery path (the sign-in upgrade)
 * offered.
 *
 * THE ONE LAW THIS MODULE OWNS (both sides of the transport):
 *
 * - THE ROUTE maps the service's typed failures into a CLOSED,
 *   viewer-safe vocabulary before they can reach a page: the
 *   identity-absent class (the anonymous session on the service boot —
 *   the service's own honest 400) answers the code `identity-required`;
 *   every other service body answers the honest viewer prose — NEVER the
 *   raw service body (which is JSON). The typed truth rides the
 *   response's `detail` field (the network tab keeps the engineer's
 *   evidence).
 * - THE CLIENT maps that vocabulary into the viewer copy: what failed,
 *   in the product's own voice, plus THE RECOVERY PATH (the sign-in
 *   upgrade — the same `/settings?section=general` entry the player's
 *   progress-scope row offers). The typed detail goes to the console
 *   (`console.warn` — never `error`: the journey console gates watch
 *   errors, and a typed refusal is a warn-grade truth, not a crash).
 * - NEVER a fabricated success: the failure element stays `role="alert"`
 *   and the recorded-set truth stays the route's alone (the chips never
 *   render recorded on a failed write).
 *
 * Pure module (no server deps): imported by the route (server) and the
 * feedback controls (the client island) — one law, both sides.
 */

/** The closed failure code: the session identity the feedback record
 *  needs is absent (the anonymous service-boot submit). */
export const FEEDBACK_IDENTITY_REQUIRED_CODE = "identity-required";

/**
 * The sign-in recovery entry — the app's one sign-in surface, the same
 * href the player's progress-scope row links (the R14 upgrade path).
 */
export const FEEDBACK_SIGN_IN_HREF = "/settings?section=general";

/**
 * The viewer-facing copy for the identity-required failure: what failed +
 * the recovery path, in the product's own voice (the honest-absence
 * inventory's register — name the failure, name the recovery, never
 * fabricate).
 */
export const FEEDBACK_IDENTITY_REQUIRED_COPY =
  "This feedback wasn't recorded — WebFlix saves recommendation feedback with a session. Sign in to record it and shape what you see next.";

/**
 * The honest generic viewer copy (the route's own prose answers already
 * follow this voice; the client's sanitize path falls back to it when a
 * body this law never wrote arrives — never raw JSON on the surface).
 */
export const FEEDBACK_GENERIC_FAILURE_COPY =
  "the feedback could not be saved right now — retry in a moment";

/**
 * The typed detail a service body carries, extracted honestly: the
 * service answers JSON (`{error, detail}` or `{ok, detail}`); a
 * non-JSON body rides verbatim (the engineer's raw truth). Never throws.
 */
export function serviceDetailText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { detail?: unknown };
      if (typeof parsed?.detail === "string" && parsed.detail.length > 0) {
        return parsed.detail;
      }
    } catch {
      // Not adapter-shaped JSON: the raw text is the detail (below).
    }
  }
  return trimmed;
}

/**
 * Does the typed detail name the identity-absent class? (The service's
 * own 400 — `x-wfx-user-id: required identity header is absent` — the
 * anonymous submit on the service boot; the ledger's B4 quote.)
 */
export function isIdentityAbsentDetail(detail: string): boolean {
  return detail.includes("x-wfx-user-id") || detail.includes("identity header is absent");
}

/**
 * THE ROUTE-SIDE MAP: one service failure body → the viewer-safe answer.
 *
 * - The identity-absent class answers the closed code (the client renders
 *   the copy + the sign-in recovery path); the typed detail rides
 *   `detail`.
 * - Every other body answers the caller's honest viewer prose (each
 *   route branch owns its own); the typed detail rides `detail` when one
 *   exists.
 *
 * The status mapping stays the caller's (the service's own typed status —
 * a failure answers a failure status, NEVER a fake success).
 */
export function viewerFailureOfServiceDetail(
  raw: string,
  fallbackProse: string,
): { readonly error: string; readonly detail?: string } {
  const detail = serviceDetailText(raw);
  if (isIdentityAbsentDetail(detail)) {
    return { error: FEEDBACK_IDENTITY_REQUIRED_CODE, detail };
  }
  return detail.length > 0 ? { error: fallbackProse, detail } : { error: fallbackProse };
}

/**
 * THE CLIENT-SIDE MAP: one route failure body → the copy the failure
 * element renders (+ whether the sign-in recovery path offers).
 *
 * - The identity-required class → the viewer copy + the recovery path.
 * - A body that looks like raw JSON (a body this law never wrote — the
 *   pre-R35 passthrough shape) → the honest generic prose: the raw text
 *   goes to the console instead (the engineer's evidence, never the
 *   viewer's surface).
 * - Anything else → the route's own prose (already viewer voice).
 */
export function viewerFailureCopyOf(body: {
  readonly error?: string;
  readonly detail?: string;
}): { readonly copy: string; readonly offersSignIn: boolean } {
  if (body.error === FEEDBACK_IDENTITY_REQUIRED_CODE) {
    return { copy: FEEDBACK_IDENTITY_REQUIRED_COPY, offersSignIn: true };
  }
  const text = typeof body.error === "string" ? body.error.trim() : "";
  if (text.startsWith("{") || text.startsWith("[")) {
    return { copy: FEEDBACK_GENERIC_FAILURE_COPY, offersSignIn: false };
  }
  return {
    copy: text.length > 0 ? text : FEEDBACK_GENERIC_FAILURE_COPY,
    offersSignIn: false,
  };
}
