# WebFlix Golden Journey Run — Evidence Summary

- commit: `9b078225371115410d4f8f956527ecbb474183f8`
- branch: `wfx/r27/web`
- environment: web-fixtures @ http://localhost:3101 (CI configuration)
- window: 2026-09-23T19:03:17.716Z → 2026-09-23T19:04:33.918Z

**0 passed · 6 failed · 0 not-run (listed with procedures) · 6 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J36 | Major user journey completion / no dead-end discovery | **FAIL** | 20 | 3 |
| J38 | First-class torrent playback (web: browser-capable + honest fallbacks) | **FAIL** | 2 | 3 |
| J39 | Multimodal media intelligence / semantic moment discovery | **FAIL** | 11 | 3 |
| J40 | YouTube viewer parity | **FAIL** | 8 | 3 |
| J41 | YouTube-equivalent playback startup | **FAIL** | 2 | 3 |
| J43 | Realtime translation | **FAIL** | 2 | 3 |

## Explicit limitations (never silent skips)

- **J36** (configuration-limit): The R22-G encoding runs the full J36 completion walk over the deterministic fixtures boot: the register round trip uses the scripted dev persona (the loud dev badge — the REAL /api/auth/register transport's email-taken/validation round trips are service-mode, proven at the contract level by packages/client-runtime/tests/account-creation.test.ts); the source chooser's connected truth and the BYOF import ride the fixture connectors (the REAL provider OAuth dance is J14/J28's service-side procedure); the Shorts like/save typed absence is the fixture source's own capability truth (the hydration law is asserted as capability-truth, not blanket presence).
  - procedure: LEAD (the production sweep): deploy the integrated tree, run this journey with --base-url against the deployed service-mode boot (real register transport, a real connectable connector, a source that declares like/save), and capture the evidence under evidence/r22/ — the J35 production-parity sweep covers the same deployment.
- **J38** (configuration-limit): The R23-W2 web encoding drives the FIRST-CLASS peer-copy surfaces end to end over the fixtures' scripted acquisition feed (the same protocol-free facts through the REAL acquisition store the J21-J26 chain validates), the honest Desktop next step for ordinary swarms, and the adapter/WebRTC environment truth behind progressive disclosure. A REAL WebRTC swarm — live hybrid peers streaming bytes into the browser video element through the R23-D adapter — requires a reachable swarm the sandbox does not have; the adapter binding (webtorrent@3.0.21 browser build, lazy-loaded) is the real code path for that environment.
  - procedure: LOCAL-ONLY (the WebRTC-capable scenario): serve a .torrent whose swarm includes WebRTC-capable peers (a WebTorrent hybrid client seeding legally-owned content) over a reachable wss tracker, register the authorized copy on the source, open its player, and capture the live streaming + the verified-asset landing under evidence/<run>/; the Desktop native path is Worker 3's J38 procedure.
- **J41** (configuration-limit): The R24-W2 web encoding measures the REAL startup path over the fixtures boot (the complete assertable marker set — the click-bridged trace origin, the streamed shell's parse, the phase declaration, the first frame at the contained-surface boundary, the seek/control pairs, the realization-switch pair — plus the MEASURED startup architecture laws: the first frame preceding every enrichment mount, the evidence-anchored position, the retained raw observations). The YouTube COMPARATIVE baseline is honestly out of scope in this configuration: the fixture catalog's content is WebFlix-internal (no identical public YouTube content — the same-content law answers samePublicContentOnYouTube=false), and this sandbox has no route to the public YouTube product. The FRESH-SESSION cold/warm cache battery (a brand-new browser per cold pass, the same browser for the warm pass) is the benchmark harness's own record under evidence/r24-w2/benchmark/ — the journey's session is shared with J01-J40 (its passes are warm by construction, which the journey never claims otherwise).
  - procedure: LEAD (the comparative protocol — the plan's lead-owned 'comparative performance test protocol'): select real public content available on BOTH systems, run the same browser/device/network profile over cold and warm cache passes on WebFlix AND YouTube, record the same metric set (the shared telemetry contract's marker pairs), evaluate the frozen R24-E thresholds (p50 +150ms / p75 +300ms / p95 +750ms TTFF deltas, startup failure +0.5pp, first-60s rebuffer +0.25pp), and attach the traces + the evaluation record under evidence/r24-lab/. The WebFlix-internal benchmark record (evidence/r24-w2/benchmark/) is the standing measurement of this lane's startup architecture laws.
- **J43** (configuration-limit): The R25-W2 encoding drives the FULL J43 walk over the fixtures boot's REAL realtime composition: the browser WebSocket → the WebFlix bridge (ws on 3102, started by the dev boot's instrumentation) → the provider session seam (the frozen R25-A domain port) with the deterministic dev provider double behind it (a REAL second WebSocket hop on 3103 — the scripted bilingual media scripts, the real PCM16 translated-speech chunks, the scripted provider drop + the scripted client network blip). The TRANSPORT, the reconnect/resume machinery, the continuity, the cost-policy verdicts (the shared Model-Fabric policy engine), and the R25-L instrumentation are all the real production wiring of this configuration. The provider-side LATENCY figures are the dev double's MODELED profile (the plan's frozen research numbers — the ~2.3s reported lag), honestly recorded as such in the metrics (the provider-reported figure rides alongside the measured one); the LIVE Qwen endpoint's end-to-end latency/cost benchmark — real credentials, real audio, the production Vercel WebSocket deployment — is the lead's R25-L procedure, and the bridge's service-mode deployment (the Vercel function transport) is the lead's R25 deployment verification.
  - procedure: LEAD (the live-provider benchmark): provision the provider credentials server-side (never in the client), register the realtime adapter through Model Fabric, deploy the bridge on the WebSocket-capable function transport, run the same J43 walk + the r25 web latency harness (apps/web/scripts/r25-web-latency.ts --base-url) against the deployed service, and record the measured R25-L numbers (first source/translation deltas, first speech chunk, stable segment, reconnect, drift) with the live provider's provenance under evidence/r25-lab/.
- **J40** (configuration-limit): The R24-W2 encoding walks the viewer-parity flow end to end over the fixtures boot: the walk's own watchlist/playlist/queue WRITES answer their typed success at the CONTROLS (the 'Saved' status, the queue-add's outcome state, the write routes' dev-boot bridge resolving the item through the runtime's own search seam), but the cross-PAGE read of those writes (the Library page listing them) is kept apart by the dev boot's per-route module graphs — the same documented doctrine the J12 limitation records for the watch-state fold (the single-bundle production boot shares one runtime instance: the writes are visible there). The Library assertions therefore carry the fresh session's HONEST states (the typed empty states — J11's own law) plus the sections' presence (the pairing laws).
  - procedure: LEAD (the production parity sweep — the J35-class run): deploy the integrated tree (the single-bundle production build), drive the same J40 walk against the deployed boot, and capture the Library showing the walk's own watchlist/playlist writes under evidence/<run>/ (the production runtime is one instance: the writes cross pages).

## Failures

- **J36 Major user journey completion / no dead-end discovery**: harness/browser failure: agent-browser command failed (-1): pollTextContains "Your imported feeds" in [data-wfx-byof-feed]
timed out after 30000ms; last observed: <absent>
- **J38 First-class torrent playback (web: browser-capable + honest fallbacks)**: journey assertion failed: Where to watch groups: the WebFlix source first, the Authorized peer copy second (the frozen order)
  expected: webflix-source then authorized-peer-copy
  observed: 
- **J39 Multimodal media intelligence / semantic moment discovery**: journey assertion failed: the item hub carries its derived intelligence (transcript, chapters, moments)
  expected: [data-wfx-intelligence] present in the DOM
  observed: 0 matching element(s)
- **J40 YouTube viewer parity**: journey assertion failed: the queue-add control renders on the item hub
  expected: [data-wfx-queue-add] present in the DOM
  observed: 0 matching element(s)
- **J41 YouTube-equivalent playback startup**: journey assertion failed: Deep Field Diary: the one obvious primary play action renders
  expected: [data-wfx-item-play] present in the DOM
  observed: 0 matching element(s)
- **J43 Realtime translation**: journey assertion failed: Deep Field Diary: the one obvious primary play action renders
  expected: [data-wfx-item-play] present in the DOM
  observed: 0 matching element(s)
