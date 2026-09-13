# WebFlix Dependency Graph and Three-Worker Model

```text
WFX-001
  ├─> WFX-002 ──> WFX-010 ──> WFX-020 ──> WFX-021 ──> WFX-031/032
  │        └────> WFX-011 ────────────────┘
  ├─> WFX-003 ──> WFX-012 ──> WFX-013 ──> WFX-022
  │                                  └────> WFX-020
  ├─> WFX-004 ──> WFX-014 ──> WFX-015 ──> WFX-023 ──> WFX-024
  └───────────────────────────────> WFX-005 ──> WFX-025 ──> WFX-026
                                                   ├─> WFX-027
                                                   └─> WFX-028
WFX-022 + WFX-024 + WFX-005 ──> WFX-029
WFX-030 ──> WFX-031/032/033
WFX-026..029 ──> WFX-040
WFX-021 + WFX-025 + WFX-027 + WFX-028 ──> WFX-041
WFX-040 + WFX-041 ──> WFX-042 ──> WFX-043
```

## Lane A — Intelligence

Owns WFX-010, 011, 020, 021, 030, 031, 032, 033, 041.

Private paths: `packages/domain/graph/**`, `packages/domain/intent/**`, `packages/recommendation/**`, `packages/model-fabric/**`.

## Lane B — Sources / Native Media

Owns WFX-003, 004, 012, 013, 014, 015, 022, 023, 024.

Private paths: `packages/connectors/**`, `packages/native-media/**`, `packages/actions/**`.

## Lane C — Experience / Clients

Owns WFX-005, 025, 026, 027, 028, 029, 040.

Private paths: `packages/experience/**`, `apps/web/**`, `apps/desktop/**`, `apps/mobile/**`.

## Lead-only

WFX-001, contract changes, dependency upgrades affecting multiple lanes, architecture changes, WFX-042, WFX-043.

## Parallel execution rule

Only WFX-001 is mandatory first. WFX-002/003/004 can then run independently. Once those are green, the three lanes fan out. Workers communicate through versioned interfaces and fixtures, not private imports.
