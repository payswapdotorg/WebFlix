# @wfx/recommendation

The Recommendation OS (WFX-021/WFX-041, Lane A) + candidate retrieval
(WFX-020) + QoE telemetry (WFX-041). Pure, deterministic TypeScript: no I/O,
no network, no persistence reads, no hidden clocks, no randomness — the
output of every stage is a pure function of its inputs, and every decision
lands in the auditable `PipelineTrace`.

## The pipeline (R05: seven stages)

```
retrieval (pool intake) -> features -> scoring (injected model) ->
feedback controls (R05) -> policy constraints -> intent-aware diversity ->
feed composition
```

`runRecommendation(ctx, options?)` orchestrates the stages; `options.model`
injects any frozen `RecommendationModel` (the shipped
`createHeuristicModel()` is the deterministic, explainable default — every
term carries its own explanation string); `options.feedback` is the active
profile's reversible control set (below). Models rank candidates; they do
not own policy, persistence, authorization, or provider actions.

## R05 — the feedback controls (os/feedback.ts)

The J15 control vocabulary, consumed as a PURE INPUT (the caller reads the
profile's records from the server and passes them in — the OS never
fetches):

| Control | Target | Effect | Undo |
|---|---|---|---|
| `not-interested` | item | DEMOTE to the very feed tail (below the availability floor, below `already-watched`) — never removed | delete the record; the composition restores byte-for-byte |
| `already-watched` | item | DEPRIORITIZE repeats (tail, above `not-interested`) — recorded history is NEVER touched (the R04 event-sink law) | delete the record |
| `dont-recommend-source` | connector id | EXCLUDE the source's realizations — the item survives via its non-suppressed realizations (realization-level: the dedupe stage picks among survivors only) | delete the record |
| `dont-recommend-creator` | creator id (`creatorId` feature key) | EXCLUDE the creator's candidates — the OS never guesses creators from titles; callers populate the documented feature from source metadata | delete the record |
| `more-like-this` | item | BOOST the anchor's similarity neighborhood (documented token overlap on the candidate text surface — the same tokenizer the intent matcher uses; the anchor itself gains no boost) by `FEEDBACK_MORE_LIKE_THIS_BOOST` (+0.3), carried in `feedbackAdjustment` — the model score is NEVER edited | delete the record |

**The suppression honest note:** a suppressed source/creator is skipped
WITH an explicit `feedback-suppression` trace decision naming the control,
the count, and every skipped candidate — never a silent gap, never an
error.

**The reversibility law (J15):** the feedback stage is a pure function of
the feedback set. Apply a control → the composition changes; delete the
record → the composition restores exactly (tested:
`feedback-controls.test.ts` — "THE REVERSIBILITY LAW"). Structural garbage
in the set throws the typed `RecommendationOSError` naming every problem
before any stage runs.

## R05 — the anti-tunnel guarantee (os/diversity.ts, J16)

After concentrated watching of one topic, composition RETAINS exploration
capability. Three mechanisms, all reorder/swap-only (the pool is never
narrowed — demotion with trace reasons is the only soft-exclusion
mechanism):

1. **Run cap K** — no more than K consecutive cards sharing one dominant
   matched objective: `K(exploration) = 1 + floor((1 - exploration) * 4)`
   clamped to [1, 5], computed from the ATTENTION-ADJUSTED exploration
   dial. Because K <= 5 < the 8-card top block, a same-objective run is
   always broken within the block whenever the pool offers ANY
   alternative — the primary enforcer of the floor.
2. **Top-block concentration + exploration injection** — when the top
   block concentrates beyond `X(exploration) = 80 - exploration * 40`
   percent on one objective, unseen candidates (different objective
   preferred) are swapped in. When no unseen candidates remain, the
   honest `exploration-injection-unsatisfied` residual is recorded.
3. **THE DIVERSITY FLOOR** (`DIVERSITY_FLOOR_MIN_DISTINCT = 2`) — the
   named guarantee: the top block must carry at least 2 distinct dominant
   objectives (or unrelated null-objective cards — they matched no intent,
   so they ARE the alternatives) whenever the pool offers them. The floor's
   enforcement arm (a greedy swap of the highest-ranked different-objective
   candidate into the block) is the BACKSTOP for the run cap — with the
   current cap values the cap itself interleaves first, so the floor's live
   paths are the yield and the honest unsatisfiable residual (named in the
   trace as `diversity-floor` / `diversity-floor-unsatisfiable`).

**The explicit-narrowing yield:** the floor (and the run cap + injection)
yield when the user EXPLICITLY narrowed — a persistent-scope intent with
provenance `explicit` matching the block's dominant objective WHILE the
attention-adjusted exploration dial is at its minimum (0). The provenance
distinction is the whole point: INFERRED persistent intents are what
concentrated watching automatically accumulates (the very tunnel the floor
softens); only the user's own submitted ask (with exploration closed — an
interest with the dial open is an interest, not a narrowing) narrows.
Session/momentary/temporary/social intents never narrow. The yield is
recorded ONCE in the trace (`diversity-floor` decision, "the explicit
narrowing wins"). Mindful mode can never narrow: the mode's exploration
floor (0.6) keeps the dial open by construction.

## R05 — attention modes (os/attention.ts, J18)

Mindful / Balanced / Immersive / Custom are EXPLICIT policy — the system
never silently optimizes for maximum session length when the user selected
another objective. Measurable differences:

- **Mindful** — mandatory diversity gap (run cap 2), session-extending
  chain cap 2, EXPLORATION and NOVELTY dials floored at 0.6 (the mode's
  guarantee — `attentionAdjustedDials` feeds the heuristic model's
  exploration/novelty terms AND the diversity stage's K/X formulas), and a
  DEFAULT 90-minute OS-planned session-extension time budget when the user
  set no explicit `maxSessionExtensionMinutes`. All declared in the trace's
  `attention-policy` decision.
- **Balanced** — the default: dials pass through exactly, chain cap 4.
- **Immersive** — unbounded chains, dials pass through: the user's explicit
  choice of unbroken continuity (declared, unhidden).
- **Custom** — the dials are the user's DIRECT controls (passed through
  exactly) + the policy objectives' maximize/minimize adjustments apply
  (compose with the feedback boost: the custom-mode re-sort key is
  `modelScore + customAdjustment + feedbackAdjustment`).

The heuristic model's exploration/novelty explanations name the adjusted
dial when a mode floor moved it (e.g. "exploration 0.6, attention-adjusted
from 0.2 for mode \"mindful\"") — J18 is auditable end-to-end.

## Telemetry (telemetry/)

`TelemetrySink` (the injected port; `createRecorderSink()` is the in-memory
reference) + the schema-versioned windowed report with privacy redaction —
see `telemetry/*.ts` module docs.

## Determinism / purity laws

Every stage is a pure function of its inputs; identical `(ctx, model,
feedback)` yields an identical `FeedPage`, trace included. No `Date.now`,
no `Math.random`, no network, no persistence. Deterministic seeds only in
tests (`packages/recommendation/tests`).
