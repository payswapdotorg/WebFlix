/**
 * @wfx/app-web — the DETERMINISTIC DEV REALTIME PROVIDER (R25-D's
 * fixtures-boot double of the R25-C provider adapter).
 *
 * THE HONEST DOUBLE LAW (the R23-G live-captions precedent, the same
 * discipline): this module is the dev/fixtures composition's stand-in for
 * the Model-Fabric realtime provider adapter (Worker 1's R25-C lane). It
 * speaks the SAME normalized event vocabulary the real adapter will
 * (source-transcript-delta … usage-telemetry — see realtime-contract.ts),
 * over a REAL WebSocket hop (the bridge's provider client connects here),
 * with DETERMINISTIC scripted timing — so the bridge's transport,
 * reconnect, continuity, and instrumentation laws are exercised by the
 * REAL machinery, while the CONTENT and the modeled latencies are loudly
 * the dev double's, never a claimed live-endpoint measurement.
 *
 * WHAT IS REAL HERE: a real WebSocket server; real session
 * start/resume/stop control flow; a real scripted provider DROP (the WS
 * closes mid-stream — the bridge must reconnect and resume); a real
 * terminal-failure direction (de); real PCM16 audio chunks (synthesized
 * tones — real bytes the translated-speech player plays).
 *
 * WHAT IS MODELED (never claimed as measured): the ~2,300 ms translation
 * lag (the plan's documented research profile), the segment pacing, the
 * script's translation text (deterministic dev content derived from the
 * fixture transcript artifact — the committed double's own law).
 *
 * NEVER REACHED IN PRODUCTION: this module is loaded ONLY through the
 * fixtures boot's dynamic import (instrumentation.ts — the R23 lesson:
 * the serverless graph never statically reaches the provider double).
 */

import { createServer, type Server as HttpServer } from "node:http";

import { WebSocket as WsServerSocket, WebSocketServer } from "ws";

import type {
  RealtimeModality,
  RealtimeProviderRefusal,
  RealtimeProviderSession,
  RealtimeProviderSessionFactory,
  RealtimeProviderStreamEvent,
  RealtimeSessionConfig,
  RealtimeTargetLanguage,
} from "./realtime-contract";

// ---------------------------------------------------------------------------
// The provider's declared capability (the bridge's capability read)
// ---------------------------------------------------------------------------

/** The dev provider's provider-neutral id (never a real provider's name). */
export const DEV_REALTIME_PROVIDER_ID = "wfx-dev-realtime";

/** The honest provider detail (the loud dev badge sentence). */
export const DEV_REALTIME_PROVIDER_DETAIL =
  "the deterministic dev realtime provider (the fixtures double — scripted source/translation content and modeled latencies; a registered Model-Fabric realtime provider serves the live lane in service mode)";

/** The dev provider's modeled lag profile (the rendered envelope truth). */
export const DEV_REALTIME_MODELED_LAG_MS = 2_300;

/** The target languages the dev provider declares (its supported directions). */
export const DEV_REALTIME_TARGET_LANGUAGES: readonly RealtimeTargetLanguage[] = [
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
 * named speakers (§R25-G: simple + contextual labels for the live stream;
 * the named labels stay the batch transcript artifact's own truth).
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
        fr: "un champ profond n'est pas une photographie. Ce sont des heures du même pan d'obscurité, empilées.",
        pt: "Um campo profundo não é uma fotografia. São horas do mesmo recanto de escuridão, empilhadas.",
        ja: "ディープフィールドは一枚の写真ではありません。同じ暗闇的一片を何時間も重ねたものです。",
      },
    },
    {
      startMs: 25_000,
      endMs: 36_000,
      speaker: "Speaker 2",
      source: "The long exposure begins. The telescope tracks a fixed point while the earth turns beneath it.",
      translations: {
        es: "Comienza la larga exposición: el telescopio sigue un punto fijo mientras la tierra gira debajo.",
        fr: "La longue pose commence. Le télescope suit un point fixe pendant que la Terre tourne beneath lui.",
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
        ja: "銀河がひとつずつ姿を現します。光の每一个染みが、まるごと一つの星の島なのです。",
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
/** The modeled translation lag (the documented research profile, ~2.3 s). */
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
// The PCM16 tone synthesis (real bytes the translated-speech player plays)
// ---------------------------------------------------------------------------

/** Synthesize one PCM16/24000 mono chunk (a soft per-segment tone — real audio, honestly synthetic). */
function synthesizePcmChunk(segmentId: number, durationMs: number, seq: number): string {
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
  return Buffer.from(bytes).toString("base64");
}

// ---------------------------------------------------------------------------
// The provider WebSocket service
// ---------------------------------------------------------------------------

/** One live provider-side session (the script's drive state). */
interface ProviderScriptSession {
  readonly token: string;
  config: RealtimeSessionConfig;
  /** The wall clock the session started (script timing origin). */
  readonly startedAtMs: number;
  /** The script's segment cursor (the last segment EMITTED, 0-based index). */
  emittedSegments: number;
  /** The OBSERVED wall time of each segment's committed source final (the timing pair's truth). */
  readonly sourceFinalWall: Map<number, number>;
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

/** The control message shapes the provider answers (the seam's dev double protocol). */
type ProviderControl =
  | { kind: "provider-session-start"; session: RealtimeSessionConfig }
  | { kind: "provider-session-resume"; token: string; lastCommittedSegmentId: number }
  | { kind: "provider-audio-append"; payload: string }
  | { kind: "provider-configure"; modalities?: RealtimeModality[]; subtitleMode?: string }
  | { kind: "provider-stop" };

/**
 * Start the deterministic dev realtime provider (a real WebSocket server).
 * Sessions are keyed per connection; the bridge's provider client is the
 * only intended consumer.
 */
export function startDevRealtimeProvider(
  options: DevRealtimeProviderOptions,
): DevRealtimeProviderHandle {
  const sessions = new Map<string, ProviderScriptSession>();

  const emit = (ws: WsServerSocket, event: RealtimeProviderStreamEvent): void => {
    if (ws.readyState !== WsServerSocket.OPEN) return;
    ws.send(JSON.stringify(event));
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
    const script = SCRIPTS[session.config.externalRef];
    if (script === undefined) return;
    const audioWantedAt = (): boolean => session.config.modalities.includes("audio");
    for (let index = fromIndex; index < script.length; index += 1) {
      const segment = script[index]!;
      const segmentNumber = index + 1;
      // The segment's wall origin (relative to the session start; the
      // resume path shifts by the drive delay only — deterministic).
      const origin = delayMs + FIRST_SOURCE_DELAY_MS + (index - fromIndex) * SEGMENT_PACING_MS;
      const previous = index > 0 ? script[index - 1]! : null;
      const speakerChanged = previous === null || previous.speaker !== segment.speaker;
      const push = (offsetMs: number, run: () => void): void => {
        session.timers.push(setTimeout(run, origin + offsetMs));
      };
      // source-transcript-delta (partial) then final.
      push(0, () => {
        if (session.ended) return;
        session.emittedSegments = Math.max(session.emittedSegments, index + 1);
        emit(ws, {
          kind: "source-transcript-delta",
          sessionId: "",
          segmentId: segmentNumber,
          text: segment.source,
          startMs: segment.startMs,
          endMs: null,
          partial: true,
          speaker: segment.speaker,
          atMs: Date.now(),
        } satisfies RealtimeProviderStreamEvent);
        emit(ws, {
          kind: "speaker-attribution",
          sessionId: "",
          segmentId: segmentNumber,
          speaker: segment.speaker,
          changed: speakerChanged,
          atMs: Date.now(),
        } satisfies RealtimeProviderStreamEvent);
      });
      push(SOURCE_FINAL_OFFSET_MS, () => {
        if (session.ended) return;
        session.sourceFinalWall.set(segmentNumber, Date.now());
        emit(ws, {
          kind: "source-transcript-final",
          sessionId: "",
          segmentId: segmentNumber,
          text: segment.source,
          startMs: segment.startMs,
          endMs: segment.endMs,
          speaker: segment.speaker,
          atMs: Date.now(),
        } satisfies RealtimeProviderStreamEvent);
      });
      // The scripted terminal failure (the de direction after segment 2).
      if (
        session.config.targetLanguage === SCRIPTED_FAILURE_LANGUAGE &&
        segmentNumber >= 2
      ) {
        push(SOURCE_FINAL_OFFSET_MS + 120, () => {
          if (session.ended) return;
          session.ended = true;
          clearTimers(session);
          ws.send(
            JSON.stringify({
              kind: "provider-terminal",
              errorKind: "provider-failed",
              detail:
                "the provider's German direction failed mid-session (the dev provider's scripted terminal failure — the graceful-fallback walk)",
              recovery: "Start the translation again, or keep watching with the original captions.",
            }),
          );
          ws.close();
        });
        return;
      }
      // translation deltas + final (the modeled lag).
      const translation = segment.translations[session.config.targetLanguage];
      if (translation !== undefined) {
        const half = Math.floor(translation.length / 2);
        push(TRANSLATION_LAG_MS, () => {
          if (session.ended) return;
          emit(ws, {
            kind: "translation-delta",
            sessionId: "",
            segmentId: segmentNumber,
            targetLanguage: session.config.targetLanguage,
            text: translation.slice(0, half),
            partial: true,
            atMs: Date.now(),
          } satisfies RealtimeProviderStreamEvent);
        });
        push(TRANSLATION_LAG_MS + TRANSLATION_DELTA_GAP_MS, () => {
          if (session.ended) return;
          emit(ws, {
            kind: "translation-delta",
            sessionId: "",
            segmentId: segmentNumber,
            targetLanguage: session.config.targetLanguage,
            text: translation,
            partial: true,
            atMs: Date.now(),
          } satisfies RealtimeProviderStreamEvent);
        });
        push(TRANSLATION_LAG_MS + TRANSLATION_DELTA_GAP_MS + TRANSLATION_FINAL_GAP_MS, () => {
          if (session.ended) return;
          const translationFinalAtWall = Date.now();
          emit(ws, {
            kind: "translation-segment-final",
            sessionId: "",
            segmentId: segmentNumber,
            targetLanguage: session.config.targetLanguage,
            text: translation,
            startMs: segment.startMs,
            endMs: segment.endMs,
            speaker: segment.speaker,
            atMs: translationFinalAtWall,
          } satisfies RealtimeProviderStreamEvent);
          // timing-metadata (the source/translation pair — §R25-A; the
          // R25-L drift derivation's input, from OBSERVED wall times).
          const sourceFinalWall = session.sourceFinalWall.get(segmentNumber) ?? translationFinalAtWall - (TRANSLATION_LAG_MS - SOURCE_FINAL_OFFSET_MS);
          emit(ws, {
            kind: "timing-metadata",
            sessionId: "",
            segmentId: segmentNumber,
            sourceStartMs: segment.startMs,
            sourceFinalAtMs: sourceFinalWall,
            translationFinalAtMs: translationFinalAtWall,
            atMs: translationFinalAtWall,
          } satisfies RealtimeProviderStreamEvent);
          // usage-telemetry (the provider's own usage truth — §R25-A).
          emit(ws, {
            kind: "usage-telemetry",
            sessionId: "",
            inputAudioMs: SEGMENT_PACING_MS,
            outputTextChars: translation.length,
            outputAudioMs: audioWantedAt() ? 1_200 : 0,
            atMs: Date.now(),
          } satisfies RealtimeProviderStreamEvent);
        });
      }
      // The audio chunk (real PCM bytes — the translated-speech player).
      // The modality is read at FIRE time — a mid-session configure
      // (§R25-A "configure") that enables translated speech takes effect
      // from the next segment (honest, never retroactive).
      if (translation !== undefined) {
        push(TRANSLATION_LAG_MS + TRANSLATION_DELTA_GAP_MS + TRANSLATION_FINAL_GAP_MS + AUDIO_CHUNK_OFFSET_MS, () => {
          if (session.ended || !audioWantedAt()) return;
          emit(ws, {
            kind: "translated-audio-chunk",
            sessionId: "",
            segmentId: segmentNumber,
            seq: 1,
            payload: synthesizePcmChunk(segmentNumber, 1_200, 1),
            format: "pcm16/24000",
            atMs: Date.now(),
          } satisfies RealtimeProviderStreamEvent);
        });
      }
      // The scripted provider DROP (once, after the drop segment's events).
      if (segmentNumber === SCRIPTED_DROP_AFTER_SEGMENT && !session.dropped) {
        push(TRANSLATION_LAG_MS + TRANSLATION_DELTA_GAP_MS + TRANSLATION_FINAL_GAP_MS + AUDIO_CHUNK_OFFSET_MS + 300, () => {
          if (session.ended) return;
          session.dropped = true;
          // The modeled provider network blip: the connection closes
          // abruptly mid-stream. The bridge must reconnect + resume.
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

  /** The provider's message handler (extracted for the ws event wiring). */
  const handleMessage = (ws: WsServerSocket, message: string): void => {
        let parsed: ProviderControl;
        try {
          parsed = JSON.parse(message) as ProviderControl;
        } catch {
          ws.send(JSON.stringify({ kind: "provider-refused", errorKind: "invalid-input", detail: "the control message is not JSON", recovery: "" }));
          return;
        }
        if (parsed.kind === "provider-session-start") {
          const script = SCRIPTS[parsed.session.externalRef];
          if (script === undefined) {
            ws.send(
              JSON.stringify({
                kind: "provider-refused",
                errorKind: "invalid-input",
                detail: `no scripted media for '${parsed.session.externalRef}' (the dev provider's catalog)`,
                recovery: "Play an item whose media the dev provider carries.",
              }),
            );
            ws.close();
            return;
          }
          const token = `devrt_${Math.random().toString(36).slice(2, 10)}`;
          const session: ProviderScriptSession = {
            token,
            config: parsed.session,
            startedAtMs: Date.now(),
            emittedSegments: 0,
            sourceFinalWall: new Map(),
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
              sourceStream: "scripted-dev-double",
            }),
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
                errorKind: "invalid-input",
                detail: "the provider session is unknown or ended",
                recovery: "Start a new session.",
              }),
            );
            ws.close();
            return;
          }
          connectionTokens.set(ws, session.token);
          ws.send(JSON.stringify({ kind: "provider-session-ready", token: session.token, providerId: DEV_REALTIME_PROVIDER_ID, sourceStream: "scripted-dev-double", resumed: true, lastCommittedSegmentId: parsed.lastCommittedSegmentId }));
          scheduleFrom(ws, session, parsed.lastCommittedSegmentId, RESUME_DELAY_MS);
          return;
        }
        if (parsed.kind === "provider-audio-append") {
          // The production capture path's relay target: the dev double
          // counts the appended audio into its usage truth (honest — the
          // scripted drive is the fixtures' source, the capture path is
          // the production source; both are typed, never mixed).
          return;
        }
        if (parsed.kind === "provider-configure") {
          // The dev provider honors configure by mutating the session's
          // LIVE config: the audio modality is read at each segment's
          // emission time (a mid-session translated-speech enable takes
          // effect from the next segment — honest, never retroactive).
          const token = connectionTokens.get(ws) ?? null;
          const session = typeof token === "string" ? sessions.get(token) : undefined;
          if (session !== undefined && Array.isArray(parsed.modalities)) {
            const modalities = parsed.modalities.filter(
              (entry): entry is RealtimeModality => entry === "text" || entry === "audio",
            );
            if (modalities.length > 0) {
              session.config = { ...session.config, modalities };
            }
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

// ---------------------------------------------------------------------------
// The provider CLIENT (the bridge's provider-WebSocket leg — the real
// Browser → bridge → PROVIDER transport hop §R25-D wires)
// ---------------------------------------------------------------------------

/** The typed handshake the provider client awaits before the session is live. */
interface ProviderHandshake {
  readonly kind: "provider-session-ready";
  readonly token: string;
  readonly providerId: string;
  readonly sourceStream: string;
  readonly resumed?: boolean;
  readonly lastCommittedSegmentId?: number;
}

/** The provider's terminal failure frame. */
interface ProviderTerminalFrame {
  readonly kind: "provider-terminal";
  readonly errorKind: string;
  readonly detail: string;
  readonly recovery: string;
}

/** The provider's refusal frame (a session could not start/resume). */
interface ProviderRefusalFrame {
  readonly kind: "provider-refused";
  readonly errorKind: string;
  readonly detail: string;
  readonly recovery: string;
}

/** The stream-event kinds the provider emits (the normalized vocabulary subset). */
const STREAM_EVENT_KINDS: readonly string[] = [
  "source-transcript-delta",
  "source-transcript-final",
  "translation-delta",
  "translation-segment-final",
  "speaker-attribution",
  "translated-audio-chunk",
  "timing-metadata",
  "usage-telemetry",
];

/**
 * Create the dev provider CLIENT factory — the seam implementation the
 * fixtures-boot bridge consumes. Every `createSession` opens a REAL
 * WebSocket to the dev provider server (the same hop the production
 * bridge opens to the Model-Fabric-registered provider endpoint), drives
 * the start/resume handshake, and surfaces the provider's normalized
 * events/terminal/close through the typed session interface.
 */
export function createDevRealtimeProviderClient(providerUrl: string): RealtimeProviderSessionFactory {
  return {
    providerId: DEV_REALTIME_PROVIDER_ID,
    providerDetail: DEV_REALTIME_PROVIDER_DETAIL,
    targetLanguages: DEV_REALTIME_TARGET_LANGUAGES,
    async createSession(config, resume) {
      return await new Promise<RealtimeProviderSession | RealtimeProviderRefusal>((resolve) => {
        let settled = false;
        let ws: WebSocket;
        try {
          ws = new WebSocket(providerUrl);
        } catch (error) {
          resolve({
            ok: false,
            kind: "no-realtime-provider-registered",
            detail: `the provider endpoint refused the connection (${error instanceof Error ? error.message : String(error)})`,
            recovery: "Check the realtime provider registration in Model & AI settings.",
          });
          return;
        }
        const eventHandlers: ((event: RealtimeProviderStreamEvent) => void)[] = [];
        const terminalHandlers: ((failure: { errorKind: string; detail: string; recovery: string }) => void)[] = [];
        const closeHandlers: (() => void)[] = [];
        let stopped = false;
        let terminalSeen = false;
        let handshake: ProviderHandshake | null = null;

        const asStreamEvent = (parsed: Record<string, unknown>): RealtimeProviderStreamEvent | null => {
          const kind = parsed["kind"];
          if (typeof kind !== "string" || !STREAM_EVENT_KINDS.includes(kind)) return null;
          // The normalized vocabulary is closed and bridge-stamped: the
          // raw frame is spread into the typed shape with the bridge's
          // sessionId filled by the bridge itself ("" here).
          return parsed as unknown as RealtimeProviderStreamEvent;
        };

        ws.addEventListener("open", () => {
          ws.send(
            JSON.stringify(
              resume === undefined
                ? { kind: "provider-session-start", session: config }
                : {
                    kind: "provider-session-resume",
                    token: resume.providerSessionToken,
                    lastCommittedSegmentId: resume.lastCommittedSegmentId,
                  },
            ),
          );
        });
        ws.addEventListener("message", (event) => {
          if (typeof event.data !== "string") return;
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(event.data) as Record<string, unknown>;
          } catch {
            return;
          }
          const kind = parsed["kind"];
          if (kind === "provider-session-ready") {
            handshake = parsed as unknown as ProviderHandshake;
            if (!settled) {
              settled = true;
              resolve({
                providerId: DEV_REALTIME_PROVIDER_ID,
                token: handshake.token,
                send(message: unknown): void {
                  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
                },
                onEvent(handler): () => void {
                  eventHandlers.push(handler);
                  return () => {
                    const index = eventHandlers.indexOf(handler);
                    if (index >= 0) eventHandlers.splice(index, 1);
                  };
                },
                onTerminal(handler): () => void {
                  terminalHandlers.push(handler);
                  return () => {
                    const index = terminalHandlers.indexOf(handler);
                    if (index >= 0) terminalHandlers.splice(index, 1);
                  };
                },
                onClose(handler): () => void {
                  closeHandlers.push(handler);
                  return () => {
                    const index = closeHandlers.indexOf(handler);
                    if (index >= 0) closeHandlers.splice(index, 1);
                  };
                },
                stop(): void {
                  if (stopped) return;
                  stopped = true;
                  try {
                    ws.send(JSON.stringify({ kind: "provider-stop" }));
                  } catch {
                    // The socket may already be gone — the close below is the truth.
                  }
                  ws.close();
                },
              });
            }
            return;
          }
          if (kind === "provider-refused") {
            const refusal = parsed as unknown as ProviderRefusalFrame;
            if (!settled) {
              settled = true;
              resolve({
                ok: false,
                kind: refusal.errorKind === "anonymous-quota-reached" ? "anonymous-quota-reached" : "invalid-input",
                detail: refusal.detail,
                recovery: refusal.recovery,
              });
            }
            ws.close();
            return;
          }
          if (kind === "provider-terminal") {
            const terminal = parsed as unknown as ProviderTerminalFrame;
            terminalSeen = true;
            for (const handler of [...terminalHandlers]) {
              handler({ errorKind: terminal.errorKind, detail: terminal.detail, recovery: terminal.recovery });
            }
            ws.close();
            return;
          }
          const streamEvent = asStreamEvent(parsed);
          if (streamEvent !== null) {
            for (const handler of [...eventHandlers]) handler(streamEvent);
          }
        });
        ws.addEventListener("close", () => {
          if (!settled) {
            settled = true;
            resolve({
              ok: false,
              kind: "no-realtime-provider-registered",
              detail: "the provider endpoint closed before the session was ready",
              recovery: "Check the realtime provider registration in Model & AI settings.",
            });
            return;
          }
          if (stopped || terminalSeen) return;
          for (const handler of [...closeHandlers]) handler();
        });
        ws.addEventListener("error", () => {
          if (!settled) {
            settled = true;
            resolve({
              ok: false,
              kind: "no-realtime-provider-registered",
              detail: "the provider endpoint could not be reached",
              recovery: "Check the realtime provider registration in Model & AI settings.",
            });
          }
        });
      });
    },
  };
}
