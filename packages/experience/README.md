# @wfx/experience

The **Experience Core** of the WebFlix remediation freeze (Lane C): the
source-neutral use-case layer (WFX-005) and the **Media Surface resolver**
(WFX-025, productionized by R09). Pure TypeScript types + pure logic +
fixtures ONLY — every external effect is an injected PORT (`ports.ts`); the
frozen contracts come exclusively from `@wfx/domain`.

```
Experience Core (this package — the surface resolver is the pure decision engine)
       |
Shared Client Runtime (consumes the resolver through the R09 seam)
       |
Platform Adapter (Web R07 / Desktop R08 — wire the resolver; host the surfaces)
```

## The Media Surface — the precedence, wired (R09)

The frozen playback-resolution precedence is **law**:

```
Native > Embed > Browser > External
```

- **Native** — a playable native realization exists (the R10 engine's
  asset; the desktop adapter's engine binding backs the rung).
- **Embed** — the provider exposes an official-embed realization.
- **Browser** — the contained host can open the provider page.
- **External** — the honest handoff, carrying a return context.

### The capability-truth law

`resolveSurface` (`src/surface/resolve.ts`, FROZEN) answers the highest
**truthfully-available** rung. Availability is **capability truth, never
aspiration** (invariant 3):

- a rung without a realization is **skipped and named**
  (`"embed: rejected — no embed realization present"`);
- a rung the device cannot realize is **rejected and named**
  (`"native: rejected — device cannot realize native playback (…)"`);
- a restricted rung is **rejected and named** (permission gates);
- an expired/unavailable realization is a **typed exclusion** with the
  reason recorded — never a crash, never a silent skip, never a fake
  success.

The answer **names what was chosen and why**: every successful resolution
carries a `precedenceTrace` with exactly one line per rung in precedence
order. `answerMediaSurface` (`src/surface/media-surface.ts`, R09) composes
the frozen resolution with the R09 truth layers — the parsed per-rung
verdicts (`parsePrecedenceTrace`), the official-embed truth, and the
external return-context seed — into ONE auditable answer object.

### The wiring (how the precedence crosses the layering law)

The runtime cannot import the Experience Core (the layering law keeps
`Experience Core -> Shared Client Runtime -> Platform Adapter` dependency
directions clean), so the frozen resolver crosses into the runtime through
the **injectable `SurfaceResolverSeam`** (R09, `@wfx/client-runtime`):

- the **adapter** derives the resolver's `DeviceCapabilities` from its own
  truthful `PlatformCapabilities` bundle and constructs the seam
  (`apps/web/src/host/media-surface.ts` → `createWebSurfaceResolver`;
  `apps/desktop/src/platform/media-surface.ts` →
  `createDesktopSurfaceResolver`);
- the **runtime** calls the seam inside `resolvePlayback`, adopts its
  answer as THE precedence decision (re-checked against the runtime's own
  capability truth — an incoherent wiring fails LOUDLY, typed), and rides
  the precedence trace on `PlaybackState.precedenceTrace`;
- the **adapters render** the trace (the web player surface) so the user
  sees what was chosen and why.

### The embed capability model (the official-embed marker)

A realization can carry the **official-embed marker** — the
`"officialEmbed"` capability entry (`src/surface/embed.ts`) — attesting
that the URL is the provider's OWN documented, permitted embeddable player.
The marker is **consumed, never obeyed**: it names the rung's truth
(`official` / `unofficial` / `absent` via `officialEmbedTruth`), the
capability matrix consumes it (`embedCapabilityMatrix`), and the surface
renders the attestation honestly — but it NEVER overrides the frozen
precedence (the same law provider hints obey). Where **no provider exposes
embeds**, the rung answers honestly-unavailable — the resolver records it
by name; **a fixture is never silently presented as production capability**
(invariant 10: the dev-fixture transport is loudly named, and the fixture
connector's embed realizations carry no marker — they render as
`unofficial`).

The embed session is **contained exactly like the browser rung**
(`EMBED_SANDBOX_TOKENS` mirror the web host's sandbox law verbatim:
`allow-scripts allow-forms allow-popups allow-presentation`, deliberately
WITHOUT `allow-same-origin` — opaque origin, cookie/storage isolation — and
without `allow-storage-access-by-user-activation`). The desktop embed runs
in the desktop BrowserHost's contained webview (the same port, the same
per-session isolation); the web embed renders a sandboxed iframe through
the same player-surface vocabulary (`data-wfx-player-mode="embed"`).

### The external rung's return context (J09)

The external handoff carries a **RETURN CONTEXT** — the durable
continuation (`src/surface/external.ts`): the canonical item + the position
at handoff (`ExternalReturnContext`, built by `buildExternalReturnContext`
with the caller-supplied instant), so the journey can return to the same
place inside WebFlix. The adapters render the visible handoff ("opens on
its source") with the return context and its return link.

## Golden journey evidence seeds (J07–J09)

The deterministic test layer for the three media-surface journeys (the lead
runs the agent-browser validation against a running app; these seeds are
the step documentation + the assertions the journeys check):

### J07 — Official embed playback

Steps: open a detail page for embed-capable content → choose Play → the
player route resolves through the wired precedence.

Expected evidence (web): the stage renders
`data-wfx-player-mode="embed"` with the provider's embed URL; the iframe
carries the containment sandbox
(`sandbox="allow-scripts allow-forms allow-popups allow-presentation"`,
NO `allow-same-origin`); `data-wfx-embed-attestation` names the marker
truth (`official` when the provider attests — see
`apps/web/tests/media-surface.test.ts`, "the official-embed marker is
consumed when present"); the precedence trace names the rungs
(`native: rejected — device cannot realize native playback` first on web);
`data-wfx-contained-surface` names the engaged contained session. On
desktop, `prepare` opens the contained webview at the embed URL (the
per-session cookie jar proves the isolation —
`apps/desktop/tests/media-surface.test.ts`).

### J08 — Contained Browser playback

Steps: open browser-only content (no embed realization) → Play → the
contained surface opens.

Expected evidence (web): `data-wfx-player-mode="browser"`; the sandboxed
iframe (the same tokens, opaque origin); the honest note "never injects
into or inspects the provider page"; the trace names
`embed: rejected — no embed realization present` then
`browser: accepted`. **The Constrained truth**: a boot context with no DOM
(a server render pass) answers `webSurfaceCapabilityTruth().constrained
=== true` — sessions are recorded for the render layer, navigation applies
on the next render (J08's honest "Constrained" answer where webview APIs
are absent; the golden journey matrix marks Mobile "Constrained" for J08).
The desktop contained surface is the full-power reference (unconstrained,
per-session data directories).

### J09 — External playback fallback / return context

Steps: open external-only content (or content whose only viable rung is
external) → Play → the visible handoff renders → follow the return link.

Expected evidence (web): `data-wfx-player-mode="external"`; the copy
"opens on its source" (the R07 contract, still green); the RETURN CONTEXT
element `data-wfx-return-context` with the item + position at handoff and
the `data-wfx-return-link` back into the player (resume parameter carried);
the trace names the rejected rungs and `external: accepted`.

## The frozen surface contracts

`src/surface/` carries the FROZEN resolver contracts (WFX-025) —
`request.ts`, `matrix.ts`, `resolve.ts`, `session-builder.ts`,
`fixtures.ts` — plus the R09 additive wiring (`embed.ts`, `external.ts`,
`media-surface.ts`) which composes them without modifying them. Contract
changes go through the lead.

## Fixtures

`src/fixtures.ts` (and the surface fixtures) are **deterministic test
fixtures — never a production source** (invariant 10). The web adapter's
dev-fixture mode (`WFX_DEV_FIXTURES=1`, dev-only) adapts them onto the
runtime's `ServerPort`; production paths never construct them.
