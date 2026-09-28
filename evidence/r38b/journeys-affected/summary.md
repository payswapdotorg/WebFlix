# R38-B — THE AFFECTED-JOURNEY VERIFICATION (J01–J44 + J48)

**The packet's rule:** "Run the affected existing journeys that your
surfaces touch (J01–J46 affected set — J45/J46 are R37's concurrent
lane: if not present at your base, your affected set is J01–J44; J44 is
R36's, present at base) and prove no regression."

J45/J46 are NOT at this base (the newest encoded journeys are J43/J44)
— the affected set is **J01–J44** (J35 is the lead's never-encoded
sweep; J42 is the lead's extension-parity journey — both absent from
the registry at base and at the lane).

## The verdict table

| Journey | Verdict | Assertions | The run record |
|---|---|---:|---|
| J01–J07 | **PASS ×7** | 19/12/6/13/7/13/12 | logs/j01-j10.log |
| J08–J10 | **PASS ×3** | 9/13/9 | logs/j08-j10.log (the first full-chunk run passed 10/10; the log-capture re-run env-died at J08 — the R25-W2 class — and the J08–J10 follow-up chunk completes the verbatim record with identical assertion counts) |
| J11–J15 | **PASS ×5** | 11/5/5/15/6 | logs/jb.log (the J11–J20 chunk's first half — J11–J15 passed before the box's OOM kill; see §The procedure) |
| J16 | **PASS** | 4 | logs/jb3.log |
| J17, J18 | **PASS ×2** | 8/4 | logs/j17j18.log |
| J19, J20 | **PASS ×2** | 11/19 | logs/j19j20.log |
| J21, J22, J23, J24, J26 (the acquisition chain) | **PASS ×5** | 14/7/15/18/8 | logs/jchain.log (one session — the runner's own order-dependence guard) |
| J25, J27, J28 | **PASS ×3** | 19/6/21 | logs/j25j28.log |
| J29, J30, J31 | **PASS ×3** | 19/15/10 | logs/j29j31.log |
| J32, J33, J34 | **PASS ×3** | 11/64/44 | logs/j32j34.log |
| J36 | **ENV-BLOCKED** (see below) | 40/45+ passing per run | logs/j36solo.log, j36solo2.log, j36-base-worktree.log |
| J37 | **PASS** | 17 | logs/j37.log |
| J38, J39 | **PASS ×2** | 44/29 | logs/j38j39.log |
| J40 | **FAIL — pre-existing, byte-identical to base** | 7 | logs/j40j41.log |
| J41 | **FAIL — pre-existing, byte-identical to base** | 2 | logs/j40j41.log |
| J43 | **FAIL — pre-existing, byte-identical to base** | 2 | logs/j43j44.log |
| J44 | **PASS** | 57 | logs/j43j44.log + the artifact run j44/ (PASS 57, 7 artifacts) |
| **J48 (this lane)** | **PASS** | **71** | ../journeys/final-run/ (the manifest + 9 artifacts) |

**Totals: 39 PASS · 3 pre-existing base fails (byte-identical) · 1
environmental block (base-identical) · 0 NEW FAILURES.**

## The three pre-existing failures (the honest comparison)

The R35b record (docs/validation/webflix-golden-journeys.md — "the
honest remaining gap"): J40, J41, J43 fail at base with the R28-B
stale-grammar class. This lane's sweep reproduces them **byte-identically**
(verified against evidence/r35b/run/manifest.json — the recorded base
failures of record):

- J40: "the item hub renders (the canonical identity surface)" —
  `[data-wfx-surface='item']` absent — identical.
- J41: "Deep Field Diary: the one obvious primary play action renders" —
  `[data-wfx-item-play]` absent — identical.
- J43: the same J41-class failure — identical.

## J36 — the environmental block (proven base-identical)

The kernel OOM-kills the fixtures dev server during the J36 walk (the
heaviest journey — it compiles nearly every route) at ~2.3GB RSS on
this 4.16GB box (kernel log: `Out of memory: Killed process …
next-server … anon-rss:2323020kB`). **The base comparison:** the same
journey at the EXACT base commit (an isolated git worktree at
37effa3) fails the same way (`anon-rss:2311916kB`, the same
connection-refused class; logs/j36-base-worktree.log) — the failure is
environmental and pre-existing, never a product regression of this lane
(the lane's five /studio routes are lazily compiled and J36 never
visits them). The lane's best J36 runs reach 40/45+ PASSING assertions
(register → sources → BYOF preview/confirm → personalize → the item's
capability surfaces → the shorts walk → the BYOM round trip), and the
R35b merge record documents the same ceiling class on the Lead's own
sandbox (evidence/r35b-merge-journeys/merge-verification.md). The
single-run full-battery record for J36 remains the dedicated-worker-
sandbox run of record (evidence/r35b/run/).

## The procedure (honest, never silent)

- The single-run full battery exceeds this box's memory ceiling (the
  first attempt died after 5 journeys — kernel OOM; the evidence is in
  the guards record). The sweep therefore ran as ORDER-PRESERVING
  CHUNKS: J01–J10 · J11–J20 (died env-side after J15 → re-run J16,
  J17–J18, J19–J20) · the acquisition chain J21–J24+J26 in ONE session
  (the runner's own guard refuses to split it) · J25+J27+J28 ·
  J29–J31 · J32–J34 · J36 (solo ×2 + the base-worktree comparison) ·
  J37 · J38–J39 · J40–J41 · J43–J44 · J48.
- The browser pool was cleaned between chunks (stale chrome processes
  from killed runs eat ~600MB — the R25-W2 box-hygiene lesson).
- Every chunk's full runner output is committed verbatim under logs/.
- The runner's default evidence dir (evidence/r16) was restored to its
  base state after the sweep — this lane's evidence lives ONLY under
  evidence/r38b/ (the lane law). The two artifact-carrying runs of
  record: J48 (journeys/final-run/ — the lane's journey) and J44
  (journeys-affected/j44/ — the R36 surface this lane composes with).
