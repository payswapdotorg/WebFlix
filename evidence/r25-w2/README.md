# R25-W2 — the web journey evidence (J01–J43)

## The record

Two runs, one truth — the same honest split the R24-W2 lane documented
for this box's memory ceiling (the sandbox's 4 GB hard limit; the
documented doctrine: a journey failure caused by the box's ceiling is
recorded as the box's failure, never as a product failure, and the
corroborating fresh-boot run proves the journey itself):

1. **`journeys-full/` — the ONE-RUN full battery** (`bun journeys/runner.ts
   --evidence-dir evidence/r25-w2/journeys-full`): the whole catalog in
   one process, one dev server, one browser — **J01–J39 PASS (38
   journeys, 3,000+ assertions)**, then the dev server was OOM-killed
   by the kernel mid-J40 (the `next-server` render process at ~2.74 GB
   RSS — Turbopack's native compiled-route memory over ~40 journeys;
   the V8 heap cap was verified to reach the process and did not help
   because the growth is native, not V8 heap). Every J40/J41/J43
   failure in this manifest is `net::ERR_CONNECTION_REFUSED` against
   the dead server — **zero product-assertion failures** (J40 completed
   26 of its 39 assertions, all passing, before the kill).
2. **`journeys-corroborating/` — the fresh-boot corroborating run**
   (`bun journeys/runner.ts --filter J40,J41,J43 --evidence-dir
   evidence/r25-w2/journeys-corroborating`): the three journeys the
   one-run battery lost to the ceiling, on a FRESH dev server + fresh
   browser (no accumulated memory) — **J40 PASS (39/39), J41 PASS
   (46/46), J43 PASS (38/38)**.

The kernel OOM record (the same failure signature all three one-run
attempts):

```
Out of memory: Killed process (next-server (v1)) total-vm:30780140kB, anon-rss:2744452kB
```

## J43 — the realtime translation walk (the lane's own journey)

Encoded at `journeys/web/j43-realtime-translation.ts` (38 assertions):
the real user flow through the primary play's honest provider-rung
restriction (R25-E — never a bypass), the authorized-peer-copy switch
opening the full-fidelity lane, the Spanish session over the REAL
WebFlix bridge (browser → bridge (ws 3102) → the provider session seam
(the frozen R25-A domain port) → the dev provider double (ws 3103)), the
aligned bilingual view + the Speaker 2 change + the live caption
overlay, the optional translated speech (real PCM chunks), the scripted
provider drop + the domain `reconnect` operation, the scripted client
network blip + the resume token (the continuity cursor), the
phase-truth playback-independence law at every stage, the measured
R25-L observations (the bridge-origin credential law — no provider
endpoint in the client), the accountless walk (the optional sign-in),
the German direction's typed provider failure (the graceful fallback
with captions remaining + playback untouched), and the bridge's
retention seam read.

## The latency record

`latency/` — the R25-L web latency benchmark record
(`bun apps/web/scripts/r25-web-latency.ts`): 3 fresh-session passes of
the full realtime walk + the graceful-fallback probe + the bridge
telemetry read, with the honest provenance (the dev double's modeled
provider profile; the bridge-path transport + instrumentation real;
the live-endpoint benchmark is the lead's R25-L procedure).
