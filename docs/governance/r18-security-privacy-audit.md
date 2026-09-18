# R18 — Security / Privacy / Authorization Audit (Lead)

Status: **CLOSED** on the complete remediation tree at
`main @ d0a9b67` (R00–R17 merged: shared runtime + platform contracts,
identity/profiles, source management, library/history, recommendation
controls, model/AI controls, web + desktop platform adapters, media
surface + contained BrowserHost, native media production path, torrent
engine + scheduler + persistence, external/social action sync, native
acquisition UX, golden journey automation, failure/recovery hardening).

Method: direct inspection (source, imports, schemas, persistence,
platform behavior) per the completion-truth rule — never worker
summaries alone. Every mechanical check below is re-runnable at any
tree state. The pre-remediation WFX-042 audit's drift-rejection
patterns remain clean on this tree (re-swept below); this audit adds
the remediation's seven frozen dimensions.

## 1. Classic drift-rejection checklist (re-swept @ d0a9b67)

| # | Drift pattern | Verdict | Evidence |
|---|---------------|---------|----------|
| 1 | Direct provider SDK calls in core code | **CLEAN** | no provider strings under `packages/*/src` + `apps/*/src` (non-test) |
| 2 | Platform-specific business logic in core | **CLEAN** | core = pure TS + injected ports; platform seams typed (`BrowserHost`, `ConnectorPort`, fabric providers) |
| 3 | Canonical persistence replaced by local DB | **CLEAN** | no `sqlite`/`prisma`/`localStorage`/`indexeddb`/`leveldb` in non-test `src` (the one storage.ts hit is the doc comment stating the port law) |
| 4 | Hidden nondeterminism | **CLEAN** | `Math.random()` in core = doc comments stating the prohibition only; `Date.now` confined to injectable defaults (verified pattern in every merge) |
| 5 | Network literals in core | **CLEAN** | URL literals: `fixture.invalid` (fixtures), the local media gateway's loopback binding (by design), and the YouTube connector's real API root (the production connector's legitimate endpoint) |
| 6 | Secrets committed | **CLEAN** | no `github_pat_`/`ghp_` material anywhere in the repo (PATs live only in the orchestration layer, never in the product tree) |

## 2. The remediation's seven frozen dimensions

### 2.1 Tenant/profile isolation (R02/R04/R05)

- **Profile ownership law**: a foreign account's profile answers the
  SAME honest 404 as an unknown id — no cross-account probing
  (`apps/api/src/app/profiles/route.ts`, golden-tested in
  `apps/api/tests/auth-profiles.test.ts` "ownership: a foreign
  account's profile and unknown ids answer the same 404").
- **Data-plane scoping**: history/library/intents/policy reads are
  profile-scoped by construction (the persistence services take
  `(userId, profileId)`; the model-policy goldens pin "profile B never
  sees profile A's policy" and "user B never sees user A's policy" —
  `packages/persistence/tests/model-controls.test.ts`).

### 2.2 Credentials (R03/R06)

- **Storage**: credentials persist ONLY as AES-256-GCM envelopes with
  AAD + keyId rotation (`packages/persistence/src/envelope-crypto.ts`,
  `APP_ENCRYPTION_KEY` presence+length validated at boot).
- **Logs/URLs**: no credential material in any `console.*` call (mechanical
  sweep over non-test sources: zero hits); the OAuth callback keeps the
  token out of the URL record (`apps/api/src/app/sources/callback`).
- **Model inputs**: THE DOUBLED LAW — (a) the model-input lane
  structurally cannot read BYOM keys (`loadBinding` exists only for the
  fabric transport lane; `listForProfile` answers secret-free
  projections; pinned by `packages/persistence/tests/model-controls.test.ts`);
  (b) `assertNoCredentialMaterial` ENFORCES the field-set law with a
  typed violation + audit record (`packages/persistence/src/model-input.ts`).
- **Prompts**: `redactForPrivacy` produces the BYOM input with SHA-256
  pseudonymization; the report never echoes redacted values (paths +
  reasons only); cross-user intent material is redacted by golden tests
  (`packages/model-fabric/tests/byom.test.ts`).

### 2.3 Model-input privacy (R06)

- Local-only policy EXCLUDES cloud providers at the planner AND the
  gateway REFUSES a local-only invocation that would reach a cloud
  provider (defense in depth — golden-tested both at plan-time and with
  a broken planner).
- Cost ceilings enforced pre-attempt and per-attempt with typed
  cost-failure honesty; exactly-at-ceiling allowed (no off-by-one).
- BYOM binding deletion follows the hard-delete discipline
  (next read answers honest null).

### 2.4 Native acquisition authorization (R11/R13/R21)

- **Invariant 5 (frozen)**: native acquisition limited to user-owned,
  licensed, public-domain, CC, or otherwise-authorized media — enforced
  by the closed provenance vocabulary (`packages/torrent-engine/src/provenance.ts`).
- A caller CANNOT assemble a provenance from a plain object (brand +
  registry derivation); `as any` is still rejected at runtime (defense
  in depth) — the typed `PROVENANCE_REJECTED` is never a warning.
- The acquisition UX states the authorized basis in the gated
  diagnostics (`vault:family-media / user-owned` — J21 golden evidence).

### 2.5 BrowserHost security (R09)

- Contained surfaces are SANDBOXED IFRAMES: `restrictCookies: "isolate"`
  is the only legal value (a non-optional typed contract), no
  `allow-same-origin` (opaque origin) — cookies/storage isolated from
  the WebFlix origin AND from other contained providers
  (`apps/web/src/platform/browser-host.ts`).
- The SSRF/isolation policy family from WFX-026 remains frozen:
  `file://` always blocked, pure-literal IP guards (private/loopback
  ranges incl. exotic spellings), guard fires BEFORE allow-list,
  per-connector allow-lists with label-boundary matching, fail-closed
  no-policy (golden suite `packages/experience/tests/browser.test.ts`).

### 2.6 Persistence deletion/export (R02/R06)

- `deleteAccount` (connector-accounts) and `deleteBinding` (BYOM) follow
  the same hard-delete discipline; the model-policy DELETE answers
  honest null on next read (golden-tested).
- Session tokens scrypt-hashed; `IssuedSession` never echoes raw
  secrets beyond the one-time issuance response.

### 2.7 Connector permissions (R03/R07)

- Capability truth is the connector descriptor's frozen union — UI
  availability renders from it, never from optimistic probing; a
  connector declaring nothing answers `unsupported` honestly
  (`packages/connectors/src/descriptor.ts`, `registry.ts`).
- The reference connector's capability matrix is the honest-truth
  golden; unsupported external actions surface typed failure states
  with idempotent retry (R17's retry law, golden-tested).

## 3. Verdict

**ALL SEVEN REMEDIATION DIMENSIONS GREEN** on `main @ d0a9b67`, with the
classic drift-rejection patterns re-swept clean. No findings requiring
code change. The audit is re-runnable: every claim above cites its
mechanical check (grep) or its golden test file.

— Tech Lead, 2026-09-18 (R18 of the 2026-09-16 remediation freeze)
