# R32 — PARTIAL RESULTS (the re-entry ledger)

Lane: `wfx/r32/shorts-rail` (base: `main @ c3640cf` — the R32 G4-corpus
merge). Task: the ONE corpus-pending surface — the shorts action rail per
G4-CORPUS.md (docs/parity-lab/r30/gap-captures/20260926-093102/). §G3
(the home resume bar) NOT built (pending).

## Status: COMPLETE — all gates green; the lane COMMITTED; the remote push BLOCKED by the sandbox's credentials (recorded below)

## What is DONE (the full record)

1. **STEP ZERO** — repo cloned, main @ c3640cf checked out, branch
   `wfx/r32/shorts-rail` created. G4-CORPUS.md read fully + the prior
   corpus docs (GAP-CORPUS.md 20260926-052954, lead-captures/CORPUS.md) +
   the raw evidence (g4-shorts.json / g4-rail-full.json /
   g4-rail-extras.json). The seams surveyed (ShortsFeed.tsx, the
   actionStates machinery, the REAL subscribe seam, the monogram law, the
   sources-model identity, the CSS, the tests, the gates).
2. **THE SURVEY PROBE** — the fixtures-boot truth measured: one source
   ("fake-source" / "Fake Source (TEST FIXTURE — never production)"), 3
   shorts cards (Neon Rain / Midnight Scoop / Rain Check), capabilities []
   on all (the typed-absence truth), the tree's current-card actions =
   [share only], the subscriptions fold empty.
3. **THE RAIL SHIPPED** — ShortsFeed.tsx (the corpus cell anatomy in
   renderElements' action case: the 48×48 button + the 24px icon + the
   count slot — share's captured "Share" text; like/save icon-only [no
   count datum]; the rail column + the 5th-element monogram avatar [no
   link] in the card case; the channel row join above the title; the
   session realization-index [boot + re-rank pages] + the session
   subscribed-record) + ShortsSubscribeRow.tsx (NEW: the identity + the
   78×32-class Subscribe pill through the REAL POST /api/library seam,
   controlled by the feed's session record) + host/shorts.ts (the payload
   extension: sourceNames [the N29 sources read] + subscriptions [the
   dual-law library read]) + globals.css (the G4 rail block — replaces
   the pre-corpus .wfx-shortcard__actions; the channel row; the pill
   class; the mobile 44px offset; the clear-screen rule extension).
4. **TESTS** — 12 new (shorts-rail-parity.test.ts), all green; the eight
   changed-surface suites 95/95 in the scoped re-run; the full battery
   **5200/1/0** (the 5188 floor + exactly 12, zero regressions — run
   twice, identical counts).
5. **PROBE** — r32-rail-probe.ts: 3 SSR captures + probe-facts.json.
6. **BROWSER-LEVEL VERIFICATION** (LIVE): the rail's measured geometry
   (48px column / 48×48 buttons / the Share text form / the 24×24 "F"
   avatar / the 91×32 pill), the subscribe round trip + its durable
   reload + the reverse path, the per-card truth across swipes (card 2
   idle / card 1 subscribed), the share event POST, the clear-screen law
   extended to the rail, the mobile 390px 44px law, zero page errors. The
   rail capture VLM-read (the count-slot law confirmed visually).
7. **GATES** — all green (see guards.md): battery 5200/1/0, lint
   LANE-CLEAN (repo 115 = the base, byte-identical; scoped 0/0),
   typecheck (root + journeys + app: zero diagnostics), contract-check
   OK, lane-check OK (942 files), parity-conformance 19/19, build code 0,
   browser-verify PASS.
8. **EVIDENCE** — evidence/r32/: INDEX.md (the citation table),
   DIVERGENCES.md (13 rows: 10 HD + 1 PEND [§G3] + 2 NOTE),
   browser-verification.md, guards.md, partial-results.md (this file),
   probe-facts.json, captures/ (3 SSR + 5 browser PNGs).

## What REMAINS: the relay only

- The remote push: BLOCKED by the sandbox's missing GitHub credentials
  (the R31 lesson — `git push` fails with "could not read Username",
  expected, do not fight it).
- The relay: evidence/r32/ (every file, same relative paths) into the
  workspace storage root + the thin bundle
  (`git bundle create webflix-r32-thin.bundle c3640cf..wfx/r32/shorts-rail`)
  + RELAY-MANIFEST.txt (the file list with sha256s + the lane SHAs) into
  the workspace root.

## The exact next step (if re-entered mid-relay)

1. Verify the lane head: `git -C /home/z/webflix log --oneline -1
   wfx/r32/shorts-rail` (the committed lane).
2. Relay `evidence/r32/` → the workspace storage root (same relative
   paths), the bundle + RELAY-MANIFEST.txt → the workspace root.
3. Post the completion report (the lane SHA, the gates table, the
   citation coverage, the escalation list [none], the divergence ledger).
