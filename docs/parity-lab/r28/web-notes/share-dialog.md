# R28 corpus sheet — SHARE DIALOG (documented anatomy; live modal bot-gated headless → CORPUS-PENDING)

The live share modal could not be opened from this sandbox (the watch action row's
metadata is bot-gated headless; the modal itself is [documented] from the corpus's
captured anatomy + the operator's binding description in the escalation).

## The anatomy (the operator's binding description + corpus)

```
<dialog> "Share"                                          title, 20px/700
┌──────────────────────────────────────────────────────┐
│  [ link icon ]  https://…/watch?v=…        [ Copy ]  │  link field + Copy pill
│                                                      │
│  (X) (WhatsApp) (Facebook) (Reddit) (Email) (…)      │  the target row (circles)
│                                                      │
│  ☐ Start at  [ 0:00 ]                                │  timestamp checkbox + field
│                                                      │
│  [ Copy link ]                        [ Embed ]      │  the bottom row
└──────────────────────────────────────────────────────┘
```

- The link field reflects the "Start at" checkbox: checked ⇒ the URL carries the
  timestamp parameter.
- Copy writes to the clipboard and confirms.
- The target row's icons are REAL share intents (they open the platform's own share
  flow with the link prefilled).
- Embed opens the embed-code view (a copyable iframe snippet).
- Dismiss: X / Esc / backdrop click.

## The WebFlix implementation decision

- The under-player action row's Share control opens the modal with the REAL canonical
  link (the app's own /player URL), a REAL clipboard copy, a REAL "Start at"
  timestamp parameter (`&resume=<ms>` — the player already honors it), REAL share
  intents (X / WhatsApp / Facebook / Reddit / Email / device share via navigator.share
  when present), and an Embed view whose snippet points at the app's own /player route
  (an honest, working embed target).
- "Copy WebFlix link" (the current details-popover vocabulary) becomes the modal's
  Copy action; the popover itself is replaced by the modal everywhere it appeared
  (cards keep a quiet Share action that opens the same modal).
