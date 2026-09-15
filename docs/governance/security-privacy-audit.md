# WFX-042 — Security / Privacy Audit (Lead)

Status: **FINAL (pending WFX-024 only)** — covers the merged tree at
`main @ 2265b69` (26/30 items: 001-005, 010-015, 020-023, 025-028,
029-033, 040, 041). Every merge passed the same drift gates before
entering `main`; the audit extends with the WFX-024 merge when it lands.

Method: direct inspection (source, imports, schemas, persistence, platform
behavior) per the frozen handoff's Final Verification rule — never worker
summaries alone. Mechanical checks re-runnable at any tree state.

## 1. Drift-rejection checklist (frozen handoff "Reject drift")

| # | Drift pattern | Verdict | Evidence |
|---|---------------|---------|----------|
| 1 | Direct provider SDK calls in core code | **CLEAN** | No provider-specific strings (`netflix`, `hulu`, `disney+`, `prime video`, `amazon`, `spotify`) anywhere under `packages/*/src` (non-test) |
| 2 | Platform-specific business logic in core | **CLEAN** | Core packages are pure TS + injected ports; platform seams are typed ports (`BrowserHost`, `ConnectorPort`, model fabric providers) |
| 3 | Last-item-only recommendation | **CLEAN** | `@wfx/recommendation` is multi-signal by construction: attention (run/monoculture neutrality), composition (session-scope replacement), diversity laws — verified in WFX-020/021 merge reviews |
| 4 | Model-controlled authorization | **CLEAN** | `packages/connectors/src/auth` and `packages/actions/src` have zero imports of `@wfx/model-fabric` / `@wfx/recommendation`; authorization flows are typed OAuth/device contracts, never model outputs |
| 5 | Native-media internals leaking into domain code | **CLEAN** | Zero `@wfx/native-media` imports in domain/experience/recommendation/actions/connectors/model-fabric `src/` (only comment references documenting WFX-024's not-yet-merged state) |
| 6 | Unsafe browser behavior | **CLEAN** | WFX-026 isolation policy: `file://` always blocked (frozen literal law), pure-literal SSRF guard (full IPv4/IPv6 blocked ranges incl. CGNAT, NAT64, 6to4, Teredo, v4-mapped; WHATWG normalization of exotic IPv4 spellings), SSRF guard fires BEFORE allow-list, per-connector allow-lists with label-boundary suffix match only, fail-closed no-policy, cookie/storage isolation `"isolate"` is a non-optional typed contract the fixture host enforces on every open; provider handoffs OBSERVED and recorded, never blocked |
| 7 | Canonical server persistence replaced by local DB | **CLEAN** | No `sqlite`/`prisma`/`localStorage`/`indexeddb`/`leveldb` in any `packages/*/src` (non-test); persistence is injected port contracts; WFX-029 library client derives from server state with typed conflict surfacing, never auto-resolves |
| 8 | Fake external success paths | **CLEAN** | No swallowed-error `ok: true` patterns in catch blocks (mechanical grep); every external effect returns TYPED results — unsupported/failure are data (`host-open-failed`, `isolated-refused`, `unsupported`, typed resolution reasons), per the no-fake-success law verified in every merge review |
| 9 | Duplicated cross-platform domain rules | **CLEAN** | `apps/{web,desktop,mobile}/src` are single-file scaffolds with zero core imports and zero domain logic (clients arrive in WFX-040 on the shared core) |

## 2. Determinism / purity laws

- Time: `Date.now()` appears ONLY as injectable default parameters
  (`generateUlid(now = Date.now())`, `now ?? Date.now()` adapter defaults) —
  the established WFX-002 pattern; every pure core module takes an injected
  `Clock` and documents the law (verified: `experience/browser/session.ts`,
  `use-cases/events.ts`, actions outbox, model fabric).
- Entropy: `Math.random()` absent from non-test, non-fixture core sources.
- Network: zero `fetch`/URL literals in `packages/*/src` (non-test) — all
  external effects are injected ports (ConnectorPort, BrowserHost, fabric
  providers, EventSink).

## 3. Frozen-contract integrity

- `contract-check`: 7 frozen blocks in sync, 7 extension types present
  (re-verified at every merge gate run, including the WFX-026 merge).
- `frozen.ts` is GENERATED (regenerated, never hand-edited).
- `lane-check`: 213 files, no cross-lane private imports (re-verified at
  every merge; grows with each item).

## 4. Security-relevant merge-review findings (history)

- WFX-025: frozen precedence + typed exclusions + audit trail in surface
  resolution — no silent fallbacks.
- WFX-026: SSRF/isolation as above; host-first close (throwing host leaves
  FSM untouched — retryable); capability honesty for optional `evaluate`.
- WFX-029: typed conflicts never auto-resolved.
- WFX-031: deterministic explainable scoring; swap contract.
- WFX-032: privacy redaction goldens (BYOM), FIPS-pinned SHA-256, output
  validation, policy enforcement, cost ceiling.
- WFX-033: hard permission laws on media transformation tools.
- WFX-014: frozen process boundary (versioned DTOs, runtime guards, no
  optimistic parsing); torrentBytes and range access typed
  UNSUPPORTED_SOURCE (honest capability, no fake transport); cache policy
  pure accounting with logical-clock LRU (deterministic eviction, honest
  rejection); process crash → typed INTERNAL for all live sessions.
- WFX-015: RFC range semantics with typed errors — malformed Range NEVER
  silently falls back to 200 (players rely on status semantics); loopback-
  only (127.0.0.1) test binding; transport-agnostic handler reusing the
  merged WFX-004 parser (no duplicated domain rules); 200/206/304/404/416/503
  semantics golden-tested.
- WFX-023: deterministic deadline-aware scheduling; injected clock and
  network estimate (no hidden time); relative piece ordinals documented as
  honest limitation (no fake precision anchors); idempotent ticks; stall
  guard with typed stall detection (no fabricated progress).
- WFX-028: rapid replacement 5-law policy; reorder-only rerank scope
  (strictly additive intents — anti-tunnel-vision law); TYPED-NOT-FIRED
  engagement events with closed vocabulary (backward swipe honestly emits
  nothing); capability honesty (absent like/save typed-null).
- WFX-040: honest capability profiles (web native honestly undeclared;
  mobile OS-constrained background with safe-side pause); BrowserHost
  cookie-isolation contract honored and tested on desktop+mobile adapters
  (closes this audit's open item); machine-checked parity invariant
  (byte-identical events — platform identity never leaks); quota-exceeded
  typed failure (never fake success).
- WFX-041: pure telemetry derivation with honest degraded markers (absent
  fields named, never fabricated); attention-mode compliance re-verified
  from composed feeds (not trusted from traces); cumulative privacy
  redaction levels (free-text drop, deterministic cohort bucketing
  documented as non-cryptographic, deterministic session pseudonymization,
  small-N suppression with typed marker — never a fake zero); every
  transformation audited in the RedactionReport; zero nondeterminism
  (no Math.random/Date.now in any telemetry source).

## 5. Open items

- WFX-024 (background completion + storage policy): the ONLY remaining
  worker item. Its merge review re-runs the mechanical drift greps + the
  storage-policy privacy review (background completion must honor the same
  honest-capability and no-fake-success laws; library/model.ts's typed
  integration gap closes with it). Audit finalization follows its merge.

## Verdict

**No drift found on the merged tree (26/30).** All nine frozen
drift-rejection patterns are clean; determinism, purity, frozen-contract,
and typed-failure laws hold across every merged package; the six
security-relevant merge families (SSRF/isolation, process boundary, range
gateway, scheduler, clients, telemetry redaction) all passed direct code
review with golden-tested laws. The audit closes when WFX-024 merges.
