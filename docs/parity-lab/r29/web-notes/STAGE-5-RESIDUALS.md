# R29-B Stage 5 — the residuals + the final gates (D16 + N16 close; the HOLD ledger)

Worker B's lane notes. Lane head after Stage 4: `b852d97`.

## What shipped

### D16/F4 — THE NINE LITERAL TOKENS → CANONICAL NAMES (CLOSED in-lane)

The web surface's nine surface-scoped tokens (hairline, pill-surface, pill-ink,
scrollbar-thumb, toast-surface, toast-ink, chrome-scrim, chrome-ink,
stage-black) are now DECLARED as `--wfx-*` custom properties with the
contract's corpus values (both themes), and the literals they replaced are gone
from the rules that used them:

- the scrollbar colors/thumb (`hsl(0,0%,67%)`/`hsl(0,0%,76%)` → `var(--wfx-scrollbar-thumb)`)
- the player chrome's bottom scrim (`rgba(0,0,0,0.74)` → `var(--wfx-chrome-scrim)`) + the chrome block's control ink (4 rules → `var(--wfx-chrome-fg)`)
- the badge base + type chip (`rgba(0,0,0,0.8)`/`#fff` → `var(--wfx-pill-bg)`/`var(--wfx-pill-fg)`)
- the snackbar toast (→ `var(--wfx-toast-bg)`/`var(--wfx-toast-fg)` — the honest token names, values identical to the CTA pair)
- the six stage/letterbox blacks (→ `var(--wfx-stage-black)`)

The parity-conformance report's informational line ("surface-scoped … not
declared") is GONE — the Web surface: CONFORMANT, both themes, with the
contract values byte-exact (the harness's own normalization check passes).

### N16 — THE DURATION PILL ALPHA (CLOSED by Stage 4's badge work)

The corpus supersession (A@298fa55: `rgba(0,0,0,0.6)`, R27's 0.8 superseded)
is the shipped badge value — live-verified `rgba(0, 0, 0, 0.6)` after the
token work (the badge keeps the corpus 0.6, NOT the stale R27 contract
token's 0.8). **Escalation for the lead**: the contract's `pill-surface`
token in `packages/platform-contracts/src/parity-tokens.ts` still encodes the
superseded 0.8 (R27 vintage) — the token update is a shared-package change,
outside this lane's paths (B records it; the app's badge follows the R28
corpus).

## The HOLD ledger (CORPUS-PENDING — recorded, never built from memory)

Per the original brief: the following stay HOLD pending the corpus pixels;
each is recorded as a DIVERGENCE, not fabricated:

- **N2/D4 — the notifications bell**: logged-in-only chrome; the lead's healthy-window record carries the avatar-cluster observation but NOT the bell's anatomy (`docs/parity-lab/r28/lead-captures/README.md`). Ships only behind honest sign-in chrome with the captured grammar.
- **N1/D3 — the mic (voice search)**: no voice-search transport; corpus anatomy known (40×40 r100 bg rgba(0,0,0,0.05)) but the capability is absent — honest absence.
- **D6 — the subscriptions rail channel list**: the lead's logged-in flat-channel-list record is CORPUS-PENDING anatomy.
- **N19 sub-item — the watched-progress overlay pixels**: the resume bar exists (WebFlix's own grammar); the corpus overlay's exact pixels are [P].
- **N27 — the shorts action-rail pixels**: the shorts shell's action rail + audio toggle are CORPUS-PENDING.

## The standing divergences (honest, recorded)

- **N15's mechanism**: WebFlix's no-choice boot follows the OS preference; YouTube's logged-out always boots light — the operator's binding ruling recorded (the Appearance menu — Stage 3's gear — is the corpus's full path).
- **N29's card channel row**: the cards' channel slot renders the connector id ("From wfx-experience-service") — the service items carry no channel-name field (the frozen law: never fabricated). The WATCH channel row (Stage 1) resolves the source displayName.
- **The miniplayer's MPA mechanism**: the dock persists across navigation via sessionStorage + the compact `/player?…&miniplayer=1` form (the iframe re-mounts per page, resuming from the real reported position) — never claimed as an SPA element transplant.
- **k/space/j/l/←/→/0–9 display evidence**: the commands round-trip; the visible play-state/position effects are evidence-gated on the provider's own broadcasts, which never advance in this sandbox (the provider's stream never loads — the display never fabricates; C's R28 k-verdict class; `evidence/r29-web/verifications/stage3-keyboard-perkey.md`).
- **The pre-existing repo-wide lint errors**: 20 `no-explicit-any` in `evidence/r28-recon/*.ts` (Worker C's R28 harness, committed on main lineage 095c73c/d34900b) — OUTSIDE this lane's allowed paths, unchanged by this lane; escalated. This lane's paths (apps/web, journeys/web) are lint-clean.

## Final gates (the full suite, on the final tree)

- battery: **5132 pass / 1 skip / 0 fail = main's floor** (290 files, 33,074 expects)
- parity-conformance: **19/19 — CONFORMANT** (both surfaces; the informational note cleared)
- contract-check: OK — 12 frozen blocks in sync
- lane-check: OK — 918 files, no cross-lane private imports
- `apps/web` build: ✓
- lint: apps/web + journeys/web clean
- typecheck: both projects ✓
