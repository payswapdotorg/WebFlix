# WebFlix Product and Safety Boundaries

## Product
WebFlix is an entertainment orchestration layer. It does not own or host every source.

## Native media
Native acquisition/background download is for user-owned, licensed, public-domain, Creative Commons, or otherwise authorized media.

## Provider controls
Never defeat DRM, extract private credentials/tokens, bypass CAPTCHAs or anti-bot controls, evade rate limits/access controls/geographic restrictions, or capture protected provider media merely to make it appear native.

The in-app browser is a UX surface, not a circumvention mechanism.

## Capability truth
Connectors must declare actual capabilities. Unsupported operations return typed unsupported results. UI availability never implies provider support.

## Social sync
All social actions are first recorded locally. Outbound sync is attempted only through supported official capabilities. The UI distinguishes local WebFlix state from confirmed external synchronization.

## AI
BYOM/local/cloud models can recommend or transform media only within the same authorization boundary as the source. Provider credentials never enter model prompts. Local-only policies must not send history/media to cloud models.

## Privacy
Credentials remain in secure provider storage. Recommendation telemetry is minimized. Export/delete operations cover graph, intents, watch state, and connector metadata.

## Attention
Mindful, Balanced, Immersive, and Custom modes are explicit. Maximum engagement is not the universal hidden objective.
