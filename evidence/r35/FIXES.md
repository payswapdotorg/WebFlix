# R35 — the four fixes (the ledger row → the root cause → the change → the test)

Base main @ 2ccb536 · lane `wfx/r35/readpath`. Every fix cites its
R34-A ledger row verbatim, names the root cause, the exact change, and
its regression test (FAILS on main / PASSES on the lane — see
REGRESSION-PROOF.md for the runner's own output in both directions).

---

## B2 — the item hub's watchlist truth reads the un-hydrated per-instance fold

**The ledger row** (evidence/r34a/LEDGER.md, B2): "after a successful
save (the control answers 'Saved to your Watchlist.'; the Library page
lists the row), the item hub on RELOAD still offers 'Save to Watchlist'
(`data-wfx-watchlist-saved="false"`). The Library page's read (the
service store) sees the write; the item page's read does not. On the
single-instance dev boot this cannot reproduce (the R30
reload-durability law's context)" — defect-candidate (service-mode read
path: hydrate-or-read-the-store before the item page's watchlistSaved
fold).

**The root cause**: `loadDetailView` (apps/web/src/host/view-models.ts)
folded the watchlist membership from
`host.runtime.libraryOps.entries().some((entry) => entry.itemId === itemId)`
— the PER-INSTANCE runtime fold. On the service-mode boot every page
render is a cold runtime whose fold is empty, while the STORED profile
library (the write's real destination, read by the Library page's read
model through `readProfileLibrary`) carries the save. The same class the
R30 law closed for the watch page's Subscribe pill — the item hub was
never lifted onto it.

**The change** (apps/web/src/host/view-models.ts):
- `readStoredLibrary(host)` — the shared stored-library read (one seam,
  every read path; `null` = the honest degradation, the caller's local
  fold answers — never a fake empty, never a fabricated row).
- `storedWatchlistSavedOf(host, { connectorId, externalRef, itemId })` —
  the item's watchlist membership from the STORED rows, joined by the
  item's SOURCE identity (`connectorId` + `externalRef` — the durable
  key the stored rows carry, never the per-process canonical mint, which
  cannot cross a fresh load's runtime). The stored read WINS when it
  answers; the local fold answers only when it fails.
- `loadDetailView`'s `watchlistSaved` wired to it (the R30 law's
  comment trail extended: one law, every read path).

**The test**: `apps/web/tests/r35-b2-item-watchlist-reload.test.ts` —
save → `simulateFreshProcess()` (the R30 harness: the runtime's boot
promise + item join reset; the persona's file-backed service-side
library SURVIVES) → `loadDetailView` on the fresh host →
`watchlistSaved === true` (main answers `false` — the defect verbatim);
the Library agrees on both boots; the honest negative (an item with NO
stored truth stays `false` — never fabricated); the fresh-instance
remove keeps working; the same-instance round trip unchanged.

---

## B3 — the Library read cannot resolve the item's source realization in its own instance

**The ledger row** (B3): "the playlist write lands and is visible
('Parity Walk' in the Library's Playlists section) but the section
answers '1 unavailable video is hidden' — the Library read cannot
resolve the item's source realization in its own instance. The write's
own control answered honestly; the read-side resolution is the gap" —
defect-candidate (same read-path class as B2).

**The root cause**: `loadLibraryView` joins each stored row through the
process's item-join map — a map taught only by searches THIS process
ran. The service-mode Library render is itself a cold runtime that never
ran the write's searches, so a row the source still serves rendered
`joined: null` and hid behind the §9 counted notice ("N unavailable
videos are hidden") while the source's catalog still carries it. (The
write itself is honest and durable — the read side was the gap.)

**The change** (apps/web/src/host/view-models.ts):
- `resolveStoredRealizations(host)` — when any watchlist/history entry
  renders unresolved, the STORED rows resolve through the runtime's OWN
  search seam (the same bridge law `/api/library`'s id resolution
  follows): each row's title searches, the hit is matched by the row's
  durable source key (`connectorId` + `externalRef`), and the join map
  learns it (the registry's idempotent source-key law makes the search's
  canonical id the SAME id the read model's registration produced, so
  the join lands under the entry's own key). The entries re-join.
- A row the source no longer serves (the search finds no matching source
  key) stays honestly unjoined — the §9 notice keeps its truth; never a
  fabricated link. A row without a usable identity never resolves.
- `loadPlayerViewShell`'s subscribe read refactored onto the shared
  `readStoredLibrary` seam (the R30 law's own read — one law, every
  read path; no behavior change, the seam extraction only).

**The test**: `apps/web/tests/r35-b3-library-playlist-resolution.test.ts`
— save-to-playlist ("Parity Walk") → `simulateFreshProcess()` →
`loadLibraryView` with NO search run first (the fresh join map stays
empty — the service-mode truth) → the playlist row renders JOINED with
its title (main answers `joined: null` — the §9 hide verbatim); the
write stays visible on every boot; the fresh-instance remove works; the
store left clean.

**The companion law update** (apps/web/tests/playlist-family.test.ts,
R30-B §9): the pre-R35 §9 test seeded its "unavailable" rows by saving
REAL fixture items without a prior view load — exactly the B3 defect's
premise (rows the source still serves, hiding). Under R35 the §9 law's
honest subject is the row whose source NO LONGER serves it: the test now
seeds retired rows (`fake:video-retired-1/2` — externalRefs the fixture
catalog does not carry) through the persona's own typed write seam
(`addFixtureLibraryEntry`), and the §9 notice still fires for them
(never a fabricated link). The premise change is documented in the test
itself with the pointer to the B3 regression pin.

---

## C2 — the watch page's SSR discovery bundle renders no intent mark

**The ledger row** (C2): "POST /api/personalize {kind:'intent'} answers
200 and the route's own GET reads both intents back, but the watch
page's SSR discovery bundle renders no intent mark (the per-instance
read — the same serverless class as B2)" — defect-candidate
(service-mode read path). Cited evidence: j42-step06 probes (POST 200,
GET read-back true, markInDom:false).

**The root cause**: the POST's write landed on ONE instance's runtime
fold; the watch page's SSR read (`loadDiscoveryBundle` →
`loadPersonalizeView`) consulted only ITS OWN instance's fold — empty on
the cold render — and never hydrated the durable intent store. The
deeper constraint: the IntentStore law keeps `session`-scoped intents
OUT of the server's durable records (they are cleared at `endSession`
by law — persisting them would corrupt that truth), so the durable-store
hydration alone (the B2 medicine) cannot carry a SESSION intent across
instances. The session-scoped truth needed a carrier the web adapter
owns.

**The change**:
- `apps/web/src/host/session-intent-cookie.ts` (NEW) — the
  `wfx_session_intent` cookie: httpOnly, same-site=lax, path=/, a
  SESSION cookie (no Max-Age/Expires — it dies with the browser session,
  exactly the intent's own scope). It carries the viewer's active
  session-scoped recommendation objectives and NOTHING else (no ids, no
  weights, no durable scopes — those live in the service's intent store
  by the IntentStore law and never ride a cookie; identity never rides
  it — the frozen transport law). Bounded (≤8 objectives, ≤120 chars
  each), deduped, order-stable, structurally guarded on read (anything
  else reads as the honest empty set — never trusted blindly, never
  fatal).
- `apps/web/src/host/request-session-intents.ts` (NEW) — the pages'
  request-scoped read (next/headers → the guarded objectives; outside a
  request scope the honest empty set answers).
- `apps/web/src/host/discoverability.ts` — `loadPersonalizeView` now
  (1) HYDRATES the durable intent store first (the R05
  `intents.hydrate()` seam — the same law the library fold's R30
  hydration follows; a failing hydrate keeps the local view, the honest
  degradation), and (2) merges the request-carried session objectives
  (LOCAL entries win per objective — the same merge law the
  IntentStore's own hydrate follows; nothing fabricated — the mark
  renders only when an objective actually rides the request or the
  runtime's own fold). `loadDiscoveryBundle` takes
  `requestCarriedIntents` and passes them through.
- `apps/web/src/app/api/personalize/route.ts` — the intent write sets
  the carrier cookie to the merged active session set (this write +
  whatever the request carried — the service-mode split means an earlier
  write may have landed on another instance); `clear-intent` empties it
  with the runtime's own `endSession()` (one truth, both stores); every
  answer (GET/POST, all kinds) composes the request-carried objectives.
- The page wiring: `(home)/page.tsx`, `settings/page.tsx`,
  `shorts/page.tsx`, `watch/page.tsx` read the request-carried intents
  and pass them to their discovery/personalize reads (the watch page's
  SSR bundle is the ledger row's own surface).

**The test**: `apps/web/tests/r35-c2-session-intent-reflection.test.ts`
— POST intent (200; the same-instance view carries it — works on main
too) → `simulateFreshProcess()` → `loadDiscoveryBundle(freshHost, {
requestCarriedIntents: [objective] })` carries the objective in its
personalize view (the SSR mark's truth; main ignores the second argument
— the fresh bundle answers empty, the defect verbatim); the POST's
response sets `wfx_session_intent` carrying the objective; the fresh
GET reads the carried truth back; the honest negatives (no carrier → no
mark; a tampered cookie payload → the honest empty set); clear-intent
empties the carrier with the fold and the cleared state survives the
reload. The test DELIBERATELY imports nothing lane-new (the cookie
payload is parsed inline) so it fails ON MAIN at the defect assertion
rather than at an import error.

---

## B4 — the anonymous feedback failure renders the raw typed error verbatim, no recovery path

**The ledger row** (B4): "the anonymous recommendation-feedback submit
renders the service's raw typed error verbatim in the failure element:
`{"error":"invalid-request","detail":"x-wfx-user-id: required identity
header is absent (identity travels as headers, never in URLs)"}`.
Honest (never fake success — the honesty law holds) but
engineering-grade copy on a viewer-facing surface, and no user-facing
recovery path (the sign-in upgrade) is offered" — defect-candidate
(copy/recovery grade). Cited evidence: j40-step10b probe + the step10
screenshot; the network log (POST /api/feedback → 400).

**The root cause**: two layers.
1. The route (`apps/web/src/app/api/feedback/route.ts`) passed the
   service's whole failure body through VERBATIM:
   `{ error: await response.text() }` — the raw JSON string landed in
   the field the client renders.
2. The client (`FeedbackControls.tsx`) rendered `errorBody?.error`
   verbatim in `data-wfx-feedback-failure` — the viewer saw the
   service's own typed-error JSON on the page. And the recovery path
   (the sign-in upgrade that WOULD make the feedback recordable) existed
   nowhere on the surface.

**The change**:
- `apps/web/src/host/feedback-viewer-copy.ts` (NEW) — the one copy law,
  both sides of the transport: the closed `identity-required` code (the
  identity-absent class — the service's own honest 400 for the anonymous
  submit), the viewer copy ("This feedback wasn't recorded — WebFlix
  saves recommendation feedback with a session. Sign in to record it and
  shape what you see next."), the sign-in recovery href
  (`/settings?section=general` — the same entry the player's
  progress-scope row offers), the route-side map
  (`viewerFailureOfServiceDetail`: the identity class → the code; every
  other body → the caller's honest viewer prose, NEVER the raw body; the
  typed detail extracted honestly — `{error,detail}`/`{ok,detail}`
  shapes unwrapped, non-JSON rides verbatim), and the client-side map
  (`viewerFailureCopyOf`: the code → copy + sign-in offer; a raw-JSON
  body → the honest generic prose — never raw JSON on the surface).
- The route's THREE failure branches (GET/POST/DELETE `!response.ok`)
  map through it. The status stays the service's own typed status (a
  failure answers a failure — never a fake success); the typed detail
  rides the response's `detail` field (the network tab keeps the
  engineer's evidence — the ledger's own quote, verbatim).
- The client: the failure state carries `{ error, detail? }`;
  `FeedbackFailure` (exported — the same element the controls render,
  never a second code path) renders the copy + the sign-in link
  (`data-wfx-feedback-signin` + `data-wfx-feedback-identity-required`);
  the typed detail goes to `console.warn` (never `error` — the journey
  console gates watch errors, and a typed refusal is warn-grade truth;
  the `UpdatePrompt` precedent's eslint form). NEVER a fabricated
  success: the element stays `role="alert"`, the recorded-set truth
  stays the route's alone.

**The test**: `apps/web/tests/r35-b4-feedback-viewer-copy.test.ts` —
the service stub answers EXACTLY the ledger's verbatim 400 body through
the REAL route handler (service-mode boot under the controlled env +
`withFetchStub`): the response stays the honest 400, `error` is the
closed code (main answers the RAW JSON string — the defect verbatim),
the typed detail rides `detail`; a non-identity 502 answers the honest
prose (main answers the raw `{"ok":false,…}` body); the failure element
renders the viewer copy + the sign-in recovery path with the raw typed
error NOWHERE in the markup; a raw-JSON body renders the honest generic
prose (the sanitize law). The route-side blocks import only
main-existing modules (they fail on main at the defect assertion); the
client-side blocks dynamically import the lane-new `FeedbackFailure`
export (on main they error with element-type-invalid — the law did not
exist — recorded honestly in REGRESSION-PROOF.md).

---

## The shared-root note (the escalation clause)

No shared package was touched: all four fixes live in `apps/web`
(the web adapter's read paths + its own feedback surface) — the allowed
paths. The API service's typed identity error is CORRECT behavior (the
ledger's own adjudication: "honest … the honesty law holds") and is kept
untouched — B4's fix is the web adapter's presentation law, never a
service change. No escalations.
