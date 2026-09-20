/**
 * @wfx/app-web — the Home discovery header (R21-D, server).
 *
 * The ORIENTATION ZONE of the Home surface (the R21 plan: "Home becomes
 * the product's orientation surface"): the feed-mode control, the
 * Personalize control, and the source strip, rendered as one calm
 * warm-light band above the content rows. Composition only — each
 * control is its own component (the feed-mode/personalize islands post
 * through their API routes; the source strip links into the existing
 * management IA).
 *
 * The compact variant (Watch) renders the feed-mode + Personalize
 * controls without the source strip (long-form browsing keeps its
 * chrome quiet).
 */

import type { JSX } from "react";

import type { DiscoveryBundle } from "@/host/discoverability";
import { FeedModeControl } from "@/components/discovery/FeedModeControl";
import { PersonalizeControl } from "@/components/discovery/PersonalizeControl";
import { SourceStrip } from "@/components/discovery/SourceStrip";

export function DiscoveryHeader({
  bundle,
  withSourceStrip = true,
}: {
  /** The Home discovery bundle (the controls' views). */
  readonly bundle: DiscoveryBundle;
  /** Whether the source strip renders (Home: yes; Watch: no). */
  readonly withSourceStrip?: boolean;
}): JSX.Element {
  return (
    <div className="wfx-disc" data-wfx-discovery-header>
      <div className="wfx-disc__row">
        <FeedModeControl view={bundle.feedMode} />
        <PersonalizeControl view={bundle.personalize} surface="home" />
      </div>
      {withSourceStrip ? <SourceStrip view={bundle.sourceStrip} /> : null}
    </div>
  );
}

/** The compact Watch/Shorts discovery band (feed mode + Personalize). */
export function CompactDiscoveryControls({
  bundle,
  surface,
}: {
  readonly bundle: DiscoveryBundle;
  readonly surface: "watch" | "shorts";
}): JSX.Element {
  return (
    <div className="wfx-disc wfx-disc--compact" data-wfx-discovery-compact data-wfx-discovery-surface={surface}>
      <div className="wfx-disc__row">
        <FeedModeControl view={bundle.feedMode} compact />
        <PersonalizeControl view={bundle.personalize} surface={surface} />
      </div>
    </div>
  );
}
