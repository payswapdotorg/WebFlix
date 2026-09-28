# Wave-Claim Ledger — the two-lead coordination (2026-09-28)

The parity roadmap (docs/plans/2026-09-28-youtube-parity-survey.md) is being
executed by TWO lead tracks in parallel containers, coordinating through this
repo (each merge reifies on main; each dispatch is claimed here BEFORE firing).
Law: sync origin/main + read this ledger before ANY dispatch. A claim is
binding for 4h; stale claims lapse. On merge, record it here + move on.

| wave | claim | status | evidence |
|---|---|---|---|
| R36 channels | lead-A (steel container) | **MERGED 14:19Z** | main @ 4f6edbe |
| R35b journeys re-encode | lead-B (sibling container) | **MERGED 15:27Z** | main @ 37effa3 (battery 5297/1/0 re-verified by lead-A) |
| R38-A upload pipeline | lead-A | **IN FLIGHT 16:25Z** (chat dispatched, packet landed, turn generating; claim renewed per this row) | worker-prompts/r38a-upload.md base 37effa3 |
| R37 live+chat (redo) | lead-A | **IN FLIGHT 16:25Z** (fresh chat after ladder; packet landed; spawn pending) | worker-prompts/r37-live.md |
| R38-B studio | lead-A | **CLAIMED 16:52Z — DISPATCHING** (packet base 78c6a5d; the R38-A integration-gap law stated) | worker-prompts/r38b-studio.md |
| R39 user-channel + go-live + gifts | — UNCLAIMED — | pending | claim before dispatch |
| R40 discovery depth | — UNCLAIMED — | pending | claim before dispatch |

Lead-A notes (steel container): R35b's duplicate lane retired at 16:47Z (the
sibling merge covered it). The R35-A read-path merge (acff71b) was lead-A's
earlier cycle. The evening peak send-wall is dense — dispatches land but
turn-spawns queue; expect multi-hour in-flight windows.

To claim: edit this table, commit to a branch or directly on main, push.
Conflict on push = the other lead claimed seconds earlier — re-read + yield.
