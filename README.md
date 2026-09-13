# WebFlix

WebFlix is the Universal Entertainment OS: a user-controlled interface for discovering, recommending, and consuming entertainment across connected media platforms, native media sources, social video, local libraries, and authorized torrent sources.

This repository currently contains the frozen architecture and implementation governance package. Product implementation must follow the repository contracts before feature code is introduced.

## Governance

- Canonical architecture: `docs/architecture/webflix-frozen-architecture.md`
- Boundary contracts: `docs/architecture/contracts.md`
- Dependency graph and worker lanes: `docs/architecture/dependency-graph.md`
- Implementation roadmap: `docs/plans/2026-09-13-webflix-implementation-plan.md`
- Tech lead runbook: `docs/handoff/tech-lead-handoff.md`
- Work-item index: `docs/work-items/index.md`
- Product and safety boundaries: `docs/architecture/product-boundaries.md`

## Non-negotiable implementation rule

Do not implement provider-specific behavior in the product core. All external sources must conform to the connector contract and expose their real capabilities. Protected-provider playback, DRM, authentication, rate limits, and platform rules must never be bypassed.

## Content boundary

Native acquisition and background downloading are designed for user-owned, licensed, public-domain, Creative Commons, or otherwise authorized media. The architecture must not depend on infringing catalogs or provider-control circumvention.
