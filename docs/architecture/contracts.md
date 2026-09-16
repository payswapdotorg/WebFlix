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
