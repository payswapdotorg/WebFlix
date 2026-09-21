# J43 — Realtime translation (Desktop) — the R25-W3 evidence

Run: 2026-09-21T23:54:14.493Z → 2026-09-21T23:54:14.508Z (desktop-composition-simulator).

## The walk

- **W1** — Play: the authorized torrent/peer copy started (playback session s-r23-1, native session test-native-1); no translation exists yet.
- **W2** — Translate control: offered on the native/torrent rung (shared-surface); the embed rung answers the honest never-capture truth.
- **W3-W4** — Translate → en: the session created; the tap opened; 2 captured frames appended; the bilingual captions streamed incrementally (1 paired row).
- **W5-W6** — Speaker change (Speaker 2) with the translation continuing; the translated speech played with the original ducked; the mode round trip held the original available.
- **W7** — Interruption → reconnect: the playback session wfxpses_00000000000000000000000001 NEVER restarted (the native session stayed playing); the recovery drove only session.reconnect() (1 call); the translation resumed.
- **W8** — The R25-L measures (real clocks): firstTranscriptDelta=0.056ms, firstTranslationDelta=0.059ms, firstSpeechChunk=0.089ms, stableSegment=0.094ms, reconnect=0.013ms, continuityGaps=1 (0.015ms), drift=-300ms.
- **W9** — Normal playback: the translation stopped cleanly; the base playback continued untouched.
- **W10** — Failure fallback: the terminal error stopped the translation; the base playback and the source captions remained.

## The assertions

**55 assertions, all passing.**

- [W1] the authorized peer copy started through the real play flow
- [W1] the native session is PLAYING before any translation exists (base playback never waits)
- [W2] the play started
- [W2] the translate control exists in the closed affordance grammar
- [W2] the native rung's translate control is offered through the shared session seam
- [W2] the embed rung's translate control answers the honest realization-exposed truth (the provider's own captions)
- [W2] the peer-copy rung resolves the authorized capture path
- [W2] the authorized path is the TORRENT path (the connector truth)
- [W3] the play started
- [W3] the translation started through the session seam
- [W3] the session input's translated-voice policy is NEUTRAL (never a silent clone)
- [W3] no provider credential reached the session input (the vocabulary scan)
- [W3] the capture tap opened on the native session
- [W3] the captured frames flow into the session's append-audio seam
- [W4] the first source delta + translation delta are visible incrementally
- [W4] the live row carries BOTH the partial source and the partial translation
- [W4] the finals stabilize both sides of the row
- [W4] the source/translation alignment holds (the paired row by position)
- [W5] the play started
- [W5] the speaker change is truthful (the new row carries Speaker 2)
- [W5] the translation CONTINUED through the speaker change
- [W5] the active speaker is projected
- [W6] the translated chunk plays at the source playhead
- [W6] the original is DUCKED, not erased, while translated speech plays
- [W6] the original-audio mode restores the FULL original gain
- [W6] the original-audio mode mutes the translated stream
- [W6] the mode switches back instantly (the lossless round trip)
- [W7] the play started
- [W7] the interruption is observed (the recovery state is interrupted)
- [W7] the playback session COUNT is unchanged by the interruption
- [W7] the playback SESSION ID is unchanged (never a restart)
- [W7] the native media session is STILL playing through the interruption
- [W7] the original carries the moment during the gap (never silence)
- [W7] the reconnect recovered the translation
- [W7] the recovery drove ONLY the session's own reconnect operation
- [W7] the native session is STILL playing after the recovery (no restart)
- [W7] the translation continues after the reconnect
- [W8] the play started
- [W8] the resumed chunk plays after the gap
- [W8] the first transcript delta was MEASURED (positive, real)
- [W8] the first translation delta was MEASURED
- [W8] the first translated speech chunk was MEASURED
- [W8] the stable segment was MEASURED
- [W8] the speaker attribution availability was observed
- [W8] the reconnect time was MEASURED
- [W8] the audio continuity gap was observed with its real duration
- [W8] the drift was MEASURED (rendered − consumed)
- [W8] the translation did NOT fail in this pass
- [W9] stopping the translation closed the session
- [W9] the native playback session is STILL playing after the translation stopped
- [W10] the play started
- [W10] the terminal failure stopped the translation (the failed state)
- [W10] the native playback session is STILL playing after the translation failed
- [W10] the source captions REMAIN after the failure (the fallback)
- [evidence] the evidence pass started

## The R25-L latency measures (real clocks)

- first source transcript delta: 0.102 ms
- first translated text delta: 0.107 ms
- first translated speech chunk: 0.165 ms
- stable translated segment: 0.124 ms
- speaker attribution availability: true
- reconnect time: 0.041 ms
- audio continuity gaps: 1 (0.051 ms)
- drift (rendered − consumed): -200 ms (0 correction(s))
- translated audio chunks: 2; captured audio frames: 2; visual frames appended: 0 (the audio-only never-forced policy)

## The honest scope (never silent skips)

- No realtime provider is bound through Model Fabric in this sandbox (Worker 1's shared contract + the provider registration have not landed) — the session here is the DETERMINISTIC DOUBLE of the Model Fabric session seam, the same shape the production factory binds.
- The latency numbers are REAL measurements of the REAL TypeScript composition executing in this sandbox (the deterministic doubles resolve immediately) — they prove the ARCHITECTURE ORDERING and the measurement machinery, not provider latency. The provider-path numbers are the lead's real-device procedure, recorded as pending (never silently passed).
- The desktop playback rides the R23 harness's authorized torrent/peer copy — the same journey law as J38/J41; the local-file and controlled-live capture paths are proven by the capture-service and adapter unit laws.
- The Web lane's J43 (Worker 2) shares the same session seam vocabulary; the Web/Desktop semantics agreement is the integration-time truth.
