R34-A — the J42 journey report (the manual production walk, manifest shape)

Journey: J42 — WebFlix extension parity (the lead-owned journey,deliberately NOT runner-encoded: journeys/web/index.ts's registry omits itby design and journeys/report.test.ts asserts ids.has("J42") === false;the runner's --filter J42 refuses the unknown id. This report follows therunner's own evidence shape — the manifest's per-journey record.)

commit: 09d0205 (branch wfx/r34a/accept-j40-j42)
environment: LIVE PRODUCTION — https://webflix-steel.vercel.app(the frozen target; the R33 build, CSS sha256 9be6abf6…)
doc: docs/validation/webflix-golden-journeys.md §J42 (verbatim specin reports/J42-SPEC.md)
browser: agent-browser 0.38.1, session r34a-j40, viewport 1280×800,fresh context at the walk's start (the FRESH-USER law); the signed-insteps use the repo's own fixture persona (dev@webflix.local /dev-password-1, apps/web/src/host/auth-fixtures.ts)
window: 2026-09-28 UTC (the per-step status files carry the URLs)
Status: PASS (all six §J42 acceptance bullets — see ACCEPTANCE-SUMMARY.md §J42)
Assertions (the observed states, per step)
step	assertion	observed	pass
01 identity-anonymous	no login wall on the public path	loginWall:false, 100 cards, 3 sign-in LINKS (offers, not gates)	✓
02 identity-signin	the fixture persona signs in on production	POST /api/auth/login → 200 (user "J36 Journey Walker"); the UI form round trip verified after sign-out → sign-in	✓
03 where-to-watch	the realization chooser renders with per-option truths	state=ready; embed ("Plays inside WebFlix — Public — plays for everyone") + external ("Opens outside WebFlix"); "Plays inside WebFlix when you press play."	✓
04 torrent-first-class	the peer-copy group's placement + the honest absence	the group vocabulary + switch semantics in WhereToWatch.tsx; no registered copy for the walked items → the honest typed absence (never a demotion)	✓
05 BYOF	the entry + the feed modes	[data-wfx-byof-entry] + the BYOF copy on Settings; all four feed modes (foryou/following/byof/hybrid) in Settings → General "Your feed"	✓
06 intent/attention	the Personalize control + the round trip	the control on /watch (surface=watch): the objective input, "Set for this session" (the session-scoped grammar), 4 attention modes, current=Balanced; POST 200 + the route's GET reads both intents back (the page-reflection divergence is LEDGER C2)	✓
07 ai-actions	the tray's five frozen actions + the model truth	transcribe/subtitles/translate/dub/commentary; per-action "Not configured — the WebFlix model (wfx-first-party) runs it."; the Manage link	✓
08 semantic-moment	the by-meaning lane answers natural language	"the part where it rains" → 25 semantic results; the item-level moment features answer the honest typed absence (the missing features named)	✓
09 offline	the honest platform truth	/offline = the WFX-057 state page ("You're offline — … Your watch progress is safe."); the Library's "Offline and verified" section with the verification law + the honest empty state	✓
10 provenance	the provenance truth on the player	"Where this came from — source-media by source-provided at 100% confidence. Models generate these signals; your recommendations and choices stay yours — no model authorizes a playback or acquisition action"	✓
Page errors: none (every step's status file: console 0, page errors 0)
Artifacts
screenshots: screenshots/j42-step01-anonymous.png … j42-step10-provenance.png (+ j42-step02b-signed-in.png, j42-step02c-signin-form-roundtrip.png, j42-step06b-intent-set.png, j42-step06c-intent-persisted.png)
snapshots: snapshots/j42-*.snapshot.txt
per-step status (console/page-errors/network/URL): raw/j42-steps/*.status.txt
the placement decisions: PARITY-ADJUDICATION.md Part 2
the findings: LEDGER.md §C
Byte-identical captures (recorded for any reviewer who diffs the shas)

Two artifact groups share identical sha256 values across filenames — verifiedbenign, recorded here so the observation never reads as a defect:

The settings-surface trio — j42-step02b-signed-in.png,j42-step02c-signin-form-roundtrip.png, j42-step05-byof.png arebyte-identical (sha256 970363098243…, 111,051 bytes each). Cause: allthree capture the SAME settled surface — the signed-in /settings page(step02 signs in ON /settings; 02b captured it signed-in, 02c ended itssign-out → sign-in round trip back on the same settled page, and step05reopened it for the BYOF stations) — and the page renders deterministicallyat the fixed 1280×800 viewport, so identical pixels are the expected truth.VLM verification (2026-09-28, vlm/vlm-j42-step05-frame.json): the frameshows the Settings page, "Signed in as J36 Journey Walker — watching asMain", the "Your feed" section with ALL FOUR feed-mode selectors ("For you,Following, Your imported feed, Blend"), Sources / Model & AI / Generaltabs — i.e. exactly the BYOF + feed-modes evidence step05 claims. Thestep05 snapshot agrees ("Add a feed (bring your own feed)"; "Account menu —signed in as Main"). 02b/02c were ad-hoc in-session captures (no dedicatedstatus/snapshot files — the ten canonical stations carry those).
The item-hub pair — j42-step03-where-to-watch.png andj42-step04-peercopy.png are byte-identical (sha256 4406845246…).Cause: step04 performs NO navigation (the walk script's own structure —it evals the peer-copy probes on the same page step03 opened and capturesagain); two captures of the same unscrolled, settled viewport arenecessarily identical. The distinct step03/step04 snapshot + status filescarry the per-station probe content.
Limitations (never silent skips)
The Desktop cross-check of the same rows is the lead's Desktop walk (thefrozen J42 split) — not runnable in this web sandbox.
The torrent REALIZATION walk (a live peer copy playing) requires aregistered authorized copy + a WebRTC-capable swarm — the J38 limitation'sown local-only procedure; this lane records the placement truth and thehonest absence on production.
The BYOF import round trip (a real provider OAuth dance) is the J33limitation's local-only procedure; this lane records the entry + thefeed-mode surfaces' production truth.
