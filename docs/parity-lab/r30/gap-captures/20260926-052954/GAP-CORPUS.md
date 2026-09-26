# GAP CORPUS 20260926-052954 — the operator's second logged-in window (the VPN-off healthy window)

THE WINDOW: login state confirmed live (avatar + bell + title "(5) YouTube",
no sign-in link). The gate was lifted by disconnecting the turbovpn (browser
egress returned to the native IP) + a fresh home load — the 04:56Z window
attempt failed because the browser was still egressing via the VPN IP
138.199.42.123 (YouTube's risk engine gates that class instantly). Captures
below ran 05:29-05:39Z. Evidence: this directory (raw .json/.jpg/.html per
surface) + g1-targeted-2.json (the picker attempt of record).

## §G1 THE THEME-PICKER SUBMENU (the R30-B gap #1 — NOW CAPTURED OPEN)

THE PATH: account menu (avatar click) → the "Appearance: Device theme" row —
the row is a `ytd-toggle-theme-compact-link-renderer` (NOT a plain
ytd-compact-link-renderer — the R30-B scan's miss, now closed) → REAL mouse
click at the label center (synthetic .click() does not open it) → the picker
renders as a SUB-PAGE of the same multi-page menu.

THE GRAMMAR (g1-2-theme-picker.jpg [VLM-verified] + .html [83KB] + rows dump):
- Header: **"Appearance"** with a **back arrow icon** (left)
- Subtext: **"Setting applies to this browser only"**
- Exactly **3 option rows**, in order:
  1. **"Use device theme"**
  2. **"Dark theme"**
  3. **"Light theme"**
- Row geometry: **300×40** each (x=1108 in a 1440 viewport), stacked at a
  **40px vertical pitch** (y=162/202/242); the inner label ~72-110×20
- The SELECTED row: **"Use device theme"** — indicated by a **bare
  checkmark icon** to its left (never a radio dot). [ERRATUM 2026-09-26:
  the original "checkmark inside a box" read (a check-in-box) was a
  capture-time over-interpretation — the selected-row marker is a BARE
  CHECKMARK: the captured yt-icon carries a single check path, no box
  outline; adjudicated 2026-09-26 by the captured DOM + two zoomed
  re-reads (a fresh full-page VLM read + a 3x-zoomed crop read). The
  check-never-radio point holds.]
- The captured selected state matches the account-menu row's own state label
  ("Appearance: Device theme") — the two-layer truth: the menu row carries
  the STATE, the picker row carries the CHECK.

## §G2 THE HEALTHY SUBSCRIPTIONS-FEED GRID (the R30-B gap #3 — NOW CAPTURED HEALTHY)

THE SURFACE: https://www.youtube.com/feed/subscriptions rendered in its
HEALTHY state (the R30 corpus's raw/07 captured only the degraded live-only
state; this window's g2-subs-feed.json/.jpg carries 14 real cards).

THE GRAMMAR (g2-subs-feed.json):
- Real subscription cards with: title, channel name, meta line
  ("channel · views · age", e.g. "AFTER FOOT 64K 7h ago", "Jimmy Kimmel
  Live 2.9M 1d ago"), thumbnail
- The cards render in the two-column browse grid (the
  ytd-two-column-browse-results-renderer shell, grid bar at x=72 y=56
  w=1352 in the 1440 viewport)
- NOTE (selector artifact, not a grammar claim): the card dump may
  double-list a video (the yt-lockup-view-model and its nested
  ytd-rich-item-renderer both match) — dedupe by title when binding.

## THE TWO GAPS THAT STAY PENDING (honest, never fabricated)

- **The home-surface resume bar** (gap #2): this account's home renders 30
  cards with ZERO progress bars and NO continue-watching shelf
  (g3-home-progress.json) — the surface is account-state-dependent; nothing
  to bind yet.
- **The shorts action rail** (gap #4): the risk-engine gate blocks the
  shorts player itself even on this healthy window (g4-shorts.json +
  g4-shorts-scroll.json: video readyState 0, only Play/Guide/Search aria,
  scroll does not unblock) — the third consistent record of this class.

## THE WINDOW LAW (lesson-167 lineage, extended)

The gate key was the EGRESS IP, not the account: VPN IP (138.199.x) =
instant gate; native IP + fresh load = healthy window with account chrome
within seconds. The theme-picker interaction law: the Appearance row is
`ytd-toggle-theme-compact-link-renderer` and needs a REAL mouse event at
its label center; the picker opens as the multi-page menu's second page.
