# WebFlix — R23 Open Viewing, First-Class Torrent & AI Media Intelligence

Date: 2026-09-20
Depends on: R22
Status: IMPLEMENTATION PLAN — architecture-preserving

## Goal

Extend WebFlix so that:
1. public content can be viewed without a WebFlix account, like a normal public-video platform;
2. login is primarily about durable identity, personalization, synchronized library/actions, source authorization and model/provider management — not a prerequisite for watching;
3. Torrent is a first-class content realization and playback path, not merely an offline-copy subsystem;
4. R2T2 and selected Hugging Face/open models materially improve live captions, transcription, semantic indexing, multimodal search, recommendation understanding, translation and local/private AI;
5. Web/Desktop remain adapters over the same Client Runtime semantics.

## Research findings

### R2T2

The R2T2 project is positioned as an open-source real-time streaming ASR system with live code, weights and hosted demos. The currently discoverable Hugging Face checkpoint is NetEase Youdao’s Confucius4-R2T2, built on Qwen3-ASR. It supports true streaming, append-only committed output, configurable 80 ms–2 s chunks, reported average latency around 200–600 ms, hotword/context prompting, vLLM, and broad multilingual capability with Chinese/English as the primary optimization target.

Important licensing distinction:
- accompanying R2T2 code: Apache 2.0;
- model weights: NetEase Model Use License Agreement.

R2T2 should therefore enter Model Fabric as an optional open-model provider with explicit model-license metadata, not as an assumed Apache-licensed dependency.

### Hugging Face candidates

Use the Hub as a model/evaluation layer, not as product logic.

High-value candidates:
- google/videoprism-base-f16r288: Apache 2.0 video embeddings; strong fit for item/moment semantic indexing and video-text retrieval.
- Qwen/Qwen2.5-VL-7B-Instruct: Apache 2.0; video inputs and temporal understanding for chaptering, visual grounding, scene/event extraction and multimodal search.
- OpenMOSS-Team/MOSS-Transcribe-Diarize: Apache 2.0; 0.9B, long-form multi-speaker transcription, diarization, timestamps and acoustic-event awareness.
- openai/whisper-large-v3-turbo: MIT; broad ASR fallback for offline/batch transcription.
- BGE-M3 ecosystem: multilingual dense + sparse + multi-vector retrieval for transcript/chapter/metadata hybrid search and reranking.
- Hugging Face Transformers.js + WebGPU: small private/local browser inference such as query embeddings, lightweight classification and local-media helpers.
- Hugging Face Inference Endpoints: production hosting option for selected open models behind Model Fabric.
- Hugging Face Spaces/ZeroGPU: evaluation/demo environment, not the production inference dependency.

## R23-A — Anonymous Viewing Contract

Freeze a distinction between:
- anonymous read/play: no WebFlix account required;
- authenticated mutation/sync: login required only when durable identity or an authorization boundary actually needs it;
- provider-authenticated playback: a provider may still require its own source authorization for that realization.

Anonymous users MUST be able to:
- open Home/Watch/Shorts/Search;
- open item details;
- resolve playable public realizations;
- play supported public embed/browser/external/native-compatible realizations;
- watch continuously within an anonymous session;
- use public playback controls;
- receive platform capability truth;
- use non-persistent/local interaction where supported.

Authentication MUST remain available for durable cross-device history/watchlist/profile, provider source connection and BYOF authorization, provider actions that require account authorization, BYOM/provider management, durable recommendation identity, account-scoped model policy, and synchronized social actions where the provider requires it.

No public-watch route may redirect to login merely because the viewer is anonymous.

## R23-B — Anonymous Playback Boundary

Audit and harden every playback/read path so authorization is checked per capability rather than globally.

Required invariant: anonymous + public realization => playback may start.
Forbidden invariant: anonymous => redirect to login.

Provider/connector authorization must remain independent from WebFlix account authentication.
Anonymous progress may exist as session-scoped/local state, but it must never be represented as durable cross-device identity until the user authenticates.

## R23-C — First-Class Torrent Realization Contract

Torrent MUST become a first-class realization/source path while preserving the Media Surface precedence model.

Do NOT create a new generic PlaybackMode = torrent.

Instead:
- retain platform playback modes native, embed, browser, external;
- allow a playback/acquisition realization to declare transport/source kind torrent;
- on Desktop, an authorized torrent realization may satisfy the native playback rung;
- on Web, a browser-capable torrent realization may satisfy a WebTorrent/browser rung where technically supported;
- otherwise Web presents the same canonical item with an honest Desktop/native next step.

The user should see torrent as Where to watch -> Authorized peer copy, not merely Offline copy.

Torrent and provider realizations must share canonical Entertainment Item identity, resume position, Like/Save semantics where applicable, AI actions, recommendation feedback, playback telemetry, Library integration, availability/realization choice, and error/recovery vocabulary.

## R23-D — Browser Torrent Adapter

Evaluate and, where permitted by the frozen architecture, implement a WebTorrent-backed browser adapter behind the existing TorrentEngine/TorrentLibrary boundary.

WebTorrent supports browser streaming using WebRTC, exposes file streams, supports seeking before full completion, and can stream media into browser video elements. Browser peers require WebRTC-capable peers; ordinary TCP/UDP-only BitTorrent peers are not reachable from the browser.

Therefore:
- the browser adapter is an optional realization, not a replacement for Desktop;
- capability truth must distinguish WebTorrent-capable from ordinary torrent availability;
- the adapter must use the existing authorization/provenance gate;
- it must not weaken R11/R13 integrity, recovery, or authorization laws;
- unsupported/browser-incompatible torrents fall back honestly to Desktop/native or another realization.

## R23-E — Torrent-as-Playback Product Surface

Replace Offline copy as the sole conceptual entry point for an available torrent realization.

Item/detail:
Where to watch
- WebFlix source
- Authorized peer copy
- Other available realizations

Acquisition states remain protocol-free: Available -> Preparing -> Buffering -> Playing -> Completing -> Ready offline / Failed.
Advanced torrent diagnostics remain progressively disclosed.
The torrent realization must be eligible for the primary play decision, not hidden under Settings or a secondary diagnostics panel.

## R23-F — AI Media Intelligence Pipeline

Extend Model Fabric with an ingestion/indexing pipeline:
source/playable media -> audio extraction -> streaming/batch transcript -> speaker/acoustic events -> scene/chapter analysis -> visual/video embeddings -> multilingual text embeddings -> canonical semantic index -> recommendation/search features.

Minimum derived artifacts:
- transcript segments with timestamps;
- optional speaker labels;
- language;
- chapters/scenes;
- visual concepts/entities;
- semantic video embedding;
- transcript/text embedding;
- searchable moments;
- confidence/provenance/model metadata.

## R23-G — R2T2 live captions and live AI

Use R2T2 for live captions for live/streaming media where an audio stream is legally available to WebFlix, low-latency transcript generation, voice/query input to WebFlix, real-time speech-to-text feeding translation or commentary agents, and live transcript search.

R2T2 is not the universal offline ASR. Model Fabric should route:
- R2T2 -> live/streaming low-latency;
- MOSS-Transcribe-Diarize or Whisper -> long-form/batch;
- provider/local model -> alternative policy choice.

## R23-H — Multimodal discovery and recommendation

Use VideoPrism + Qwen2.5-VL + transcript embeddings to improve search by meaning rather than title, search for a specific scene/moment, show-me-the-part-where queries, chapter-aware recommendation, visual similarity, content-aware anti-tunnel exploration, richer recommendation explanations, and cold-start understanding for new titles.

Recommendation remains policy-owned by the existing Recommendation OS. Models generate features/signals; they do not own user policy or authorization.

## R23-I — Privacy/local model path

Use Hugging Face/Transformers.js WebGPU selectively for private local work such as query embeddings, lightweight classification, local-media transcript helpers where a browser model is small enough, local search over user-owned media, and private preprocessing before sending only necessary derived text/features to remote models.

WebGPU must be optional. WASM/remote inference remains the fallback.

## R23-J — Model Fabric open-model provider

Add a first-class provider category huggingface-open-model with model id, revision, license, supported tasks, execution location, privacy class, cost, latency profile, hardware requirements and provenance.

Support both self-hosted/HF Inference Endpoint and local/Desktop model execution.
Do not make the application depend directly on the Hugging Face SDK inside shared product logic.

## R23-K — Anonymous AI boundary

Anonymous viewers may use low-cost or local AI experiences that do not require durable identity, for example subtitles, transcript, translate, visual Q&A on current content, and local semantic discovery.

High-cost or stateful features may be quota/policy limited, but they should answer with a useful typed state rather than redirecting every viewer to login.

Durable personalized recommendation/model policy remains account-scoped.

## R23-L — Three-worker implementation

### Worker 1 — Shared intelligence/runtime
- R23-A anonymous capability contract
- R23-B playback authorization/read-path hardening
- R23-C torrent realization contract
- R23-F media intelligence artifact contracts
- R23-G/H/I/J Model Fabric integrations
- tests and frozen shared interfaces

### Worker 2 — Web
- anonymous public playback UX
- R23-D browser torrent adapter/product integration where capability permits
- R23-E torrent-first realization UI
- R23-G live caption/AI surfaces
- multimodal search/moment discovery
- WebGPU private/local feature probes
- browser evidence

### Worker 3 — Desktop/native/torrent
- R23-C torrent realization integration with native media
- R23-E Desktop torrent play surface
- torrent background/recovery/verified-library continuity
- R23-G/H local AI integration where useful
- model runtime packaging
- Desktop/native evidence

### Lead
- architecture/contract ratification;
- license review;
- provider/model provenance review;
- anonymous/auth capability matrix;
- torrent first-class parity gate;
- integration;
- production verification.

## Dependency graph

R22 -> R23-A -> R23-B -> R23-C -> R23-D/R23-E
R22 -> R23-F -> R23-G/R23-H/R23-I/R23-J
R23-A -> R23-K
After A/C/F are frozen, Worker 2 and Worker 3 may run concurrently. Worker 1 remains the owner of shared semantic contracts and model/provider integration.

## J37 — Anonymous Viewing

Fresh browser, no WebFlix account:
Home -> Search -> open public video -> Play -> continue watching -> switch playback realization where available -> return to Home/Watch -> continue session.

Acceptance:
- no login wall for public playback;
- no redirect to Settings merely to watch;
- provider-auth requirements are distinguished from WebFlix-account requirements;
- anonymous state remains honestly session-scoped;
- login remains available but optional.

## J38 — First-Class Torrent Playback

Fresh user selects an authorized torrent-capable realization:
Item -> Where to watch -> Authorized peer copy -> choose file if needed -> Buffering -> Playing -> seek -> continue -> pause/resume -> background completion -> verified offline -> Library.

Web additionally tests browser-capable WebTorrent scenarios; Desktop must prove the full native path.
Torrent failures must recover without losing truthful state.

## J39 — Multimodal Media Intelligence

Fresh user:
Search by natural-language description -> receive semantically relevant title/moment -> open item -> transcript/chapters -> ask about a visual event -> jump to relevant segment -> change language/subtitle output -> observe provenance/model truth.

## R23 acceptance

Required:
- all existing gates;
- anonymous playback J37;
- torrent first-class J38;
- multimodal intelligence J39;
- no regression in J01-J36;
- model-license/provenance checks;
- production Web verification;
- Desktop/native verification;
- no login gate for public viewing;
- no torrent path hidden as a mere offline utility;
- no direct Hugging Face/OpenAI/provider SDK calls inside shared product logic;
- no model is allowed to authorize a playback/acquisition action.