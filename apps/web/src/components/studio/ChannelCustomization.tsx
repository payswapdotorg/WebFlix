"use client";

/**
 * @wfx/app-web — R38-B — THE STUDIO CHANNEL CUSTOMIZATION (the
 * banner/avatar/handle/description editors + the live composed preview
 * — the survey's row 30 "channel customization").
 *
 * THE CUSTOMIZATION LAW (the task packet): channel customization
 * "writes real persisted profile state through the additive
 * domain-graph seam." The writes go through the studio profile store
 * (`wfx-studio-profile-v1`) whose records ARE the domain graph's
 * `ChannelProfileEdit` (@wfx/domain — packages/domain/src/graph/
 * channel-profile.ts: the validating constructor throws the graph's
 * typed GraphError with field-level details — the refusal renders
 * those verbatim, one law two layers); the preview composes the
 * persisted edit over R36's derived base identity through the graph
 * seam's `composeChannelProfile` (the pure overlay law).
 *
 * THE COMPOSITION TRUTH (honest, recorded in evidence/r38b/
 * DIVERGENCES.md): the base identity is R36's own derivation (the
 * server props — the monogram avatar, the typed-absence banner, the
 * stable handle); the customized preview renders the base with the
 * edit's declared fields winning. The R36 channel page's read path
 * carries no profile-edit seam at this base — this lane's
 * byte-compatibility constraint keeps R36's files untouched, so the
 * channel page keeps rendering the derived truth (J44 proves no
 * regression) and the merge-time binding is the documented one-place
 * compose.
 *
 * The persisted edit loads AFTER MOUNT (the hydration law); the typed
 * save states render verbatim (the SessionControls law).
 */

import { useCallback, useEffect, useState, type JSX } from "react";

import type { ChannelProfileEdit } from "@wfx/domain";
import { composeChannelProfile } from "@wfx/domain";

import type { StudioChannelView } from "@/host/studio-store/studio-views";
import {
  clearStudioProfileEdit,
  readStudioProfileEdit,
  writeStudioProfileEdit,
} from "@/host/studio-store/studio-profile";

/** The typed save state (the same grammar every studio surface renders). */
type SaveState =
  | { readonly state: "idle" }
  | { readonly state: "saving" }
  | { readonly state: "saved"; readonly detail: string }
  | { readonly state: "refused"; readonly problems: readonly string[] };

/** The customization island. */
export function ChannelCustomization({
  view,
}: {
  /** The managed channel's studio view (R36's derived identity — the base truth). */
  readonly view: StudioChannelView;
}): JSX.Element {
  const connectorId = view.identity.connectorId;

  // The form starts empty (no customization); the persisted edit loads after mount.
  const [handle, setHandle] = useState("");
  const [description, setDescription] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [edit, setEdit] = useState<ChannelProfileEdit | null>(null);
  const [editLoaded, setEditLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });

  useEffect(() => {
    const persisted = readStudioProfileEdit(connectorId);
    setEdit(persisted);
    if (persisted !== null) {
      setHandle(persisted.handle ?? "");
      setDescription(persisted.description ?? "");
      setBannerUrl(persisted.bannerUrl ?? "");
      setAvatarUrl(persisted.avatarUrl ?? "");
    }
    setEditLoaded(true);
  }, [connectorId]);

  /** The composed preview (the graph seam's pure overlay over the base). */
  const composed = composeChannelProfile(
    {
      connectorId,
      handle: view.identity.handle,
      description: view.identity.description,
    },
    edit,
  );

  /** The typed save round trip (through the domain-graph seam). */
  const save = useCallback((): void => {
    setSaveState({ state: "saving" });
    const outcome = writeStudioProfileEdit(connectorId, {
      handle: handle.trim().length > 0 ? handle.trim() : null,
      description: description.trim().length > 0 ? description : null,
      bannerUrl: bannerUrl.trim().length > 0 ? bannerUrl.trim() : null,
      avatarUrl: avatarUrl.trim().length > 0 ? avatarUrl.trim() : null,
    });
    if (outcome.ok) {
      setEdit(outcome.edit);
      setSaveState({
        state: "saved",
        detail: `Saved — the channel's customized profile (stored locally on this device; ${composeCustomizedCount(outcome.edit)} field(s) declared).`,
      });
    } else {
      setSaveState({ state: "refused", problems: outcome.problems });
    }
  }, [avatarUrl, bannerUrl, connectorId, description, handle]);

  /** The clear round trip (the base derivation's truth stands again). */
  const clear = useCallback((): void => {
    const outcome = clearStudioProfileEdit(connectorId);
    setSaveState(
      outcome.ok
        ? { state: "saved", detail: "Cleared — the channel's base derived truth stands again." }
        : { state: "refused", problems: [outcome.problem ?? "the clear was refused"] },
    );
    if (outcome.ok) {
      setEdit(null);
      setHandle("");
      setDescription("");
      setBannerUrl("");
      setAvatarUrl("");
    }
  }, [connectorId]);

  return (
    <section className="wfx-channel__section" aria-label="Channel customization" data-wfx-studio-customization>
      {/* THE BASE TRUTH (R36's derivation — the provenance panel). */}
      <div className="wfx-detail__section" data-wfx-studio-customization-base>
        <h2>The base derived truth (R36&apos;s derivation law)</h2>
        <p className="wfx-card__meta" data-wfx-studio-customization-base-handle>
          Handle: @{view.identity.handle} (the slugified stable connector id)
        </p>
        <p className="wfx-card__meta" data-wfx-studio-customization-base-avatar>
          Avatar: the honest monogram ({view.identity.avatarMark}) — {view.identity.avatarNote}
        </p>
        <p className="wfx-card__meta" data-wfx-studio-customization-base-banner>
          Banner:{" "}
          {view.identity.banner.state === "derived-art"
            ? `derived from the source's own artwork (${view.identity.banner.note})`
            : view.identity.banner.note}
        </p>
        <p className="wfx-card__meta" data-wfx-studio-customization-base-description>
          Description: {view.identity.description}
        </p>
        <p className="wfx-row__reason" data-wfx-studio-customization-composition-note>
          The channel page renders this derived truth. Your customization below is the
          studio&apos;s own profile record (this device) — the creator-declared write path for
          exactly these slots; the channel page&apos;s read-side binding lands at merge (recorded
          honestly in the lane&apos;s divergence ledger).
        </p>
      </div>

      {/* THE LIVE COMPOSED PREVIEW (the graph seam's overlay). */}
      <div className="wfx-detail__section" data-wfx-studio-customization-preview style={{ marginTop: "12px" }}>
        <h2>The customized preview (base + your declared edits)</h2>
        {editLoaded && composed.customizedFields.length === 0 ? (
          <p className="wfx-row__reason" data-wfx-studio-customization-preview-none>
            No customization declared on this device — the preview renders the base truth
            verbatim.
          </p>
        ) : null}
        {composed.customizedFields.length > 0 ? (
          <div data-wfx-studio-customization-preview-composed>
            <p className="wfx-card__meta" data-wfx-studio-customization-preview-handle>
              Handle: @{composed.handle}
              {composed.handle !== view.identity.handle ? " (your declared handle)" : ""}
            </p>
            <p className="wfx-card__meta" data-wfx-studio-customization-preview-description>
              Description: {composed.description}
            </p>
            <p className="wfx-card__meta" data-wfx-studio-customization-preview-banner>
              Banner:{" "}
              {composed.bannerUrl !== null
                ? `your declared artwork (${composed.bannerUrl})`
                : view.identity.banner.state === "derived-art"
                  ? `the source's own derived art`
                  : "the base typed absence (no banner declared by the source or by you)"}
            </p>
            <p className="wfx-card__meta" data-wfx-studio-customization-preview-avatar>
              Avatar:{" "}
              {composed.avatarUrl !== null
                ? `your declared artwork (${composed.avatarUrl})`
                : `the base monogram (${view.identity.avatarMark})`}
            </p>
            {composed.editedAt !== null ? (
              <p className="wfx-row__reason" data-wfx-studio-customization-preview-editedat>
                Last edit recorded {composed.editedAt} — stored locally on this device,
                reload-durable.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* THE EDITORS (the four fields — the closed vocabulary). */}
      <form
        className="wfx-comments__editor"
        data-wfx-studio-customization-form
        style={{ display: "grid", gap: "10px", margin: "16px 0" }}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="wfx-detail__meta" htmlFor="wfx-studio-custom-handle">
          Handle (lowercase letters, digits, single inner hyphens — the same slug grammar the
          channel route derives)
        </label>
        <input
          id="wfx-studio-custom-handle"
          className="wfx-channel__searchinput"
          type="text"
          placeholder={view.identity.handle}
          value={handle}
          data-wfx-studio-customization-handle
          onChange={(event) => {
            setHandle(event.currentTarget.value);
          }}
        />
        <label className="wfx-detail__meta" htmlFor="wfx-studio-custom-description">
          Description (the creator-declared text; leave empty to keep the base truth)
        </label>
        <textarea
          id="wfx-studio-custom-description"
          className="wfx-comments__input"
          rows={3}
          placeholder={
            view.identity.descriptionDeclared
              ? view.identity.description
              : "The source declares no description — yours becomes the channel's declared truth"
          }
          value={description}
          data-wfx-studio-customization-description
          onChange={(event) => {
            setDescription(event.currentTarget.value);
          }}
        />
        <label className="wfx-detail__meta" htmlFor="wfx-studio-custom-banner">
          Banner artwork URL (http/https — the creator-declared banner)
        </label>
        <input
          id="wfx-studio-custom-banner"
          className="wfx-channel__searchinput"
          type="url"
          placeholder="https://…"
          value={bannerUrl}
          data-wfx-studio-customization-banner
          onChange={(event) => {
            setBannerUrl(event.currentTarget.value);
          }}
        />
        <label className="wfx-detail__meta" htmlFor="wfx-studio-custom-avatar">
          Avatar artwork URL (http/https — the creator-declared avatar)
        </label>
        <input
          id="wfx-studio-custom-avatar"
          className="wfx-channel__searchinput"
          type="url"
          placeholder="https://…"
          value={avatarUrl}
          data-wfx-studio-customization-avatar
          onChange={(event) => {
            setAvatarUrl(event.currentTarget.value);
          }}
        />
        <div className="wfx-comments__btnrow">
          <button type="submit" className="wfx-comments__submit" data-wfx-studio-customization-submit>
            Save customization
          </button>
          <button
            type="button"
            className="wfx-comments__cancel"
            data-wfx-studio-customization-clear
            onClick={() => {
              clear();
            }}
          >
            Clear customization
          </button>
        </div>
      </form>

      {/* THE TYPED SAVE STATE (rendered verbatim — the graph seam's own details on refusal). */}
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

      {/* The honest transport label. */}
      <p className="wfx-row__reason" data-wfx-studio-customization-footnote>
        Customization is WebFlix&apos;s own creator record — written through the domain graph&apos;s
        channel-profile edit seam, stored locally on this device, reload-durable. The base
        identity stays the catalog&apos;s own derived truth (R36&apos;s law); your declared edits
        are the write path for the customizable slots.
      </p>
    </section>
  );
}

/** The declared-field count of one edit (the preview's own sum). */
function composeCustomizedCount(edit: ChannelProfileEdit): number {
  let count = 0;
  if (edit.handle !== null) count += 1;
  if (edit.description !== null) count += 1;
  if (edit.bannerUrl !== null) count += 1;
  if (edit.avatarUrl !== null) count += 1;
  return count;
}
