# WebFlix Golden Journey Run — Evidence Summary

- commit: `b4cf97be8fae95f92d7aa0c64a9e275425b0b530`
- branch: `wfx/r22/integration`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-20T17:22:40.309Z → 2026-09-20T17:25:01.921Z

**0 passed · 1 failed · 0 not-run (listed with procedures) · 1 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J36 | Major user journey completion / no dead-end discovery | **FAIL** | 43 | 0 |

## Explicit limitations (never silent skips)

- **J36** (configuration-limit): The R22-G encoding runs the full J36 completion walk over the deterministic fixtures boot: the register round trip uses the scripted dev persona (the loud dev badge — the REAL /api/auth/register transport's email-taken/validation round trips are service-mode, proven at the contract level by packages/client-runtime/tests/account-creation.test.ts); the source chooser's connected truth and the BYOF import ride the fixture connectors (the REAL provider OAuth dance is J14/J28's service-side procedure); the Shorts like/save typed absence is the fixture source's own capability truth (the hydration law is asserted as capability-truth, not blanket presence).
  - procedure: LEAD (the production sweep): deploy the integrated tree, run this journey with --base-url against the deployed service-mode boot (real register transport, a real connectable connector, a source that declares like/save), and capture the evidence under evidence/r22/ — the J35 production-parity sweep covers the same deployment.

## Failures

- **J36 Major user journey completion / no dead-end discovery**: harness/browser failure: agent-browser command failed (-1): wait [data-wfx-session-signed-out]
✗ CDP command timed out: Runtime.evaluate

proc: timed out after 20000ms
