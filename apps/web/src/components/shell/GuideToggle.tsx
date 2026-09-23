"use client";

/**
 * @wfx/app-web — the guide (hamburger) toggle island (R27-W2).
 *
 * YouTube's masthead Guide button: at ≥1280px it collapses the labeled
 * 240px rail to the 72px icon rail (and back); at <1280px it opens the
 * rail as the overlay drawer (the labeled rail over a scrim). The state
 * lives on the document root (`data-wfx-guide="collapsed" | "drawer"`),
 * the CSS answers at the two breakpoints — one honest seam, two familiar
 * behaviors, no fabricated navigation.
 */

import { useCallback, useEffect, useState, type JSX } from "react";

import { Icon } from "@/components/shell/Icon";

/** The guide state vocabulary (the seam's own). */
type GuideState = "default" | "collapsed" | "drawer";

/** Read the CURRENT guide state from the document. */
function guideState(): GuideState {
  if (typeof document === "undefined") return "default";
  const value = document.documentElement.dataset.wfxGuide;
  return value === "collapsed" || value === "drawer" ? value : "default";
}

/** The guide toggle island (renders as the topbar's hamburger). */
export function GuideToggle(): JSX.Element {
  const [state, setState] = useState<GuideState>("default");

  // The viewport band decides which behavior the toggle performs: the
  // wide band flips labeled⇄icon rail; the narrower bands open the drawer.
  const toggle = useCallback((): void => {
    const current = guideState();
    const wide = window.matchMedia("(min-width: 1280px)").matches;
    let next: GuideState;
    if (wide) {
      next = current === "collapsed" ? "default" : "collapsed";
    } else {
      next = current === "drawer" ? "default" : "drawer";
    }
    if (next === "default") {
      delete document.documentElement.dataset.wfxGuide;
    } else {
      document.documentElement.dataset.wfxGuide = next;
    }
    setState(next);
  }, []);

  // Close the drawer on Escape + on resize back into the wide band (the
  // state must never strand a surface in the wrong shape).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && guideState() === "drawer") {
        delete document.documentElement.dataset.wfxGuide;
        setState("default");
      }
    };
    const onResize = (): void => {
      if (guideState() === "drawer" && window.matchMedia("(min-width: 1280px)").matches) {
        delete document.documentElement.dataset.wfxGuide;
        setState("default");
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const open = state !== "default";
  return (
    <button
      type="button"
      className="wfx-topbar__guide"
      onClick={toggle}
      aria-label={open ? "Close guide" : "Open guide"}
      aria-expanded={open}
      data-wfx-guide-toggle={state}
    >
      <Icon name="menu" size={24} />
    </button>
  );
}
