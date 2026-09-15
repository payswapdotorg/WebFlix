# WFX-043 — Release Acceptance (Lead)

Status: **ACCEPTED — FINAL.** Verified against the complete merged tree
at `main @ 386e674` (ALL worker items: 001-005, 010-015, 020-024, 025-029,
030-033, 040, 041; WFX-042 audit CLOSED). The four frozen acceptance
dimensions verify green with machine-checked evidence; the fresh-clone
golden journey passes on the final tree.

## 1. Golden journeys

| Journey | Evidence | Result |
|---------|----------|--------|
| Repo boot (the lead's golden path) | fresh `git clone` from the canonical remote (the sole source of truth) @ `386e674` → `bun install` → full gate suite | **PASS** — 1757 tests, 0 fail, contract/lane checks OK |
| Watch journey (feed → playback → resume) | `packages/experience/tests/watch.test.ts` golden sequences (episodic continuity, resume 5%/95% band law, honest control descriptors) | **PASS** (in suite) |
| Short journey (stack → swipe → replacement) | `packages/experience/tests/short.test.ts` golden flows (never-wraps swipes, 5-law replacement, typed unused) | **PASS** (in suite) |
| Action journey (intent → outbox → sync) | `packages/actions/tests/sync.test.ts` goldens (idempotent outbox, deterministic backoff, reconciliation) | **PASS** (in suite) |
| Library journey (history → conflicts) | `packages/experience/tests/library.test.ts` goldens (typed conflicts never auto-resolved) | **PASS** (in suite) |
| Cross-client journey parity | `apps/web/src/shared/parity.test.ts` — golden flow (watch feed → playback start → like action → library read) returns **byte-identical frozen EntertainmentEvent streams** on web/desktop/mobile runtimes; the helper is verified to CATCH drifted surfaces (no vacuous green) | **PASS** (in suite) |

## 2. Capability matrix

Verified by `apps/web/src/shared/capabilities.test.ts` (machine-checked,
WFX-040):

- **Web** — browser-constrained: `native` playback mode HONESTLY undeclared
  (no WebFlix-controlled media path); no contained browser host (the host
  page renders provider surfaces per the frozen boundary).
- **Desktop** — reference full-power: every frozen playback mode declared
  and playable; WFX-026 `BrowserHost` with the cookie-isolation contract
  enforced (non-isolate opens typed-rejected).
- **Mobile** — native media + OS-constrained background (wifi/charging
  inputs honored; unprovable conditions pause SAFE-SIDE) + reduced casting
  ceilings; `BrowserHost` cookie-isolation enforced.
- Parity is NOT uniformity: the same device resolves different modes BY
  DESIGN (`embed` on web, `native` on desktop/mobile) while domain
  semantics and event vocabulary remain identical (machine-checked).

## 3. Media recovery

Verified by the native-media chain test suites (WFX-004/014/015/023):

- **Typed retryable taxonomy** — `IO_ERROR` and `ENGINE_TIMEOUT` are the
  table-derived retryable codes; retryability mirrors the frozen table for
  EVERY code (tested exhaustively); error DTOs round-trip with code,
  detail, sessionId, and retryable intact.
- **Timeout recovery** — a silent engine misses the wire deadline with a
  retryable `ENGINE_TIMEOUT`; the session is NOT failed (a late success may
  have raced).
- **Process crash** — an `error` event through `onEvent` is process-fatal:
  every live session fails with typed `INTERNAL`; the handle terminates; no
  fake success crosses the seam.
- **Stall guard** — typed stall detection with idempotent ticks; no
  fabricated progress (WFX-023).
- **Range failures** — unsatisfiable ranges answer 416 with the correct
  `Content-Range` form; engine failures surface as 503 with typed reasons;
  a failing `readRange` is 503 INTERNAL (non-retryable, immediate); a
  malformed `Range` NEVER silently degrades to a full 200 (players rely on
  status semantics).

## 4. Recommendation regression

Verified by the recommendation suites (WFX-020/021/041):

- **Determinism** — "the source contains no hidden clock or randomness
  (deterministic by construction)"; identical inputs yield identical
  outputs across calls; telemetry determinism verified ("identical (trail,
  clock) yields identical metrics").
- **Source neutrality** — identical items under swapped connector ids
  compose identically (no provider drift in ranking).
- **Anti-tunnel-vision** — the anti-tunnel fixture survives intact; the
  narrowing fixture shows low survival + the narrowed signal visible;
  rerank scope is reorder-only (no below-visibility demotion); intents are
  strictly additive.
- **Attention-policy compliance** — re-verified from composed feeds (not
  trusted from traces); crafted violating feeds (4-run gaps, session-
  extending chains) are detected; compliant feeds verify clean; unprovable
  checks degrade typed (never guessed).

## 5. Full gate results (final `386e674`)

```
lint            — 0 errors (1 pre-existing cosmetic warning in GENERATED frozen.ts)
typecheck       — clean (tsc --noEmit, strict)
test            — 1757 pass / 0 fail / 9500 expect() calls / 62 files
contract-check  — OK — 7 frozen blocks in sync, 7 extension types present
lane-check      — OK — 217 files, no cross-lane private imports
ci              — green (all of the above chained)
fresh clone     — PASS (remote @ 386e674 → install → 1757/1757)
```

## 6. Outstanding

None. WFX-024 merged (386e674) with 6/6 gates + direct review
(pause-never-cancel resumable completion, never-evict storage governor,
63 new tests); the drift greps re-ran clean and WFX-042 is CLOSED.

## Verdict

**ACCEPTED — FINAL.** All four frozen acceptance dimensions verify green
on the complete tree with machine-checked evidence; the release boots and
passes from a fresh clone of the canonical remote. The Universal
Entertainment OS roadmap is complete.
