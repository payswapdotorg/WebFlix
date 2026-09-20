# WebFlix — R25 Qwen3.8 LiveTranslate Realtime Media Translation

Date: 2026-09-20  
Depends on: R23 Model Fabric/realtime media contracts; R24 parity/performance lab.  
Status: APPROVED ARCHITECTURE PLAN

## Research summary

Qwen3.8-LiveTranslate-Flash-Realtime is Qwen's current realtime simultaneous-translation model. Official Qwen material describes a Hybrid-MoE Thinker/Talker architecture with interleaved streaming understanding, translation and speech generation. Qwen reports approximately 2.3 seconds average lagging versus 2.8 seconds for the previous generation. The model adds real-time speaker separation, synchronized source + translation output, long-context disambiguation, visual context, and translated speech with optional voice cloning. cite placeholder0  

The current cloud API accepts streaming audio and optional image frames, and returns text and/or audio. Official Qwen Cloud documentation lists 60 source languages, with 29 supporting audio output. Qwen3.8's ASR transcript is enabled by default, and the realtime protocol emits incremental transcript and translation/audio events. cite placeholder1  

The currently documented production endpoint is the Alibaba Cloud Model Studio service using model id `qwen3.8-livetranslate-flash-realtime` over WebSocket. Current official model documentation identifies Alibaba Cloud Model Studio as the inference service provider. In the reviewed official materials I did not find a public open-weight distribution, so WebFlix must treat this as a managed cloud provider, not assume self-hosting or open-weight rights. cite placeholder2  

## Product role

Qwen3.8 should become the realtime translation/interpretation specialist inside WebFlix's Model Fabric.

It should complement:

- R2T2 -> low-latency streaming ASR/live caption specialist;
- Qwen3.8-LiveTranslate -> realtime translation + speaker-aware interpretation + translated speech;
- MOSS-Transcribe-Diarize / Whisper -> long-form/batch transcription;
- VideoPrism/Qwen-VL -> offline visual/video understanding;
- BGE-M3 and other retrieval models -> semantic indexing;
- other translation models -> fallback, privacy, cost or language coverage choices.

Qwen3.8 must not become the universal model for every media transformation.

## R25-A — Shared realtime session contract

The current WebFlix transform API is a queued operation model. Qwen3.8 needs a separate streaming session seam.

Add a shared abstraction equivalent to:

### RealtimeTranslationSession

Inputs:

- source media identity;
- source audio stream;
- optional image/video-frame stream;
- optional source-language hint;
- target language;
- output modalities: text / text+audio;
- subtitle mode: source / translated / bilingual;
- speaker-attribution mode;
- visual-context policy;
- hotword mappings;
- translated-voice policy.

Events:

- session-created;
- source-transcript-delta;
- source-transcript-final;
- translation-delta;
- translation-segment-final;
- speaker-attribution;
- translated-audio-chunk;
- source/translation timing metadata;
- usage/cost telemetry;
- recoverable error;
- terminal error;
- session-closed.

Operations:

- start;
- configure;
- append audio;
- append image frame;
- stop;
- reconnect/resume;
- close.

The shared contract must not contain Qwen event names or Qwen-specific JSON.

## R25-B — Model Fabric extension

Extend Model Fabric's task/capability vocabulary with a realtime translation capability rather than overloading the existing batch transform task.

Recommended logical task:

`realtime-translation`

Capability dimensions:

- streaming input;
- source ASR;
- text translation;
- streaming text output;
- translated speech output;
- speaker attribution;
- visual-context input;
- hotword support;
- voice cloning;
- supported language directions;
- latency profile;
- privacy class;
- price/cost model;
- provider provenance;
- revision/model id.

The router may choose Qwen3.8 when the request requires combinations such as:

- realtime translation + audio output;
- realtime translation + speaker separation;
- realtime translation + visual context.

It should choose R2T2 or another provider when the requested output is only low-latency source transcription.

## R25-C — Qwen provider adapter

Create a provider-specific Qwen adapter behind Model Fabric.

The adapter owns:

- DashScope/Qwen WebSocket URL and protocol;
- session.update serialization;
- input_audio_buffer.append;
- input_image_buffer.append;
- response event parsing;
- source transcript reconstruction;
- translation delta reconstruction;
- audio chunk decoding;
- speaker-id mapping;
- hotword configuration;
- usage accounting;
- retry/reconnect behavior;
- provider error normalization.

No Qwen-specific types may cross into shared Product/Experience code.

## R25-D — Web transport

WebFlix should use a server-side realtime bridge:

Browser -> WebFlix WebSocket -> Qwen WebSocket

Never:

Browser -> Qwen with a long-lived Alibaba API key.

Vercel announced WebSocket support for Functions in public beta in June 2026 and its current knowledge-base guidance says Vercel Functions can serve WebSocket connections; connections are pinned to one Function instance and durable shared state should be externalized. WebFlix should therefore prototype the bridge on Vercel Fluid Compute while keeping the shared contract provider-neutral, with reconnectable sessions and external state where necessary. cite placeholder3  

The realtime bridge should persist only what is needed for continuity/telemetry by default. Raw media should not be persisted unless the user explicitly requests a generated artifact.

## R25-E — Media-source integration

The model should consume audio/frames only when WebFlix has lawful and technical access.

### Full-fidelity paths

- WebFlix-owned media pipeline;
- authorized local media;
- authorized torrent/peer playback;
- WebFlix-controlled live stream input;
- other source adapters that explicitly expose authorized media streams.

### Restricted paths

Provider iframe/embed surfaces may not expose their media stream to WebFlix. WebFlix must not bypass DRM, cross-origin isolation, access controls or source restrictions just to obtain audio.

For restricted surfaces:

- prefer provider-provided captions/transcripts where available;
- offer translation of user-provided text/subtitles where permitted;
- otherwise truthfully mark live translation unavailable.

This preserves the existing BrowserHost/security boundary.

## R25-F — Visual context

Qwen3.8 can receive image frames in addition to audio. Official documentation says images may be captured from a realtime video stream and are optional. Visual input can improve translation by using on-screen text, lip movement, gestures and other visual context. cite placeholder1  

WebFlix should not send every video frame.

Use an adaptive visual sampler:

- scene-change trigger;
- OCR/on-screen-text trigger;
- speaker/shot change trigger;
- low-rate periodic frame fallback.

The frame sampler belongs to the media adapter, not the Qwen provider.

## R25-G — Bilingual player experience

Add a familiar player-local language control:

Translate -> [target language]

Then let the user choose:

- translated subtitles;
- original + translated subtitles;
- translated speech;
- original audio;
- bilingual transcript.

A live bilingual view should preserve source/translation alignment rather than replacing the original transcript.

Speaker labels should be simple and contextual, e.g. Speaker 1 / Speaker 2, unless trusted source metadata supplies names.

## R25-H — Voice cloning safety and product policy

Qwen supports voice cloning. The default WebFlix path should **not** clone voices.

Default:

- translated speech uses a neutral/system voice;
- user may enable voice preservation only when rights/consent requirements are satisfied;
- voice-clone provenance/consent state is recorded with the generated artifact/session.

Never silently clone a source speaker.

## R25-I — Hotwords and domain terminology

Expose hotword support through the shared model policy only as a product feature when useful.

Examples:

- movie/series character names;
- creator names;
- technical terms;
- product/company names;
- game names.

The provider adapter converts the normalized vocabulary to Qwen's provider syntax.

## R25-J — Anonymous and authenticated behavior

Anonymous users may use realtime translation for currently playable public media when the capability does not require durable identity.

Login is needed only when the user wants durable:

- preferred translation language;
- translated-language voice settings;
- saved translated artifacts;
- synchronized subtitle preferences;
- cross-device translation history.

This follows R23's accountless-public-viewing law.

## R25-K — Cost and latency controls

Current Alibaba documentation lists indicative International/Singapore pricing of $7.50 per million input-audio tokens, $20 per million text-output tokens, $30 per million output-audio tokens and $0.55 per million image-input tokens. The documented audio rates imply roughly $0.19/hour for input audio alone and about $1.35/hour for output audio alone before text/image usage and promotions; actual cost varies with usage and output. cite placeholder2  

Because output speech is substantially more expensive than input audio, Model Policy should support:

- text-only translation;
- text + audio translation;
- session duration limits;
- anonymous quotas;
- user/account budget limits;
- adaptive visual sampling;
- automatic fallback to text-only when audio output would exceed policy.

Do not let cost controls block the user's existing playback.

## R25-L — Performance acceptance

Qwen reports approximately 2.3 seconds average lagging, but WebFlix must benchmark end-to-end latency rather than treating that figure as guaranteed UI latency. cite placeholder0  

Measure:

- first source transcript delta;
- first translated text delta;
- first translated speech chunk;
- stable translated segment;
- speaker attribution availability;
- reconnect time;
- audio continuity;
- drift between source and translated subtitle timing.

Acceptance target:

- start translating without delaying video playback;
- translated text begins promptly after the source utterance starts;
- reconnect does not require restarting the media item;
- source captions remain available if translation fails;
- translation failure never stops base playback.

Exact numeric thresholds should be ratified from R24 benchmark hardware/network data rather than copied from provider marketing.

## R25-M — Three-worker execution

### Worker 1 — Shared Experience/Intelligence

Own:

- realtime media-session contract;
- Model Fabric realtime task/capabilities;
- provider metadata and provenance;
- router policy;
- normalized event vocabulary;
- usage/cost model;
- privacy/consent state contracts;
- shared tests.

### Worker 2 — Web

Own:

- WebSocket realtime bridge integration;
- player Translate control;
- bilingual subtitle/transcript surface;
- translated-audio playback controls;
- graceful fallback;
- anonymous behavior;
- browser evidence and latency instrumentation.

### Worker 3 — Desktop/native/torrent

Own:

- native audio capture;
- native output mixing;
- torrent/local/live media integration;
- translated-audio buffering;
- reconnect/recovery;
- Desktop evidence and latency instrumentation.

### Lead

Own:

- current Qwen documentation verification;
- provider/service/legal boundary review;
- Model Fabric contract ratification;
- performance/cost benchmark;
- Vercel realtime deployment verification;
- voice-cloning consent policy;
- final J43 acceptance.

## J43 — Realtime translation

Fresh public playable media with an accessible audio stream:

Play -> Translate -> choose target language -> show original + translated captions -> speaker changes -> translation continues -> optionally enable translated audio -> network interruption -> reconnect -> return to normal playback.

Acceptance:

- base video playback begins without waiting for translation;
- translated text and/or audio arrive incrementally;
- source + translation stay aligned;
- speaker attribution remains truthful;
- visual context improves supported cases without becoming a mandatory video-upload pipeline;
- failure falls back to original playback/captions;
- no provider credentials reach the browser;
- Web/Desktop semantics agree where both platforms support the capability;
- torrent/local playback can use the same translation session seam.

## R25 rejection criteria

Reject:

- Qwen API calls in shared product logic;
- Qwen credentials in the client;
- treating Qwen3.8 as a batch transform;
- replacing R2T2 or the batch ASR stack wholesale;
- requiring translation to start playback;
- forcing visual-frame upload when audio alone is sufficient;
- silent voice cloning;
- capturing protected/provider media by bypassing browser/security controls;
- anonymous users being forced to log in for a non-durable translation session;
- hardcoded Qwen language/model assumptions outside Model Fabric.

## Completion truth

R25 is green only when J43 passes on supported Web and Desktop paths, the provider is registered through Model Fabric, realtime session semantics are provider-neutral, Qwen credentials stay server-side, Vercel/realtime deployment is verified, cost/latency telemetry is captured, voice-cloning policy is enforced, and R23/R24 journeys remain green.
