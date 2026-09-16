/**
 * @wfx/platform-contracts — shared primitive types (R01, remediation freeze).
 *
 * This package is PURE TypeScript: zero package dependencies, no React, no
 * Node/browser APIs, no wall clock, no randomness. It declares the
 * adapter-side capability ports of the frozen remediation layering law
 * (docs/architecture/webflix-remediation-architecture.md):
 *
 *     Experience Core -> Shared Client Runtime -> Platform Adapter -> (Web | Desktop | Mobile)
 *
 * Adapters OWN these capabilities; the runtime CONSUMES them. Nothing here
 * knows about Web/Desktop/Mobile implementation details beyond their
 * truthful capability vocabulary.
 */

/** A subscription disposer. Every `subscribe` on every port returns one. */
export type Unsubscribe = () => void;
