"use client";

/**
 * @wfx/app-web — R38-B — THE STUDIO CONTENT TABLE (the content list
 * island — the survey's row 30 "content list (drafts/scheduled/
 * published)").
 *
 * THE TRUTH MODEL (the CONCURRENT-CATALOG LAW):
 * - PUBLISHED rows are the channel's REAL catalog items (server props —
 *   every row a hit the transport really answered through the SAME
 *   discovery composition the channel page renders; the studio never
 *   fabricates a catalog row).
 * - DRAFT/SCHEDULED rows are this device's own studio records (loaded
 *   AFTER MOUNT from the studio content store — the CommentsSection
 *   hydration law: the initial render matches the server, the local
 *   truth loads after mount, never a hydration mismatch). A draft is
 *   NEVER a catalog write: it does not enter search/home/channel; the
 *   honest publish note names the upload wave (the bell-menu
 *   honest-later-wave vocabulary).
 * - The STATE is data: a draft with visibility "scheduled" AND a future
 *   instant derives the scheduled state (never a second truth).
 *
 * THE TYPED SAVE STATES (the SessionControls law): idle → saving →
 * saved (the persisted record echoed) / refused (the field-level
 * problems rendered verbatim — never a fabricated success).
 */

import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import type { StudioChannelView } from "@/host/studio-store/studio-views";
import {
  STUDIO_VISIBILITIES,
  draftStateOf,
  readStudioDraftsOf,
  writeStudioDraft,
  type StudioDraftRecord,
  type StudioVisibility,
} from "@/host/studio-store/studio-content";
import { studioVideoHref } from "@/app/studio/href";
import { Icon } from "@/components/shell/Icon";

/** The state filter vocabulary. */
type ContentFilter = "all" | "published" | "draft" | "scheduled";

const CONTENT_FILTERS: readonly { readonly value: ContentFilter; readonly label: string }[] = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Drafts" },
  { value: "scheduled", label: "Scheduled" },
];

/** The visibility label. */
function visibilityLabel(visibility: StudioVisibility): string {
  return visibility === "unlisted" ? "Unlisted" : visibility === "private" ? "Private" : visibility === "scheduled" ? "Scheduled" : "Public";
}

/** The draft form's state (the new/edit draft editor). */
interface DraftFormState {
  readonly editingId: string | null;
  readonly title: string;
  readonly description: string;
  readonly visibility: StudioVisibility;
  readonly scheduledFor: string;
}

const EMPTY_DRAFT_FORM: DraftFormState = {
  editingId: null,
  title: "",
  description: "",
  visibility: "private",
  scheduledFor: "",
};

/** One typed save state (the save grammar the surfaces render). */
export type StudioSaveState =
  | { readonly state: "idle" }
  | { readonly state: "saving" }
  | { readonly state: "saved"; readonly detail: string }
  | { readonly state: "refused"; readonly problems: readonly string[] };

/** The content table island. */
export function ContentTable({
  view,
}: {
  /** The managed channel's studio view (the published set — the server truth). */
  readonly view: StudioChannelView;
}): JSX.Element {
  // The local truths (the drafts) load after mount — the hydration law.
  const [drafts, setDrafts] = useState<readonly StudioDraftRecord[]>([]);
  const [localLoaded, setLocalLoaded] = useState(false);
  const [filter, setFilter] = useState<ContentFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<DraftFormState>(EMPTY_DRAFT_FORM);
  const [saveState, setSaveState] = useState<StudioSaveState>({ state: "idle" });

  const reloadDrafts = useCallback((): void => {
    setDrafts(readStudioDraftsOf(view.identity.connectorId));
    setLocalLoaded(true);
  }, [view.identity.connectorId]);

  useEffect(() => {
    reloadDrafts();
  }, [reloadDrafts]);

  /** Open the form (new or edit). */
  const openForm = useCallback((draft: StudioDraftRecord | null): void => {
    setFormOpen(true);
    setSaveState({ state: "idle" });
    if (draft === null) {
      setForm(EMPTY_DRAFT_FORM);
      return;
    }
    setForm({
      editingId: draft.id,
      title: draft.title,
      description: draft.description,
      visibility: draft.visibility,
      scheduledFor: draft.scheduledFor !== null ? draft.scheduledFor.slice(0, 16) : "",
    });
  }, []);

  /** Submit the draft form (the typed save round trip). */
  const submitDraft = useCallback((): void => {
    setSaveState({ state: "saving" });
    const scheduledFor =
      form.visibility === "scheduled" && form.scheduledFor.length > 0
        ? new Date(`${form.scheduledFor}:00`).toISOString()
        : null;
    const outcome = writeStudioDraft(
      {
        connectorId: view.identity.connectorId,
        title: form.title,
        description: form.description,
        visibility: form.visibility,
        scheduledFor,
      },
      form.editingId,
    );
    if (outcome.ok) {
      const record = outcome.record as StudioDraftRecord;
      const state = draftStateOf(record);
      setSaveState({
        state: "saved",
        detail:
          state === "scheduled"
            ? `Saved — scheduled for ${record.scheduledFor} (stored locally on this device).`
            : "Saved to this device's studio record.",
      });
      reloadDrafts();
      setForm(EMPTY_DRAFT_FORM);
      setFormOpen(false);
    } else {
      setSaveState({ state: "refused", problems: outcome.problems });
    }
  }, [form, reloadDrafts, view.identity.connectorId]);

  // The merged rows: published (the server truth) + drafts/scheduled (the local truth).
  const draftRows = useMemo(
    () =>
      drafts.map((draft) => ({
        kind: "draft" as const,
        draft,
        state: draftStateOf(draft),
      })),
    [drafts],
  );

  const filteredPublished = filter === "all" || filter === "published";
  const filteredDrafts = draftRows.filter(
    (row) => filter === "all" || (filter === "draft" && row.state === "draft") || (filter === "scheduled" && row.state === "scheduled"),
  );

  const draftCount = draftRows.filter((row) => row.state === "draft").length;
  const scheduledCount = draftRows.filter((row) => row.state === "scheduled").length;

  return (
    <section className="wfx-channel__section" aria-label="Studio content" data-wfx-studio-content>
      {/* THE STATE FILTER (the chip grammar; the counts are the real derived counts). */}
      <div className="wfx-chipbar" data-wfx-studio-content-filters>
        <div className="wfx-chipbar__track">
          {CONTENT_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`wfx-chip${filter === option.value ? " wfx-chip--active" : ""}`}
              aria-pressed={filter === option.value}
              data-wfx-studio-content-filter={option.value}
              onClick={() => {
                setFilter(option.value);
              }}
            >
              {option.label}
              {option.value === "published" ? ` (${view.items.length})` : ""}
              {option.value === "draft" ? ` (${draftCount})` : ""}
              {option.value === "scheduled" ? ` (${scheduledCount})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* THE NEW-DRAFT ENTRY (the one obvious primary action). */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "12px 0" }}>
        <button
          type="button"
          className="wfx-btn wfx-btn--primary"
          data-wfx-studio-newdraft-open
          onClick={() => {
            openForm(null);
          }}
        >
          <Icon name="plus" size={16} />
          New draft
        </button>
        <span className="wfx-detail__meta" data-wfx-studio-newdraft-note>
          A draft is this device&apos;s own studio record — publishing into the real catalog lands
          with the upload wave (never a fabricated catalog row).
        </span>
      </div>

      {formOpen ? (
        <form
          className="wfx-comments__editor"
          data-wfx-studio-newdraft-form
          style={{ display: "grid", gap: "10px", margin: "0 0 16px" }}
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
        >
          <label className="wfx-detail__meta" htmlFor="wfx-studio-draft-title">
            Title
          </label>
          <input
            id="wfx-studio-draft-title"
            className="wfx-channel__searchinput"
            type="text"
            value={form.title}
            placeholder="The draft's title"
            data-wfx-studio-newdraft-title
            onChange={(event) => {
              const value = event.currentTarget.value;
              setForm((current) => ({ ...current, title: value }));
            }}
          />
          <label className="wfx-detail__meta" htmlFor="wfx-studio-draft-description">
            Description
          </label>
          <textarea
            id="wfx-studio-draft-description"
            className="wfx-comments__input"
            rows={3}
            placeholder="The draft's description (this device's own studio record)"
            value={form.description}
            data-wfx-studio-newdraft-description
            onChange={(event) => {
              const value = event.currentTarget.value;
              setForm((current) => ({ ...current, description: value }));
            }}
          />
          <label className="wfx-detail__meta" htmlFor="wfx-studio-draft-visibility">
            Visibility
          </label>
          <select
            id="wfx-studio-draft-visibility"
            className="wfx-channel__searchinput"
            value={form.visibility}
            data-wfx-studio-newdraft-visibility
            onChange={(event) => {
              const value = event.currentTarget.value as StudioVisibility;
              setForm((current) => ({ ...current, visibility: value }));
            }}
          >
            {STUDIO_VISIBILITIES.map((visibility) => (
              <option key={visibility} value={visibility}>
                {visibilityLabel(visibility)}
              </option>
            ))}
          </select>
          {form.visibility === "scheduled" ? (
            <>
              <label className="wfx-detail__meta" htmlFor="wfx-studio-draft-schedule">
                Publish date (your recorded schedule)
              </label>
              <input
                id="wfx-studio-draft-schedule"
                className="wfx-channel__searchinput"
                type="datetime-local"
                value={form.scheduledFor}
                data-wfx-studio-newdraft-schedule
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setForm((current) => ({ ...current, scheduledFor: value }));
                }}
              />
            </>
          ) : null}
          <div className="wfx-comments__btnrow">
            <button
              type="button"
              className="wfx-comments__cancel"
              data-wfx-studio-newdraft-cancel
              onClick={() => {
                setFormOpen(false);
                setForm(EMPTY_DRAFT_FORM);
                setSaveState({ state: "idle" });
              }}
            >
              Cancel
            </button>
            <button type="submit" className="wfx-comments__submit" data-wfx-studio-newdraft-submit>
              {form.editingId !== null ? "Save draft" : "Create draft"}
            </button>
          </div>
        </form>
      ) : null}

      {/* THE TYPED SAVE STATE (rendered verbatim — never a fabricated success). */}
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

      {/* THE HONEST EMPTY STATES (typed, never a fabricated row). */}
      {localLoaded && filteredDrafts.length === 0 && (filter === "all" || filter === "draft") && draftCount === 0 ? (
        <p className="wfx-row__reason" data-wfx-studio-empty-drafts>
          No drafts yet — your next video starts here (this device&apos;s own studio record).
        </p>
      ) : null}
      {localLoaded && filter === "scheduled" && scheduledCount === 0 ? (
        <p className="wfx-row__reason" data-wfx-studio-empty-scheduled>
          Nothing scheduled — a draft with a future publish date lands here (your recorded
          schedule; publishing into the catalog lands with the upload wave).
        </p>
      ) : null}
      {!localLoaded ? (
        <p className="wfx-row__reason" data-wfx-studio-local-pending>
          Reading this device&apos;s studio records…
        </p>
      ) : null}

      {/* THE ROWS. */}
      <ul className="wfx-queue__list" style={{ listStyle: "none", padding: 0 }} data-wfx-studio-rows>
        {filteredDrafts.map(({ draft, state }) => (
          <li
            key={draft.id}
            className="wfx-queue__item"
            data-wfx-studio-draft-row={draft.id}
            data-wfx-studio-row-state={state}
            style={{ display: "grid", gap: "6px", padding: "10px 0", borderBottom: "1px solid var(--wfx-border, #ccc)" }}
          >
            <span className="wfx-card__title" data-wfx-studio-draft-title>
              {draft.title}
            </span>
            <span className="wfx-card__meta">
              <span className="wfx-chip wfx-chip--active" data-wfx-studio-draft-state={state}>
                {state === "scheduled" ? "Scheduled" : "Draft"}
              </span>
              {" · "}
              {visibilityLabel(draft.visibility)}
              {state === "scheduled" && draft.scheduledFor !== null
                ? ` · for ${draft.scheduledFor}`
                : ""}
              {" · this device's own studio record (not in the catalog)"}
            </span>
            {state === "scheduled" ? (
              <span className="wfx-row__reason" data-wfx-studio-draft-publish-note>
                Publishing into the real catalog lands with the upload wave — your schedule is
                recorded and ready.
              </span>
            ) : null}
            <span style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="wfx-btn wfx-btn--sm"
                data-wfx-studio-draft-edit={draft.id}
                onClick={() => {
                  openForm(draft);
                }}
              >
                Edit
              </button>
            </span>
          </li>
        ))}
        {filteredPublished
          ? view.items.map((item) => (
              <li
                key={item.itemId}
                className="wfx-queue__item"
                data-wfx-studio-row={item.itemId}
                data-wfx-studio-row-state="published"
                style={{ display: "grid", gap: "6px", padding: "10px 0", borderBottom: "1px solid var(--wfx-border, #ccc)" }}
              >
                <a
                  className="wfx-card__title"
                  href={studioVideoHref(
                    {
                      itemId: item.itemId,
                      connectorId: item.connectorId,
                      externalRef: item.externalRef,
                      title: item.title,
                      canonicalType: item.canonicalType,
                      ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
                    },
                    { channel: view.identity.handle },
                  )}
                  data-wfx-studio-row-link={item.itemId}
                >
                  {item.title}
                </a>
                <span className="wfx-card__meta">
                  <span className="wfx-chip wfx-chip--active" data-wfx-studio-row-visibility="published">
                    Published
                  </span>
                  {" · "}
                  {item.isShort ? "Short" : "Video"}
                  {item.durationMs !== undefined ? ` · ${Math.round(item.durationMs / 1000)}s` : ""}
                  {" · in the catalog's public feed (every surface renders it)"}
                </span>
              </li>
            ))
          : null}
      </ul>

      {/* The honest transport label (the CommentsSection footnote law). */}
      <p className="wfx-row__reason" data-wfx-studio-content-footnote>
        Studio content state is WebFlix&apos;s own — drafts and edits are stored locally on this
        device, honestly counted. Published rows are the catalog&apos;s real items (the same
        discovery feed every surface reads).
      </p>
    </section>
  );
}
