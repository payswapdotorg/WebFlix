"use client";

/**
 * @wfx/app-web — the item/player feedback controls (R21-E, client).
 *
 * The contextual RECOMMENDATION-FEEDBACK entry the R21-A matrix binds
 * to the item decision hub and the player: the frozen J15 vocabulary
 * (More like this / Not interested / Don't recommend this source /
 * I've already watched this) with its recovery path — every recorded
 * control is listed and UNDOABLE on the spot ("you cannot undo what you
 * cannot see").
 *
 * Writes go through `/api/feedback` (the service's R05 policy surface —
 * the one owner; the route proxies it in service mode and drives the
 * deterministic persona in fixtures mode). The honest answer is typed:
 * a failure names its reason (never a fake "feedback saved"), and the
 * recorded chips carry their undo.
 *
 * R35 (B4) — THE VIEWER-FACING FAILURE ELEMENT: a failing write renders
 * HONEST VIEWER COPY through `host/feedback-viewer-copy.ts` — the
 * identity-required class (the anonymous session on the service boot)
 * names what failed and offers the SIGN-IN RECOVERY PATH (the same
 * `/settings?section=general` entry the player's progress-scope row
 * offers); any raw-JSON body (a shape this law never wrote) renders the
 * honest generic prose instead. The typed detail goes to `console.warn`
 * (the engineer's evidence — never `error`, the journey gates watch
 * errors). NEVER a fabricated success: the failure element stays
 * `role="alert"` and the recorded-set truth stays the route's alone.
 *
 * The controls render in the server HTML (a client island whose static
 * content is SSR'd — no hydration gate on discoverability); the
 * recorded-set read loads on mount.
 */

import { useCallback, useEffect, useState, type JSX } from "react";

import { FEEDBACK_CONTROLS } from "@wfx/client-runtime";

import {
  FEEDBACK_SIGN_IN_HREF,
  viewerFailureCopyOf,
} from "@/host/feedback-viewer-copy";

/** One recorded feedback control (the route's record shape). */
interface FeedbackRecord {
  readonly id: string;
  readonly kind: string;
  readonly target: string;
  readonly createdAt: string;
}

/**
 * The typed failure body the route answers (the B4 law's closed shape:
 * the viewer-safe `error` + the engineer's `detail`).
 */
export interface FeedbackFailureBody {
  readonly error: string;
  readonly detail?: string;
}

/** The label of one recorded control (the same frozen vocabulary). */
function labelOf(kind: string): string {
  return FEEDBACK_CONTROLS.find((control) => control.kind === kind)?.label ?? kind;
}

/**
 * R35 (B4) — read one failing response's body through the copy law's
 * closed shape: the viewer-safe `error` + the engineer's `detail` (the
 * detail warns to the console — never renders, never `error`: the
 * journey gates watch errors and a typed refusal is warn-grade truth).
 * Module-scope pure (no component state).
 */
async function failureFromBody(response: Response): Promise<FeedbackFailureBody> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    detail?: string;
  } | null;
  if (body?.detail !== undefined && body.detail.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`wfx-feedback: ${body.detail}`); // the engineer's evidence channel (the UpdatePrompt precedent)
  }
  return {
    error: typeof body?.error === "string" ? body.error : "the feedback could not be saved",
    ...(body?.detail !== undefined ? { detail: body.detail } : {}),
  };
}

/**
 * R35 (B4) — THE VIEWER-FACING FAILURE ELEMENT: the honest copy + the
 * sign-in recovery path. Exported for its own law's test (the same
 * element the controls render — never a second code path). The raw
 * typed error NEVER renders here (the copy law maps it); a fabricated
 * success NEVER renders here (the element is a failure element).
 */
export function FeedbackFailure({
  failure,
}: {
  readonly failure: FeedbackFailureBody;
}): JSX.Element {
  const { copy, offersSignIn } = viewerFailureCopyOf(failure);
  return (
    <p
      className="wfx-disc__failure"
      data-wfx-feedback-failure
      role="alert"
      {...(offersSignIn ? { "data-wfx-feedback-identity-required": "true" } : {})}
    >
      {copy}
      {offersSignIn ? (
        <>
          {" "}
          <a className="wfx-disc__linkbtn" href={FEEDBACK_SIGN_IN_HREF} data-wfx-feedback-signin>
            Sign in
          </a>
        </>
      ) : null}
    </p>
  );
}

export function FeedbackControls({
  target,
  sourceId,
  surface,
}: {
  /** The canonical item id the feedback targets. */
  readonly target: string;
  /** The source id (the don't-recommend-source control's target). */
  readonly sourceId: string;
  /** The surface the controls render on. */
  readonly surface: "item" | "player";
}): JSX.Element {
  const [records, setRecords] = useState<readonly FeedbackRecord[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<FeedbackFailureBody | null>(null);
  const [loaded, setLoaded] = useState(false);

  const read = useCallback(async () => {
    try {
      const response = await fetch(`/api/feedback?target=${encodeURIComponent(target)}`);
      if (response.ok) {
        const body = (await response.json()) as { controls?: readonly FeedbackRecord[] };
        setRecords(Array.isArray(body.controls) ? body.controls : []);
      }
    } catch {
      // The read's honest absence: the controls still render and submit;
      // only the recorded list stays unread (never fabricated).
    } finally {
      setLoaded(true);
    }
  }, [target]);

  useEffect(() => {
    void read();
  }, [read]);

  const record = useCallback(
    async (kind: string, kindTarget: string) => {
      setPending(kind);
      setFailure(null);
      try {
        const response = await fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, target: kindTarget }),
        });
        if (!response.ok) {
          setFailure(await failureFromBody(response));
        } else {
          await read(); // the recorded truth (never a fabricated echo)
        }
      } catch (thrown) {
        setFailure({
          error: thrown instanceof Error ? thrown.message : "the feedback could not be saved",
        });
      } finally {
        setPending(null);
      }
    },
    [read],
  );

  const undo = useCallback(
    async (id: string) => {
      setPending(id);
      setFailure(null);
      try {
        const response = await fetch(`/api/feedback?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!response.ok) {
          setFailure(await failureFromBody(response));
        } else {
          await read();
        }
      } catch (thrown) {
        setFailure({ error: thrown instanceof Error ? thrown.message : "the undo failed" });
      } finally {
        setPending(null);
      }
    },
    [read],
  );

  return (
    <section
      className="wfx-detail__section"
      aria-label="Recommendation feedback"
      data-wfx-feedback-controls
      data-wfx-feedback-surface={surface}
    >
      <h3>Shape what WebFlix shows you next</h3>
      <div className="wfx-disc__feedback-row" data-wfx-feedback-buttons>
        {FEEDBACK_CONTROLS.map((control) => {
          const kindTarget =
            control.kind === "not-interested-source" ? sourceId : target;
          const recorded = records.some((entry) => entry.kind === control.kind && entry.target === kindTarget);
          return (
            <button
              key={control.kind}
              type="button"
              className={`wfx-disc__feedbackbtn${recorded ? " wfx-disc__feedbackbtn--recorded" : ""}`}
              disabled={pending !== null}
              data-wfx-feedback={control.kind}
              {...(recorded ? { "data-wfx-feedback-recorded": "true" } : {})}
              onClick={() => {
                void record(control.kind, kindTarget);
              }}
            >
              {control.label}
            </button>
          );
        })}
      </div>
      {records.length > 0 ? (
        <ul className="wfx-disc__feedbackrecords" data-wfx-feedback-records>
          {records.map((entry) => (
            <li key={entry.id} data-wfx-feedback-record={entry.kind}>
              <span>{labelOf(entry.kind)}</span>
              <button
                type="button"
                className="wfx-disc__linkbtn"
                disabled={pending !== null}
                data-wfx-feedback-undo={entry.id}
                onClick={() => {
                  void undo(entry.id);
                }}
              >
                Undo
              </button>
            </li>
          ))}
        </ul>
      ) : loaded ? (
        <p className="wfx-disc__phint" data-wfx-feedback-none>
          Feedback is immediate and reversible — undoing restores the signal.
        </p>
      ) : null}
      {failure !== null ? <FeedbackFailure failure={failure} /> : null}
    </section>
  );
}
