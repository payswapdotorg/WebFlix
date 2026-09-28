"use client";

/**
 * @wfx/app-web — R38-B — THE STUDIO DETAILS EDITOR (the video details
 * island — the survey's row 30 "video details editor").
 *
 * THE TRUTH MODEL (the CONCURRENT-CATALOG LAW): the editor edits a
 * CATALOG item's details (title/description/visibility), writing the
 * STUDIO-OWNED edit record (this device's own store — reload-durable).
 * The catalog's own read surfaces keep their truth (the catalog write
 * seam is the upload wave's lane, concurrent — never worked around
 * here); the studio renders the COMPOSED truth (the catalog's original
 * value named beside the studio record — the provenance law), and the
 * honest note says exactly what the edit is.
 *
 * THE TYPED SAVE STATES (the SessionControls law): idle → saving →
 * saved (the persisted record echoed, provenance named) / refused (the
 * field-level problems rendered verbatim — never a fabricated success).
 * The persisted edit loads AFTER MOUNT (the CommentsSection hydration
 * law — the initial render matches the server's catalog truth).
 */

import { useCallback, useEffect, useState, type JSX } from "react";

import type { StudioItemSummary } from "@/host/studio-store/studio-views";
import {
  STUDIO_VISIBILITIES,
  readStudioItemEdit,
  writeStudioItemEdit,
  type StudioVisibility,
} from "@/host/studio-store/studio-content";
import { studioAnalyticsHref } from "@/app/studio/href";
import { playerHref } from "@/app/href";

/** The typed save state (the same grammar the content table renders). */
type SaveState =
  | { readonly state: "idle" }
  | { readonly state: "saving" }
  | { readonly state: "saved"; readonly detail: string }
  | { readonly state: "refused"; readonly problems: readonly string[] };

/** The visibility label. */
function visibilityLabel(visibility: StudioVisibility): string {
  return visibility === "unlisted"
    ? "Unlisted"
    : visibility === "private"
      ? "Private"
      : visibility === "scheduled"
        ? "Scheduled"
        : "Public";
}

/** The details editor island. */
export function DetailsEditor({
  item,
  channelHandle,
}: {
  /** The catalog item's studio truth (the published set's own row). */
  readonly item: StudioItemSummary;
  /** The managed channel's handle (the editor's scope + the return links). */
  readonly channelHandle: string;
}): JSX.Element {
  // The form starts at the CATALOG truth (the server render); the
  // persisted edit (this device's own record) loads after mount.
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<StudioVisibility>("public");
  const [scheduledFor, setScheduledFor] = useState("");
  const [editLoaded, setEditLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });

  useEffect(() => {
    const edit = readStudioItemEdit(item.itemId);
    if (edit !== null) {
      setTitle(edit.title);
      setDescription(edit.description);
      setVisibility(edit.visibility);
      if (edit.scheduledFor !== null) setScheduledFor(edit.scheduledFor.slice(0, 16));
    }
    setEditLoaded(true);
  }, [item.itemId]);

  /** The typed save round trip. */
  const save = useCallback((): void => {
    setSaveState({ state: "saving" });
    const scheduleIso =
      visibility === "scheduled" && scheduledFor.length > 0
        ? new Date(`${scheduledFor}:00`).toISOString()
        : null;
    const outcome = writeStudioItemEdit({
      itemId: item.itemId,
      connectorId: item.connectorId,
      title,
      description,
      visibility,
      scheduledFor: scheduleIso,
    });
    if (outcome.ok) {
      setSaveState({
        state: "saved",
        detail:
          "Saved — the studio record for this video (stored locally on this device; the catalog's own surfaces keep the source's truth).",
      });
    } else {
      setSaveState({ state: "refused", problems: outcome.problems });
    }
  }, [description, item.connectorId, item.itemId, scheduledFor, title, visibility]);

  return (
    <section className="wfx-channel__section" aria-label="Video details" data-wfx-studio-editor>
      {/* THE CATALOG TRUTH (the provenance panel — the source's own values). */}
      <div className="wfx-detail__section" data-wfx-studio-editor-catalog>
        <h2>The catalog&apos;s own truth</h2>
        <p className="wfx-card__title" data-wfx-studio-editor-catalog-title>
          {item.title}
        </p>
        <p className="wfx-card__meta">
          {item.isShort ? "Short" : "Video"} · {item.canonicalType}
          {item.durationMs !== undefined ? ` · ${Math.round(item.durationMs / 1000)}s` : ""}
          {item.publishedAt !== null ? ` · published ${item.publishedAt}` : ""}
          {" · the source declares no description"}
        </p>
        <p className="wfx-row__reason" data-wfx-studio-editor-catalog-note>
          The catalog&apos;s own surfaces (search, home, the channel page, the player) render this
          truth. Your edit below is the studio&apos;s own record on this device — the catalog write
          seam is the upload wave&apos;s lane, composing here at merge.
        </p>
      </div>

      {/* THE EDITOR (the studio record's form). */}
      <form
        className="wfx-comments__editor"
        data-wfx-studio-editor-form
        style={{ display: "grid", gap: "10px", margin: "16px 0" }}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="wfx-detail__meta" htmlFor="wfx-studio-editor-title">
          Title (the studio record)
        </label>
        <input
          id="wfx-studio-editor-title"
          className="wfx-channel__searchinput"
          type="text"
          value={title}
          data-wfx-studio-editor-title
          onChange={(event) => {
            setTitle(event.currentTarget.value);
          }}
        />
        <label className="wfx-detail__meta" htmlFor="wfx-studio-editor-description">
          Description (the studio record)
        </label>
        <textarea
          id="wfx-studio-editor-description"
          className="wfx-comments__input"
          rows={4}
          placeholder="The description this device's studio record carries for this video"
          value={description}
          data-wfx-studio-editor-description
          onChange={(event) => {
            setDescription(event.currentTarget.value);
          }}
        />
        <label className="wfx-detail__meta" htmlFor="wfx-studio-editor-visibility">
          Visibility (the studio record)
        </label>
        <select
          id="wfx-studio-editor-visibility"
          className="wfx-channel__searchinput"
          value={visibility}
          data-wfx-studio-editor-visibility
          onChange={(event) => {
            setVisibility(event.currentTarget.value as StudioVisibility);
          }}
        >
          {STUDIO_VISIBILITIES.map((value) => (
            <option key={value} value={value}>
              {visibilityLabel(value)}
            </option>
          ))}
        </select>
        {visibility === "scheduled" ? (
          <>
            <label className="wfx-detail__meta" htmlFor="wfx-studio-editor-schedule">
              Publish date (your recorded schedule)
            </label>
            <input
              id="wfx-studio-editor-schedule"
              className="wfx-channel__searchinput"
              type="datetime-local"
              value={scheduledFor}
              data-wfx-studio-editor-schedule
              onChange={(event) => {
                setScheduledFor(event.currentTarget.value);
              }}
            />
          </>
        ) : null}
        <div className="wfx-comments__btnrow">
          <button type="submit" className="wfx-comments__submit" data-wfx-studio-editor-submit>
            Save
          </button>
        </div>
      </form>

      {/* THE TYPED SAVE STATE (rendered verbatim). */}
      {saveState.state !== "idle" ? (
        <p
          className="wfx-row__reason"
          role="status"
          data-wfx-studio-save-state={saveState.state}
          data-wfx-studio-save-status={
            saveState.state === "saved"
              ? saveState.detail
              : saveState.state === "refused"
                ? saveState.problems.join(" ")
                : saveState.state
          }
        >
          {saveState.state === "saving"
            ? "Saving…"
            : saveState.state === "saved"
              ? saveState.detail
              : saveState.state === "refused"
                ? `Not saved — ${saveState.problems.join(" ")}`
                : ""}
        </p>
      ) : null}

      {/* THE COMPOSED TRUTH (the studio record after the load — the provenance named). */}
      {editLoaded && (title !== item.title || description.length > 0 || visibility !== "public") ? (
        <div className="wfx-detail__section" data-wfx-studio-composed>
          <h2>The studio record (this device)</h2>
          <p className="wfx-card__title" data-wfx-studio-composed-title>
            {title}
          </p>
          <p className="wfx-card__meta" data-wfx-studio-composed-visibility>
            {visibilityLabel(visibility)}
            {visibility === "scheduled" && scheduledFor.length > 0 ? ` · for ${scheduledFor}` : ""}
          </p>
          {description.length > 0 ? (
            <p className="wfx-card__meta" data-wfx-studio-composed-description>
              {description}
            </p>
          ) : null}
          <p className="wfx-row__reason">
            The catalog&apos;s original title was “{item.title}” — the studio record above is this
            device&apos;s own edit, stored locally and reload-durable.
          </p>
        </div>
      ) : null}

      <p className="wfx-row__reason" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <a
          href={playerHref({
            itemId: item.itemId,
            connectorId: item.connectorId,
            externalRef: item.externalRef,
            title: item.title,
            canonicalType: item.canonicalType,
            ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
          })}
          data-wfx-studio-editor-watch-link
        >
          Open on the watch surface
        </a>
        {" · "}
        <a
          href={studioAnalyticsHref({ channel: channelHandle, itemId: item.itemId })}
          data-wfx-studio-editor-analytics-link
        >
          This video&apos;s analytics
        </a>
      </p>
    </section>
  );
}
