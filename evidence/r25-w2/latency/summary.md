# R25-W2 — the web realtime-translation latency record

- commit: `ec37ff1e583840915872a774e68f14f401c685ae`
- boot: web-fixtures (the deterministic fixtures composition — the same boot the J43 journey consumes)
- bridge: ws://localhost:3102 (the WebFlix WebSocket bridge; the provider session seam behind it)
- provider: wfx-dev-realtime — the deterministic dev realtime provider (the fixtures double — scripted source/translation content and modeled latencies; a registered Model-Fabric realtime provider serves the live lane in service mode)
- reported average lag: ~2300 ms (the provider-REPORTED figure, recorded never promised)
- passes: 3 (fresh browser sessions — fresh WS sessions)
- provenance: the deterministic dev realtime provider's MODELED profile (the plan's frozen research figures) — the bridge-path transport, the reconnect machinery, the cost-policy verdicts, and the instrumentation are the REAL production wiring of this configuration; the LIVE Qwen endpoint's end-to-end latency benchmark is the lead's R25-L procedure (never presented as the live provider's number)

## The R25-L web metric set (measured over the passes)

| metric | min | median | max |
|---|---:|---:|---:|
| firstSourceTranscriptDeltaMs | 427 ms | 430 ms | 476 ms |
| firstTranslatedTextDeltaMs | 2727 ms | 2731 ms | 2776 ms |
| firstTranslatedSpeechChunkMs | 14237 ms | 14241 ms | 14290 ms |
| stableSegmentMs | 3328 ms | 3331 ms | 3376 ms |
| reconnectTimeMs | 1205 ms | 1206 ms | 1207 ms |
| driftMs | 2200 ms | 2200 ms | 2200 ms |

## The graceful-fallback probe

- terminal error kind: `provider-failure`
- playback phase after the failure: `buffering` (unchanged — the never-block-playback law)
- original captions remain: true
- the fallback sentence rendered: true

## The bridge's server-side telemetry at the end

- ended sessions retained: 3
- client marker records flushed: 4
- sample usage (one ended session): {"inputAudioTokens":154,"textOutputTokens":169,"outputAudioTokens":60,"imageInputTokens":0} → derived cost $0.006335

## The raw observations

- pass 1 (33506 ms, 8 segments, screenshot pass-1.png):
  - session-start-requested @ 1790037573162
  - session-bound @ 1790037573221
  - session-created @ 1790037573252
  - first-source-transcript-delta @ 1790037573638
  - first-translation-delta @ 1790037575938
  - first-stable-segment @ 1790037576538
  - recoverable-error @ 1790037583440
  - reconnected @ 1790037583448
  - first-translated-audio-chunk @ 1790037587452
  - client-disconnected @ 1790037597251
  - reconnect-requested @ 1790037598452
  - reconnected @ 1790037598458
- pass 2 (30824 ms, 8 segments, screenshot pass-2.png):
  - session-start-requested @ 1790037604129
  - session-bound @ 1790037604157
  - session-created @ 1790037604165
  - first-source-transcript-delta @ 1790037604559
  - first-translation-delta @ 1790037606860
  - first-stable-segment @ 1790037607460
  - recoverable-error @ 1790037614361
  - reconnected @ 1790037614369
  - first-translated-audio-chunk @ 1790037618370
  - client-disconnected @ 1790037628161
  - reconnect-requested @ 1790037629361
  - reconnected @ 1790037629367
- pass 3 (30676 ms, 8 segments, screenshot pass-3.png):
  - session-start-requested @ 1790037634630
  - session-bound @ 1790037634655
  - session-created @ 1790037634663
  - first-source-transcript-delta @ 1790037635057
  - first-translation-delta @ 1790037637357
  - first-stable-segment @ 1790037637958
  - recoverable-error @ 1790037644858
  - reconnected @ 1790037644864
  - first-translated-audio-chunk @ 1790037648867
  - client-disconnected @ 1790037658657
  - reconnect-requested @ 1790037659858
  - reconnected @ 1790037659862
