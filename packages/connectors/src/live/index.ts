/**
 * @wfx/connectors — the R37 live barrel (the live designation + the
 * archived live-chat log artifact).
 *
 * The SDK's live vocabulary: the item-level live designation (the
 * metadata keys + the typed derivation every live surface consumes) and
 * the committed chat-log artifact behind chat replay on archived live
 * VODs. Exported through the package's public entry (one additive line in
 * src/index.ts — the WFX-054 YouTube precedent: provider modules stay
 * under their own directory with the SDK's laws enforced).
 */

export * from "./live-designation";
export * from "./live-chat-log";
