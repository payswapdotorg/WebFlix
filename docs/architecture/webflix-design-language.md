# WebFlix Visual Design Language — ShareNet-Inspired

**Status:** FROZEN INPUT TO R21 IMPLEMENTATION  
**Reference:** https://sharenet-conformance.vercel.app  
**Source:** https://github.com/pectoraux/ShareNet

## Intent

WebFlix should feel calm, trustworthy, spacious, and product-first rather than like a dark streaming clone or an engineering dashboard.

The ShareNet reference contributes the visual language; WebFlix keeps its own entertainment identity, content composition, playback behavior, and source-neutral semantics.

Do not copy ShareNet branding, copy, icons, connection-ring imagery, or information architecture.

## Visual principles

### Warm-light foundation

Use a warm off-white page background rather than pure white, with soft graphite foreground text.

Preferred characteristics:

- warm, slightly tinted neutrals;
- subtle surface separation rather than heavy shadows;
- hairline borders;
- cards that are only slightly brighter than the page;
- dark text that is softer than absolute black.

The existing WebFlix dark visual treatment may remain available where product-specific playback or immersive media context requires it, but ordinary management/discovery surfaces should adopt the calm ShareNet-inspired light register unless a product decision explicitly requires another mode.

### Typography carries hierarchy

Use whitespace, type scale, weight, and grouping to communicate importance.

Avoid:

- oversized marketing typography that overwhelms content;
- dense dashboard grids;
- decorative labels everywhere;
- excessive badges;
- visually noisy source/protocol metadata.

Primary copy should be plain-language and action-oriented.

### One clear primary action

Surfaces should have one obvious primary action and subordinate secondary actions.

Prefer rounded/pill primary controls for high-intent actions and restrained outline/text controls for secondary actions.

Do not create equal-weight button clusters.

### Quiet surfaces

Avoid glassmorphism, neon, gratuitous gradients, and heavy drop shadows.

Entertainment artwork may be visually rich inside content/media regions, but the surrounding application chrome should remain calm so content and decisions remain legible.

### Semantic state color

Borrow ShareNet's semantic state approach:

- teal/green family: connected, ready, confirmed, healthy;
- amber: recovering, degraded, pending, requires attention;
- red: failed, unavailable, destructive;
- neutral: idle, disconnected, unsupported, not yet configured.

State color must always be paired with text, iconography, shape, or weight. Never communicate state by color alone.

### Navigation

Keep the WebFlix primary navigation compact:

Home / Watch / Shorts / Search / Library / Settings

Desktop may use a restrained fixed rail inspired by ShareNet's sidebar proportions.

Mobile should use a compact top header plus bottom navigation with comfortable touch targets.

Active navigation should use a subtle filled/pill treatment rather than a loud underline or high-contrast block.

### Generous whitespace

Prefer comfortable vertical rhythm and intentional empty space.

Use spacious page headers, centered empty/error states, and visually distinct sections rather than cramming every capability above the fold.

This is particularly important for:

- Home;
- onboarding;
- intent selection;
- source connection;
- feed import;
- Model & AI;
- empty Library states;
- playback recovery;
- acquisition/offline states.

### Calm empty/error/loading states

Follow the ShareNet pattern of a centered, readable state explanation:

icon -> concise headline -> one-sentence explanation -> one useful action.

Do not dump raw service errors, protocol errors, stack details, or transport identifiers into ordinary product surfaces.

Advanced diagnostics remain accessible through progressive disclosure.

Skeletons should mirror the final layout so loading does not visually jump between unrelated structures.

### Motion

Motion should explain state transitions, not decorate them.

Allowed patterns include:

- subtle active-nav transitions;
- restrained surface transitions;
- lightweight progress/state animation;
- short contextual feedback.

Every animated interaction must respect the browser's reduced-motion preference.

### Content-first entertainment adaptation

ShareNet's sparse visual hierarchy must be adapted to WebFlix rather than copied literally.

WebFlix-specific composition:

- rich media artwork and thumbnails may be expressive;
- content rows remain visually scannable;
- playback surfaces can enter a more immersive mode;
- recommendation controls remain quiet until invoked;
- source/provenance labels are compact;
- contextual controls appear near the decision they affect;
- media should remain the strongest visual object on content surfaces.

### Trust and truth styling

Capability truth should feel like product information, not a developer console.

Examples:

- “Available offline in Desktop” is preferable to a raw native-media capability diagnostic;
- “Playing through the current source” is preferable to exposing internal connector IDs;
- “Saved in WebFlix — source sync pending” is preferable to a transport-state code;
- “This title isn't playable here” should offer the next supported realization where possible.

### Density

Use a default comfortable density.

Compact layouts are appropriate for:

- navigation;
- small source/feed status rows;
- inline playback controls;
- library metadata;
- advanced diagnostics.

Do not make the main entertainment experience feel like an admin panel.

## ShareNet-inspired acceptance criteria

A WebFlix surface fails visual review when it:

- defaults to noisy dark dashboard styling without a product reason;
- relies on gradients/glass/neon for hierarchy;
- uses multiple competing primary CTAs;
- exposes raw engineering diagnostics before the user-facing explanation;
- communicates important state only through color;
- feels cramped because whitespace was removed to fit more controls;
- ignores mobile touch target sizing;
- animates without a reduced-motion path.

A WebFlix surface passes when it feels calm and premium, the primary decision is obvious, the state is understandable in plain language, and content remains visually dominant.

## Reference implementation evidence

The ShareNet source implements its consumer shell with scoped warm-light OKLCH tokens, semantic connected/warning/error/neutral state tokens, hairline borders, rounded/pill controls, typography-driven summaries, centered empty/error/loading states, a compact desktop rail/mobile bottom navigation, and reduced-motion-aware active-navigation motion.

WebFlix should reproduce those design principles, not copy ShareNet components verbatim.


## Familiar video-product interaction grammar — R24

WebFlix should borrow the **interaction grammar users already understand from mature video products such as YouTube** without copying their branding, icon set, visual identity, or exact information architecture.

This means:

- play is always the dominant action on playable media;
- common player controls appear where viewers expect them;
- queue/save/share/feedback controls live near the content decision they affect;
- search, Watch, Shorts, Library and playback retain predictable relationships;
- loading and recovery states preserve the player shell rather than replacing it with an engineering state;
- advanced source/provenance/model information is progressively disclosed;
- WebFlix-only capabilities such as Where to watch, torrent realizations, BYOF, explicit intent, attention modes and AI transformations are introduced at the moment of user intent rather than behind a separate architecture surface;
- source or platform differences are expressed as capability truth, not a different product language.

This is the **YouTube parity law**: WebFlix may be more capable than YouTube, but those extra capabilities should feel like natural additions to a familiar video product.

## Playback ease

Playback UX is also a design requirement.

The UI should avoid adding WebFlix-only ceremony between a user deciding to watch and the first playable frame. Metadata, recommendations, AI enrichment, provenance details and nonessential analytics must not block playback. Torrent realizations follow the same rule: when an authorized peer copy can play, it should look and behave like another way to watch, not like a download workflow.
