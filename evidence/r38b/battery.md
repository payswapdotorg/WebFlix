# R38-B — The battery run record (the lane-head gate of record)

The gate run at the lane head (`bun run test` at the lane's shipping
tree, this sandbox):

```
Ran 5359 tests across 311 files. [192.39s]
 5358 pass
 1 skip
 0 fail
 34101 expect() calls
1 tests skipped:
(skip) R11 — the webtorrent evaluation skip honesty > webtorrent native
        prebuilt unavailable in this environment (reason recorded)
```

**The comparison against the packet's floor:** the baseline of record is
5297 tests / 5296 pass / 1 skip / 0 fail (measured at the exact base —
guards.md §1). The lane head answers **5359 / 5358 / 1 / 0** — the base
floor + EXACTLY this lane's 62 lane tests:

- `packages/domain/src/graph/channel-profile.test.ts` — 13 tests (the
  domain-graph seam's laws: the closed vocabulary, the handle grammar,
  the URL guard, the validating constructor's field-level refusals, the
  compose law).
- `apps/web/src/host/studio-store/studio-content.test.ts` — 14 tests.
- `apps/web/src/host/studio-store/studio-moderation.test.ts` — 13 tests.
- `apps/web/src/host/studio-store/studio-profile.test.ts` — 8 tests.
- `apps/web/src/host/studio-store/studio-analytics.test.ts` — 8 tests.
- `apps/web/src/host/studio-store/studio-views.test.ts` — 5 tests.

Zero regressions: no pre-existing test was modified (the only non-owned
product file touched is `journeys/report.test.ts` — the registry-count
guard's mechanical companion, the repo's own convention for every
journey-adding lane; see DIVERGENCES.md row 7).

The other lane-head gates: typecheck clean (both tsconfigs),
contract-check OK (12 frozen blocks, 7 extension types), lane-check OK
(993 files), the scoped lane lint 0 problems, and the full-repo lint
error set byte-identical to the base list (guards.md §5).
