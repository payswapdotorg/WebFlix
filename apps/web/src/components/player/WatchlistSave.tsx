"use client";

/**
 * @wfx/app-web — the WebFlix-native watchlist save (R24-W2, the
 * R24-C watch-later row: the Watchlist pairing).
 *
 * THE AUDIT'S GAP, CLOSED: the only previous save path rode the
 * PROVIDER's own save capability (a source without it left NO way to
 * save). This control writes the runtime's LibraryOperations.save
 * DIRECTLY — the durable canonical-keyed watchlist entry (local-first,
 * typed sync states) — offered on cards, the item hub and the player
 * REGARDLESS of provider capability. The provider's own save action
 * stays a separate truth beside it (J10's action-sync law is
 * untouched); this is WebFlix's own save, the same one everywhere.
 *
 * The playlist write is the same seam with a list name (the runtime's
 * one write path — the Library's playlists section renders the lists).
 */

import { useCallback, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";

/** The save control's serialized input (server-computed per render). */
export interface WatchlistSaveProps {
  readonly itemId: string;
  readonly title: string;
  /** The initial saved state (the runtime's own watchlist truth at render). */
  readonly initiallySaved: boolean;
  /** The compact variant (cards) vs the standard variant (item/player). */
  readonly variant?: "standard" | "compact";
  /** Offer the save-to-playlist choice (the item hub's fuller control). */
  readonly offerPlaylist?: boolean;
}

/** The typed save outcome the control renders verbatim. */
interface SaveOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/** The WebFlix-native watchlist/playlist save control. */
export function WatchlistSave(props: WatchlistSaveProps): JSX.Element {
  const [saved, setSaved] = useState(props.initiallySaved);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [listName, setListName] = useState("");

  /** Write (or remove) through the runtime's own library seam. */
  const write = useCallback(
    async (op: "save" | "remove", name?: string): Promise<void> => {
      try {
        const response = await fetch("/api/library", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            op,
            itemId: props.itemId,
            ...(name !== undefined && name.trim().length > 0 ? { listName: name.trim() } : {}),
          }),
        });
        const result = (await response.json()) as {
          ok?: boolean;
          kind?: string;
          detail?: string;
          entry?: { sync: string };
        };
        if (result.ok === true) {
          setSaved(op === "save");
          setOutcome({
            ok: true,
            detail:
              op === "save"
                ? `Saved to your Watchlist${result.entry?.sync === "pending" ? " — syncing to your sources" : ""}.`
                : "Removed from your Watchlist.",
          });
        } else {
          setOutcome({
            ok: false,
            detail: `${result.kind ?? "failed"}: ${result.detail ?? "the save was refused"}`,
          });
        }
      } catch {
        setOutcome({ ok: false, detail: "The save could not reach the host — nothing was written." });
      }
    },
    [props.itemId],
  );

  const compact = props.variant === "compact";

  return (
    <div className="wfx-watchlist" data-wfx-watchlist-save>
      <button
        type="button"
        className={compact ? "wfx-card__actionbtn" : "wfx-btn wfx-btn--sm"}
        onClick={() => {
          void write(saved ? "remove" : "save");
        }}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${props.title} from your Watchlist` : `Save ${props.title} to your Watchlist`}
        data-wfx-watchlist-toggle
        data-wfx-watchlist-saved={saved ? "true" : "false"}
      >
        <Icon name="save" size={compact ? 16 : 18} />
        {!compact ? <span>{saved ? "Saved to Watchlist" : "Save to Watchlist"}</span> : null}
      </button>
      {props.offerPlaylist === true && !compact ? (
        <button
          type="button"
          className="wfx-btn wfx-btn--sm wfx-btn--ghost"
          onClick={() => {
            setPlaylistOpen((current) => !current);
          }}
          aria-expanded={playlistOpen}
          data-wfx-watchlist-playlist-toggle
        >
          Save to a playlist
        </button>
      ) : null}
      {playlistOpen ? (
        <form
          className="wfx-watchlist__playlistform"
          data-wfx-watchlist-playlist-form
          onSubmit={(event) => {
            event.preventDefault();
            void write("save", listName);
            setPlaylistOpen(false);
            setListName("");
          }}
        >
          <input
            type="text"
            value={listName}
            placeholder="Playlist name"
            aria-label="Playlist name"
            onChange={(event) => {
              setListName(event.target.value);
            }}
            data-wfx-watchlist-playlist-name
          />
          <button type="submit" className="wfx-btn wfx-btn--sm">
            Save
          </button>
        </form>
      ) : null}
      {outcome !== null && !compact ? (
        <span
          className={`wfx-watchlist__status${outcome.ok ? "" : " wfx-watchlist__status--error"}`}
          role="status"
          data-wfx-watchlist-status
        >
          {outcome.detail}
        </span>
      ) : null}
    </div>
  );
}
