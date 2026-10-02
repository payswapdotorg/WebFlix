# WebFlix Golden Journey Run — Evidence Summary

- commit: `b0238206a348c5740396d09fd27ffef3997a7b7b`
- branch: `work/wfx-deploy-w3-regression`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-10-02T10:39:50.275Z → 2026-10-02T10:40:40.338Z

**1 passed · 0 failed · 0 not-run (listed with procedures) · 1 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J43 | Realtime translation | PASS | 38 | 3 |

## Explicit limitations (never silent skips)

- **J43** (configuration-limit): The R25-W2 encoding drives the FULL J43 walk over the fixtures boot's REAL realtime composition: the browser WebSocket → the WebFlix bridge (ws on 3102, started by the dev boot's instrumentation) → the provider session seam (the frozen R25-A domain port) with the deterministic dev provider double behind it (a REAL second WebSocket hop on 3103 — the scripted bilingual media scripts, the real PCM16 translated-speech chunks, the scripted provider drop + the scripted client network blip). The TRANSPORT, the reconnect/resume machinery, the continuity, the cost-policy verdicts (the shared Model-Fabric policy engine), and the R25-L instrumentation are all the real production wiring of this configuration. The provider-side LATENCY figures are the dev double's MODELED profile (the plan's frozen research numbers — the ~2.3s reported lag), honestly recorded as such in the metrics (the provider-reported figure rides alongside the measured one); the LIVE Qwen endpoint's end-to-end latency/cost benchmark — real credentials, real audio, the production Vercel WebSocket deployment — is the lead's R25-L procedure, and the bridge's service-mode deployment (the Vercel function transport) is the lead's R25 deployment verification.
  - procedure: LEAD (the live-provider benchmark): provision the provider credentials server-side (never in the client), register the realtime adapter through Model Fabric, deploy the bridge on the WebSocket-capable function transport, run the same J43 walk + the r25 web latency harness (apps/web/scripts/r25-web-latency.ts --base-url) against the deployed service, and record the measured R25-L numbers (first source/translation deltas, first speech chunk, stable segment, reconnect, drift) with the live provider's provenance under evidence/r25-lab/.
