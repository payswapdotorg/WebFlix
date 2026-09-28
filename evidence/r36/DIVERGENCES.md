# R36 — THE HONEST-DIVERGENCE LEDGER (WebFlix-real vs the corpus)

Every row: the captured/expected YouTube grammar (cited from the parity-lab
corpus + the survey), WebFlix's real truth (cited), and the honest resolution.
Classes: `HD` honest-divergence (WebFlix's real surface differs, by law) ·
`CLOSED` a survey row this lane closes. The frozen laws hold throughout: honest
identity, capability truth both directions, never a fabricated count/image/state.

1. **[CLOSED] Survey row 17 — creator channel pages.** The #1 structural gap
   ("no `/channel`/`@handle` route exists anywhere in the tree" — the survey's
   own evidence column) is closed: `/channel/[handle]` renders the full page
   grammar (banner · avatar + name + Subscribe + bell · the five-tab bar · the
   channel search field), honestly bound (the derivation law, below).

2. **[HD] The banner.** YouTube's channel banner is the creator's own uploaded
   art. WebFlix's sources declare NO channel banner (no ServerPort seam carries
   one) — the page renders the TYPED-ABSENCE strip with its honest sentence, or
   DERIVED ART built ONLY from the source's own item artwork (the
   `contentArtworkOf` seam) when a channel's items carry real thumbnails. Never
   a fabricated image. (The fixtures boot carries no artwork — the absence strip
   is the fixtures' honest truth; the derived-art arm activates where a source
   serves item art.)

3. **[HD] The avatar.** YouTube renders the creator's channel photo. WebFlix's
   sources declare no channel photo — the honest MONOGRAM (the name's own first
   mark, the same stand-in the watch channel row, the search result avatar, and
   the rail subscriptions carry — the R33-C law extended to the 80px channel
   slot).

4. **[HD] The subscriber count.** YouTube renders "1.23M subscribers". No
   reachable seam declares a channel's subscriber count on this host (the
   sources model carries none; the YouTube connector's service-side
   channel-summary projection is not surfaced through the ServerPort) — the
   count slot renders the typed absence ("This source declares no subscriber
   count — WebFlix never fabricates one") PLUS the user's OWN subscription
   truth ("Subscribed (you)"). The R28 law verbatim. (A future source-declared
   count binds to the same slot — the `ChannelIdentity.subscriberCount` type
   carries the declared arm.)

5. **[HD] The verified badge.** Source-declared only — no source on this host
   declares a verification claim, so no checkmark renders (never a fabricated
   one). The About tab names the absence.

6. **[HD] The @handle form.** YouTube's handles are creator-chosen @names.
   WebFlix's honest handle is the slugified STABLE CONNECTOR ID
   (`fake-source` → `/channel/fake-source`) — never a fabricated "@name" form
   (the R33-C corpus note's own law: "WebFlix's sources carry display names,
   not handles"). The handle is pure and stable — links stay durable.

7. **[HD] The join date.** YouTube renders "Joined Mar 2019" (the channel's
   creation date). WebFlix's honest analog is the source's OWN connection truth
   — `authorizedAt` (the authorization grant instant) rendered as "Connected
   since <date> (this source's own connection date — never a fabricated 'Joined'
   claim)". Typed absence when the source declares none.

8. **[HD] Community tab.** The survey's row-17 tab list includes Community —
   the corpus grammar's tab set for channels WITH a community surface. WebFlix
   has no community-posts transport (the survey's row 26 gap — a later wave);
   the tab is honestly ABSENT from the tab bar (the SearchFilters law: an
   option without real backing never renders).

9. **[HD] The Videos-tab sort.** YouTube offers Latest/Popular/Oldest over real
   publish dates and view counts. WebFlix's options derive from the items' OWN
   declared metadata (`publishedAt`/`viewCount` in the source's item rows,
   validated): the fixtures source declares neither — all three sort options
   are honestly absent with the note ("This source declares no publish dates or
   view counts — the channel's own feed order is shown"), and the service-mode
   YouTube connector's item metadata (which DOES carry both) lights the options
   up through the same derivation. An unbacked sort in the URL honestly falls
   back to the feed order.

10. **[HD] The bell's delivery.** YouTube's bell schedules real notifications.
    WebFlix's bell records the user's per-channel preference (All/Personalized/
    None — persisted in the browser's own local store, the same honest local
    transport the reactions store uses) and the menu states the delivery truth
    honestly ("No notification source is connected on this host yet — your
    preference is recorded and will bind when delivery lands") — never a dead
    imitation. The delivery surface is the survey's row-19/R40 wave.

11. **[HD] The channel's "videos" count.** YouTube's count is the channel's own
    declared upload count. WebFlix's count is DERIVED from the channel's own
    surfaced items (the discovery-seed hits scoped to the connector — real
    items, counted honestly) and the About tab names the derivation ("counts
    derived from this channel's own surfaced items (never fabricated)").

12. **[CLOSED] Survey row 18 — search channel results.** The search surface
    grows the channel-results section above the item results: the avatar, the
    name (a real link to the channel page), the honest subscriber truth, the
    description snippet (the identity's own honest state — the fixture source
    declares none, so the snippet is the honest absence sentence, never
    invented copy), and the INLINE SUBSCRIBE (the same one-store write). No
    channel match ⇒ the section is honestly ABSENT (never a fake row) — the
    "rain" query (item matches, no channel match) proves it.

13. **[CLOSED] Survey row 10 — subscribe composes.** The watch page's Subscribe
    (landed R29-B/R30) composes with the channel surface: the channel page's
    pill writes the SAME frozen `Subscriptions` list through the SAME
    `POST /api/library` seam (one store, one write path — never a second
    store), keyed on the channel's representative item (the channel's own first
    feed item — a real, honest key), with the channel's truth read as the
    CONNECTOR-scoped fold of the same list. The Library's playlists section and
    the rail subscriptions render the same entries.

14. **[HD] The card channel-slot link (the stretched-link law).** YouTube's
    card is a `ytd-video-renderer` with ONE stretched title link + separate
    channel-link overlay. WebFlix adopts the same DOM grammar (the card visual
    becomes a plain element; the ONE play anchor stretches over the lockup via
    `::after`; the channel slot is its own real link layered above it) — HTML
    forbids the naive nested-anchor form, and the corpus's own pattern is the
    honest answer. `a[data-wfx-card]` + aria-label stay EXACTLY ONE per card
    (the journeys' finder contract holds), and the R33-C display-name seam is
    unchanged (the link is additive).

15. **[HD] J44 vs the survey's "J43".** The survey's WAVE R36 names its new
    journey "J43 (channel browse/subscribe round trip)" — but J43 is ALREADY
    the R25-W2 realtime-translation journey, encoded and accepted at base
    (`journeys/web/j43-realtime-translation.ts`, the R25 acceptance record).
    Renaming an accepted journey would regress its acceptance record and
    requires docs/ edits outside this lane's allowed paths — the channel
    journey is encoded as **J44** (the next free catalog number), the collision
    documented here + in the registry test + the journey's own header.
