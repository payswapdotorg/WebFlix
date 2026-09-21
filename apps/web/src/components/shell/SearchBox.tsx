"use client";

/**
 * @wfx/app-web — the search box with suggestions (R24-W2, the R24-C
 * search-suggestions row: "WebFlix suggestions plus optional voice/AI
 * query").
 *
 * THE FAMILIAR SUGGESTION GRAMMAR, HONESTLY BACKED: typing under the
 * search box answers a source-neutral suggestion list — the TITLE
 * completions from the runtime's own search seam plus the
 * MATCHES-BY-MEANING lane (the same semantic search R23 wired; its
 * honest unavailable state rides along). A suggestion is a HINT, never
 * a required step: submitting the raw query still runs the full search;
 * the list only ever fills the box. The list is keyboard-navigable
 * (ArrowDown/ArrowUp + Enter), Escape dismisses, and the control
 * degrades to the plain form when the suggestion seam cannot answer
 * (the typed empty state — never noise for single characters).
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";

/** One suggestion (the route's typed lane entry). */
interface Suggestion {
  readonly kind: "title" | "meaning";
  readonly text: string;
  readonly href: string;
}

/** The search box with its suggestion island. */
export function SearchBox(): JSX.Element {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const boxRef = useRef<HTMLFormElement | null>(null);

  /** Fetch the suggestion lanes (debounced — the quiet seam). */
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(`/api/search/suggest?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            setSuggestions([]);
            return;
          }
          const body = (await response.json()) as { suggestions?: Suggestion[] };
          setSuggestions(body.suggestions ?? []);
          setOpen((body.suggestions ?? []).length > 0);
          setActiveIndex(-1);
        })
        .catch(() => {
          // The typed seam failure: the plain form still works (the
          // full search runs on submit — the suggestion lane is a hint).
        });
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  /** Dismiss on outside click. */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (boxRef.current === null) return;
      if (event.target instanceof Node && boxRef.current.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  /** The keyboard navigation (the familiar list grammar). */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (!open || suggestions.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % suggestions.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      } else if (event.key === "Escape") {
        setOpen(false);
        setActiveIndex(-1);
      } else if (event.key === "Enter" && activeIndex >= 0 && suggestions[activeIndex] !== undefined) {
        event.preventDefault();
        window.location.assign(suggestions[activeIndex]!.href);
      }
    },
    [activeIndex, open, suggestions],
  );

  return (
    <form className="wfx-search" action="/search" method="get" role="search" ref={boxRef} data-wfx-searchbox>
      <input
        className="wfx-search__input"
        type="search"
        name="q"
        placeholder="Search your entertainment"
        aria-label="Search your entertainment"
        autoComplete="off"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        data-wfx-searchbox-input
      />
      <button className="wfx-search__submit" type="submit" aria-label="Search">
        <Icon name="search" size={18} />
      </button>
      {open && suggestions.length > 0 ? (
        <div className="wfx-search__suggestions" role="listbox" aria-label="Search suggestions" data-wfx-suggestions>
          {suggestions.map((suggestion, index) => (
            <a
              key={`${suggestion.kind}-${suggestion.text}-${index}`}
              className={`wfx-search__suggestion${index === activeIndex ? " wfx-search__suggestion--active" : ""}`}
              href={suggestion.href}
              role="option"
              aria-selected={index === activeIndex}
              data-wfx-suggestion={suggestion.kind}
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
            >
              <Icon name={suggestion.kind === "meaning" ? "sparkle" : "search"} size={14} />
              <span>{suggestion.text}</span>
              {suggestion.kind === "meaning" ? <span className="wfx-capchip">by meaning</span> : null}
            </a>
          ))}
        </div>
      ) : null}
    </form>
  );
}
