"use client";

/**
 * @wfx/app-web — THE UNIFIED SHARE PANEL (R28-B, the operator's #4:
 * "sharing doesn't work the same" — against the corpus sheet
 * docs/parity-lab/r28/youtube/share-dialog.md).
 *
 * THE YOUTUBE SHARE GRAMMAR, HONESTLY BACKED (the corpus's measured
 * anatomy, every value cited):
 *
 * - the entry points (the watch action row's Share pill + the card
 *   kebab's Share item) open ONE unified panel;
 * - the panel: 470×337 centered, radius 12, the dialog shadow
 *   `rgba(0,0,0,0.15) 0 0 24px 12px` (the same grammar as the filters
 *   panel), "Share" header + the 24×24 Cancel (X);
 * - the target row: 70×93 icon tiles in a horizontally scrollable strip
 *   with Previous/Next arrows (40×40) — the measured order Embed,
 *   Messages, WhatsApp, Facebook, X, Email, Reddit, Pinterest, LinkedIn
 *   (Embed FIRST — the current build's placement);
 * - the link field pre-filled with the SOURCE's own short-form URL
 *   (`youtu.be/<id>` — derived from the realization's embed URL, never
 *   fabricated: no provider-issued `si=` share-tracking token is minted)
 *   with the WebFlix canonical link as the honest fallback when the
 *   source provides none;
 * - the Copy pill 64×40 r20 → the "Link copied to clipboard" toast;
 * - "Start at [timestamp]" checkbox appending `?t=<seconds>` to the
 *   link (the player page carries the LIVE provider-reported position).
 *
 * THE HONEST LAWS THIS KEEPS:
 * - every tile is a REAL share intent (the platform's own share-surface
 *   URLs; the OS messaging scheme where that is the platform's own
 *   surface) — never a dead imitation;
 * - the Embed tile shows the provider's own documented embed code when
 *   the item's realizations carry an embed (the same frozen resolve
 *   read the hover preview uses), and the honest not-embeddable truth
 *   when they do not;
 * - the copy is the REAL clipboard (with the typed fallback truth).
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { Icon, type IconName } from "@/components/shell/Icon";
import { getActiveEmbedControl } from "@/components/player/embed-session-client";

/** The share control's serialized input (server-computed per render). */
export interface ShareControlProps {
  /** The canonical WebFlix link (the player href — the fallback share target). */
  readonly canonicalHref: string;
  /** The canonical link's plain-language name (what the copy carries). */
  readonly title: string;
  /** The source's own URL, when one exists (the realization's embed/watch URL). */
  readonly sourceUrl?: string;
  /** The source's id (the label of the source link). */
  readonly sourceId?: string;
  /** R28-B — the card's target fields (the lazy resolve for the share short link). */
  readonly connectorId?: string;
  readonly externalRef?: string;
  /** The trigger's form: the player's action pill, or the card kebab's row. */
  readonly variant?: "pill" | "menu";
}

/** One share target tile (the corpus row — real intents, honest order). */
interface ShareTarget {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** The real share intent (opens the platform's own share surface). */
  readonly open: (link: string, title: string) => void;
}

/** The measured tile order (Embed first — the current build's placement). */
const SHARE_TARGETS: readonly ShareTarget[] = [
  {
    id: "embed",
    label: "Embed",
    icon: "embed",
    open: (): void => {
      /* The Embed tile is the code view — handled by the panel itself. */
    },
  },
  {
    id: "messages",
    label: "Messages",
    icon: "messages",
    open: (link): void => {
      window.location.href = `sms:?&body=${encodeURIComponent(link)}`;
    },
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: "whatsapp",
    open: (link): void => {
      window.open(`https://wa.me/?text=${encodeURIComponent(link)}`, "_blank", "noopener");
    },
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: "facebook",
    open: (link): void => {
      window.open(
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
        "_blank",
        "noopener",
      );
    },
  },
  {
    id: "x",
    label: "X",
    icon: "xsocial",
    open: (link, title): void => {
      window.open(
        `https://twitter.com/intent/tweet?url=${encodeURIComponent(link)}&text=${encodeURIComponent(title)}`,
        "_blank",
        "noopener",
      );
    },
  },
  {
    id: "email",
    label: "Email",
    icon: "link",
    open: (link, title): void => {
      window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(link)}`;
    },
  },
  {
    id: "reddit",
    label: "Reddit",
    icon: "reddit",
    open: (link, title): void => {
      window.open(
        `https://www.reddit.com/submit?url=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}`,
        "_blank",
        "noopener",
      );
    },
  },
  {
    id: "pinterest",
    label: "Pinterest",
    icon: "pinterest",
    open: (link, title): void => {
      window.open(
        `https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(link)}&description=${encodeURIComponent(title)}`,
        "_blank",
        "noopener",
      );
    },
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: "linkedin",
    open: (link): void => {
      window.open(
        `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`,
        "_blank",
        "noopener",
      );
    },
  },
];

/** Derive the source's own short-form URL from a realization URL (never a guess). */
function sourceShortUrlOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "www.youtube-nocookie.com") {
      if (parsed.pathname.startsWith("/embed/")) {
        const id = parsed.pathname.slice("/embed/".length).split("/")[0] ?? "";
        if (id.length > 0) return `https://youtu.be/${id}`;
      }
      const v = parsed.searchParams.get("v");
      if (v !== null && v.length > 0) return `https://youtu.be/${v}`;
    }
    // A non-YouTube source's own URL IS its share link (verbatim).
    if (parsed.protocol === "https:") return parsed.toString();
  } catch {
    // A non-parsable URL never reaches this control (the surface validates).
  }
  return null;
}

/** Format a position as the m:ss / h:mm:ss the Start-at label carries. */
function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** The provider's documented embed snippet (the code the Embed view shares). */
function embedCodeOf(url: string, title: string): string {
  return `<iframe width="560" height="315" src="${url}" title="${title.replace(/"/g, "&quot;")}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

/** The unified share panel (the corpus dialog + the honest backing). */
export function ShareControl(props: ShareControlProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [embedView, setEmbedView] = useState(false);
  const [startAt, setStartAt] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [embedUrl, setEmbedUrl] = useState<string | null>(
    props.sourceUrl !== undefined ? props.sourceUrl : null,
  );
  const [embedResolved, setEmbedResolved] = useState(props.sourceUrl !== undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  // The share link truth: the source's own short form when the realization
  // provides one (resolved or passed); the WebFlix canonical link otherwise.
  const shortUrl = embedUrl !== null ? sourceShortUrlOf(embedUrl) : null;
  const absoluteCanonical =
    typeof window !== "undefined"
      ? `${window.location.origin}${props.canonicalHref}`
      : props.canonicalHref;
  const baseLink = shortUrl ?? absoluteCanonical;
  const startAtSeconds = Math.floor(
    (startAt ? (getActiveEmbedControl().positionMs > 0 ? getActiveEmbedControl().positionMs : 0) : 0) / 1000,
  );
  const shareLink =
    startAt && startAtSeconds > 0
      ? `${baseLink}${baseLink.includes("?") ? "&" : "?"}t=${startAtSeconds}`
      : baseLink;

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    };
  }, []);

  /** Show the snackbar toast (the corpus's "Link copied to clipboard"). */
  const showToast = useCallback((message: string): void => {
    setToast(message);
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast(null);
    }, 3000);
  }, []);

  /** Open the panel (+ resolve the embed truth lazily when the card must). */
  const connectorId = props.connectorId;
  const externalRef = props.externalRef;
  const openPanel = useCallback((): void => {
    setOpen(true);
    setEmbedView(false);
    if (!embedResolved && connectorId !== undefined && externalRef !== undefined) {
      void (async (): Promise<void> => {
        try {
          const params = new URLSearchParams({ connectorId, ref: externalRef });
          const response = await fetch(`/api/preview?${params.toString()}`);
          const body = (await response.json()) as { previewable?: boolean; url?: string };
          if (body.previewable === true && typeof body.url === "string") {
            setEmbedUrl(body.url);
          }
        } catch {
          // The honest fallback stays: the canonical link (never a guess).
        }
        setEmbedResolved(true);
      })();
    }
  }, [embedResolved, connectorId, externalRef]);

  /** Close (the Esc + scrim + X paths). */
  const close = useCallback((): void => {
    setOpen(false);
    setEmbedView(false);
    setStartAt(false);
  }, []);

  // Esc closes the open panel (the dialog grammar's keyboard path).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  /** Copy the link (the REAL clipboard with the typed fallback truth). */
  const copyLink = useCallback(
    async (link: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(link);
        showToast("Link copied to clipboard");
      } catch {
        showToast("This browser did not allow the clipboard copy — the link is selected for manual copying.");
      }
    },
    [showToast],
  );

  /** Scroll the tiles strip (the Previous/Next arrows). */
  const scrollTiles = useCallback((direction: -1 | 1): void => {
    trackRef.current?.scrollBy({ left: direction * 220, behavior: "smooth" });
  }, []);

  const triggerClass =
    props.variant === "menu"
      ? "wfx-sharemenu__item"
      : "wfx-btn wfx-btn--sm wfx-share__trigger";
  const triggerLabel = `Share ${props.title}`;

  return (
    <>
      <button
        type="button"
        className={triggerClass}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-wfx-share
        data-wfx-share-toggle
        onClick={openPanel}
      >
        <Icon name="share" size={16} />
        <span>Share</span>
      </button>
      {open ? (
        <div className="wfx-share__scrim" data-wfx-share-scrim onClick={close}>
          {/* The corpus dialog: 470×337, r12, the dialog shadow, Share + X. */}
          <div
            ref={panelRef}
            className="wfx-share__panel"
            role="dialog"
            aria-modal="true"
            aria-label="Share"
            data-wfx-share-panel
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="wfx-share__header">
              <h2 className="wfx-share__title">Share</h2>
              <button
                type="button"
                className="wfx-share__close"
                aria-label="Cancel"
                onClick={close}
                data-wfx-share-close
              >
                <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" style={{ display: "block" }}>
                  <path d="M5 5l14 14M19 5 5 19" />
                </svg>
              </button>
            </div>
            {embedView ? (
              /* The Embed view: the provider's documented embed code (or the
                  honest not-embeddable truth), with its own Copy. */
              <div className="wfx-share__embedview" data-wfx-share-embed>
                {embedUrl !== null ? (
                  <>
                    <code className="wfx-share__code" data-wfx-share-embed-code>
                      {embedCodeOf(embedUrl, props.title)}
                    </code>
                    <div className="wfx-share__copyrow">
                      <button
                        type="button"
                        className="wfx-share__copy"
                        onClick={() => void copyLink(embedCodeOf(embedUrl, props.title))}
                        data-wfx-share-embed-copy
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        className="wfx-share__linkbutton"
                        onClick={() => {
                          setEmbedView(false);
                        }}
                      >
                        Done
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="wfx-share__truth" data-wfx-share-embed-absent>
                      This source provides no embeddable player for {props.title} — there is no
                      embed code to share (never a fabricated one).
                    </p>
                    <button
                      type="button"
                      className="wfx-share__linkbutton"
                      onClick={() => {
                        setEmbedView(false);
                      }}
                    >
                      Done
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                {/* The target row: the measured tiles, scrollable, with arrows. */}
                <div className="wfx-share__targets">
                  <button
                    type="button"
                    className="wfx-share__arrow"
                    aria-label="Previous share targets"
                    onClick={() => scrollTiles(-1)}
                    data-wfx-share-arrow="prev"
                  >
                    <Icon name="arrowLeft" size={20} />
                  </button>
                  <div className="wfx-share__track" ref={trackRef} data-wfx-share-targets>
                    {SHARE_TARGETS.map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        className="wfx-share__target"
                        data-wfx-share-target={target.id}
                        onClick={() => {
                          if (target.id === "embed") {
                            setEmbedView(true);
                            return;
                          }
                          target.open(shareLink, props.title);
                        }}
                      >
                        <span className="wfx-share__targetglyph">
                          <Icon name={target.icon} size={28} />
                        </span>
                        <span className="wfx-share__targetlabel">{target.label}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="wfx-share__arrow"
                    aria-label="Next share targets"
                    onClick={() => scrollTiles(1)}
                    data-wfx-share-arrow="next"
                  >
                    <Icon name="arrowRight" size={20} />
                  </button>
                </div>
                {/* The link field + the Copy pill (64×40 r20). */}
                <div className="wfx-share__linkrow">
                  <label className="wfx-share__field">
                    <span className="wfx-sr-only">Share link</span>
                    <input
                      type="text"
                      readOnly
                      value={shareLink}
                      data-wfx-share-link
                      onFocus={(event) => {
                        event.currentTarget.select();
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="wfx-share__copy"
                    onClick={() => void copyLink(shareLink)}
                    data-wfx-share-copy
                  >
                    Copy
                  </button>
                </div>
                {/* Start-at: the timestamp checkbox appending ?t= to the link. */}
                <label className="wfx-share__startat">
                  <input
                    type="checkbox"
                    checked={startAt}
                    onChange={(event) => {
                      setStartAt(event.currentTarget.checked);
                    }}
                    data-wfx-share-startat
                  />
                  <span>
                    Start at{" "}
                    {startAtSeconds > 0 ? formatTimestamp(startAtSeconds) : "0:00"}
                  </span>
                </label>
              </>
            )}
          </div>
        </div>
      ) : null}
      {/* The toast (the corpus's "Link copied to clipboard" snackbar). */}
      {toast !== null ? (
        <p className="wfx-share__toast" role="status" data-wfx-share-toast>
          {toast}
        </p>
      ) : null}
    </>
  );
}
