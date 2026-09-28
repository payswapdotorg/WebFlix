# R37 — THE HONEST-TRANSPORT PROOF (every live number, message, and badge — its REAL backing)

The honest-transport law (R28, binding) governs every social number on
the R37 live surfaces: a viewer count, a chat message, or a badge renders
ONLY what its transport really carries; the typed-absence state renders
otherwise. This document names the REAL backing for every rendered
datum, per surface, and records the dev double's deterministic transcript
verbatim (the task's proof ask).

## 1. The viewer count — per surface

| Surface | The rendered datum | Its REAL backing | The typed-absence state |
|---|---|---|---|
| The `/live` rail (live card 1 — `fake:live-1`) | "1,247 watching" | The fixture entry's source-declared `liveViewerCount: 1247` metadata (byof-fixtures.ts's R37 section) — the dev double's committed figure, the same vocabulary a live-reporting connector projects. The badge carries `data-wfx-live-viewers="1247"` + `data-wfx-live-viewers-state="declared"` + the provenance title "the source's reported concurrent viewers". | — |
| The `/live` rail (live card 2 — `fake:live-2`) | "Viewer count not reported" | **Nothing is declared** — the entry carries no `liveViewerCount` key. The slot renders `data-wfx-live-viewers-state="absent"` + the note "This source reports no viewer count — WebFlix never fabricates one." | THE PROOF ENTRY: a second live stream whose count is the typed absence, never a fabricated number. |
| The watch live mode (header) | "1,247 watching" | The view's `viewerCount` slot — the SAME source-declared figure (one derivation, `viewerCountViewOf`). | The absence renders identically when the entry declares none. |
| The live chat panel (head) | The count with the provenance title | The TRANSPORT's carried figure: the `chat-joined` ack's `viewerCount` (the double's reported figure at join — 1247) and each `viewer-count` event's figure thereafter (the double's scripted report stepping +3 every 15s of session time). Every event carries the provenance sentence "the dev chat double's scripted reported figure (a fixtures-mode model, never a live measurement)". | `data-wfx-livechat-viewers="absent"` when the transport carries none. |

**Never fabricated:** no surface computes, estimates, or invents a
viewer figure. The only numbers that render are (a) the source-declared
metadata figure and (b) the transport-carried event figure — both the
dev double's committed numbers, both provenance-labeled.

## 2. The chat messages — per surface

| Surface | The rendered messages | Their REAL backing |
|---|---|---|
| The live chat panel | The relayed entries (author + badges + body) | The TRANSPORT's `chat-message` events — the bridge relays the dev double's committed script on the session's deterministic timeline. Nothing renders that the bridge did not send: the client state holds ONLY transport-delivered entries (LiveChat.tsx's state machine appends on `chat-message` events alone). |
| The viewer's own message | The `you`-marked entry | The TRANSPORT's relay of the viewer's own accepted `send` op (the bridge mints `author: "you"`, `you: true` — the honest self-identity; the client never locally echoes). |
| The chat replay (archived VOD) | The window's entries | The COMMITTED LOG artifact (the fixture entry's `chatLog`, validated at the boundary through `parseLiveChatLog`) — never a stream: an ended broadcast has no current chat, and the bridge answers a join on an archived item with the typed `not-live` refusal naming the replay as the honest alternative. |

## 3. The badges, the pin, and slow mode

- **Member badges**: rendered only from the entry's `authorBadges` — the
  source-declared closed vocabulary (`member | moderator |
  verified-creator`, validated by the connector-layer parser; a
  malformed badge fails the whole log's parse — never a partial render).
  The committed scripts exercise all three; an author with no declared
  badges renders none (the honest absence).
- **The pinned message**: the live panel renders a pin ONLY on the
  transport's `chat-pinned` event (the double's scripted pin at the 13s
  offset); the replay renders the pin ONLY from the committed log's
  `pinnedOffsetMs` (from its own offset onward — `liveChatPinnedAt`).
  No surface pins a message the data does not name.
- **Slow mode**: the declared interval rides the transport's
  `chat-joined` ack (5s — the double's session fact); the ENFORCEMENT is
  a real transport behavior (the bridge's typed `slow-mode` refusal
  carrying the remaining `waitMs`, proven by the bridge test); the
  archived fact renders in the past tense on the replay ("Slow mode
  (5s) was on during this stream") — a recorded session fact, never a
  live rule on an ended broadcast.
- **Emojis**: the bodies carry the emoji grammar verbatim from the
  committed data; the composer's emoji row is a real insert control (a
  click appends to the draft — browser-verified).

## 4. The typed-absence states encoded (the task's report ask)

1. **The viewer-count absence** (the /live rail's second stream —
   `data-wfx-live-viewers-state="absent"` + the never-fabricate note).
2. **The bridge-unavailable state** (the live chat panel renders
   `data-wfx-livechat-state="unavailable"` with the honest sentence when
   the boot runs without the bridge — never a spinner, never a fake
   chat; the boot's env gate decides, `livechat-boot.ts`).
3. **The service-mode live absence** (the /live rail in service mode:
   the honest "No connected source declares live items through this
   boot's transport" state — a fixture is never silently presented as
   production capability, invariant 10).
4. **The archived-chat-log absence** (a malformed/missing committed log
   answers `chatLogState` — "the replay renders nothing rather than a
   partial log").
5. **The not-live item state** (the watch page's honest typed state with
   the one-click player link — the no-dead-end law).
6. **The not-found state** (an unknown ref: "WebFlix does not fabricate
   watch pages" — the /item law).
7. **The no-scrub live edge** (the live watch mode renders NO seek
   control and states why — "seeking is unavailable on a live stream";
   the honest absence of a control, never a dead one).
8. **The unbound live stage** (`data-wfx-live-stage="unbound"` — the
   contained fixture embed never resolves; the stage discloses the
   unbound truth exactly as the shorts stage does for a provider that
   never answers).

## 5. The dev double's deterministic transcript of record

**The live broadcast's current-chat script** (host/livechat/
livechat-dev-double.ts `DEV_LIVECHAT_SCRIPT` — the committed transcript,
13 entries on the deterministic timeline):

| at | author | badges | body |
|---:|---|---|---|
| 800ms | mod_ana | moderator | Welcome to Signal Bloom live! The stream starts now 🌸 |
| 2.2s | bloomWatcher | member | member badge and proud — third bloom stream in a row 🎉 |
| 4.1s | quietSky | — | the intro synth is so good tonight |
| 6.0s | SignalBloom | verified-creator | We are LIVE from the bloom lab — tonight is the deep-sky sequence ✨ |
| 8.4s | lensLass | — | 🔥🔥🔥 |
| 10.5s | polaris_jim | member | the member stream notifications are worth it alone ⭐ |
| 13.0s | mod_ana | moderator (PINNED) | 📌 Rules: be kind, no spoilers, slow mode (5s) is on. Enjoy the bloom! |
| 15.6s | nightowl_4 | member | chat is moving fast tonight 🌙 |
| 18.2s | SignalBloom | verified-creator | Shout-out to the members in chat — the member badge looks great on you 💚 |
| 21.0s | selenite | member | 😄😄😄 |
| 23.5s | quietSky | — | asking for a friend: will the VOD keep this chat? |
| 26.0s | mod_ana | moderator | Yes — the VOD keeps the chat as a replay, timed to the moment you are watching 📼 |
| 29.0s | bloomWatcher | member | best feature on the platform, honestly |

Session facts: slow mode 5s; the reported viewer figure at join **1247**
stepping +3 per 15s report (the double's scripted report — every figure
carries the provenance sentence).

**The archived VOD's committed chat log** (byof-fixtures.ts
`ARCHIVED_VOD_CHAT_LOG` — the replay's data of record, 15 entries over
the 13-minute timeline, `slowModeMs: 5000`, `pinnedOffsetMs: 44000`):

| offset | author | badges | body |
|---:|---|---|---|
| 1s | AuroraNights | verified-creator | Welcome to the aurora watch — we go live to the ridge in a minute 🌌 |
| 5s | selenite | member | member here since the first broadcast ✨ |
| 11s | quietSky | — | the sky map overlay is such a nice touch |
| 18s | mod_ana | moderator | Reminder: keep it kind — slow mode (5s) is on for the night 💚 |
| 26s | lensLass | — | is the 300mm the one you used last week? |
| 33s | AuroraNights | verified-creator | yes! the 300mm f/4 — the ridge shot needs the reach |
| 41s | nightowl_4 | member | first aurora stream, this is magical 🌠 |
| 44s | mod_ana | moderator (THE PIN) | 📌 Pinned: tonight's shot list is in the description — timestamps included! |
| 52s | me | — (you) | the chat replay of this moment is going to be great |
| 63s | polaris_jim | member | KP index is climbing 🤞 |
| 74s | quietSky | — | green arc starting on the horizon!! |
| 88s | selenite | member | corona is peaking, unreal 😭 |
| 101s | AuroraNights | verified-creator | the ridge is LIT — stay with me for the timelapse 🎥 |
| 116s | nightowl_4 | member | best stream I have ever watched 🌙 |
| 129s | mod_ana | moderator | that's a wrap on the live — the VOD + this chat stay right here. Goodnight! 🌃 |

## 6. What the transport never does

- No credential reaches the browser (the bridge URL is WebFlix's own —
  J45 asserts the observation record's `bridgeUrl` starts
  `ws://localhost:3104`).
- No chat retention (the bridge persists nothing — the replay's data of
  record is the COMMITTED connector-layer log artifact, not a capture of
  the live stream).
- No fabricated replay (the bridge refuses a join on an archived item
  with the typed `not-live` refusal naming the committed log).
- No viewer count, message, or badge renders outside the derivations
  above (the surfaces derive through `liveDesignationOf` /
  `parseLiveChatLog` / the transport's own events — never guessing).
