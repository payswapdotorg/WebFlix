# R37 — THE RUN MANIFESTS (the lane's owned-surface inventory + the affected-journey comparison of record)

## 1. The owned-surface inventory (`git diff 37effa3 --stat` at the code head)

The diff target is the FIXED BASE SHA `37effa325c5060e14afda7e07db5b7eb61e45d9e`
(the task §1 base). The upstream `main` ref moved past the base during the
run (the wave-claim ledger commits 78c6a5d + 2ae1c13 — coordination docs
only, zero product code); this lane incorporates NOTHING from them (the
no-pull law), so the base SHA is the diff target of record.

Modified (7 files — every one an owned extension):
- `apps/web/src/app/watch/page.tsx` (+53/−3) — the param-gated LIVE MODE
  branch; the default browse branch unchanged (byte-compatible; J03
  PASS 6 assertions at the lane).
- `apps/web/src/host/byof/byof-fixtures.ts` (+220) — the appended,
  clearly delimited R37 section (the live fixture entries + the
  archived VOD's committed chat log + the pure readers); nothing above
  the delimiter touched.
- `apps/web/src/instrumentation.ts` (+14) — the appended livechat-boot
  call (its own dynamic import + try/catch); the realtime bridge
  startup untouched.
- `docs/validation/webflix-golden-journeys.md` (+39) — ONE dated
  additive section (J45/J46).
- `journeys/report.test.ts` (+6/−1) — the catalog guard's additive
  J45/J46 registration (the R36 lane's own precedent: its merge diff
  touched exactly report.test.ts + web/index.ts + the new journey file
  for the same registration).
- `journeys/web/index.ts` (+13) — the two imports + the two array
  entries (additive only).
- `packages/connectors/src/index.ts` (+5) — the one export line (the
  WFX-054 barrel-growth precedent).

New (the lane's own trees):
- `apps/web/src/app/live/**` (page.tsx + loading.tsx — the /live route).
- `apps/web/src/components/live/**` (live-views.ts + LiveBrowseSurface +
  LiveBadge + LiveChat + live.css + live-views.test.ts).
- `apps/web/src/components/watch/LiveWatchSurface.tsx` + `ChatReplay.tsx`.
- `apps/web/src/host/livechat/**` (livechat-wire + livechat-dev-double +
  livechat-bridge + livechat-bridge-state + livechat-boot + the two
  colocated test files).
- `packages/connectors/src/live/**` (live-designation.ts + live-chat-log.ts
  + index.ts) + `packages/connectors/tests/live-designation.test.ts` +
  `live-chat-log.test.ts`.
- `journeys/web/j45-live-watch-chat.ts` + `j46-chat-replay-scrub.ts`.
- `evidence/r37/**` (this tree).

NOT touched (read-only honored): `host/realtime/**`, `app/channel/**`,
`components/channel/**`, `components/player/**` (including ChannelRow),
`components/search/**`, `components/cards/**`, `packages/domain/**`,
`packages/experience/**`, `apps/api/**`, every other package,
`journeys/lib/**`, `journeys/runner.ts`, `scripts/**`, the root
package.json + bun.lock (zero new dependencies — the bridge uses `ws`
8.21.3 + node:http, both already in the tree).

## 2. The affected-journey verdict table (the comparison of record)

| Journey | Lane verdict | Base verdict (isolated worktree @ 37effa3) | Notes |
|---|---|---|---|
| J01 First launch | **PASS 19** | — (passes at base by record; passes at lane) | boot 1 |
| J02 Home discovery | **PASS 12** | — | boot 1 |
| J03 Watch browsing | **PASS 6** | — | THE byte-compatibility proof for the default /watch branch |
| J04 Shorts | **PASS 13** | — | boot 1 |
| J05 Search | **PASS 7** | — | boot 1 |
| J06 Item detail | **PASS 13** | — | boot 1 |
| J11 Library | **PASS 11** | — | boot 1 |
| J37 Anonymous | **PASS 17** | — | boot 1 |
| J40 Viewer parity | FAIL 7 (solo) | **FAIL 7 — byte-identical failure reason** | the R35b-documented pre-existing stale-grammar failure of record ("the item hub renders … [data-wfx-surface='item'] absent") |
| J43 Realtime translation | FAIL 2 (solo) | **FAIL 2 — byte-identical failure reason** | the R35b-documented pre-existing failure ("the one obvious primary play action … [data-wfx-item-play] absent") |
| J44 Creator channels | **PASS 57** (solo) | (R36's own merge record: PASS 57 at this main head) | THE R36 composability proof — the channel page + the /live rail's channel slots coexist |
| J45 Live watch + chat | **PASS 30** | (new — fails on main by construction: the journey file does not exist there) | evidence/r37/journeys-j45 + the fresh final-head run in evidence/r37/journeys |
| J46 Chat replay scrub | **PASS 21** | (new — same) | evidence/r37/journeys-j46 + the fresh final-head run |

The base manifests of record: `base-comparison/j40-base-manifest.json`,
`j43-base-manifest.json` (+ summaries); the lane solo manifests beside
them. Boot 1's J43/J44 failures were the documented kernel OOM ceiling
(`base-comparison/affected-set-boot1-summary.md` — the R35b-merge
verification's own class; connection-refused against the OOM-killed
server), proven environmental by the solo re-runs above.

## 3. The lane's browser-verification record (the pre-gate self-check)

Before the journeys were encoded, the surfaces were verified live in the
agent-browser session (the DOM grammar asserts):

- `/live`: 2 LIVE badges, viewer 1247 declared + the typed absence on
  the count-less stream, 1 was-live badge, the loud disclosure, the
  bridge truth, the watch hrefs.
- The live watch mode: state live, the unbound stage, the no-scrub
  truth, the channel row, the fixture embed src.
- The chat: 9→15 scripted messages with the 3 badge kinds + emojis, the
  pin event at its scripted offset, the viewer report (1250→1262 with
  provenance), the you-echo, the slow-mode refusal on a back-to-back
  send (`data-wfx-livechat-refusal="slow-mode"`), the emoji insert.
- The archived mode: the was-live badge, 13:00, the replay truth, the
  facts line, the scrub-following window (0:20 → the 1s/5s/11s/18s
  entries; 1:40 → the 74s/88s entries), the pin from 44s, the play clock
  advancing.
- The default `/watch` (no params): the browse renders, no livewatch
  element.

## 4. The deterministic transcript of record

`honesty.md` §5 carries the dev double's committed chat script + the
archived VOD's committed log verbatim (the task's honesty proof ask).
