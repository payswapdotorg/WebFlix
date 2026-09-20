/**
 * @wfx/app-web — the Where-to-watch row (R21-E, server).
 *
 * The item decision hub's realization choice and the player's source
 * switch: ONE canonical title first, source realizations second (the
 * frozen law). Every offered way renders — including the ones this
 * platform cannot host, with their honest reason and Desktop next step
 * ("unsupported is not undiscoverable"). The ways this platform CAN
 * play carry their switch path (the player's mode preference).
 *
 * Server component; pure presentational projection of a
 * `WhereToWatchView` (the R21-C `realizationChoiceView` seam's host
 * projection — never a second derivation of the mode labels).
 */

import type { JSX } from "react";

import type { WhereToWatchView } from "@/host/decision-views";
import { Icon } from "@/components/shell/Icon";
import { ErrorState } from "@/components/ui/StateViews";

/** The availability chip vocabulary (state color paired with text — never color alone). */
function AvailabilityChip({ view }: { readonly view: WhereToWatchView }): JSX.Element {
  if (view.usableCount === 0) {
    return <span className="wfx-badge wfx-badge--state wfx-badge--state-unavailable">No way to play here</span>;
  }
  if (view.usableCount === 1) {
    return <span className="wfx-badge wfx-badge--state">1 way to play here</span>;
  }
  return <span className="wfx-badge wfx-badge--state">{view.usableCount} ways to play here</span>;
}

/** The Where-to-watch row. `variant="player"` renders the compact switch row. */
export function WhereToWatch({
  view,
  variant = "item",
}: {
  readonly view: WhereToWatchView;
  /** The surface the row renders on (the item hub or the player switch). */
  readonly variant?: "item" | "player";
}): JSX.Element {
  if (view.status === "error") {
    return (
      <section className="wfx-detail__section" aria-label="Where to watch" data-wfx-where-to-watch data-wfx-where-to-watch-state="error">
        <h2>Where to watch</h2>
        <ErrorState
          title="The ways to watch could not be read"
          detail={`${view.errorDetail ?? "the source read did not complete"} — re-open this page from search or your library to retry.`}
        />
      </section>
    );
  }
  return (
    <section
      className={variant === "player" ? "wfx-player__wheretowatch" : "wfx-detail__section"}
      aria-label="Where to watch"
      data-wfx-where-to-watch
      data-wfx-where-to-watch-state="ready"
    >
      {variant === "item" ? <h2>Where to watch</h2> : <h3>Where to watch</h3>}
      <p className="wfx-row__reason" data-wfx-wheretowatch-active>
        {view.activeSentence}
      </p>
      <p className="wfx-card__meta">
        <AvailabilityChip view={view} />
        <span data-wfx-wheretowatch-count>
          {view.options.length} way{view.options.length === 1 ? "" : "s"} offered across your sources
        </span>
      </p>
      {view.options.length > 0 ? (
        <ul className="wfx-wheretowatch__options" data-wfx-wheretowatch-options>
          {view.options.map((option) => (
            <li
              key={`${option.mode}:${option.connectorId}`}
              className={`wfx-wheretowatch__option${option.usable ? "" : " wfx-wheretowatch__option--unusable"}`}
              data-wfx-watch-option={option.mode}
              {...(option.usable ? { "data-wfx-watch-usable": "true" } : { "data-wfx-watch-usable": "false" })}
            >
              <span className="wfx-wheretowatch__modelabel" data-wfx-watch-mode-label>
                {option.modeLabel}
              </span>
              <span className="wfx-capchip" data-wfx-watch-source>
                source {option.connectorId}
              </span>
              {/* R23 web-A — the typed access truth: public plays for
                  everyone; a provider's OWN sign-in truth renders as the
                  source's (active or needed), never a WebFlix-account
                  requirement. */}
              <span className="wfx-capchip wfx-capchip--access" data-wfx-watch-access={option.accessState}>
                {option.accessSentence}
              </span>
              {option.usable ? (
                option.switchHref !== undefined ? (
                  <a className="wfx-btn wfx-btn--sm" href={option.switchHref} data-wfx-watch-switch={option.mode}>
                    <Icon name="play" size={14} />
                    {variant === "player" ? "Switch to this" : "Play this way"}
                  </a>
                ) : null
              ) : (
                <span className="wfx-wheretowatch__reason" data-wfx-watch-unusable-reason>
                  {option.unusableReason ?? "This platform cannot host this way of watching."}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="wfx-row__reason" data-wfx-wheretowatch-none>
          No source offered a way to watch this title yet — the sources strip on Home and Settings
          carry the connection paths.
        </p>
      )}
    </section>
  );
}
