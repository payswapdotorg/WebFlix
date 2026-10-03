# J39 — the semantic/moment search transport's exact production answer (WFX-R23R, 2026-10-03)

## The web host's intelligence route (the journey-consumed transport)

```
GET https://webflix-steel.vercel.app/api/intelligence?q=a%20space%20documentary%20about%20telescopes%20and%20galaxies
{"mode":"service","kind":"semantic-search","view":{"status":"ready","meaning":[],"moments":[],"provenance":[],"meaningSearchAvailable":false}}
→ HTTP 200 · content-type application/json
```

## The backing Experience API wire (the split runtime's other half)

```
GET https://webflix-api.vercel.app/experience/intelligence?q=a%20space%20documentary%20about%20telescopes%20and%20galaxies
{"kind":"served","value":{"meaning":[],"moments":[],"provenance":[],"meaningSearchAvailable":false}}
→ HTTP 200 · content-type application/json
```

## The item-intelligence read (a real catalog item — the per-feature prerequisite truth)

```
GET https://webflix-steel.vercel.app/api/intelligence?item=ZR1HI21eSM0
{"mode":"service","kind":"item-intelligence","view":{"status":"ready","features":{"search-by-meaning":{"available":false,"missing":["transcript-text-embedding","semantic-video-embedding"]},"moment-search":{"available":false,"missing":["transcript-segments"]},"chapter-aware-signals":{"available":false,"missing":["chapters-scenes"]},"visual-similarity":{"available":false,"missing":["semantic-video-embedding"]},"anti-tunnel-exploration":{"available":false,"missing":["semantic-video-embedding","transcript-text-embedding"]},"richer-explanations":{"available":false,"missing":["transcript-segments","chapters-scenes","visual-concepts-entities"]},"cold-start-understanding":{ … (the per-feature prerequisite truth — every feature names its missing derived artifacts) }}}
→ HTTP 200
```

(Observed verbatim 2026-10-03; the full payload is in parity-record.json's intelligence-chain check and the chunk manifests' assertion journals.)

## The moment-query variant

```
GET https://webflix-steel.vercel.app/api/intelligence?q=the%20moment%20the%20first%20deep%20field%20image%20resolves
{"mode":"service","kind":"semantic-search","view":{"status":"ready","meaning":[],"moments":[],"provenance":[],"meaningSearchAvailable":false}}
→ HTTP 200
```

## The rendered surface state (browser-observed, agent-browser)

- `/search?q=<semantic query>` → `[data-wfx-semantic-search][data-wfx-semantic-state="no-matches"]`
- sentence: "Nothing matches “…” by meaning or moment yet — WebFlix does not fabricate semantic results."
- zero `[data-wfx-semantic-meaning-result]` entries; zero `[data-wfx-semantic-moment-jump]` entries

## The registration boundary (R23-J, the same walk's live-route step)

```
POST https://webflix-steel.vercel.app/api/model/open-models  {"providerId":"confucius4-r2t2","action":"register"}
{"error":"unavailable","detail":"Open-model registration is served by the platform's model runtime (the service lane / the Desktop model runtime) — the web transport serves the registry reads only."}
→ HTTP 503
```

## The reading (the revalidation finding)

The deployed Experience API NOW SERVES the intelligence route
(`/experience/intelligence` — the R23-era escalated missing dependency is
landed), and it answers a SERVED wire whose semantic capability is the
honest typed unavailable: `meaningSearchAvailable:false` with empty
meaning/moments/provenance — the R23-H "never approximated" law held
through the product evolution. The web host projects that wire faithfully
(mode=service view); the surfaces render the no-fabrication sentence; the
real catalog items carry no derived artifacts and their per-feature
prerequisite truth names exactly what is missing. The prior acceptance's
fixtures-mode artifacts (the meaning result, the moment jump) remain
fixtures-boot truths, machine-checked unchanged (chunk F: 30 assertions
PASS).
