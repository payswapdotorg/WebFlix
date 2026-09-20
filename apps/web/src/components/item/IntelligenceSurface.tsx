/**
 * @wfx/app-web — the item's intelligence surface (R23-F/H, the J39
 * transcript/chapters/moments walk).
 *
 * The item's derived intelligence — transcript segments, chapters/scenes,
 * searchable moments — rendered under ONE progressive disclosure ("What's
 * inside this title"), with:
 *
 * - MOMENT/CHAPTER JUMP PATHS: every chapter and moment links into the
 *   player at its timestamp (`&resume=<ms>` — the same resume seam every
 *   way of watching uses);
 * - HONEST PROVENANCE: every derived artifact names the model that
 *   produced it (stage + model id + confidence — the R23-F provenance
 *   law, never a silent derivation);
 * - THE PREREQUISITE TRUTH: the discovery features' availability renders
 *   per-feature (available / prerequisites-missing naming what is
 *   absent) — the R23-H honesty law;
 * - THE ANONYMOUS BOUNDARY (R23-K): a low-cost local read — no account
 *   needed, no wall.
 *
 * Server component; pure presentational projection of an
 * `ItemIntelligenceView`.
 */

import type { JSX } from "react";

import type { ItemIntelligenceView } from "@/host/intelligence";
import { formatPosition } from "@/components/ui/format";
import { playerHref } from "@/app/routing";

/** The feature labels (the R23-H contract's user vocabulary, one source). */
const FEATURE_LABELS: Readonly<Record<string, string>> = {
  "search-by-meaning": "Search by meaning",
  "moment-search": "Find the exact moment",
  "chapter-aware-signals": "Chapter-aware recommendations",
  "visual-similarity": "Visually similar",
  "anti-tunnel-exploration": "Content-aware exploration",
  "richer-explanations": "Richer why-this",
  "cold-start-understanding": "New-title understanding",
};

/** One player link that jumps to a timestamp (the resume seam — the
 *  viewer's normal realization resolution answers, never forced). */
function jumpHref(input: {
  readonly itemId: string;
  readonly connectorId: string;
  readonly externalRef: string;
  readonly title: string;
  readonly canonicalType: string;
  readonly startMs: number;
}): string {
  return playerHref(
    {
      itemId: input.itemId,
      connectorId: input.connectorId,
      externalRef: input.externalRef,
      title: input.title,
      canonicalType: input.canonicalType,
    },
    input.startMs,
  );
}

/** The intelligence surface. */
export function IntelligenceSurface({
  view,
  target,
}: {
  readonly view: ItemIntelligenceView;
  /** The item's identity (the jump paths' target). */
  readonly target: {
    readonly itemId: string;
    readonly connectorId: string;
    readonly externalRef: string;
    readonly title: string;
    readonly canonicalType: string;
  };
}): JSX.Element {
  if (view.status === "unavailable") {
    // The honest absence — rendered as the disclosed section's typed
    // state (the capability stays discoverable, never a dead end).
    return (
      <details className="wfx-detail__section" data-wfx-intelligence data-wfx-intelligence-state="unavailable">
        <summary>What&apos;s inside this title</summary>
        <p className="wfx-row__reason" data-wfx-intelligence-detail>
          {view.detail ?? "No derived intelligence for this title yet."}
        </p>
      </details>
    );
  }
  const jump = (startMs: number): string =>
    jumpHref({
      itemId: target.itemId,
      connectorId: target.connectorId,
      externalRef: target.externalRef,
      title: target.title,
      canonicalType: target.canonicalType,
      startMs,
    });
  return (
    <details className="wfx-detail__section" data-wfx-intelligence data-wfx-intelligence-state="ready">
      <summary>
        What&apos;s inside this title
        {view.chapters !== undefined ? ` — ${view.chapters.length} chapters` : ""}
        {view.moments !== undefined ? `, ${view.moments.length} findable moments` : ""}
      </summary>

      {view.moments !== undefined && view.moments.length > 0 ? (
        <section aria-label="Findable moments" data-wfx-intelligence-moments>
          <h3>Findable moments</h3>
          <ul>
            {view.moments.map((moment) => (
              <li key={`${moment.startMs}-${moment.description.slice(0, 12)}`} data-wfx-intelligence-moment>
                <a
                  href={jump(moment.startMs)}
                  data-wfx-intelligence-moment-jump={String(moment.startMs)}
                >
                  <strong>{formatPosition(moment.startMs)}</strong> — {moment.description}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.chapters !== undefined && view.chapters.length > 0 ? (
        <section aria-label="Chapters" data-wfx-intelligence-chapters>
          <h3>Chapters</h3>
          <ul>
            {view.chapters.map((chapter) => (
              <li
                key={`${chapter.kind}-${chapter.startMs}`}
                data-wfx-intelligence-chapter={chapter.kind}
              >
                <a href={jump(chapter.startMs)} data-wfx-intelligence-chapter-jump={String(chapter.startMs)}>
                  <strong>{chapter.title ?? `${chapter.kind} at ${formatPosition(chapter.startMs)}`}</strong>{" "}
                  ({formatPosition(chapter.startMs)})
                </a>
                {chapter.summary !== null ? <span> — {chapter.summary}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.transcript !== undefined && view.transcript.length > 0 ? (
        <details data-wfx-intelligence-transcript-disclosure>
          <summary>Transcript ({view.transcriptLanguage ?? "en"})</summary>
          <ol className="wfx-intelligence__transcript" data-wfx-intelligence-transcript>
            {view.transcript.map((segment) => (
              <li key={`${segment.startMs}-${segment.text.slice(0, 12)}`} data-wfx-intelligence-segment>
                <a href={jump(segment.startMs)} className="wfx-intelligence__stamp">
                  {formatPosition(segment.startMs)}
                </a>
                {segment.speakerLabel !== null ? <strong>{segment.speakerLabel}: </strong> : null}
                <span>{segment.text}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {/* The R23-H prerequisite truth: per-feature availability, honest. */}
      <section aria-label="What the intelligence supports" data-wfx-intelligence-features>
        <h3>What this supports</h3>
        <ul>
          {Object.entries(view.features).map(([kind, feature]) => (
            <li
              key={kind}
              data-wfx-intelligence-feature={kind}
              data-wfx-intelligence-feature-available={feature?.available ? "true" : "false"}
            >
              {FEATURE_LABELS[kind] ?? kind}
              {feature?.available !== true && feature !== undefined ? (
                <span> — needs {feature.missing.join(", ")} for this title</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {/* The honest provenance: every contributing model, named. */}
      <section aria-label="Model provenance" data-wfx-intelligence-provenance>
        <h3>Where this came from</h3>
        <ul>
          {view.provenance.map((entry) => (
            <li key={`${entry.stage}-${entry.modelId}`} data-wfx-intelligence-provenance-row={entry.modelId}>
              {entry.sentence}
            </li>
          ))}
        </ul>
        <p className="wfx-row__reason" data-wfx-intelligence-provenance-note>
          Models generate these signals; your recommendations and choices stay yours — no model
          authorizes a playback or acquisition action.
        </p>
      </section>
    </details>
  );
}
