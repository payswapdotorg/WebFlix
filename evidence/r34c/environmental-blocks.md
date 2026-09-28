# R34-C — The Environmental-Block Table

Every block with its rendered/measured evidence and the journeys it touched.

## Block 1 — The shared persistent production identity state (J11)

**The block:** the journey suite's FRESH-STATE LAW operates by deleting the
runner's LOCAL fixture drive-state files (acquisition + source-auth) before
each run — a mechanism that has NO effect on the production deployment's
persistent identity store. The production anonymous identity
(`x-wfx-user-id: wfx-anonymous`) carries DURABLE library state written by
prior production verification lanes and/or this session's own runs.

**The rendered truth (probed live, 2026-09-27):**

```
GET https://webflix-api.vercel.app/experience/library
    (x-wfx-user-id: wfx-anonymous)
→ [{"connectorId":"wfx-experience-service","externalRef":"3uyGhtARP4M",
    "title":"1 HOUR Rainy Day in Airport ✈️ | Cozy Lofi for Relax…",
    "addedAt":"2026-09-27T20:50:50.690Z",
    "metadata":{"list":"Saved", …,
    "canonicalItemId":"wfxitm_01M2KR6R00XDZHNKYJ4GME8PHD"}}]
```

One Saved-list entry. (The R30-web repro record —
evidence/r30-web/repro/prod-r30a-verify.repro.json — documents real
production Subscribe/library writes against this same shared identity on
2026-09-25; the current Saved entry's addedAt falls inside THIS lane's
session window, between the smoke run and chunk-01 — the exact writer is
not client-determinable; candidates are a late-draining queued action event
from a prior production lane or an action from this lane's own smoke
browser session.)

**The journey impact:** J11's first assertion — "the watchlist is honestly
empty on a fresh session (typed empty state, never fabricated saves)" —
observes "entries present" and fails (`run/chunk-03/manifest.json` +
`run/chunk-03/j11-failure.png`). The product itself is CORRECT: it renders
the stored truth exactly as it should; the local fresh-state boot passes
J11 with all 11 assertions (`local-baseline/full/manifest.json`).

**The journeys touched:** J11 (direct); no other journey asserts fresh-empty
library state before its own writes.

**What it needs:** an environmental retry window with a CLEAN anonymous
identity (or a state reset by the operator) — or a catalog-neutral
watchlist assertion in the journey-spec update work item.

## Block 2 — The production semantic-search transport (J39)

**The block:** the production `/api/intelligence` transport answers its
honest typed-unavailable state — the R23-H law ("it stays off honestly
rather than approximated") — so the by-meaning search finds nothing on
production.

**The standing record:** this is the R23 revalidation target already
tracked in docs/work-items/index.md ("R23 requires current-production
revalidation where the live transport disagrees with the prior acceptance
record… Current revalidation target: J39 semantic/moment search"). The R23
production sweep recorded the honest state verbatim (evidence/r23/
production-sweep.md: `GET /api/intelligence?q=…` → 200, "Semantic search is
not served by this transport yet — it stays off honestly rather than
approximated.").

**The journey impact:** J39's meaning-result assertion ("finds the space
documentary by what it IS — Deep Field Diary") observes `<none>`
(`run/chunk-08/manifest.json` + `j39-failure.png`). The local fixtures boot
reaches deep into the journey (the deterministic provider double serves the
meaning search) before failing on the R29-B session-label grammar — the
semantic machinery itself is intact on the tree.

**The journeys touched:** J39 (direct). No other journey consumes the
semantic transport.

**What it needs:** the standing R23 revalidation lane (the live semantic
transport on production) — an operator/deployment matter, not a code
regression.

## Block 3 (recorded for completeness) — The provider bot-gate at the egress (no journey verdict blocked)

The R28-B evidence (evidence/r28-web/verifications) records that the
sandbox's egress renders the provider's own bot-gate inside embed frames on
PRODUCTION-class surfaces. THIS suite's journeys assert the DOM containment
grammar (never provider content), and no J01–J39 verdict in this run was
blocked by provider content — the block table records it because the
hover-preview/player-embed surfaces (R28-B/R33-A) depend on it in richer
verifications. Zero journeys touched in THIS run.

## Non-blocks (verified NOT environmental)

- **Network/egress to production:** clean — every chunk's manifests show
  full page loads; the failures are assertion-observed DOM truths, never
  navigation refusals (the runner would answer a typed BrowserError;
  only J23/J24/J29-local answered element-not-found harness errors, root-caused
  to grammar moves, not network).
- **The R33-C-era `/sources` HTML answer:** NO LONGER REPRODUCES — the
  current deployment answers the typed envelope (`401` without identity
  headers; `{"authenticated":false,"sources":[]}` with them). Recorded as a
  deployment-truth update in guards.md.
