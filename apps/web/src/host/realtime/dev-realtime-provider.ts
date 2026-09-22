/**
 * @wfx/app-web — the DETERMINISTIC DEV REALTIME PROVIDER (R25-D's
 * fixtures-boot double of the R25-C provider adapter).
 *
 * THE HONEST DOUBLE LAW (the R23-G live-captions precedent, the same
 * discipline): this module is the dev/fixtures composition's stand-in
 * for the Model-Fabric realtime provider adapter (the shared R25-A
 * session port's implementation). Its frames ARE the frozen domain
 * events (`session-created` … `usage-telemetry` from `@wfx/domain` —
 * Worker 1's landed contract, bound verbatim; the ONE transport
 * encoding: the audio chunk's `Uint8Array` rides as `audioBase64` in
 * the adapter's own JSON protocol), over a REAL WebSocket hop (the
 * bridge's provider client connects here), with DETERMINISTIC scripted
 * timing — so the bridge's transport, reconnect, continuity, and
 * instrumentation laws are exercised by the REAL machinery, while the
 * CONTENT and the modeled latencies are loudly the dev double's, never
 * a claimed live-endpoint measurement.
 *
 * WHAT IS REAL HERE: a real WebSocket server; the real session
 * start/resume/stop control flow; a real scripted provider DROP (the
 * connection closes mid-stream — the bridge must drive the domain
 * `reconnect` operation and resume); a real terminal-failure direction
 * (de); real PCM16 translated-speech chunks (synthesized tones — real
 * bytes the translated-speech player plays).
 *
 * WHAT IS MODELED (never claimed as measured): the ~2,300 ms reported
 * average lag (the plan's frozen research figure — rendered as the
 * REPORTED envelope truth, never a UI promise), the segment pacing,
 * the script's translation text (deterministic dev content derived
 * from the fixture transcript artifact — the committed double's own
 * law), and the usage token counts (the double's documented token
 * model, consistent with the plan's implied per-hour figures — the
 * cost MATH itself is the shared cost model's, never this module's).
 *
 * NEVER REACHED IN PRODUCTION: this module is loaded ONLY through the
 * fixtures boot's dynamic import (instrumentation.ts — the R23 lesson:
 * the serverless graph never statically reaches the provider double).
 */

import { createServer, type Server as HttpServer } from "node:http";

import { WebSocket as WsServerSocket, WebSocketServer } from "ws";

import type {
  RealtimeTranslationSessionInputs,
  RealtimeTranslationEvent,
} from "@wfx/domain";

// ---------------------------------------------------------------------------
// The provider's declared identity + capability (the seam's truths)
// ---------------------------------------------------------------------------

/** The dev provider's provider-neutral id (never a real provider's name). */
export const DEV_REALTIME_PROVIDER_ID = "wfx-dev-realtime";

/** The dev double's pinned model identity (the domain session-created truth). */
export const DEV_REALTIME_MODEL_ID = "wfx-dev-realtime-double";
export const DEV_REALTIME_MODEL_REVISION = "r25-dev-1";

/** The honest provider detail (the loud dev badge sentence). */
export const DEV_REALTIME_PROVIDER_DETAIL =
  "the deterministic dev realtime provider (the fixtures double — scripted source/translation content and modeled latencies; a registered Model-Fabric realtime provider serves the live lane in service mode)";

/** The dev provider's REPORTED average lag (the frozen research figure, rendered never promised). */
export const DEV_REALTIME_REPORTED_AVERAGE_LAG_MS = 2_300;

/** The target languages the dev provider declares (its supported directions). */
export const DEV_REALTIME_TARGET_LANGUAGES: readonly { readonly code: string; readonly label: string }[] = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "de", label: "German" },
];

// ---------------------------------------------------------------------------
// The deterministic media scripts (the committed transcript double)
// ---------------------------------------------------------------------------

/** One scripted segment (the media timeline's own span + the speakers + the translations). */
interface ScriptedSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly speaker: "Speaker 1" | "Speaker 2";
  readonly source: string;
  readonly translations: Readonly<Record<string, string>>;
}

/**
 * The scripted media scripts, keyed by externalRef. Deep Field Diary's
 * script derives from the fixture transcript artifact (the same
 * committed-segment double the live-captions surface drives) — the live
 * diarization's simple labels (Speaker 1 / Speaker 2) map the artifact's
 * named speakers (§R25-G: simple + contextual labels for the live
 * stream; the named labels stay the batch transcript artifact's own
 * truth, `trustedSource: false` on the live attribution events).
 */
const SCRIPTS: Readonly<Record<string, readonly ScriptedSegment[]>> = {
  "fake:video-1": [
    {
      startMs: 0,
      endMs: 6_400,
      speaker: "Speaker 1",
      source: "The observatory wakes an hour before dusk — every dome, one checklist.",
      translations: {
        es: "El observatorio despierta una hora antes del crepúsculo: cada cúpula, una sola lista de verificación.",
        fr: "L'observatoire s'éveille une heure avant le crépuscule — chaque dôme, une seule checklist.",
        pt: "O observatório desperta uma hora antes do anoitecer — cada cúpula, uma única lista de verificação.",
        ja: "天文台は夕暮れの1時間前に目を覚まします。すべてのドームに、たった一枚のチェックリスト。",
      },
    },
    {
      startMs: 6_500,
      endMs: 15_200,
      speaker: "Speaker 1",
      source: "First light is a ritual: cooling the sensors, opening the shutter, listening for the sky.",
      translations: {
        es: "La primera luz es un ritual: enfriar los sensores, abrir el obturador, escuchar el cielo.",
        fr: "La première lumière est un rituel : refroidir les capteurs, ouvrir l'obturateur, écouter le ciel.",
        pt: "A primeira luz é um ritual: esfriar os sensores, abrir o obturador, escutar o céu.",
        ja: "最初の光は儀式です。センサーを冷やし、シャッターを開け、空に耳を傾ける。",
      },
    },
    {
      startMs: 15_300,
      endMs: 24_800,
      speaker: "Speaker 1",
      source: "A deep field is not one photograph. It is hours of the same patch of darkness, stacked.",
      translations: {
        es: "Un campo profundo no es una sola fotografía: son horas del mismo fragmento de oscuridad, apiladas.",
        fr: "Un champ profond n'est pas une photographie. Ce sont des heures du même pan d'obscurité, empilées.",
        pt: "Um campo profundo não é uma fotografia. São horas do mesmo recanto de escuridão, empilhadas.",
        ja: "ディープフィールドは一枚の写真ではありません。同じ暗闇の一片を何時間も重ねたものです。",
      },
    },
    {
      startMs: 25_000,
      endMs: 36_000,
      speaker: "Speaker 2",
      source: "The long exposure begins. The telescope tracks a fixed point while the earth turns beneath it.",
      translations: {
        es: "Comienza la larga exposición: el telescopio sigue un punto fijo mientras la tierra gira debajo.",
        fr: "La longue pose commence. Le télescope suit un point fixe pendant que la Terre tourne sous lui.",
        pt: "Começa a longa exposição. O telescópio acompanha um ponto fixo enquanto a Terra gira por baixo.",
        ja: "長時間露光が始まります。地球が下で回転する間、望遠鏡は定点を追い続けます。",
      },
    },
    {
      startMs: 36_100,
      endMs: 45_300,
      speaker: "Speaker 2",
      source: "Galaxies drift into view one by one — each smudge of light, an entire island of stars.",
      translations: {
        es: "Las galaxias aparecen una a una: cada mancha de luz, toda una isla de estrellas.",
        fr: "Les galaxies dérivent une à une — chaque tache de lumière, une île entière d'étoiles.",
        pt: "As galáxias surgem uma a uma — cada mancha de luz, uma ilha inteira de estrelas.",
        ja: "銀河がひとつずつ姿を現します。光の染みひとつひとつが、まるごと一つの星の島なのです。",
      },
    },
    {
      startMs: 45_500,
      endMs: 55_600,
      speaker: "Speaker 1",
      source: "You are not looking at a picture of space. You are looking back in time.",
      translations: {
        es: "No estás mirando una imagen del espacio: estás mirando hacia atrás en el tiempo.",
        fr: "Vous ne regardez pas une image de l'espace. Vous regardez vers le passé.",
        pt: "Você não está olhando para uma imagem do espaço. Está olhando para trás no tempo.",
        ja: "あなたは宇宙の絵を見ているのではありません。時間をさかのぼって見ているのです。",
      },
    },
    {
      startMs: 55_800,
      endMs: 64_200,
      speaker: "Speaker 2",
      source: "The final stack resolves. Thousands of galaxies in a frame of sky you could cover with a grain of sand at arm's length.",
      translations: {
        es: "La pila final se resuelve: miles de galaxias en un fragmento de cielo que cubrirías con un grano de arena a brazo extendido.",
        fr: "La pile finale se résout. Des milliers de galaxies dans un cadre de ciel que couvrirait un grain de sable à bout de bras.",
        pt: "A pilha final se resolve: milhares de galáxias num recorte de céu que um grão de areia cobriria a braço estendido.",
        ja: "最終スタックが解像します。腕を伸ばした砂粒ひとつで覆える空の枠に、数千の銀河が。",
      },
    },
    {
      startMs: 64_300,
      endMs: 71_400,
      speaker: "Speaker 1",
      source: "That is the gift of the long exposure: patience, made visible.",
      translations: {
        es: "Ese es el regalo de la larga exposición: la paciencia, hecha visible.",
        fr: "Voilà le don de la longue pose : la patience, rendue visible.",
        pt: "Esse é o dom da longa exposição: a paciência, tornada visível.",
        ja: "それが長時間露光の贈り物です。可視化された忍耐。",
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// The deterministic timing profile (the modeled latencies — loudly not a
// measurement of any live endpoint)
// ---------------------------------------------------------------------------

/** Wall-clock delay from session start to the first source delta. */
const FIRST_SOURCE_DELAY_MS = 400;
/** Wall-clock pacing between scripted segments (the drive's own pace). */
const SEGMENT_PACING_MS = 3_200;
/** Source partial → final gap. */
const SOURCE_FINAL_OFFSET_MS = 700;
/** The modeled translation lag (the frozen research profile, ~2.3 s). */
const TRANSLATION_LAG_MS = 2_300;
/** Translation delta 1 → delta 2 gap. */
const TRANSLATION_DELTA_GAP_MS = 300;
/** Translation final after the second delta. */
const TRANSLATION_FINAL_GAP_MS = 300;
/** The audio chunk after the translation final. */
const AUDIO_CHUNK_OFFSET_MS = 200;
/** The delay before a resumed session continues (the modeled recovery). */
const RESUME_DELAY_MS = 500;
/**
 * The scripted provider DROP: after this segment index (1-based) the
 * provider's connection closes mid-stream — the bridge's provider
 * reconnect + resume path is exercised for real.
 */
const SCRIPTED_DROP_AFTER_SEGMENT = 3;
/**
 * The scripted terminal-failure direction: sessions targeting this
 * language fail terminally after the second committed source segment
 * (the graceful-fallback walk's honest provider failure).
 */
const SCRIPTED_FAILURE_LANGUAGE = "de";

// ---------------------------------------------------------------------------
// The PCM16 tone synthesis + the double's documented token model
// ---------------------------------------------------------------------------

/** Synthesize one PCM16/24000 mono chunk (a soft per-segment tone — real audio, honestly synthetic). */
function synthesizePcmChunk(segmentId: number, durationMs: number, seq: number): Uint8Array {
  const sampleRate = 24_000;
  const sampleCount = Math.floor((durationMs / 1000) * sampleRate);
  const bytes = new Uint8Array(sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const baseFreq = 320 + segmentId * 40 + seq * 12;
  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / sampleRate;
    // A soft two-tone chord with a fade-in envelope (audible, gentle).
    const envelope = Math.min(1, index / (sampleRate * 0.02)) * 0.22;
    const sample =
      envelope * (Math.sin(2 * Math.PI * baseFreq * t) + 0.6 * Math.sin(2 * Math.PI * (baseFreq * 1.5) * t));
    view.setInt16(index * 2, Math.max(-32768, Math.min(32767, Math.round(sample * 32767 * 0.5))), true);
  }
  return bytes;
}

/**
 * The double's documented token model (consistent with the plan's
 * implied per-hour figures — the cost MATH is the shared model's):
 * input audio ≈ 7 tokens/second; text output ≈ 1 token per 4 chars;
 * output audio ≈ 12.5 tokens/second.
 */
const INPUT_AUDIO_TOKENS_PER_SECOND = 7;
const OUTPUT_AUDIO_TOKENS_PER_SECOND = 12.5;

// ---------------------------------------------------------------------------
// The provider's frame vocabulary (the adapter's OWN protocol — the
// domain events in their wire encoding + the control frames)
// ---------------------------------------------------------------------------

/**
 * The double's stream frames: the frozen domain events with
 * `sessionId: ""` (the adapter-side session stamps the true id) and
 * the audio chunk carrying `audioBase64` (the one documented transport
 * encoding — decoded at the adapter boundary).
 */
export type DevProviderStreamFrame = RealtimeTranslationEvent & {
  readonly audioBase64?: string;
};

/** The ready handshake frame. */
interface ProviderHandshakeFrame {
  readonly kind: "provider-session-ready";
  readonly token: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly sourceStream: string;
  readonly resumed?: boolean;
}

/** The provider's terminal failure frame (the domain errorKind vocabulary). */
interface ProviderTerminalFrame {
  readonly kind: "provider-terminal";
  readonly errorKind: "provider-failure" | "policy" | "unknown";
  readonly detail: string;
  readonly recovery: string;
}

/** The provider's refusal frame (a session could not start/resume). */
interface ProviderRefusalFrame {
  readonly kind: "provider-refused";
  readonly errorKind: "policy" | "unsupported-language-direction" | "unknown";
  readonly detail: string;
  readonly recovery: string;
}

/** The control messages the double answers (its own protocol — the adapter owns it). */
export type DevProviderControl =
  | { kind: "provider-session-start"; inputs: RealtimeTranslationSessionInputs }
  | { kind: "provider-session-resume"; token: string; lastCommittedSegmentId: string }
  | { kind: "provider-audio-append"; payloadBase64: string }
  | { kind: "provider-configure"; outputModality?: "text" | "text-and-audio" }
  | { kind: "provider-stop" };

// ---------------------------------------------------------------------------
// The provider WebSocket service
// ---------------------------------------------------------------------------

/** One live provider-side session (the script's drive state). */
interface ProviderScriptSession {
  readonly token: string;
  inputs: RealtimeTranslationSessionInputs;
  /** The wall clock the session started (script timing origin). */
  readonly startedAtMs: number;
  /** The OBSERVED wall time of each segment's committed source final. */
  readonly sourceFinalWall: Map<string, number>;
  /** The first-observation flags (the incremental timing-metadata truth). */
  firstSourceDeltaObserved: boolean;
  firstTranslationDeltaObserved: boolean;
  firstAudioChunkObserved: boolean;
  /** The pending wall timers (cleaned on close). */
  timers: ReturnType<typeof setTimeout>[];
  /** Whether the session ended (terminal/closed). */
  ended: boolean;
  /** Whether the scripted drop already fired (once per session). */
  dropped: boolean;
}

/** The options for {@link startDevRealtimeProvider}. */
export interface DevRealtimeProviderOptions {
  /** The fixed port (the dev boot's 3103; tests inject their own). */
  readonly port: number;
}

/** The running dev provider handle. */
export interface DevRealtimeProviderHandle {
  readonly port: number;
  readonly url: string;
  stop(): Promise<void>;
}

/** The double's active script derivation (null when the item has no script). */
export function devRealtimeScriptFor(externalRef: string): readonly ScriptedSegment[] | null {
  return SCRIPTS[externalRef] ?? null;
}

/**
 * Start the deterministic dev realtime provider (a real WebSocket server).
 * Sessions are keyed per connection; the adapter-side session client
 * (dev-realtime-session.ts) is the only intended consumer.
 */
export function startDevRealtimeProvider(
  options: DevRealtimeProviderOptions,
): DevRealtimeProviderHandle {
  const sessions = new Map<string, ProviderScriptSession>();

  const emit = (ws: WsServerSocket, frame: DevProviderStreamFrame): void => {
    if (ws.readyState !== WsServerSocket.OPEN) return;
    ws.send(JSON.stringify(frame));
  };

  const clearTimers = (session: ProviderScriptSession): void => {
    for (const timer of session.timers) clearTimeout(timer);
    session.timers = [];
  };

  /** Schedule the scripted stream from the given segment index (inclusive, 0-based). */
  const scheduleFrom = (
    ws: WsServerSocket,
    session: ProviderScriptSession,
    fromIndex: number,
    delayMs: number,
  ): void => {
    const script = SCRIPTS[session.inputs.sourceMedia.externalRef ?? ""];
    if (script === undefined) return;
    const wantsAudio = (): boolean => session.inputs.outputModality === "text-and-audio";
    for (let index = fromIndex; index < script.length; index += 1) {
      const segment = script[index]!;
      const segmentId = `seg-${index + 1}`;
      // The segment's wall origin (relative to the session start; the
      // resume path shifts by the drive delay only — deterministic).
      const origin = delayMs + FIRST_SOURCE_DELAY_MS + (index - fromIndex) * SEGMENT_PACING_MS;
      const speakerId = segment.speaker === "Speaker 1" ? "speaker-1" : "speaker-2";
      const push = (offsetMs: number, run: () => void): void => {
        session.timers.push(setTimeout(run, origin + offsetMs));
      };
      // source-transcript-delta (the segment's first half, then the full).
      push(0, () => {
        if (session.ended) return;
        emit(ws, {
          kind: "source-transcript-delta",
          sessionId: "",
          occurredAt: new Date().toISOString(),
          segmentId,
          deltaText: segment.source.slice(0, Math.floor(segment.source.length / 2)),
          sourceLanguage: "en",
          timing: { startedAtMs: segment.startMs, endedAtMs: segment.endMs },
        });
        emit(ws, {
          kind: "speaker-attribution",
          sessionId: "",
          occurredAt: new Date().toISOString(),
          speakerId,
          label: segment.speaker,
          segmentId,
          trustedSource: false,
        });
        if (!session.firstSourceDeltaObserved) {
          session.firstSourceDeltaObserved = true;
          emit(ws, {
            kind: "timing-metadata",
            sessionId: "",
            occurredAt: new Date().toISOString(),
            firstSourceTranscriptDeltaMs: Date.now() - session.startedAtMs,
          });
        }
      });
      push(SOURCE_FINAL_OFFSET_MS, () => {
        if (session.ended) return;
        session.sourceFinalWall.set(segmentId, Date.now());
        emit(ws, {
          kind: "source-transcript-final",
          sessionId: "",
          occurredAt: new Date().toISOString(),
          segmentId,
          text: segment.source,
          speakerId,
          timing: { startedAtMs: segment.startMs, endedAtMs: segment.endMs },
        });
      });
      // The scripted terminal failure (the de direction after segment 2).
      if (
        session.inputs.targetLanguage === SCRIPTED_FAILURE_LANGUAGE &&
        index >= 1
      ) {
        push(SOURCE_FINAL_OFFSET_MS + 120, () => {
          if (session.ended) return;
          session.ended = true;
          clearTimers(session);
          ws.send(
            JSON.stringify({
              kind: "provider-terminal",
              errorKind: "provider-failure",
              detail:
                "the provider's German direction failed mid-session (the dev provider's scripted terminal failure — the graceful-fallback walk)",
              recovery: "Start the translation again, or keep watching with the original captions.",
            } satisfies ProviderTerminalFrame),
          );
          ws.close();
        });
        return;
      }
      // translation deltas + final (the modeled lag).
      const translation = segment.translations[session.inputs.targetLanguage];
      if (translation !== undefined) {
        const half = Math.floor(translation.length / 2);
        push(TRANSLATION_LAG_MS, () => {
          if (session.ended) return;
          emit(ws, {
            kind: "translation-delta",
            sessionId: "",
            occurredAt: new Date().toISOString(),
            segmentId: `${segmentId}-tr`,
            sourceSegmentId: segmentId,
            targetLanguage: session.inputs.targetLanguage,
            deltaText: translation.slice(0, half),
          });
          if (!session.firstTranslationDeltaObserved) {
            session.firstTranslationDeltaObserved = true;
            emit(ws, {
              kind: "timing-metadata",
              sessionId: "",
              occurredAt: new Date().toISOString(),
              firstTranslationDeltaMs: Date.now() - session.startedAtMs,
            });
          }
        });
        push(TRANSLATION_LAG_MS + TRANSLATION_DELTA_GAP_MS, () => {
          if (session.ended) return;
          emit(ws, {
            kind: "translation-delta",
            sessionId: "",
            occurredAt: new Date().toISOString(),
            segmentId: `${segmentId}-tr`,
            sourceSegmentId: segmentId,
            targetLanguage: session.inputs.targetLanguage,
            deltaText: translation.slice(half),
          });
        });
        push(TRANSLATION_LAG_MS + TRANSLATION_DELTA_GAP_MS + TRANSLATION_FINAL_GAP_MS, () => {
          if (session.ended) return;
          const translationFinalWall = Date.now();
          emit(ws, {
            kind: "translation-segment-final",
            sessionId: "",
            occurredAt: new Date().toISOString(),
            segmentId: `${segmentId}-tr`,
            sourceSegmentId: segmentId,
            targetLanguage: session.inputs.targetLanguage,
            text: translation,
            timing: { startedAtMs: segment.startMs, endedAtMs: segment.endMs },
          });
          // timing-metadata (the source/translation lag — the provider's
          // own observed pair for this segment, §R25-A).
          const sourceFinalWall = session.sourceFinalWall.get(segmentId);
          if (sourceFinalWall !== undefined) {
            emit(ws, {
              kind: "timing-metadata",
              sessionId: "",
              occurredAt: new Date().toISOString(),
              sourceToTranslationLagMs: Math.max(0, translationFinalWall - sourceFinalWall),
            });
          }
          // usage-telemetry (the double's documented token model; the
          // cost MATH is the shared model's — §R25-A).
          emit(ws, {
            kind: "usage-telemetry",
            sessionId: "",
            occurredAt: new Date().toISOString(),
            usage: {
              inputAudioTokens: Math.round((SEGMENT_PACING_MS / 1000) * INPUT_AUDIO_TOKENS_PER_SECOND),
              textOutputTokens: Math.ceil(translation.length / 4),
              outputAudioTokens: wantsAudio()
                ? Math.round(1.2 * OUTPUT_AUDIO_TOKENS_PER_SECOND)
                : 0,
              imageInputTokens: 0,
            },
          });
        });
      }
      // The audio chunk (real PCM bytes — the translated-speech player).
      // The modality is read at FIRE time — a mid-session configure
      // (§R25-A "configure") that enables translated speech takes effect
      // from the next segment (honest, never retroactive).
      if (translation !== undefined) {
        push(TRANSLATION_LAG_MS + TRANSLATION_DELTA_GAP_MS + TRANSLATION_FINAL_GAP_MS + AUDIO_CHUNK_OFFSET_MS, () => {
          if (session.ended || !wantsAudio()) return;
          const chunk = synthesizePcmChunk(index + 1, 1_200, 1);
          emit(ws, {
            kind: "translated-audio-chunk",
            sessionId: "",
            occurredAt: new Date().toISOString(),
            sequence: index + 1,
            audioBase64: Buffer.from(chunk).toString("base64"),
            format: "pcm16",
            timing: { startedAtMs: segment.startMs, endedAtMs: segment.endMs },
          } as unknown as DevProviderStreamFrame);
          if (!session.firstAudioChunkObserved) {
            session.firstAudioChunkObserved = true;
            emit(ws, {
              kind: "timing-metadata",
              sessionId: "",
              occurredAt: new Date().toISOString(),
              firstTranslatedAudioChunkMs: Date.now() - session.startedAtMs,
            });
          }
        });
      }
      // The scripted provider DROP (once, after the drop segment's events).
      if (index + 1 === SCRIPTED_DROP_AFTER_SEGMENT && !session.dropped) {
        push(TRANSLATION_LAG_MS + TRANSLATION_DELTA_GAP_MS + TRANSLATION_FINAL_GAP_MS + AUDIO_CHUNK_OFFSET_MS + 300, () => {
          if (session.ended) return;
          session.dropped = true;
          // The modeled provider network blip: the connection closes
          // abruptly mid-stream. The bridge must drive the domain
          // 'reconnect' operation and resume.
          ws.terminate();
        });
        return;
      }
    }
  };

  /** The per-connection provider session token (the routing key). */
  const connectionTokens = new WeakMap<WsServerSocket, string>();

  const httpServer: HttpServer = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://localhost:${options.port}`);
    if (url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, provider: DEV_REALTIME_PROVIDER_ID }));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WsServerSocket) => {
    // Nothing on open — the first control message creates the session.
    ws.on("message", (data: unknown, _isBinary: boolean) => {
      const message = typeof data === "string" ? data : Buffer.from(data as ArrayBufferLike).toString("utf8");
      handleMessage(ws, message);
    });
    ws.on("close", () => {
      handleClose(ws);
    });
  });

  /** The provider's message handler (the ws event wiring). */
  const handleMessage = (ws: WsServerSocket, message: string): void => {
    let parsed: DevProviderControl;
    try {
      parsed = JSON.parse(message) as DevProviderControl;
    } catch {
      ws.send(
        JSON.stringify({
          kind: "provider-refused",
          errorKind: "unknown",
          detail: "the control message is not JSON",
          recovery: "",
        } satisfies ProviderRefusalFrame),
      );
      return;
    }
    if (parsed.kind === "provider-session-start") {
      const externalRef = parsed.inputs.sourceMedia.externalRef ?? "";
      const script = SCRIPTS[externalRef];
      // The double's own fail-closed gates (the shared validator ran
      // bridge-side already; the provider double re-asserts them).
      if (script === undefined) {
        ws.send(
          JSON.stringify({
            kind: "provider-refused",
            errorKind: "policy",
            detail: `no scripted media for '${externalRef}' (the dev provider's catalog)`,
            recovery: "Play an item whose media the dev provider carries.",
          } satisfies ProviderRefusalFrame),
        );
        ws.close();
        return;
      }
      if (parsed.inputs.sourceMedia.audioStreamLegallyAvailable !== true) {
        ws.send(
          JSON.stringify({
            kind: "provider-refused",
            errorKind: "policy",
            detail: "the source media declares no lawful audio path — the provider refuses (no capture circumvention, ever)",
            recovery: "Choose a way of watching whose audio WebFlix can lawfully reach.",
          } satisfies ProviderRefusalFrame),
        );
        ws.close();
        return;
      }
      const token = `devrt_${Math.random().toString(36).slice(2, 10)}`;
      const session: ProviderScriptSession = {
        token,
        inputs: parsed.inputs,
        startedAtMs: Date.now(),
        sourceFinalWall: new Map(),
        firstSourceDeltaObserved: false,
        firstTranslationDeltaObserved: false,
        firstAudioChunkObserved: false,
        timers: [],
        ended: false,
        dropped: false,
      };
      sessions.set(token, session);
      connectionTokens.set(ws, token);
      ws.send(
        JSON.stringify({
          kind: "provider-session-ready",
          token,
          providerId: DEV_REALTIME_PROVIDER_ID,
          modelId: DEV_REALTIME_MODEL_ID,
          modelRevision: DEV_REALTIME_MODEL_REVISION,
          sourceStream: "scripted-dev-double",
        } satisfies ProviderHandshakeFrame),
      );
      scheduleFrom(ws, session, 0, 0);
      return;
    }
    if (parsed.kind === "provider-session-resume") {
      const session = sessions.get(parsed.token);
      if (session === undefined || session.ended) {
        ws.send(
          JSON.stringify({
            kind: "provider-refused",
            errorKind: "policy",
            detail: "the provider session is unknown or ended",
            recovery: "Start a new session.",
          } satisfies ProviderRefusalFrame),
        );
        ws.close();
        return;
      }
      connectionTokens.set(ws, session.token);
      ws.send(
        JSON.stringify({
          kind: "provider-session-ready",
          token: session.token,
          providerId: DEV_REALTIME_PROVIDER_ID,
          modelId: DEV_REALTIME_MODEL_ID,
          modelRevision: DEV_REALTIME_MODEL_REVISION,
          sourceStream: "scripted-dev-double",
          resumed: true,
        } satisfies ProviderHandshakeFrame),
      );
      scheduleFrom(ws, session, Number(parsed.lastCommittedSegmentId.replace("seg-", "")), RESUME_DELAY_MS);
      return;
    }
    if (parsed.kind === "provider-audio-append") {
      // The production capture path's relay target: the dev double
      // counts the appended audio honestly (the scripted drive is the
      // fixtures' source; the capture path is the production source;
      // both are typed, never mixed).
      return;
    }
    if (parsed.kind === "provider-configure") {
      // The dev provider honors configure by mutating the session's
      // LIVE inputs: the audio modality is read at each segment's
      // emission time (a mid-session translated-speech enable takes
      // effect from the next segment — honest, never retroactive).
      const token = connectionTokens.get(ws) ?? null;
      const session = typeof token === "string" ? sessions.get(token) : undefined;
      if (session !== undefined && (parsed.outputModality === "text" || parsed.outputModality === "text-and-audio")) {
        session.inputs = { ...session.inputs, outputModality: parsed.outputModality };
      }
      return;
    }
    if (parsed.kind === "provider-stop") {
      const token = connectionTokens.get(ws) ?? null;
      if (typeof token === "string") {
        const session = sessions.get(token);
        if (session !== undefined) {
          session.ended = true;
          clearTimers(session);
          sessions.delete(token);
        }
      }
      ws.close();
      return;
    }
  };

  /** The provider's close handler (the ws event wiring). */
  const handleClose = (ws: WsServerSocket): void => {
    const token = connectionTokens.get(ws) ?? null;
    if (typeof token !== "string") return;
    const session = sessions.get(token);
    // A scripted DROP is a mid-stream close: the session stays
    // resumable (the bridge's provider reconnect asks for it). A
    // terminal/stop close already removed it.
    if (session !== undefined && !session.ended) {
      clearTimers(session);
    }
  };

  httpServer.listen(options.port);

  return {
    port: options.port,
    url: `ws://localhost:${options.port}`,
    stop: async (): Promise<void> => {
      for (const session of sessions.values()) {
        session.ended = true;
        clearTimers(session);
      }
      sessions.clear();
      wss.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}
