# WFX-DEPLOY-W2 — Host / Playback / Service Integration lane (WebFlix Deployment Release)

You are WFX-DEPLOY-W2, the host/playback/service-integration worker for
the WebFlix deployment release. Mission context: the operator has ordered
the current WebFlix app deployed and browser-verified test-ready by
2026-10-03 00:00 UTC. The TL coordinates three worker lanes (W1 web UX +
you + W3 browser-regression) against one baseline. The production Vercel
project `webflix` serves at https://webflix-steel.vercel.app (currently
STALE — predates the R38-B merge); the deployed Experience API service is
https://webflix-api.vercel.app (LIVE). Your lane guarantees the host's
service-mode truth: boot law, remote transport, playback resolution, and
failure honesty.

Deadline pressure is real — but the quality bar does NOT drop. The TL
rejects: fixture-mode claims presented as service-mode, "player page
rendered" as playback success, any hidden fixture fallback in production
behavior, fabricated evidence. Evidence labels: OBSERVED / DOCUMENTED /
HYPOTHESIS / REPRODUCED / UNRESOLVED.

## 0. Identity and ground rules

- Repo: https://github.com/payswapdotorg/WebFlix.git (public read).
- Baseline: main @ fbbef9b244887ef3f38e7bddf1b72cff3e6f6ae4 (verify:
  `git log --oneline -1` shows the wind-down ledger with R37 + R38-B
  merged. If absent STOP and report UNRESOLVED).
- Branch: work/wfx-deploy-w2-host from main. Push with the PAT below;
  - Push credential (for git push ONLY; NEVER commit it to any file or history):
  https://x-access-token:__PAT_PLACEHOLDER__@github.com/payswapdotorg/WebFlix.git
NEVER open PRs / never merge (TL-owned); NEVER commit any credential,
  token, key, or auth state to files or history.
- You own ONLY: apps/web/src/host/** and apps/web/src/platform/**.
  Do NOT touch apps/web/src/app/**, apps/web/src/components/**,
  apps/web/tests/**, journeys/**, or packages/ — needed changes there
  go in your report as HANDOFF lines.
- Shared-file rule: package.json, bun.lock, root tsconfig, workspace
  config are TL-owned. Report needed changes as HANDOFF; never rewrite
  them yourself.
- FIRST COMMIT: this work order verbatim as
  docs/work-items/WFX-DEPLOY-W2.md (dated 2026-10-02). The work-items
  index update is TL-owned — do not edit index.md.

## 1. Setup (verify before working)

~~~bash
git clone https://github.com/payswapdotorg/WebFlix.git
cd WebFlix && git checkout main && git log --oneline -1
git checkout -b work/wfx-deploy-w2-host
bun install
bun run typecheck && bun run lint
bun run test            # record the ACTUAL baseline numbers you see
bun run contract-check && bun run lane-check
~~~

Canonical contracts (READ FIRST): apps/web/DEPLOYMENT.md (boot law,
transport table, env law) and docs/infrastructure/deployment.md
(WFX-056 platform record). Service-mode env for your verification runs:
WFX_API_BASE=https://webflix-api.vercel.app ; WFX_DEV_FIXTURES must be
UNSET in every service-mode check (and NEVER set together with
NODE_ENV=production — that combination is a typed HostConfigError).

## 2. Deliverable — host boot law + service mode (REPRODUCED)

- Verify the boot selection law (src/host/config.ts, boot.ts): (a)
  WFX_DEV_FIXTURES=1 + NODE_ENV≠production → fixture ports; (b) unset →
  service ports against WFX_API_BASE; (c) any other combination → typed
  HostConfigError naming the offending variables. Machine-verify (the
  existing host-boot tests) AND behavior-verify in a real booted app.
- Boot the app in service mode against the REAL deployed service:
  `cd apps/web && WFX_API_BASE=https://webflix-api.vercel.app bun run dev`
  and confirm real content flows (no fixtures anywhere in the path).
- Verify NO hidden fixture fallback: grep-level + behavioral — with
  WFX_DEV_FIXTURES unset, a failing/unreachable WFX_API_BASE must
  produce the documented degrade/typed-error behavior, never fixture
  content.

## 3. Deliverable — remote transport contract (real requests)

Against https://webflix-api.vercel.app with REAL requests, verify the
transport mapping (src/host/remote-ports.ts): GET /experience/search?query=,
GET /experience/metadata?ref=, GET /experience/resolve?ref=,
POST /experience/actions, GET+POST /experience/library,
POST /experience/events — with identity headers (x-wfx-user-id,
x-wfx-session-id, x-wfx-locale, x-wfx-region) traveling as HEADERS,
never URLs. Verify the degrade law: read failures (network, non-2xx,
malformed JSON) → empty answer ([]/null); action failures → failed
receipts with transport detail; event delivery failures → typed
HostTransportError thrown (never silent success); 10s request timeout
actually enforced (prove with a hanging endpoint — e.g. a local
black-hole proxy — not just by reading the code).

## 4. Deliverable — playback resolution honesty (the hard gate)

The player must NEVER fake playback. Verify the real resolution path:
- `/player` starts a REAL playback session and renders the RESOLVED
  Media Surface mode: embed iframe / visible browser panel / visible
  external handoff — whichever the service's resolve answer dictates.
- Where content is not embeddable, the documented visible-browser /
  external-handoff behavior must ACTUALLY occur (observable in the
  browser, not just a state string).
- NO fake video element, no placeholder that mimics playback, no
  claimed capability the service did not grant.
- Player failure paths: resolve failure → typed failure state; timeout
  behavior per the transport law; error surfaces honest and actionable.
- Verify with agent-browser in service mode (real resolve answers) AND
  document which mode each exercised content item resolved to. Use the
  deployed production app (https://webflix-steel.vercel.app) as an
  additional real-service reference where useful — but YOUR branch's
  local service-mode boot is the verification target.

## 5. Deliverable — production configuration behavior

- Verify production build behavior: `bun run build` completes with NO
  env vars (nothing env-dependent evaluated at build time); the built
  app in service mode (WFX_API_BASE set, NODE_ENV=production) serves
  real content; the built app WITHOUT WFX_API_BASE fails LOUDLY with
  the typed HostConfigError (visible 500 + server-log detail), never
  silent fixtures.
- Document the exact env posture the Vercel project needs (names +
  source-of-truth pointers; VALUES NEVER in files or commits).

## 6. Gates (must be green at your branch HEAD)

~~~bash
bun run typecheck && bun run lint && bun run test
bun run contract-check && bun run lane-check
~~~
Zero regressions vs the baseline numbers you recorded in §1. If a gate
fails outside your ownership, report it — never patch another lane's tree.

## 7. Completion report (final message)

Produce docs/work-items/WFX-DEPLOY-W2-REPORT.md (commit it): branch +
HEAD SHA; commit list; changed-file list; per-check verdict table
(boot law / transport / resolution / failure paths / production config →
VERIFIED-REPRODUCED / FIXED-<sha> / HANDOFF / UNRESOLVED with evidence
pointers); gates table (actual numbers); HANDOFF list; UNRESOLVED list.
Push the branch, then report the same summary as your final message.
The TL harvests from git truth — unsupported completion claims are
ignored.

Dated: 2026-10-02
