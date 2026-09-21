"use client";

/**
 * @wfx/app-web — the share control (R24-W2, the R24-C share row:
 * "Canonical WebFlix link + source link when appropriate").
 *
 * THE FAMILIAR SHARE GRAMMAR, HONESTLY BACKED: one share control at
 * every content decision (cards, the item hub, the player) carrying the
 * CANONICAL WebFlix link (the item/player href — the clipboard copy +
 * the platform's own share sheet where the browser exposes one), with
 * the SOURCE link offered beside it where a source URL exists. The
 * control never fabricates a source link (an external-only reference
 * renders the canonical link alone).
 */

import { useCallback, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";

/** The share control's serialized input (server-computed per render). */
export interface ShareControlProps {
  /** The canonical WebFlix link (the item hub or the player href). */
  readonly canonicalHref: string;
  /** The canonical link's plain-language name (what the copy carries). */
  readonly title: string;
  /** The source's own URL, when one exists (offered beside the canonical link). */
  readonly sourceUrl?: string;
  /** The source's id (the label of the source link). */
  readonly sourceId?: string;
}

/** The typed copy outcome the control renders verbatim. */
interface CopyOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/** Copy one link (the clipboard API with the typed fallback truth). */
async function copyLink(link: string): Promise<CopyOutcome> {
  try {
    await navigator.clipboard.writeText(link);
    return { ok: true, detail: "Link copied" };
  } catch {
    return {
      ok: false,
      detail: "This browser did not allow the clipboard copy — the link is selected for manual copying.",
    };
  }
}

/** The share control: the canonical link + the source link + the OS sheet. */
export function ShareControl(props: ShareControlProps): JSX.Element {
  const [outcome, setOutcome] = useState<CopyOutcome | null>(null);

  const shareSheetAvailable =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const onCanonicalCopy = useCallback(async (): Promise<void> => {
    setOutcome(await copyLink(props.canonicalHref));
  }, [props.canonicalHref]);

  const onShareSheet = useCallback(async (): Promise<void> => {
    if (typeof navigator.share !== "function") return;
    try {
      await navigator.share({ title: props.title, url: props.canonicalHref });
      setOutcome({ ok: true, detail: "Shared" });
    } catch {
      setOutcome({ ok: false, detail: "The share sheet was dismissed — nothing was shared." });
    }
  }, [props.canonicalHref, props.title]);

  // A native disclosure: the share panel renders in the markup (closed by
  // default), keyboard-operable for free — the same progressive-disclosure
  // grammar the product's other surfaces use.
  return (
    <details className="wfx-share" data-wfx-share>
      <summary className="wfx-btn wfx-btn--sm" aria-label={`Share ${props.title}`} data-wfx-share-toggle>
        <Icon name="share" size={16} />
        Share
      </summary>
      <div className="wfx-share__panel" data-wfx-share-panel>
        <button type="button" className="wfx-share__row" onClick={() => void onCanonicalCopy()} data-wfx-share-copy>
          <Icon name="link" size={16} />
          <span>Copy WebFlix link</span>
        </button>
        {props.sourceUrl !== undefined ? (
          <a className="wfx-share__row" href={props.sourceUrl} target="_blank" rel="noopener noreferrer" data-wfx-share-source>
            <Icon name="external" size={16} />
            <span>Open on {props.sourceId ?? "the source"}</span>
          </a>
        ) : null}
        {shareSheetAvailable ? (
          <button type="button" className="wfx-share__row" onClick={() => void onShareSheet()} data-wfx-share-sheet>
            <Icon name="share" size={16} />
            <span>Share through this device</span>
          </button>
        ) : null}
        <code className="wfx-share__link" data-wfx-share-canonical>
          {props.canonicalHref}
        </code>
        {outcome !== null ? (
          <span
            className={`wfx-share__status${outcome.ok ? "" : " wfx-share__status--error"}`}
            role="status"
            data-wfx-share-status
          >
            {outcome.detail}
          </span>
        ) : null}
      </div>
    </details>
  );
}
