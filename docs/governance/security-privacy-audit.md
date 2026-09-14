# WFX-042 — Security / Privacy Audit (Lead)

Status: **IN PROGRESS** — covers the merged tree at `main @ a8a14e8`
(20/30 items: 001-005, 010-013, 020-022, 025-027, 029-033). The audit
EXTENDS mechanically with every subsequent merge (014/015/023/024/028/040/041);
each merge already passes the same drift gates before entering `main`.

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
- `lane-check`: 172 files, no cross-lane private imports (re-verified at
  every merge).

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

## 5. Open items (audit extends when they merge)

- WFX-014/015/023/024 (native media chain): SSRF-adjacent surface = local
  HTTP gateway binding rules (015 binds where? loopback-only expected),
  scheduler authority boundaries (023), background completion + storage
  policy privacy (024 — the library/model.ts comment already anticipates it).
- WFX-028 (Short Feed): same laws as 027 (typed transparency, no fabrication).
- WFX-040 (clients): platform adapters must enforce the `BrowserHost`
  cookie-isolation contract; capability parity must be honest (typed
  unsupported, never greyed-out lies).
- WFX-041 (telemetry): QoE events must respect the frozen event envelope
  and privacy redaction laws (no user-identifying payloads).

## Verdict (current tree)

**No drift found.** All nine frozen drift-rejection patterns are clean on
the merged tree; determinism, purity, frozen-contract, and typed-failure
laws hold. Audit re-runs mechanically (`grep` sets + contract-check +
lane-check) and is extended by the per-merge direct reviews.
