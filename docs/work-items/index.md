# WebFlix Work Item Registry

The complete implementation backlog is the WFX registry below. Each item has one owner lane and explicit dependencies in the implementation plan. GitHub issue titles use WFX IDs where the repository connector permits issue creation; the repository files remain canonical so no work item is lost to tooling limitations.

| ID | Work item | Lane | Dependencies |
|---|---|---|---|
| WFX-001 | Repository governance + CI baseline | Lead | — |
| WFX-002 | Shared domain types + event envelope | Lead/A | 001 |
| WFX-003 | Connector SDK | B | 001,002 |
| WFX-004 | Native media service contract | B | 001,002 |
| WFX-005 | Experience API shell | C | 002,003,004 |
| WFX-010 | Entertainment Graph | A | 002 |
| WFX-011 | Intent Graph | A | 002 |
| WFX-012 | Connector registry + secure credentials | B | 003 |
| WFX-013 | Reference read-only connector | B | 012 |
| WFX-014 | Native media engine adapter | B | 004 |
| WFX-015 | Local HTTP range/media gateway | B | 014 |
| WFX-020 | Candidate retrieval/index | A | 003,010,011 |
| WFX-021 | Recommendation OS | A | 010,011,020 |
| WFX-022 | External action synchronization | B | 012,013 |
| WFX-023 | Deadline-aware playback scheduler | B | 014,015 |
| WFX-024 | Background completion + storage | B | 023 |
| WFX-025 | Media Surface resolver | C | 003,005 |
| WFX-026 | In-app browser surface | C | 025 |
| WFX-027 | Long-form Watch Feed | C | 005,021,025 |
| WFX-028 | Short Feed | C | 005,021,025 |
| WFX-029 | Library/history client | C | 005,022,024 |
| WFX-030 | Model Fabric | A | 002 |
| WFX-031 | WebFlix recommendation model | A | 021,030 |
| WFX-032 | BYOM adapter | A | 021,030 |
| WFX-033 | Media transformation tools | A | 030 |
| WFX-040 | Cross-platform clients | C | 026-029 |
| WFX-041 | QoE + recommendation telemetry | A | 021,025,027,028 |
| WFX-042 | Security/privacy audit | Lead | Production features |
| WFX-043 | Release acceptance | Lead | 040-042 |

## Assignment rule

A worker receives one or more WFX IDs only within its lane. The worker may not create a new shared dependency, change a frozen contract, or edit another lane's private paths without lead approval.

## GitHub issue status

Current issue-backed work items: WFX-001 -> issue #1, WFX-002 -> #2, WFX-003 -> #3, WFX-004 -> #4. The remaining WFX items are fully defined in the repository plan/registry and should be materialized as issues by the tech lead when GitHub issue mutation is available in the execution environment.
