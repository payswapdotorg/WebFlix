# WFX-DEPLOY-W2 — Completion Report (Host / Playback / Service Integration lane)

**Branch:** `work/wfx-deploy-w2-host` (from `main` @ `fbbef9b244887ef3f38e7bddf1b72cff3e6f6ae4`, the wind-down ledger with R37 + R38-B merged — verified before work began)

**HEAD SHA:** the branch tip — 3 commits on top of baseline `fbbef9b` (work order `1ad6284` → report `84a079a` → report addendum `df01271`; `git log --oneline main..work/wfx-deploy-w2-host` is the canonical truth — the TL harvests from git)

**Date:** 2026-10-02

**Push status: UNRESOLVED (credential-blocked, not work-blocked).** The work order's push credential was delivered as the literal unfilled placeholder `__PAT_PLACEHOLDER__` — no usable token exists in the environment (no credential helper, no `GITHUB_*`/`GH_*`/token env vars, no `~/.git-credentials`, no `gh` CLI; a plain `git push -u origin work/wfx-deploy-w2-host` fails `could not read Username for 'https://github.com'`). Both commits exist locally on the branch and are harvestable the moment a real PAT is supplied (push URL shape per §0 of the work order; the credential must never be committed — verified: the only credential-shaped string in this branch's history is the placeholder literal itself, part of the verbatim work order). All verification work §2–§5 is COMPLETE and independent of the push.

**Mission recap:** guarantee the host's service-mode truth — boot law, remote transport, playback resolution, failure honesty — against the REAL deployed Experience API (`https://webflix-api.vercel.app`, LIVE), with the production Vercel web app (`https://webflix-steel.vercel.app`, STALE — predates R38-B) used only as an additional real-service REFERENCE. All checks below ran against THIS branch's local boots.

---

## 1. Commit list

| SHA | Subject |
|---|---|
| `1ad6284` | WFX-DEPLOY-W2: work order committed verbatim (docs/work-items/WFX-DEPLOY-W2.md, dated 2026-10-02) — host/playback/service-integration lane, baseline fbbef9b verified |
| `84a079a` | WFX-DEPLOY-W2-REPORT.md — the completion report (gates were run at `1ad6284`, i.e. with the identical tree; the report commit adds docs only) |
| `df01271` | report addendum — push status recorded honestly (credential-blocked) + gates-table provenance |

## 2. Changed-file list

| File | Change |
|---|---|
| `docs/work-items/WFX-DEPLOY-W2.md` | added (work order verbatim; first commit per §0) |
| `docs/work-items/WFX-DEPLOY-W2-REPORT.md` | added (this report) |

**Zero source changes.** The verification lane found the host platform (`apps/web/src/host/**`, `apps/web/src/platform/**`) already satisfying every deliverable at the baseline; no defect inside this lane's ownership required a fix. All claims below are REPRODUCED observations, not code-read assertions.

---

## 3. Architecture drift note (read FIRST — it reframes two work-order clauses)

The work order's §2/§3 reference `src/host/boot.ts` and `src/host/remote-ports.ts` (per `apps/web/DEPLOYMENT.md`). **Those files no longer exist**: R07 (`e44d0f1`) consolidated the boot path into `src/host/web-host.ts` (+ `src/host/config.ts`, which remains THE law module) and the transport into `src/platform/server-port.ts` (its module doc states verbatim: "the former `host/remote-ports.ts`, carried forward by this module"). Additionally, the R01 ServerPort ratification **superseded** the WFX-003 empty-answer degrade law: reads answer TYPED `ServerResult` failures (`{ok:false, failure:{kind,detail}}`) rendered honestly — a stricter honesty than `[]`/`null` — and event delivery failures surface as the runtime's typed `RuntimeError` → HTTP 502 at `/api/events` (the class name `HostTransportError` was removed with the pre-R07 transport). "Never a silent success" and "never a fixture fallback" are preserved by the current law. This report verifies the CURRENT law and flags the DEPLOYMENT.md drift as HANDOFF-1 (the file is outside this lane's ownership).

---

## 4. Per-check verdict table

| # | Check (work-order §) | Verdict | Evidence |
|---|---|---|---|
| 1 | Baseline SHA + ledger present (§0) | **VERIFIED-REPRODUCED** | `git log --oneline -1` at clone: `fbbef9b ledger: wind-down executed (lead-ALI10) — R37 + R38-B merged (gates green, 5418/5417/1/0 at head)…` |
| 2 | Boot law (a) `WFX_DEV_FIXTURES=1` + dev → fixture ports (§2) | **VERIFIED-REPRODUCED** | Machine: `apps/web/tests/web-host.test.ts` 9/9 pass ("WFX_DEV_FIXTURES=1 (dev only) boots the fixture-backed transport"). Behavioral: booted app → HTTP 200, `data-wfx-mode="fixtures"`, visible "dev fixtures" badge (log: `scripts/dev-fixtures.log`) |
| 3 | Boot law (b) unset → service ports vs `WFX_API_BASE` (§2) | **VERIFIED-REPRODUCED** | Machine: same file ("WFX_API_BASE boots the REAL ServerPort transport"). Behavioral: `WFX_API_BASE=https://webflix-api.vercel.app bun run dev` → `GET /` 200, 848 776 bytes, `data-wfx-mode="service"`, real seeded titles ("1,000 Years Of English Monarchy In 4 Hours"), connector `wfx-experience-service`; `GET /api/health` 200 |
| 4 | Boot law (c) other combos → typed `HostConfigError` naming variables (§2) | **VERIFIED-REPRODUCED** | Machine: 3 tests (missing `WFX_API_BASE` → `missing:["WFX_API_BASE"]`; flag+production → `invalid:["WFX_DEV_FIXTURES"]`; malformed URL → `invalid:["WFX_API_BASE"]`). Behavioral: no-env boot → HTTP 500, server log `Error [HostConfigError]: webflix web host misconfigured: service boot requires WFX_API_BASE…` at `src/host/config.ts:136`, RSC `digest` ties browser to log (logs: `dev-no-env.log`, `prod-start-noenv.log`) |
| 5 | No hidden fixture fallback — grep (§2) | **VERIFIED-REPRODUCED** | Repo-wide grep: every import of a `*-fixtures.ts` module is gated on `host.mode === "fixtures"` (view-models.ts:1045, intelligence.ts:66, torrent-realizations.ts:136, api routes sources/acquisition/open-models/feedback); `platform/` (the service transport home) contains ZERO fixture imports |
| 6 | No hidden fixture fallback — behavioral (§2) | **VERIFIED-REPRODUCED** | Unreachable `WFX_API_BASE` (127.0.0.1:9109), fixtures UNSET → honest typed degrade: "For you could not load **network: GET …/experience/search?query=rain did not complete (TypeError: fetch failed)** Retry" — NO fixture content, NO real titles either (log: `dev-unreachable-api.log`) |
| 7 | Transport mapping — all 7 frozen endpoints, REAL requests (§3) | **VERIFIED-REPRODUCED** | Script `scripts/verify-transport.ts` vs the LIVE service: search (19+ real hits), metadata (SourceItem, availability=available, capabilities=[playEmbed,playExternal,like,save]), resolve (embed+external realizations), actions (like → receipt status=**confirmed**), library GET (array) + POST add (status=**confirmed**), events POST progress (ok, durable) — **26/26 checks PASS** |
| 8 | Identity as HEADERS, never URLs (§3) | **VERIFIED-REPRODUCED** | Local echo proxy captured the port's outgoing requests: `x-wfx-user-id`, `x-wfx-session-id`, `x-wfx-locale`, `x-wfx-region` all present as HEADERS; URL query carries only documented params (`/experience/search?query=probe-query` etc.) — checks B1–B11 PASS |
| 9 | Degrade law — typed failures (§3, current R01 law) | **VERIFIED-REPRODUCED** | Unreachable → `kind:"network"`; HTTP 500 → `kind:"unavailable"`; non-JSON 2xx → `kind:"malformed"`; wrong-shape 2xx → `kind:"malformed"`; malformed entries inside valid array skipped (ok:true, 1 usable); metadata 404 → `ok:true, value:null` (the one honest-absence read) — checks D1–D5b PASS |
| 10 | Action failures → failed receipts with transport detail (§3) | **VERIFIED-REPRODUCED** | Port answers `ok:false` + typed failure (D2b); the runtime settles the action `failed` with that detail (machine-tested; `apps/web/tests/platform-server-port.test.ts` 45/45 pass) |
| 11 | Event delivery failures → typed error, never silent success (§3) | **VERIFIED-REPRODUCED** | End-to-end: `POST /api/events` with unreachable API → **HTTP 502** `{"error":"the watch-state report was not delivered (network): client-runtime failure (network): emitEvent (watch state): POST …/experience/events did not complete (TypeError: fetch failed)"}` (log: `dev-events-502.log`); closed vocabulary: `type:"like"` → 400 with the documented reason |
| 12 | 10 s request timeout actually enforced (§3) | **VERIFIED-REPRODUCED** | Black-hole proxy (accepts TCP, never answers): request cut at **10 001 ms** (9.0–11.5 s window), typed `network` failure naming `TimeoutError`; injected `timeoutMs=800` cut at **801 ms** — checks C1–C4 PASS. NOT code-read: measured wall-clock |
| 13 | `/player` starts a REAL playback session, renders the RESOLVED mode (§4) | **VERIFIED-REPRODUCED** | agent-browser vs local service-mode boot: `ref=5SRgdyUsuAg` → `data-wfx-player-mode="embed"` + REAL visible iframe `https://www.youtube-nocookie.com/embed/5SRgdyUsuAg?enablejsapi=1&autoplay=1&mute=1` (996×560 px, `getClientRects()>0`), `data-wfx-embed-attestation="unofficial"` named honestly, control=bound, containment=privacy-host; truthful `buffering` phase; **0 `<video>` elements** (screenshots: `player-embed-mode.png`, `player-clickthrough-short.png`) |
| 14 | External handoff ACTUALLY occurs (§4) | **VERIFIED-REPRODUCED** | `&mode=external` (an offered realization): `data-wfx-player-mode="external"`, visible handoff copy "This content opens on its source — the provider keeps the playback path. WebFlix never fakes in-app playback…" + "Open on the source" → `https://www.youtube.com/watch?v=5SRgdyUsuAg`; 0 videos, 0 iframes (screenshot: `player-external-mode.png`) |
| 15 | Browser panel behavior (§4) | **VERIFIED (machine) / COVERAGE-LIMITED (live)** | Machine: `apps/web/tests/adapter-surfaces.test.ts` + `capability-surfaces.test.ts` 46/46 pass — browser-only content renders the CONTAINED surface (`data-wfx-player-mode="browser"`, cookie-isolated iframe, `sandbox="allow-scripts allow-forms allow-popups allow-presentation"`); browser-beats-external precedence. Live: the deployed catalog offers **no browser-mode realizations** (19/19 probed items → `[embed, external]`; probe script `scripts/probe-resolve-modes.ts`), so the mode is unreachable against the LIVE service — and the unoffered preference is honestly NOT forced (`&mode=browser` resolves to embed per the documented law; OBSERVED). No fake browser stage is fabricated to fill the gap |
| 16 | NO fake video / placeholder / ungranted capability (§4) | **VERIFIED-REPRODUCED** | 0 `<video>` elements in EVERY exercised state (embed, external, failed, click-through short, production HTML grep); the stage renders exactly what the service's resolve answer granted; handoff copy states the no-fake law verbatim |
| 17 | Player failure paths → typed failure state (§4) | **VERIFIED-REPRODUCED** | Nonexistent ref → `data-wfx-player-state="failed"` + "Playback could not start — unavailable: client-runtime failure (unavailable): no valid playback realization could be resolved — source 'wfx-experience-service' offers no playback realization for this item… | native: rejected — no native realization present | embed: rejected — no embed realization" (full precedence trace, honest + actionable; screenshot: `player-resolve-failed.png`) |
| 18 | Production build with NO env (§5) | **VERIFIED-REPRODUCED** | `env -u WFX_API_BASE -u WFX_DEV_FIXTURES -u NODE_ENV bun run build` → **exit 0**; route table all `ƒ` (dynamic) except `○ /offline` + `○ /_not-found` (documented; log: `build-no-env.log`) |
| 19 | Built app in service mode serves real content (§5) | **VERIFIED-REPRODUCED** | `next start` + `WFX_API_BASE`: `GET /` 200 (791 478 bytes, real titles, `data-wfx-mode="service"`), `/api/health` 200 `{"ok":true,"service":"webflix-web","version":"0.1.0"}`, `GET /player` 200 `data-wfx-player-mode="embed"` + real embed URL, 0 `<video>` (log: `prod-start-service.log`) |
| 20 | Built app WITHOUT `WFX_API_BASE` fails LOUDLY (§5) | **VERIFIED-REPRODUCED** | HTTP 500 + typed `HostConfigError` naming `WFX_API_BASE` in server log + RSC digest tie; NO fixture content in the failure (log: `prod-start-noenv.log`) |
| 21 | Fixture flag + production = typed crime (§1/§2) | **VERIFIED-REPRODUCED** | Built app + `WFX_DEV_FIXTURES=1` (`next start`, NODE_ENV=production): HTTP 500 + `Error [HostConfigError]: … WFX_DEV_FIXTURES is set but NODE_ENV is 'production' — dev fixtures must never boot in production`; no fixture content (log: `prod-start-fixturecrime.log`) |
| 22 | Production app as real-service reference (§4) | **OBSERVED** | `https://webflix-steel.vercel.app/player?…ref=5SRgdyUsuAg` → same embed-mode resolution against the same LIVE service (`data-wfx-mode="service"`, real embed iframe, 0 videos; screenshot: `production-reference-embed.png`). Reference only — the STALE deployment predates R38-B; THIS branch's local boots are the verification target |

### 4.1 Mode coverage per exercised content item (§4 requirement)

| Content item (real catalog) | Service resolve answer | Exercised mode | Result |
|---|---|---|---|
| "1,000 Years Of English Monarchy In 4 Hours" (`5SRgdyUsuAg`, video) | `[embed → youtube-nocookie.com/embed/…, external → youtube.com/watch?v=…]` | **embed** (default precedence) | REAL visible embed iframe, control bound, attestation=unofficial named |
| same | same | **external** (`&mode=external`, offered) | Visible handoff + real external URL link |
| same | same | browser (`&mode=browser`, NOT offered) | Honest non-force: resolves to embed (documented law) |
| "1 HOUR Rainy Day in Airport…" (`3uyGhtARP4M`, short; via home-card click-through) | `[embed, external]` | **embed** | REAL visible embed iframe; click-through from home card |
| `THIS_REF_DOES_NOT_EXIST_999` (nonexistent) | `[]` (no realizations) | **resolve-failed** | Typed failed state + full precedence trace |

Live-catalog limit (honest): 19/19 probed items offer `[embed, external]` only — **no external-only and no browser-mode items exist in the deployed catalog**, so the browser-panel and forced-external-by-absence paths are machine-verified only (see verdict #15).

---

## 5. Gates table (actual numbers; run at `1ad6284` — the source tree at HEAD `84a079a` is IDENTICAL, the report commit is docs-only)

| Gate | Baseline `fbbef9b` (recorded §1) | `1ad6284` (identical tree at HEAD) | Regression? |
|---|---|---|---|
| `bun run typecheck` | clean, exit 0 | clean, exit 0 | none |
| `bun run lint` | 116 problems (33 errors / 83 warnings), exit 1 — **pre-existing at baseline; every error file outside this lane's ownership** (`apps/api`, `apps/desktop`, `apps/web/tests`, `evidence/`, `packages/`) | 116 problems (33 / 83), exit 1; **0 problems in `apps/web/src/host/**` + `apps/web/src/platform/**`** | none (identical; reported, not patched — another lane's tree) |
| `bun run test` | 5418 tests / 5417 pass / 1 skip / 0 fail (34 269 expects, 316 files) | 5418 / 5417 / 1 / 0 (34 270 expects, 316 files) | none — battery counts EXACT; +1 expect() call out of 34 269 is a nondeterministic-count artifact (pass/fail/skip identical), noted for honesty |
| `bun run contract-check` | OK — 12 frozen blocks in sync, 7 extension types present | OK — identical | none |
| `bun run lane-check` | OK — 1014 files, no cross-lane private imports | OK — identical | none |

Gate-script note: the ledger's merge-time message (03a0dd9) records "lane-check OK (993 files)" at that earlier commit; the number actually observed at baseline `fbbef9b` (and at HEAD) is **1014 files** — recorded as observed.

---

## 6. Vercel env posture for the web project (names + source-of-truth pointers ONLY — values never in files or commits)

| Name | Posture | Source of truth |
|---|---|---|
| `WFX_API_BASE` | SET (production + preview) to the deployed Experience API base | `docs/infrastructure/deployment.md` §9 (WFX-055B activation; env id `dcJvo5RsbQmp4vYH` on project `prj_Ylm0ROs2ZxwxxHWCMAroSPH8`); the VALUE lives only in the Vercel env store |
| `WFX_DEV_FIXTURES` | UNSET — must never exist in production (typed boot crime, verdict #21) | `apps/web/DEPLOYMENT.md` env law; `apps/web/src/host/config.ts` Law 1 |
| `NODE_ENV` | platform-set (`production`); never override | `docs/infrastructure/deployment.md` §3 |
| `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `R2_*`, `UPSTASH_*`, `YOUTUBE_*`, `VERCEL_TOKEN` | NOT set on the WEB project (service-lane variables; least privilege) | `apps/web/DEPLOYMENT.md` "NOT consumed by this app"; `docs/infrastructure/environment-inventory.md` |

Deploy note (TL-relevant): a Vercel deployment from post-R38-B `main` needs NO env change vs the WFX-055B posture above — the same `WFX_API_BASE` activation serves the merged app (verified locally: the R38-B code base boots, serves real content, and resolves real playback against the LIVE service).

---

## 7. HANDOFF list (changes outside this lane's ownership — reported, not made)

1. **HANDOFF-1 (docs drift, W1 or TL):** `apps/web/DEPLOYMENT.md` still names `src/host/boot.ts`, `src/host/remote-ports.ts`, `HostTransportError`, and the pre-R01 empty-answer degrade law ("read failures → empty answer ([]/null)"; "event delivery failures → typed HostTransportError thrown"). All four were superseded by R07/R01 (transport now `src/platform/server-port.ts`; reads answer typed `ServerResult` failures; events fail via typed `RuntimeError` → 502 at `/api/events`). The file is outside this lane's ownership; the drift misled two clauses of this work order (§2/§3 wording) and will mislead future readers.
2. **HANDOFF-2 (catalog, service lane, informational):** the deployed catalog offers no browser-mode or external-only realizations (19/19 probed = `[embed, external]`), so the visible-browser-panel path cannot be browser-verified against the LIVE service. If the service lane seeds such an item, re-run this lane's browser checks (probe script + player URLs documented in §4.1).
3. **HANDOFF-3 (lint, TL):** `bun run lint` fails at baseline with 33 errors, all in `apps/api/**`, `apps/desktop/**`, `apps/web/tests/**`, `evidence/**`, `packages/**` — pre-existing, outside this lane's tree; zero errors in `apps/web/src/host/**` + `apps/web/src/platform/**`. Recorded so the TL does not read a red lint as this lane's regression.
4. **HANDOFF-4 (index):** per §0 of the work order, the work-items index update is TL-owned — not edited here.

## 8. UNRESOLVED list

1. **Branch push (credential-blocked).** See the push-status note at the top of this report: the delivered push credential is an unfilled placeholder; no usable token exists in this environment. The branch — both commits, all git truth — is local and ready; the push completes the moment a real PAT is provided to this worker (or the TL harvests the branch directly from this machine). Nothing else is unresolved: every deliverable §2–§5 check is VERIFIED-REPRODUCED (or machine-VERIFIED with the coverage limit honestly named — verdict #15, a property of the deployed catalog, not a code defect); no check is HYPOTHESIS-only; no failure was papered over.

## 9. Reproduction pointers (local artifacts, outside the repo)

- Verification scripts: `/home/z/my-project/scripts/verify-transport.ts` (26-check transport suite — REAL service + echo/black-hole/misbehaving proxies), `/home/z/my-project/scripts/probe-resolve-modes.ts` (catalog resolve-mode probe)
- Boot/build logs: `/home/z/my-project/scripts/{dev-service-mode,dev-unreachable-api,dev-no-env,dev-fixtures,dev-events-502,dev-browser-verify,build-no-env,prod-start-service,prod-start-noenv,prod-start-fixturecrime}.log`
- Browser screenshots: `/home/z/my-project/download/wfx-deploy-w2-evidence/{player-embed-mode,player-clickthrough-short,player-external-mode,player-resolve-failed,production-reference-embed}.png`
