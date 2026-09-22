# R26-W2 — the playback-fix verification evidence (the real-provider browser runs)

All captures are from `agent-browser` sessions against the web app booted in
**service mode against the REAL production Experience API**
(`WFX_API_BASE=https://webflix-api.vercel.app`) — real catalog, real YouTube
embeds — plus the deterministic cold-invocation simulations over HTTP.

## The reproduced production failures (before the lane's fixes)

1. **The playback session not-found** (reproduced on live production
   `https://webflix-steel.vercel.app` and re-simulated locally): the page render
   creates the session in ONE serverless invocation's module memory; the
   client's `/api/playback` calls land on other invocations and answer
   `not-found: no playback session 'wfxpses_…' on this host` forever.
2. **01-player-black-stage-reproduced.png** — the embed stage renders BLACK:
   the frozen opaque-origin sandbox (`sandbox` WITHOUT `allow-same-origin`)
   makes the provider's player refuse to render entirely (poster, controls,
   API — all dead).
3. **The literal-phrase search gap**: `/search?q=rainy day lofi` → 0 results
   while "1 HOUR Rainy Day in Airport ✈️ | Cozy Lofi…" is in the catalog
   (reproduced on live production).

## The fixes, verified

1. **02-sandbox-matrix-opaque-vs-same-origin.png** — the empirical matrix
   (injected control iframes on the same page): LEFT = the frozen opaque-origin
   token set (black box, ZERO provider API messages); MIDDLE = the same tokens
   + `allow-same-origin` (the provider's poster + red play button render AND
   the provider's documented embedder API answers: initialDelivery, onReady,
   infoDelivery with playerState/currentTime/duration/volume). The EmbedStage
   now grants the provider-embed family (YouTube) its own origin — never
   WebFlix's — with every other isolation property preserved (disclosed in the
   component's law note + escalated for lead ratification).
2. **03-player-poster-rendered-after-fix.png** — the player page after the fix:
   the provider's real player renders (poster + its own Play button) and the
   control handshake is LIVE — the chrome received the provider's own duration
   evidence (4:29:06 for the documentary, 0:19 / 0:34 for the shorts) and the
   volume cluster rendered (the honest realization-exposed binding).
3. **The stateless command mapping (deterministic cold-invocation simulation)**:
   - `POST /api/playback {sessionId: <an id no invocation ever saw>, command:
     "play"}` (no intent) → `not-found … on this host` — the reproduced
     production failure, byte-for-byte.
   - The same POST **with the client-carried intent** → `ok: true` + the real
     re-resolved session state (through the SAME frozen resolve path against
     the REAL production API).
   - A follow-up seek on the same id → accepted at 4200 ms (the runtime's
     position-evidence law); the GET state read with the flat intent params
     returns the same truthful state.
4. **The tokenized-phrase search recovery (against the REAL production API)**:
   `/search?q=rainy day lofi` → 9 honest token matches led by the exact title
   the dossier named, with the disclosure note ("No title contains the whole
   phrase … these matches contain the words "rainy", "day", "lofi" in any
   order.").

## The honest remaining failure (classified, never papered over)

**04-provider-anti-bot-interstitial.png / 05-provider-refusal-honest-buffering.png**
— from this datacenter network context, YouTube's embed player answers every
play attempt (WebFlix's chrome Play dispatching `playVideo`, or the provider's
own in-frame button) with the "Sign In to confirm you're not a bot"
interstitial. Classification: **provider restriction** (the provider's
anti-bot control over embedded playback from this network context). It is
never bypassed (the frozen provider-controls law); the chrome honestly stays
in the evidence-backed `buffering` phase — no fabricated progress, no fake
success. The architecture is verified end-to-end up to the provider's own
refusal: stage rendering, live control channel, real evidence flow, session
command execution, honest typed states. The first frame in a
provider-permitting context (a residential browser session, or the lead's
production verification after deploying this lane) completes the proof.
