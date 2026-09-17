# @wfx/recommendation

The Recommendation OS (WFX-021, Lane A — intelligence) plus candidate
retrieval (WFX-020) and QoE telemetry (WFX-041). The OS is PURE
TypeScript: every stage is a deterministic function of
`(RecommendationContext, model, options)` — no I/O, no hidden clocks, no
randomness; every ordering decision lands in the auditable
`PipelineTrace`.

## The pipeline

```text
retrieval (pool intake) -> features -> scoring (injected model) ->
[R05: feedback controls] -> policy constraints -> intent-aware diversity ->
feed composition
```

`runRecommendation(ctx, options?)` orchestrates the stages; `options.model`
injects any frozen `RecommendationModel` (the default is the shipped
deterministic heuristic) and `options.feedback` (R05) passes the active
profile's feedback control records.

## R05 — feedback, suppression, anti-tunnel semantics

### The J15 control vocabulary (`os/feedback.ts`)

`more-like-this` | `not-interested` | `dont-recommend-source` |
`dont-recommend-creator` | `already-watched` — typed, per-profile,
timestamped, REVERSIBLE records (`RecommendationFeedbackRecord`). Applied
by `applyFeedback` between scoring and policy:

- **`not-interested`** (item target): the item is EXCLUDED from the
  composed feed with a `feedback-not-interested` trace decision naming it.
  This is the one feedback semantic that removes a card — the user said
  "not interested" — and it is fully reversible: undoing the control
  restores the candidate exactly (determinism guarantees byte-equal
  restoration).
- **`dont-recommend-source`** (connector target): every pool candidate
  whose realization belongs to the suppressed source is SKIPPED with an
  honest note (`feedback-suppressed-source`) — never a silent gap, never an
  error. An item that also has a non-suppressed realization still surfaces
  (the dedupe keeps the surviving realization).
- **`dont-recommend-creator`** (creator target): every candidate carrying
  the documented `creatorId` feature equal to the suppressed creator is
  skipped with the same honest-note law. Candidates without the feature
  are never suppressed — the OS never guesses a creator.
- **`already-watched`** (item target): the item is DEMOTED to the tail
  (`feedback-already-watched`) — repeats are deprioritized WITHOUT deleting
  history and WITHOUT excluding the item (a rewatch is a legal user
  action).
- **`more-like-this`** (item target): the target's SIMILARITY
  NEIGHBORHOOD — candidates whose text surface shares an objective token
  with the target's, or whose dominant matched objective equals the
  target's — is BOOSTED above non-neighbors (stable reorder, incoming order
  preserved within the group, `feedback-more-like-this` traced). Model
  scores are never touched.

**The event-sink law (R04, preserved):** feedback never deletes or
falsifies recorded viewing events — `event_outbox`/`watch_history` are
immutable audit truth; feedback shapes future candidate composition only.
At the API layer this is pinned by test: feedback operations leave the
outbox byte-identical.

### The anti-tunnel guarantee (J16 — the diversity floor)

After concentrated watching of one topic, the composition RETAINS
exploration capability:

1. **The pool never narrows.** The pipeline output is a permutation of the
   candidate pool (feedback exclusions aside — an explicit user control).
   No number of same-topic watches can remove candidates from the feed.
2. **Fatigue demotes repeats.** Watched items accumulate negative fatigue
   terms (`os/fatigue.ts`) — a watch is one signal, never identity; every
   UNWATCHED candidate ranks above every watched one in the concentrated
   scenario (test-pinned).
3. **The top block never over-concentrates.** The diversity stage
   (`os/diversity.ts`) caps the top-block concentration on the DIVERSITY
   KEY at `X(exploration) = 80 − exploration·40` percent and swaps UNSEEN
   candidates into concentrated blocks (`exploration-injection` decisions);
   when no unseen candidates remain below the block, the residual is
   recorded honestly (`exploration-injection-unsatisfied`) — never a fake
   success, never a narrowed pool.
4. **Runs cap at K(exploration) = 1 + ⌊(1 − exploration)·4⌋.** The run cap
   and concentration machinery key on the DIVERSITY KEY: the dominant
   matched INTENT objective when one matched, else the documented `topic`
   candidate feature (R05) — so WATCH-DRIVEN concentration (no intents,
   pure topic watching — the J16 scenario) is subject to the same floor,
   not just intent-driven runs. A same-topic tail with no alternatives
   left is the designed honest `objective-run-unsatisfiable` residual
   (placed, traced, never deleted).
5. **Only an explicit user action may narrow.** A persistent narrow intent
   (plus custom mode with the exploration dial lowered) may concentrate
   the feed — that is the user's explicit choice; the pool STILL never
   narrows.

### Attention modes are policy, not cosmetics (J18)

Mindful / Balanced / Immersive / Custom change MEASURABLE behavior
(`os/attention.ts` + `os/policy.ts`):

| Mode | Exploration floor | Time budget | Novelty weighting | Chain cap |
|---|---|---|---|---|
| `mindful` | effective exploration never below `MINDFUL_MIN_EFFECTIVE_EXPLORATION` (0.5) | own default `MINDFUL_DEFAULT_SESSION_EXTENSION_MINUTES` (60) when unset; larger explicit caps narrowed to it | `MINDFUL_NOVELTY_RANK_WEIGHT × freshness` rank boost (traced) | 2 |
| `balanced` | the raw dial | explicit cap only | none | 4 |
| `immersive` | the raw dial | explicit cap only | none | unbounded |
| `custom` | the raw dial | explicit cap only | none (the user's objectives apply) | unbounded |

The system never silently optimizes for maximum time spent when another
mode is selected: mindful derives its own OS-planned-extension budget
(`attentionSessionExtensionBudget`), floors the diversity machinery's
effective exploration, and rank-boosts fresh content (`attention-novelty-
weighting` trace decisions; model scores verbatim). The same context
composed under mindful vs immersive produces MEASURABLY different feeds
(test-pinned: fresh-above-stale ordering, `session-extension-cap` stops,
and different end-to-end card order).

### R05 documented candidate feature keys

Graph-aware callers populate them from the Entertainment Graph; the OS
never guesses:

- `topic` — the anti-tunnel diversity key when no intent matched.
- `creatorId` — the `dont-recommend-creator` feedback target.

(Alongside the WFX-021 keys `publishedAt` / `nextEpisodeOf`.)

## Determinism

No stage performs I/O, reads a hidden clock, or touches randomness — the
only time source is the ctx's own event timestamps, and every ordering
decision is total. Identical `(ctx, model, options)` yields an identical
`FeedPage`, trace included — which is what makes REVERSIBILITY testable:
control applied → composition changes → control undone → composition
restores byte-for-byte.
