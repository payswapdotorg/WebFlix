R34-A — guards

Lane wfx/r34a/accept-j40-j42 · base main @ 09d0205 · the J40 + J42production acceptance evidence lane (evidence + docs only — zero productbytes).

The lane gates
gate	requirement	result
G1 — no product code changes	the lane changes zero product bytes; only evidence/r34a/** + a docs/validation acceptance record	PASS — durable check (re-runnable on the committed lane): git diff --name-only 09d0205..HEAD lists exactly 127 paths — 126 under evidence/r34a/ + docs/validation/r24-production-acceptance-r34a.md, 4402 insertions, zero paths outside the two permitted roots; working tree clean. (The original pre-commit moment — git status --short showing ?? evidence/r34a/ + the docs record with git diff HEAD empty — was the check at composition time; the committed form above is the durable re-run.)
G2 — no-battery-change	nice -n 19 ionice -c3 bun test --parallel=1 answers IDENTICALLY to main's 5256/1/0	PASS — 5256 tests / 1 skip / 0 fail across 300 files (5255 pass; 33627 expect() calls; 228.09 s; bun test v1.3.14). The first attempt's 1313-test run (missing bun install on the fresh clone) is recorded in battery-test-summary.txt — no result taken from it
G3 — the production target	every journey action hits https://webflix-steel.vercel.app exactly	PASS — every step-status file carries the URL (raw/j40-steps/*.status.txt, raw/j42-steps/*.status.txt); no local boot was used for any evidence of record
G4 — the runner's report	the runner's own J40 pass/fail captured verbatim	PASS — j40-runner/manifest.json + summary.md + the failure artifacts (the honest FAIL: the fixture term has no suggestions on the production catalog)
G5 — the parity adjudication	every exercised J40 behavior paired; every J42 placement decision recorded	PASS — PARITY-ADJUDICATION.md (27 pairing rows + 13 placement rows, all citing ParityTaxonomyRowId)
G6 — the findings ledger	every defect/block/divergence recorded with reproduction evidence, honestly classified	PASS — LEDGER.md (15 findings: 2 environmental blocks, 4 defect-candidates, 4 honest divergences, 3 configuration divergences, 2 integrity records)
G7 — the acceptance summary	the R24 clauses adjudicated honestly (closed vs open)	PASS — ACCEPTANCE-SUMMARY.md (J40: 3 PASS + 1 not-covered-Desktop; J42: 6/6 PASS; the comparison half: grammar-composed, playback-blocked-environmental)
G8 — the shorts depth check	the R33 follow-through against the G4 corpus	PASS — SHORTS-DEPTH-CHECK.md (the stage machinery verified live incl. the unmute round trip; the playback-broadcast block recorded environmental)
G9 — the fresh-user law	fresh browser state; the signed-in paths use the repo's fixture persona	PASS — the walks start from a destroyed context; the sign-in uses dev@webflix.local / dev-password-1 (accepted on production — LEDGER C1)
G10 — relay	the evidence + the thin bundle + the sha256 manifest into the workspace storage root	PASS — see RELAY-MANIFEST.txt + the completion report
The frozen laws — compliance
Never fabricate: every observation above is a live capture (screenshot,snapshot, DOM-walk JSON, or the product's own typed API answer). Theenvironmental blocks are recorded as blocks with their own captures +VLM-quoted wall text; no YouTube-side behavior was invented.
The parity adjudication law: every exercised behavior carries itspairing row (taxonomy id + lab classification + evidence); theWebFlix-only encounters carry their contextual-vs-administrationclassification; the defect-candidates are recorded as findings withreproduction evidence — never patched over.
The extension-parity law: every canonical-path capability carries itsplacement decision; the anonymous path was walked fresh and stayedfrictionless; torrent stays first-class (the same Where-to-watch flow);the platform/source limits stay honest (the typed-absence inventory).
Production is the target: every evidence URL ishttps://webflix-steel.vercel.app (the step-status files are the proof).No local boot was used for any evidence of record.
No product code changes: G1 (the working tree carries only thepermitted additions).
Reproduction
bun install                                                    # the fresh clone needs it (LEDGER A4)bun journeys/runner.ts --filter J40 \  --base-url https://webflix-steel.vercel.app \  --evidence-dir evidence/r34a/j40-runner                      # the encoded journey's honest resultbash evidence/r34a/scripts/j40-walk.sh step01 … step11          # the manual production walk (resumable per step)bash evidence/r34a/scripts/j42-walk.sh step01 … step10          # the canonical extension pathbash evidence/r34a/scripts/yt-compare.sh rick|zoo|ed            # the YouTube side (the corpus-capture pattern)bash evidence/r34a/scripts/yt-compare.sh wfx-rick|wfx-zoo|wfx-ed # the WebFlix sidesnice -n 19 ionice -c3 bun test --parallel=1                     # G2 (expect 5256/1/0)

The YouTube-side walks reproduce the environmental walls in a gatedenvironment (the captures + VLM reads are the block's own evidence); in anunblocked environment the same script produces the grammar captures withoutthe walls.
