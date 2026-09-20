# WebFlix Golden Journey Run — Evidence Summary

- commit: `e2429b4f6e7e0874864cc47a975c7bbc88453ded`
- branch: `wfx/r22/integration`
- environment: web-fixtures @ http://localhost:3101
- window: 2026-09-20T17:10:03.254Z → 2026-09-20T17:10:42.081Z

**0 passed · 1 failed · 0 not-run (listed with procedures) · 1 total**

| Journey | Title | Status | Assertions | Artifacts |
|---|---|---|---:|---:|
| J36 | Major user journey completion / no dead-end discovery | **FAIL** | 18 | 3 |

## Explicit limitations (never silent skips)

- **J36** (configuration-limit): The R22-G encoding runs the full J36 completion walk over the deterministic fixtures boot: the register round trip uses the scripted dev persona (the loud dev badge — the REAL /api/auth/register transport's email-taken/validation round trips are service-mode, proven at the contract level by packages/client-runtime/tests/account-creation.test.ts); the source chooser's connected truth and the BYOF import ride the fixture connectors (the REAL provider OAuth dance is J14/J28's service-side procedure); the Shorts like/save typed absence is the fixture source's own capability truth (the hydration law is asserted as capability-truth, not blanket presence).
  - procedure: LEAD (the production sweep): deploy the integrated tree, run this journey with --base-url against the deployed service-mode boot (real register transport, a real connectable connector, a source that declares like/save), and capture the evidence under evidence/r22/ — the J35 production-parity sweep covers the same deployment.

## Failures

- **J36 Major user journey completion / no dead-end discovery**: journey assertion failed: the authorized import preview renders (preview before confirm — the provenance law)
  expected: [data-wfx-byof-preview] present in the DOM
  observed: 0 matching element(s)
