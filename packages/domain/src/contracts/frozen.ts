// GENERATED from docs/architecture/contracts.md by scripts/check-contracts.mjs
// DO NOT EDIT. Contract changes are lead-owned: edit the doc, then run `bun run contract-check -- --write`.
// eslint-disable-next-line
import type { SearchResult, SourceItem, UserAction, ActionReceipt, LibraryEntry, LibraryCommand, EntertainmentCandidate } from "./extensions";

// ===== section: Connector SDK =====
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

// ===== section: Entertainment Graph =====
export interface EntertainmentItem { id:string; canonicalType:'movie'|'series'|'episode'|'video'|'short'|'post'|'audio'; canonicalTitle?:string; durationMs?:number; orientation?:'horizontal'|'vertical'|'square'|'unknown'; }
export interface SourceRealization { id:string; entertainmentItemId:string; connectorId:string; externalRef:string; capabilities:Capability[]; availability:'available'|'unknown'|'unavailable'; }
export interface EntertainmentEvent { userId:string; itemId:string; type:'impression'|'start'|'progress'|'complete'|'skip'|'like'|'dislike'|'save'|'share'|'search'; occurredAt:string; sessionId:string; sourceRealizationId?:string; payload?:Record<string,unknown>; }

// ===== section: Intent Graph =====
export type IntentScope='persistent'|'temporary'|'session'|'momentary'|'social';
export interface UserIntent { id:string; userId:string; scope:IntentScope; objective:string; weight:number; confidence:number; expiresAt?:string; provenance:'explicit'|'inferred'|'imported'; }
export interface RecommendationPolicy { id:string; userId:string; objectives:{id:string;weight:number;direction:'maximize'|'minimize'}[]; exploration:number; novelty:number; socialInfluence:number; attentionMode:'mindful'|'balanced'|'immersive'|'custom'; maxSessionExtensionMinutes?:number; }

// ===== section: Recommendation OS =====
export interface RecommendationContext { userId:string; sessionId:string; surface:'watch'|'short'; intents:UserIntent[]; policy:RecommendationPolicy; recentEvents:EntertainmentEvent[]; candidatePool:EntertainmentCandidate[]; }
export interface RecommendationModel { id:string; version:string; score(ctx:RecommendationContext):Promise<RecommendationScore[]>; }
export interface RecommendationScore { itemId:string; score:number; explanations:string[]; confidence:number; }

// ===== section: Model Fabric =====
export type ModelTask='recommendation'|'ranking'|'summary'|'translation'|'transcription'|'speechToText'|'textToSpeech'|'dubbing'|'commentary';
export interface ModelProvider { id:string; capabilities:ModelTask[]; invoke<TInput,TOutput>(task:ModelTask,input:TInput):Promise<TOutput>; }
export interface ModelPolicy { task:ModelTask; preferredProvider?:string; fallbackProviders:string[]; privacy:'local-only'|'trusted-cloud'|'any-cloud'; maxCostPerOperation?:number; }

// ===== section: Media Surface =====
export type PlaybackMode='native'|'embed'|'browser'|'external';
export interface PlaybackRealization { mode:PlaybackMode; connectorId:string; url?:string; externalRef?:string; expiresAt?:string; capabilities:string[]; }
export interface PlaybackSession { id:string; userId:string; itemId:string; realization:PlaybackRealization; resumePositionMs:number; createdAt:string; }

// ===== section: Shared client runtime =====
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

// ===== section: Native media =====
export interface NativeMediaSession { id:string; assetId:string; fileId:string; state:'resolving'|'buffering'|'playing'|'background'|'complete'|'failed'; bufferedMs:number; positionMs:number; integrity:'unknown'|'verified'|'failed'; }
export interface NativeMediaEngine {
  open(input:{magnet?:string;torrentBytes?:Uint8Array;localPath?:string}):Promise<NativeMediaSession>;
  seek(sessionId:string,positionMs:number):Promise<void>;
  prioritize(sessionId:string,deadlines:{piece:number;deadlineMs:number}[]):Promise<void>;
  pause(sessionId:string):Promise<void>; resume(sessionId:string):Promise<void>; close(sessionId:string):Promise<void>;
}

// ===== section: Torrent engine =====
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

// ===== section: Acquisition =====
export type AcquisitionState='available'|'preparing'|'buffering'|'playing'|'completing'|'ready-offline'|'failed';
export interface AcquisitionStatus { id:string; itemId:string; state:AcquisitionState; progress:number; bufferedMs:number; assetId?:string; error?:string; }
