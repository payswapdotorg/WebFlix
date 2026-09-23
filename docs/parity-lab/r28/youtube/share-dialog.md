# Share dialog — the R28 sheet (the operator's complaint #4: "sharing doesn't work the same")

Captured 2026-09-23T23:5xZ from live youtube.com by Worker A (1440×900, logged-out, light theme). Path measured: **card 3-dot menu ("More actions") → "Share"** on a channel-grid video — the unified share panel; the watch-page action-row Share button (same panel family) did not hydrate in the gated session (see watch-page-anatomy). Provenance: **[rendered]**. Raw: share-sheet probes, captures `46-share-sheet-open.light.png`, `47-share-startat-copied.light.png`.

## The dialog [rendered]
- Container: `tp-yt-paper-dialog` hosting **`ytd-unified-share-panel-renderer`** — box **470×337**, centered.
- Surface: bg **`#ffffff`**, radius **12px**, elevation shadow **`rgba(0,0,0,0.15) 0px 0px 24px 12px`** — the same dialog grammar as the search Filters panel (r12 + identical shadow).
- Header: `yt-share-panel-header-renderer` "Share" (422×22) + **Cancel (X) 24×24** top-right.

## The social-target row [rendered]
- Vertical icon+label **BUTTON tiles, each 70×93**, in a horizontally scrollable row with **Previous/Next arrow buttons** (Next 40×40) that appear on overflow.
- Order measured left→right: **Embed, Messages, WhatsApp, Facebook, X, Email, Reddit, Pinterest, LinkedIn** (VLM visual check concurs: "Embed, Messages, WhatsApp, Facebook, X + right arrow").
- **Embed is the FIRST tile in the row** — not a bottom-row action as in older builds.

## The link field + Copy [rendered]
- Link `input`: **`https://youtu.be/<id>?si=<share-tracking-token>`** — the **youtu.be short form with `?si=` param** (measured value on a real video: `https://youtu.be/O_97HkFMhFk?si=WjUGOKmDUyJMFDmX`). Input text **14px / 400, `#0f0f0f`**, height 16 (inside a bordered field container).
- **Copy button**: pill **64×40**, radius **20px**, text "Copy" **14px / 500 `#0f0f0f`**, transparent bg (adjacent to the link field's right edge).
- **Copy behavior (measured by clicking it)**: link is copied and a **toast renders: "Link copied to clipboard"** (`yt-snackbar` family).

## Start-at [rendered]
- Checkbox row **"Start at"** with timestamp — visual label reads **"Start at 0:00"** (VLM-verified); toggling appends `&t=<seconds>` to the youtu.be link [documented — the interactive t-param append is the standard behavior; the checkbox mounted but the sandbox click did not toggle it before the dialog closed].

## Card 3-dot menu (the entry measured) [rendered]
- Card "More actions" button (40×40, bottom-right of the metadata area) → popup menu items: **Add to queue, Save to playlist, Download, Share** (+ feedback/report family below the fold in the iron-dropdown markup).

## Watch-page Share button (the operator's reference point) [css]/[documented]
- Position: in the under-player action row (`ytd-watch-metadata #top-level-buttons` region), pill button with share icon + "Share" text, same 36–40px pill grammar as the row's other actions. The action row did not hydrate in the gated session (CORPUS-PENDING for pixel re-verification; structure corroborated by [css] rules + R27).
- Clicking it opens the same `ytd-unified-share-panel-renderer` [documented] — anatomy above applies.

## What B must build for parity (the operator's #4)
1. Share pill in the watch action row + card 3-dot "Share" entry → the unified panel: 470px dialog, r12, shadow, "Share" header + X.
2. Scrollable 70×93 icon tiles: Embed first, then Messages, WhatsApp, Facebook, X, Email, Reddit, Pinterest, LinkedIn.
3. Link field pre-filled with the **short-form URL `youtu.be/<id>?si=…`**, Copy pill (r20) → **"Link copied to clipboard" toast**.
4. "Start at [0:00]" checkbox appending `&t=` to the copied link.
