# WebFlix Golden Journey Run — Evidence Summary

- commit: `37effa325c5060e14afda7e07db5b7eb61e45d9e`
- branch: `wfx/r37/live`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-28T18:54:09.914Z → 2026-09-28T18:55:38.966Z

**8 passed · 3 failed · 0 not-run (listed with procedures) · 11 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J01 | First launch / profile selection / onboarding | PASS | 19 | 3 |
| J02 | Home discovery / hero / rows / intent entry | PASS | 12 | 3 |
| J03 | Long-form Watch browsing | PASS | 6 | 3 |
| J04 | Shorts vertical discovery | PASS | 13 | 3 |
| J05 | Unified search | PASS | 7 | 3 |
| J06 | Item detail / availability / realization choice | PASS | 13 | 3 |
| J11 | Library / watchlist / history | PASS | 11 | 3 |
| J37 | Anonymous public viewing without WebFlix login | PASS | 17 | 3 |
| J40 | YouTube viewer parity | **FAIL** | 3 | 3 |
| J43 | Realtime translation | **FAIL** | 0 | 3 |
| J44 | Creator channel round trip | **FAIL** | 0 | 3 |

## Explicit limitations (never silent skips)

- **J43** (configuration-limit): The R25-W2 encoding drives the FULL J43 walk over the fixtures boot's REAL realtime composition: the browser WebSocket → the WebFlix bridge (ws on 3102, started by the dev boot's instrumentation) → the provider session seam (the frozen R25-A domain port) with the deterministic dev provider double behind it (a REAL second WebSocket hop on 3103 — the scripted bilingual media scripts, the real PCM16 translated-speech chunks, the scripted provider drop + the scripted client network blip). The TRANSPORT, the reconnect/resume machinery, the continuity, the cost-policy verdicts (the shared Model-Fabric policy engine), and the R25-L instrumentation are all the real production wiring of this configuration. The provider-side LATENCY figures are the dev double's MODELED profile (the plan's frozen research numbers — the ~2.3s reported lag), honestly recorded as such in the metrics (the provider-reported figure rides alongside the measured one); the LIVE Qwen endpoint's end-to-end latency/cost benchmark — real credentials, real audio, the production Vercel WebSocket deployment — is the lead's R25-L procedure, and the bridge's service-mode deployment (the Vercel function transport) is the lead's R25 deployment verification.
  - procedure: LEAD (the live-provider benchmark): provision the provider credentials server-side (never in the client), register the realtime adapter through Model Fabric, deploy the bridge on the WebSocket-capable function transport, run the same J43 walk + the r25 web latency harness (apps/web/scripts/r25-web-latency.ts --base-url) against the deployed service, and record the measured R25-L numbers (first source/translation deltas, first speech chunk, stable segment, reconnect, drift) with the live provider's provenance under evidence/r25-lab/.
- **J40** (configuration-limit): The R24-W2 encoding walks the viewer-parity flow end to end over the fixtures boot: the walk's own watchlist/playlist/queue WRITES answer their typed success at the CONTROLS (the 'Saved' status, the queue-add's outcome state, the write routes' dev-boot bridge resolving the item through the runtime's own search seam), but the cross-PAGE read of those writes (the Library page listing them) is kept apart by the dev boot's per-route module graphs — the same documented doctrine the J12 limitation records for the watch-state fold (the single-bundle production boot shares one runtime instance: the writes are visible there). The Library assertions therefore carry the fresh session's HONEST states (the typed empty states — J11's own law) plus the sections' presence (the pairing laws).
  - procedure: LEAD (the production parity sweep — the J35-class run): deploy the integrated tree (the single-bundle production build), drive the same J40 walk against the deployed boot, and capture the Library showing the walk's own watchlist/playlist writes under evidence/<run>/ (the production runtime is one instance: the writes cross pages).

## Failures

- **J40 YouTube viewer parity**: harness/browser failure: agent-browser command failed (-1): wait [data-wfx-suggestions]
✗ Wait timed out after 25000ms

proc: timed out after 15000ms
- **J43 Realtime translation**: harness/browser failure: agent-browser command failed (1): open http://localhost:3101/search?q=Deep%20Field
✗ Navigation failed: net::ERR_CONNECTION_REFUSED
- **J44 Creator channel round trip**: harness/browser failure: agent-browser command failed (1): open http://localhost:3101/
✗ Navigation failed: net::ERR_CONNECTION_REFUSED
