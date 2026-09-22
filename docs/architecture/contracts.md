# WebFlix Boundary Contracts

Shared contracts are implementation seams. Workers may implement behind them but may not alter semantics without Lead review.

The remediation architecture in `docs/architecture/webflix-remediation-architecture.md` adds shared client-runtime, platform, acquisition, and torrent boundaries. This file is the type-level source of truth.

## Connector SDK

```ts
export type Capability = 'identity'|'catalogSearch'|'metadata'|'playNative'|'playEmbed'|'playBrowser'|'playExternal'|'availability'|'libraryRead'|'libraryWrite'|'like'|'save'|'follow'|'comment'|'download'|'transform'|'feedImport';
export interface ConnectorDescriptor { id:string; version:string; displayName:string; capabilities:Capability[]; auth:'none'|'oauth'|'device'|'local'; }
export interface ConnectorContext { userId:string; locale:string; region?:string; }
export interface SourceConnector {
  descriptor(): ConnectorDescriptor;
  search(ctx:ConnectorContext, query:string):Promise<SearchResult[]>;
  metadata(ctx:ConnectorContext, ref:string):Promise<SourceItem|null>;
  resolve(ctx:ConnectorContext, ref:string):Promise<PlaybackRealization[]>;
  executeAction(ctx:ConnectorContext, action:UserAction):Promise<ActionReceipt>;
  readLibrary?(ctx:ConnectorContext):Promise<LibraryEntry[]>;
  writeLibrary?(ctx:ConnectorContext, command:LibraryCommand):Promise<ActionReceipt>;
}
```

## Entertainment Graph

```ts
export interface EntertainmentItem { id:string; canonicalType:'movie'|'series'|'episode'|'video'|'short'|'post'|'audio'; canonicalTitle?:string; durationMs?:number; orientation?:'horizontal'|'vertical'|'square'|'unknown'; }
export interface SourceRealization { id:string; entertainmentItemId:string; connectorId:string; externalRef:string; capabilities:Capability[]; availability:'available'|'unknown'|'unavailable'; }
export interface EntertainmentEvent { userId:string; itemId:string; type:'impression'|'start'|'progress'|'complete'|'skip'|'like'|'dislike'|'save'|'share'|'search'; occurredAt:string; sessionId:string; sourceRealizationId?:string; payload?:Record<string,unknown>; }
```

## Intent Graph

```ts
export type IntentScope='persistent'|'temporary'|'session'|'momentary'|'social';
export interface UserIntent { id:string; userId:string; scope:IntentScope; objective:string; weight:number; confidence:number; expiresAt?:string; provenance:'explicit'|'inferred'|'imported'; }
export interface RecommendationPolicy { id:string; userId:string; objectives:{id:string;weight:number;direction:'maximize'|'minimize'}[]; exploration:number; novelty:number; socialInfluence:number; attentionMode:'mindful'|'balanced'|'immersive'|'custom'; maxSessionExtensionMinutes?:number; }
```

## Recommendation OS

```ts
export interface RecommendationContext { userId:string; sessionId:string; surface:'watch'|'short'; intents:UserIntent[]; policy:RecommendationPolicy; recentEvents:EntertainmentEvent[]; candidatePool:EntertainmentCandidate[]; }
export interface RecommendationModel { id:string; version:string; score(ctx:RecommendationContext):Promise<RecommendationScore[]>; }
export interface RecommendationScore { itemId:string; score:number; explanations:string[]; confidence:number; }
```

Models rank candidates; they do not own policy, persistence, authorization, or provider actions.

## Model Fabric

```ts
export type ModelTask='recommendation'|'ranking'|'summary'|'translation'|'transcription'|'speechToText'|'textToSpeech'|'dubbing'|'commentary';
export interface ModelProvider { id:string; capabilities:ModelTask[]; invoke<TInput,TOutput>(task:ModelTask,input:TInput):Promise<TOutput>; }
export interface ModelPolicy { task:ModelTask; preferredProvider?:string; fallbackProviders:string[]; privacy:'local-only'|'trusted-cloud'|'any-cloud'; maxCostPerOperation?:number; }
```

## Media Surface

```ts
export type PlaybackMode='native'|'embed'|'browser'|'external';
export interface PlaybackRealization { mode:PlaybackMode; connectorId:string; url?:string; externalRef?:string; expiresAt?:string; capabilities:string[]; }
export interface PlaybackSession { id:string; userId:string; itemId:string; realization:PlaybackRealization; resumePositionMs:number; createdAt:string; }
```

Precedence: Native -> Embed -> Browser -> External, subject to actual platform/provider capability.

## Shared client runtime

```ts
export interface PlatformCapabilities {
  platform:'web'|'desktop'|'mobile';
  storage:'browser'|'filesystem'|'os-managed';
  browserHost:'none'|'contained';
  nativeMedia:'none'|'local'|'native-service';
  backgroundWork:'none'|'limited'|'full';
  sharing:boolean;
  notifications:boolean;
}

export interface SectionStatus { state:'ready'|'error'; error?:{ kind:'invalid-input'|'network'|'unauthorized'|'unavailable'|'unsupported-capability'|'degraded'|'not-found'; detail:string }; }
export interface HomeQuery { includeContinueWatching?:boolean; }
export interface HomeModel { continueWatching:{ status:SectionStatus; entries:{ itemId:string; title:string; positionMs:number; completionRatio:number|null; lastWatchedAt:string; status:'in-progress'|'completed'|'skipped' }[] }; }
export interface SearchQuery { query:string; }
export interface SearchModel { query:string; status:SectionStatus; hits:{ canonicalItemId:string; result:SearchResult }[]; }
export interface PlaybackIntent { itemId:string; externalRef?:string; realization?:PlaybackRealization; resumePositionMs?:number; }
export interface ActionState { actionId:string; action:UserAction; status:'requested'|'confirmed-locally'|'confirmed-by-provider'|'unsupported'|'failed'; requestedAt:string; settledAt?:string; externalId?:string; detail?:string; capabilityGate?:string; }
export type WatchStateCommand = { kind:'start'; itemId:string; positionMs?:number; playbackSessionId?:string } | { kind:'progress'; itemId:string; positionMs:number; playbackSessionId?:string } | { kind:'complete'; itemId:string; positionMs?:number; playbackSessionId?:string } | { kind:'skip'; itemId:string; positionMs?:number; playbackSessionId?:string };
export interface LibraryQuery { includeWatchlist?:boolean; includeHistory?:boolean; }
export interface LibraryModel { watchlist:{ status:SectionStatus; entries:LibraryEntry[] }; history:{ status:SectionStatus; entries:LibraryEntry[] }; }
export interface UserIntentCommand { objective:string; scope:IntentScope; weight?:number; expiresAt?:string; provenance?:'explicit'|'inferred'|'imported'; }
export interface RecommendationPolicyCommand { attentionMode:'mindful'|'balanced'|'immersive'|'custom'; exploration?:number; novelty?:number; socialInfluence?:number; }

export interface ClientRuntime {
  platform: PlatformCapabilities['platform'];
  getHome(input:HomeQuery):Promise<HomeModel>;
  search(input:SearchQuery):Promise<SearchModel>;
  resolvePlayback(input:PlaybackIntent):Promise<PlaybackSession>;
  dispatchAction(input:UserAction):Promise<ActionState>;
  updateWatchState(input:WatchStateCommand):Promise<void>;
  library(input:LibraryQuery):Promise<LibraryModel>;
  setIntent(input:UserIntentCommand):Promise<void>;
  setRecommendationPolicy(input:RecommendationPolicyCommand):Promise<void>;
}
```

The runtime has no provider SDK calls and no Web/Desktop-specific business rules.

> **Lead ratification (R01, 2026-09-16).** The sketch's input/output types are now defined
> above (aligned with the delivered, tested `@wfx/client-runtime` shapes). Two semantics are
> ratified: (1) `ServerPort` implementations return typed failures (`ok:false` with a
> `ServerFailure`) where the frozen `apps/web` remote-ports degrade reads to empty answers —
> the runtime must render honest error states, never fake emptiness; (2) the `ClientRuntime`
> facade carries failures via typed throws + in-band section statuses (the sketch's bare
> signatures are preserved verbatim). The `native-media` DTO/snapshot builders set
> `integrity: "unknown"` (no verdict claimed) until R10 owns real verdicts.

## Native media

```ts
export interface NativeMediaSession { id:string; assetId:string; fileId:string; state:'resolving'|'buffering'|'playing'|'background'|'complete'|'failed'; bufferedMs:number; positionMs:number; integrity:'unknown'|'verified'|'failed'; }
export interface NativeMediaEngine {
  open(input:{magnet?:string;torrentBytes?:Uint8Array;localPath?:string}):Promise<NativeMediaSession>;
  seek(sessionId:string,positionMs:number):Promise<void>;
  prioritize(sessionId:string,deadlines:{piece:number;deadlineMs:number}[]):Promise<void>;
  pause(sessionId:string):Promise<void>; resume(sessionId:string):Promise<void>; close(sessionId:string):Promise<void>;
}
```

## Torrent engine

Torrent protocol internals are private to the torrent-engine package. Product code consumes only this boundary:

```ts
export type TorrentState='metadata'|'checking'|'buffering'|'playing'|'downloading'|'paused'|'complete'|'failed';
export interface TorrentSource { kind:'magnet'|'torrent-file'; value:string|Uint8Array; authorized:boolean; }
export interface TorrentFile { path:string; sizeBytes:number; playable:boolean; selected:boolean; verifiedBytes:number; }
export interface TorrentSession { id:string; state:TorrentState; files:TorrentFile[]; progress:number; peers:number; verifiedPieces:number; totalPieces:number; error?:string; }
export interface TorrentEngine {
  add(source:TorrentSource):Promise<TorrentSession>;
  metadata(sessionId:string):Promise<TorrentSession>;
  selectFiles(sessionId:string,filePaths:string[]):Promise<TorrentSession>;
  resume(sessionId:string):Promise<void>;
  pause(sessionId:string):Promise<void>;
  prioritize(sessionId:string,deadlines:{piece:number;deadlineMs:number}[]):Promise<void>;
  getRange(sessionId:string,input:{filePath:string;offset:number;length:number}):Promise<Uint8Array>;
  inspect(sessionId:string):Promise<TorrentSession>;
  remove(sessionId:string,deleteData:boolean):Promise<void>;
}
```

## Acquisition

```ts
export type AcquisitionState='available'|'preparing'|'buffering'|'playing'|'completing'|'ready-offline'|'failed';
export interface AcquisitionStatus { id:string; itemId:string; state:AcquisitionState; progress:number; bufferedMs:number; assetId?:string; error?:string; }
```

All clients consume the same Experience API, client-runtime contracts, and event schemas. Contract changes require synchronized updates to this document, tests, affected work items, and the tech-lead handoff.

## Bring Your Own Feed

BYOF is a distinct feed/import capability. It is not inferred from generic catalog search.

```ts
export type FeedImportMethod='api'|'official-export'|'user-file'|'snapshot';
export type FeedSyncState='live'|'syncing'|'snapshot'|'stale'|'reauthorization-required'|'unsupported'|'degraded';
export interface FeedImportCapability { method:FeedImportMethod; supportsContinuousSync:boolean; supportsFollowing:boolean; supportsPlaylists:boolean; supportsLikesOrSaves:boolean; }
export interface FeedProvenance { connectorId:string; importMethod:FeedImportMethod; sourceRef?:string; capturedAt:string; syncState:FeedSyncState; sourceOrder:number; relationship:'follow'|'subscription'|'playlist'|'watchlist'|'like'|'save'|'ranked-feed'|'history'|'unknown'; }
export interface FeedRecord { id:string; userId:string; profileId:string; entertainmentItemId:string; provenance:FeedProvenance; importedAt:string; sourceUpdatedAt?:string; }
export interface FeedImport { id:string; connectorId:string; method:FeedImportMethod; status:'preview'|'confirmed'|'running'|'complete'|'failed'|'reauthorization-required'; startedAt:string; completedAt?:string; error?:string; }
export interface FeedImportPreview { importId:string; connectorId:string; method:FeedImportMethod; itemCount:number; relationshipCounts:Record<string,number>; freshness:FeedSyncState; sample:FeedRecord[]; }
export interface FeedPort { previewImport(input:{connectorId:string;method?:FeedImportMethod;artifact?:Uint8Array}):Promise<FeedImportPreview>; confirmImport(importId:string):Promise<FeedImport>; readFeed(input:{profileId:string;mode:'webflix'|'following'|'byof'|'hybrid'}):Promise<FeedRecord[]>; syncImport(importId:string):Promise<FeedImport>; }

// --- R20-A lane additions (Worker 1, for lead ratification): the named
// relationship union, the idempotent import key contract, the connector
// feed surface, and the reconciliation contracts. The frozen shapes above
// keep their exact semantics (add-only law). ---

/** The relationship kinds an imported feed record can carry (the FeedProvenance.relationship union, named for reuse). */
export type FeedRelationship = 'follow'|'subscription'|'playlist'|'watchlist'|'like'|'save'|'ranked-feed'|'history'|'unknown';

/** The identity of one imported feed relationship: (profile, source, container, external item). The import-key law: re-importing the same relationship is IDEMPOTENT — it addresses the SAME record, never a duplicate. */
export interface FeedImportKeyInput { profileId:string; connectorId:string; relationship:FeedRelationship; sourceRef?:string; externalRef:string; }

/** One relationship/item as the authorized source reports it, in source-native order. `sourceRef` is the relationship's container (playlist id, 'LL'/'WL', the follow graph itself when absent). Source-native order is data with provenance — never a WebFlix rank. */
export interface ConnectorFeedItem { externalRef:string; relationship:FeedRelationship; sourceOrder:number; sourceRef?:string; title?:string; sourceUpdatedAt?:string; metadata?:Record<string,unknown>; }

/** One authorized feed capture read from a connector. A capture is a point-in-time snapshot: it is never presented as live; `continuousSync` states whether the route can be re-read later. `sourceRef` names the capture's container when it is uniform (a scoped playlist sync); a multi-container capture omits it and every item carries its own. `metadata` carries non-credential capture diagnostics (quota cost, page discipline) — provenance truth, never secrets. */
export interface ConnectorFeedSnapshot { connectorId:string; method:FeedImportMethod; capturedAt:string; continuousSync:boolean; orderSemantics:'source-native'|'unknown'; sourceRef?:string; syncState:FeedSyncState; items:readonly ConnectorFeedItem[]; metadata?:Record<string,unknown>; }

/** A request to import a feed from a connector: the import method, an optional relationship/container filter, or a user-supplied export artifact. */
export interface FeedImportRequest { method:FeedImportMethod; relationships?:readonly FeedRelationship[]; sourceRef?:string; artifact?:Uint8Array; }

/** One item-level reconciliation decision. `remove` deletes only the imported feed record — never WebFlix-local library/history state. */
export interface FeedReconciliationItem { key:string; externalRef:string; relationship:FeedRelationship; sourceRef?:string; action:'add'|'update'|'remove'|'keep'; reason:'new-item'|'source-changed'|'order-changed'|'source-removed'|'unchanged'; }

/** The reconciliation report: what one sync changed, what it deduplicated, what it preserved, with honest counts. `preservedLocalActions` is the structural law: feed reconciliation writes ONLY feed records/imports. */
export interface FeedReconciliationReport { importId:string; connectorId:string; method:FeedImportMethod; capturedAt:string; appliedAt:string; added:number; updated:number; removed:number; kept:number; deduplicated:number; preservedLocalActions:boolean; items:readonly FeedReconciliationItem[]; }
```

Source-native ordering is data with provenance. It must never be represented as a WebFlix recommendation score merely because it appears in a BYOF surface.

## Realtime translation

Realtime translation is a STREAMING session seam, never a batch TransformOperation: it owns its own event/operation vocabulary. The seam is provider-neutral by law — NO provider event names, NO provider-specific JSON cross it; the provider adapter (behind Model Fabric) owns the protocol. Anonymous realtime translation of currently playable public media needs no login; voice preservation is consent-gated and never the default.

```ts
// --- R25-A lane additions (Worker 1, for lead ratification): the
// provider-neutral realtime translation session contract. ---

/** What the session outputs: translated text, or translated text plus translated speech. */
export type RealtimeOutputModality='text'|'text-and-audio';
/** Which captions the session surfaces: source transcript, translated text, or both interleaved (the live bilingual view preserves source/translation alignment — the source transcript is never replaced). */
export type RealtimeSubtitleMode='source'|'translated'|'bilingual';
/** How utterance speakers are labeled: no attribution; simple contextual labels (Speaker 1 / Speaker 2); or labels taken only from trusted source metadata. */
export type RealtimeSpeakerAttributionMode='off'|'simple-labels'|'trusted-metadata';
/** Whether the caller may append video frames as visual context. The frame sampler belongs to the media adapter, never the provider; 'adaptive' means sampled frames only (scene/shot/on-screen-text triggers plus a low-rate periodic fallback), never every frame. */
export type RealtimeVisualContextPolicy='off'|'adaptive';
/** The translated-speech voice policy. 'preserve-source-voice' is consent-gated (a satisfied consent record must accompany it); the neutral system voice is the default and the fallback. */
export type RealtimeTranslatedVoicePolicy='neutral-system-voice'|'preserve-source-voice';
/** The voice-cloning consent state, recorded with the session/artifact whenever translated speech is produced. */
export type RealtimeVoiceConsentState='not-required'|'satisfied'|'missing'|'revoked';
/** The consent/provenance record for voice preservation. Never silently synthesized: 'satisfied' requires a real basis. */
export interface RealtimeVoiceConsentRecord { state:RealtimeVoiceConsentState; basis:string; recordedAt:string; }
/** The identity of the media whose audio the session translates. `audioStreamLegallyAvailable` is the honest gate: false means WebFlix has no lawful audio path and the session refuses (no capture circumvention, ever). */
export interface RealtimeSourceMediaIdentity { itemId?:string; connectorId?:string; externalRef?:string; audioStreamLegallyAvailable:boolean; }
/** One hotword mapping: a source term plus its preferred target-language rendering. Provider hotword syntax is the adapter's concern. */
export interface RealtimeHotwordMapping { term:string; preferredRendering?:string; }
/** The complete realtime translation session input. */
export interface RealtimeTranslationSessionInputs {
  sourceMedia:RealtimeSourceMediaIdentity;
  targetLanguage:string;
  sourceLanguageHint?:string;
  outputModality:RealtimeOutputModality;
  subtitleMode:RealtimeSubtitleMode;
  speakerAttribution:RealtimeSpeakerAttributionMode;
  visualContextPolicy:RealtimeVisualContextPolicy;
  hotwords:readonly RealtimeHotwordMapping[];
  translatedVoicePolicy:RealtimeTranslatedVoicePolicy;
  voiceConsent?:RealtimeVoiceConsentRecord;
}
/** The mid-session reconfiguration subset. Source media identity is immutable for a session; every other dimension may be reconfigured where the state machine allows it. */
export interface RealtimeSessionConfiguration { targetLanguage?:string; outputModality?:RealtimeOutputModality; subtitleMode?:RealtimeSubtitleMode; speakerAttribution?:RealtimeSpeakerAttributionMode; visualContextPolicy?:RealtimeVisualContextPolicy; hotwords?:readonly RealtimeHotwordMapping[]; translatedVoicePolicy?:RealtimeTranslatedVoicePolicy; voiceConsent?:RealtimeVoiceConsentRecord; }
/** The session lifecycle states. */
export type RealtimeTranslationSessionState='idle'|'starting'|'streaming'|'reconnecting'|'stopped'|'closed';
/** The session operations (the command surface). 'reconnect' is reconnect/resume: reattach after an interruption WITHOUT restarting the media item. */
export type RealtimeTranslationOperation='start'|'configure'|'append-audio'|'append-image-frame'|'stop'|'reconnect'|'close';
/** The closed event vocabulary — provider-neutral. 'timing-metadata' carries source/translation timing; 'usage-telemetry' carries the usage/cost accounting. */
export type RealtimeTranslationEventKind='session-created'|'source-transcript-delta'|'source-transcript-final'|'translation-delta'|'translation-segment-final'|'speaker-attribution'|'translated-audio-chunk'|'timing-metadata'|'usage-telemetry'|'recoverable-error'|'terminal-error'|'session-closed';
/** Provider-neutral error classes. 'recoverable-error' carries the recovery hint; 'terminal-error' ends the session (base playback continues regardless). */
export type RealtimeTranslationErrorKind='network'|'timeout'|'policy'|'unsupported-language-direction'|'consent-required'|'provider-failure'|'unknown';
/** Source/translation segment timing, in media-position milliseconds. */
export interface RealtimeSegmentTiming { startedAtMs:number; endedAtMs:number; }
/** The normalized audio format of translated speech chunks. */
export type RealtimeTranslatedAudioFormat='pcm16'|'opus';
/** The usage accounting record. Token counts are provider-reported truth; monetary cost is derived by Model Fabric's realtime cost model, never by the provider adapter. */
export interface RealtimeSessionUsage { inputAudioTokens:number; textOutputTokens:number; outputAudioTokens:number; imageInputTokens:number; }
/** The full provider-neutral event union. Every event carries the sessionId and a wall-clock occurredAt. */
export type RealtimeTranslationEvent =
 | { kind:'session-created'; sessionId:string; occurredAt:string; providerId:string; modelId:string; modelRevision:string; effectiveInputs:RealtimeTranslationSessionInputs }
 | { kind:'source-transcript-delta'; sessionId:string; occurredAt:string; segmentId:string; deltaText:string; sourceLanguage?:string; timing:RealtimeSegmentTiming }
 | { kind:'source-transcript-final'; sessionId:string; occurredAt:string; segmentId:string; text:string; speakerId?:string; timing:RealtimeSegmentTiming }
 | { kind:'translation-delta'; sessionId:string; occurredAt:string; segmentId:string; sourceSegmentId?:string; targetLanguage:string; deltaText:string }
 | { kind:'translation-segment-final'; sessionId:string; occurredAt:string; segmentId:string; sourceSegmentId?:string; targetLanguage:string; text:string; timing:RealtimeSegmentTiming }
 | { kind:'speaker-attribution'; sessionId:string; occurredAt:string; speakerId:string; label:string; segmentId?:string; trustedSource:boolean }
 | { kind:'translated-audio-chunk'; sessionId:string; occurredAt:string; sequence:number; audio:Uint8Array; format:RealtimeTranslatedAudioFormat; timing:RealtimeSegmentTiming }
 | { kind:'timing-metadata'; sessionId:string; occurredAt:string; firstSourceTranscriptDeltaMs?:number; firstTranslationDeltaMs?:number; firstTranslatedAudioChunkMs?:number; sourceToTranslationLagMs?:number }
 | { kind:'usage-telemetry'; sessionId:string; occurredAt:string; usage:RealtimeSessionUsage }
 | { kind:'recoverable-error'; sessionId:string; occurredAt:string; errorKind:RealtimeTranslationErrorKind; detail:string; recovery:string }
 | { kind:'terminal-error'; sessionId:string; occurredAt:string; errorKind:RealtimeTranslationErrorKind; detail:string }
 | { kind:'session-closed'; sessionId:string; occurredAt:string; reason:'user-stop'|'user-close'|'terminal-error'|'policy'|'provider-closed'; finalUsage?:RealtimeSessionUsage };
/** One appended source-audio chunk, in media-position order. */
export interface RealtimeAudioChunkInput { audio:Uint8Array; mediaPositionMs?:number; }
/** One appended visual frame, sampled by the media adapter under an 'adaptive' visual-context policy. */
export interface RealtimeImageFrameInput { frame:Uint8Array; mediaPositionMs?:number; }
/** The provider-neutral realtime translation session port. Implementations (the provider adapter behind Model Fabric, the Web bridge, the Desktop capture path) own the protocol; this surface stays provider-neutral by law. */
export interface RealtimeTranslationSession {
  readonly sessionId:string;
  readonly state:RealtimeTranslationSessionState;
  start():Promise<void>;
  configure(configuration:RealtimeSessionConfiguration):Promise<void>;
  appendAudio(chunk:RealtimeAudioChunkInput):Promise<void>;
  appendImageFrame(frame:RealtimeImageFrameInput):Promise<void>;
  stop():Promise<void>;
  reconnect():Promise<void>;
  close():Promise<void>;
  events():AsyncIterable<RealtimeTranslationEvent>;
}
/** The session factory seam Model Fabric exposes for realtime translation. */
export interface RealtimeTranslationSessionFactory { open(inputs:RealtimeTranslationSessionInputs):Promise<RealtimeTranslationSession>; }
```