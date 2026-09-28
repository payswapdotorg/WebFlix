# R38-B — THE HONEST-DIVERGENCE LEDGER (WebFlix-real vs the task packet's claims + the corpus)

Every row: the expected claim (the task packet / the survey / the
YouTube grammar), WebFlix's real truth at this base (cited), and the
honest resolution. Classes: `HD` honest divergence (recorded, never
fabricated) · `ENV` environmental (the box's ceiling, proven
base-identical) · `PRECEDENT` a mechanical companion change carried by
the repo's own convention.

1. **[HD] "The R36 channel page then renders the customized truth" (the
   packet's CUSTOMIZATION LAW) — NOT achievable inside this lane's
   ownership at this base.** The channel page's read path is
   `loadChannelView` → `host.runtime.sources.refresh()` → the
   ServerPort's `readSources` (packages/client-runtime/src/sources.ts:292–350)
   + the runtime's search transport; the identity derives ONLY from
   `SourceInfo` + the channel's items (channel-views.ts:406–468 — the
   description is the hardcoded typed absence at :450–453). There is NO
   seam through which a profile edit can flow into `/channel/[handle]`'s
   render without editing R36's files (channel-views.ts /
   ChannelSurface.tsx / the channel route — read-only for this lane) or
   the frozen client-runtime/ServerPort (outside the lane). The packet's
   §2 premise ("the R36 channel-profile entity
   `packages/domain/src/graph/**`") is factually off at this base: NO
   channel-profile entity exists in the domain graph (grep: zero matches
   at base) — R36's channel profile is a web-host derivation. **The
   honest resolution:** this lane BUILDS the write path the packet
   wanted to exist (the additive `channel-profile` seam in the domain
   graph — the validated `ChannelProfileEdit` record + the pure
   `composeChannelProfile` overlay law, packages/domain/src/graph/
   channel-profile.ts), persists real reload-durable state through it
   (`wfx-studio-profile-v1`), renders the customized truth through the
   studio's composed preview (base + edit, the graph seam's overlay),
   proves the R36 read surfaces stay byte-compatible (J44 PASS 57 at the
   lane head — J48 §10 asserts the derived truth still renders), and
   documents the ONE-PLACE merge-time binding for the Lead:
   *`channelIdentityOf`'s return in channel-views.ts:440–467, overlaid
   with `composeChannelProfile(base, readStudioProfileEdit(connectorId))`
   — the exact compose the studio's preview already performs.* Never a
   fabricated J48 claim that the channel page shows the customization.

2. **[HD] The pin's watch-surface rendering.** The studio's PIN is real
   persisted moderation state (the `wfx-studio-moderation-v1` record,
   one per video; the studio renders the pinned thread first with the
   badge — J48 asserts it live). The watch surface's pinned-badge slot
   (CommentsSection.tsx:177–178 — "the pinned-badge slot (the corpus
   grammar; never fabricated)") does not read the moderation record at
   this base: the R28 file is frozen for this lane. The binding (a
   read of the moderation record in the row's badge slot) is the
   merge-time compose; recorded here, never claimed otherwise.

3. **[HD] The draft's catalog publish.** YouTube Studio publishes
   drafts into the creator's channel. WebFlix's catalog write seam is
   the R38-A upload lane (CONCURRENT — not at this base; the packet's
   own law: "R38-A is building the local-catalog write seam
   CONCURRENTLY — it is NOT yours"). The studio's draft/scheduled
   records are real persisted state that NEVER enter the catalog (no
   search/home/channel exposure); the scheduled state's note names the
   upload wave honestly (the bell-menu honest-later-wave vocabulary).
   The store's read seam composes with a future uploaded-items source
   by design (the published set resolves through the runtime's own
   discovery seams — `loadChannelView` — never a parallel catalog).

4. **[HD] The studio's channel binding.** YouTube Studio manages the
   signed-in creator's own channel. WebFlix has no server-side creator
   identity at this base (no studio service in apps/api; the dev persona
   is a scripted fixture). The honest binding: the studio manages THE
   CATALOG'S OWN CHANNEL (the fixtures boot's one real source), the same
   channel R36's page renders, resolved through R36's own read seams —
   and the studio's header says exactly that (the binding note names
   "the one channel this WebFlix host's catalog carries" + the
   local-transport truth), never a fabricated "your account's channel"
   claim.

5. **[ENV] J36 on this box.** The full J36 walk (the heaviest journey —
   it compiles nearly every route) is OOM-killed by the kernel at
   ~2.3GB server RSS on THIS sandbox (4.16GB total with the co-resident
   preview stack): `Out of memory: Killed process … next-server …
   anon-rss:2323020kB`. **Proven base-identical:** the same journey at
   the exact base commit (an isolated worktree) fails the same way
   (`anon-rss:2311916kB`, the same connection-refused class) —
   `journeys-affected/logs/j36-base-worktree.log`. The lane's best runs
   reach 40/45+ passing assertions (register → sources → BYOF →
   personalize → item → shorts → the BYOM walk). This is the R35b
   merge-record's documented environmental class (the Lead sandbox's
   own ceiling — evidence/r35b-merge-journeys/merge-verification.md),
   never a product regression of this lane (the lane adds five lazy
   routes J36 never visits).

6. **[ENV] The affected-journey sweep is chunked.** The single-run
   full battery exceeds this box's ceiling (the same class); the sweep
   ran as order-preserving chunks (the acquisition chain J21–J24+J26
   together — the runner's own guard) with the browser pool cleaned
   between chunks. The full per-chunk runner outputs are committed
   (journeys-affected/logs/) and the verdict table is
   journeys-affected/summary.md. The runner's default evidence dir
   (evidence/r16) was restored to its base state after the sweep — this
   lane's evidence lives ONLY under evidence/r38b/ (the lane law).

7. **[PRECEDENT] journeys/report.test.ts (the registry guard).** The
   registry-integrity test pins the encoded-journey count (42 at base).
   The additive J48 registration makes it 43; the guard's update (42→43
   + the J48 clause) is the mechanical companion every journey-adding
   lane has carried (git log journeys/report.test.ts: the R20-E, R22-G,
   R23, R24-W2, R25-W2, and R36 lanes each updated it for their
   journey). The file is otherwise untouched.

8. **[HD] The lint baseline.** `bun run lint` at the pristine base
   fails with 33 errors, ALL outside this lane (evidence probe scripts,
   apps/api local-dev tests, apps/desktop scripts, one apps/web test,
   torrent-engine fixtures — the full list frozen in guards.md §3).
   The merged lanes' gates of record (R35b/R36) list battery +
   typecheck + contract-check + lane-check and describe lint as
   *lane-clean* (scoped). This lane's obligation matches that
   convention: every file the lane adds lints CLEAN (verified), and the
   full-repo error set is BYTE-IDENTICAL to the base list (diff-verified
   at the lane head).
