# Logged-in surfaces — the R28 sheet (CORPUS-PENDING)

This sheet is **CORPUS-PENDING** per the lead's ruling — cite `docs/parity-lab/r28/lead-captures/README.md` on `wfx/r28/lead-captures` @ **0755a38** (lead-owned captures from the operator's live logged-in tab). Nothing below is fabricated; every line is either a lead-recorded healthy-window observation, a measured gate signature, or an explicit pending item.

## What happened (binding context)
- The operator logged in at ~22:05Z (2FA completed). The tab was fully logged-in for ~1h (avatar cluster present, "(94) YouTube" title, feed cards rendering) — lead-side capture.
- At ~23:15Z the account-bound surfaces began returning empty — YouTube's risk engine gating the automated/datacenter context. Worker A's sandbox observed the identical gate: injected first-party auth chain (SID/HSID/SSID/APISID/SAPISID/LOGIN_INFO/__Secure-1PSID*) **cleared server-side on first contact**; only the 3P cookie family survived — the session was invalidated, not merely blocked.
- Directive (lead, 2026-09-23): do NOT retry login or fight the gate. Logged-in corpus re-capture waits for a healthy window (operator-initiated human session).

## Healthy-window observations already recorded (lead-captured, [rendered-by-lead])
| Surface | Observation |
| --- | --- |
| Masthead account cluster | avatar button **rightmost** in the masthead; notifications count surfaces in the document title ("(94) YouTube") |
| Rail subscriptions section | flat channel list under a "Subscriptions" section heading (observed: Les Vidéos de Riles · Marques Brownlee · Hasan Minhaj · LastWeekTonight · Jimmy Kimmel Live · Bloomberg Originals · Mastar · Show more); avatars not measured before degradation |
| Subscriptions feed | `/feed/subscriptions` — grid container renders; post-gate rows empty (gate signature) |
| Home (logged-in) | feed cards rendering pre-gate (thin/empty post-gate) |

## Pending items (NOT measured — next healthy window)
- Subscriptions feed row grammar · History page · Watch later · Liked videos · Playlists · notifications bell + panel anatomy · avatar account menu rows + theme picker (Appearance submenu with account default + "Use device theme" option — logged-out variant measured in color-survey.md) · account default theme (operator PREF carried `f6=80`, unverified semantics).

## What B should NOT do
Do not build account-chrome from memory beyond the lead's recorded grammar above; the account surfaces ship behind the honest sign-in chrome (as WebFlix's own account model permits) until the pending capture lands.
