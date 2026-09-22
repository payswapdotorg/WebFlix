# R26-W2 — the real-artwork presentation verification (the browser runs)

All captures are from an `agent-browser` session against the web app booted in
service mode against a **LOCAL verification stub of the Experience API**
(`mini-services/artwork-stub` on port 3199) that serves the artwork contract's
EXACT transport shape — content rows carrying `metadata.thumbnailUrl` with
REAL provider thumbnail URLs (`https://i.ytimg.com/vi/<ref>/hqdefault.jpg`,
the same URLs the YouTube connector's own projection carries from the
provider's API answer) and the production catalog's real YouTube refs.

**HONESTY LAW**: this is a LOCAL verification harness for the PRESENTATION
lane — never a production transport claim. The production transport carriage
(the deployed API's rows actually carrying `thumbnailUrl`) is Worker 1's named
dependency, escalated to the lead. What this run proves is the web lane's
half of the contract: wherever the transport carries artwork, the surfaces
render it as real `<img>` images with the typed fallback law honored.

## What was verified (the DOM evidence)

- **Home**: 10 `[data-wfx-artwork-img]` images (cards + hero), each actually
  loaded from i.ytimg.com (`naturalWidth: 480` — real bytes, not broken
  placeholders), with the deterministic placeholder still rendered beneath
  every image (the fallback floor). The VLM read of `r26-artwork-home.png`:
  "real photographic video thumbnails rather than colored gradient
  placeholders… actual imagery to represent the media content."
- **Search**: the result cards render the real artwork (`loaded: 1/1` for the
  matched item).
- **Item detail**: the detail stage renders the source artwork
  (`https://i.ytimg.com/vi/5SRgdyUsuAg/hqdefault.jpg`, loaded) with the
  readability scrim and the honest fallback-reason sentence when a source
  carries none.
- **The fallback law**: the placeholder monogram ALWAYS renders beneath the
  artwork image in the server HTML; the one-per-shell `ArtworkFallback`
  island hides any image whose URL fails to load so the placeholder shows
  through (never a dead box, never a generated replacement).

## Files

- `r26-artwork-home.png` — the home surface with real thumbnails (hero + rows).
- `r26-artwork-search.png` — the search surface rendering real artwork.
- `r26-artwork-item.png` — the item detail stage with the real source artwork.
- `player-black-stage-before.png` — (context) the reproduced black stage before
  the embed containment fix.
