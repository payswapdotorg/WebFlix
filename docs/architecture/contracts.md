# WebFlix Boundary Contracts

Shared contracts are implementation seams. Workers may implement behind them but may not alter semantics without Lead review.

The remediation architecture in `docs/architecture/webflix-remediation-architecture.md` adds shared client-runtime, platform, acquisition, and torrent boundaries. This file is the type-level source of truth.

## Connector SDK

```ts
export type Capability = 'identity'|'catalogSearch'|'metadata'|'playNative'|'playEmbed'|'playBrowser'|'playExternal'|'availability'|'libraryRead'|'libraryWrite'|'like'|'save'|'follow'|'comment'|'download'|'transform';
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
```

Source-native ordering is data with provenance. It must never be represented as a WebFlix recommendation score merely because it appears in a BYOF surface.