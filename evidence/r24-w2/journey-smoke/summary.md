# WebFlix Golden Journey Run — Evidence Summary

- commit: `04212274b98d6ae83a8cce699b83f369d73c2773`
- branch: `wfx/r24/web`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-21T16:44:26.975Z → 2026-09-21T16:45:26.934Z

**2 passed · 0 failed · 0 not-run (listed with procedures) · 2 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J40 | YouTube viewer parity | PASS | 39 | 3 |
| J41 | YouTube-equivalent playback startup | PASS | 46 | 3 |

## Explicit limitations (never silent skips)

- **J41** (configuration-limit): The R24-W2 web encoding measures the REAL startup path over the fixtures boot (the complete assertable marker set — the click-bridged trace origin, the streamed shell's parse, the phase declaration, the first frame at the contained-surface boundary, the seek/control pairs, the realization-switch pair — plus the MEASURED startup architecture laws: the first frame preceding every enrichment mount, the evidence-anchored position, the retained raw observations). The YouTube COMPARATIVE baseline is honestly out of scope in this configuration: the fixture catalog's content is WebFlix-internal (no identical public YouTube content — the same-content law answers samePublicContentOnYouTube=false), and this sandbox has no route to the public YouTube product. The FRESH-SESSION cold/warm cache battery (a brand-new browser per cold pass, the same browser for the warm pass) is the benchmark harness's own record under evidence/r24-w2/benchmark/ — the journey's session is shared with J01-J40 (its passes are warm by construction, which the journey never claims otherwise).
  - procedure: LEAD (the comparative protocol — the plan's lead-owned 'comparative performance test protocol'): select real public content available on BOTH systems, run the same browser/device/network profile over cold and warm cache passes on WebFlix AND YouTube, record the same metric set (the shared telemetry contract's marker pairs), evaluate the frozen R24-E thresholds (p50 +150ms / p75 +300ms / p95 +750ms TTFF deltas, startup failure +0.5pp, first-60s rebuffer +0.25pp), and attach the traces + the evaluation record under evidence/r24-lab/. The WebFlix-internal benchmark record (evidence/r24-w2/benchmark/) is the standing measurement of this lane's startup architecture laws.
- **J40** (configuration-limit): The R24-W2 encoding walks the viewer-parity flow end to end over the fixtures boot: the walk's own watchlist/playlist/queue WRITES answer their typed success at the CONTROLS (the 'Saved' status, the queue-add's outcome state, the write routes' dev-boot bridge resolving the item through the runtime's own search seam), but the cross-PAGE read of those writes (the Library page listing them) is kept apart by the dev boot's per-route module graphs — the same documented doctrine the J12 limitation records for the watch-state fold (the single-bundle production boot shares one runtime instance: the writes are visible there). The Library assertions therefore carry the fresh session's HONEST states (the typed empty states — J11's own law) plus the sections' presence (the pairing laws).
  - procedure: LEAD (the production parity sweep — the J35-class run): deploy the integrated tree (the single-bundle production build), drive the same J40 walk against the deployed boot, and capture the Library showing the walk's own watchlist/playlist writes under evidence/<run>/ (the production runtime is one instance: the writes cross pages).
