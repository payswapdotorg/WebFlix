/**
 * @wfx/app-api — the media-intelligence DERIVATION PIPELINE (R26-W4).
 *
 * THE PATH that derives R23-F artifact sets for catalog items through
 * MODEL FABRIC — the provider-neutral model routing per the R23-G
 * routing law (docs/plans/2026-09-20-webflix-open-viewing-torrent-ai-plan.md):
 *
 *   source/playable media -> audio extraction -> streaming/batch
 *   transcript -> speaker/acoustic events -> scene/chapter analysis ->
 *   visual/video embeddings -> multilingual text embeddings -> canonical
 *   semantic index -> recommendation/search features.
 *
 * THE MODEL ROUTES (provider-neutral — no provider SDK anywhere):
 *
 * - transcription + speech-events (the long-form/batch route) route
 *   through the `ModelFabric` GATEWAY over registered open-model
 *   providers (MOSS-Transcribe-Diarize preferred, Whisper large v3 turbo
 *   fallback — the R23-G "MOSS/Whisper -> long-form/batch" law), so the
 *   fabric's routing/fallback/timeout/trace machinery is genuinely in
 *   the loop;
 * - structural analysis routes through the gateway's `summary` task
 *   (Qwen2.5-VL-7B-Instruct — the R23-H structural contributor);
 * - VideoPrism (video embeddings) and BGE-M3 (multilingual text
 *   embeddings) are CATALOG-ONLY models — zero frozen ModelTasks — so
 *   per the R23-J catalog law they are consumed by this pipeline
 *   DIRECTLY through the runtime seam, never registered for task
 *   routing.
 *
 * THE RUNTIME SEAM (the established injectable seam): the pipeline's
 * model invocations all flow through {@link IntelligenceModelRuntime}.
 * Production binds {@link createHttpIntelligenceModelRuntime} over the
 * operator-provisioned open-model runtime endpoint
 * (`WFX_INTELLIGENCE_MODEL_ENDPOINT` — the self-hosted/HF-endpoint
 * execution locations the R23-J catalog declares); tests inject a
 * deterministic stub. NO FIXTURES EVER ENTER THIS PIPELINE — the
 * dev-fixture artifact sets live behind the web host's fixtures boot
 * only (the 050 environment law).
 *
 * THE HONEST-FAILURE LAW (the golden rule this lane binds): when a
 * derivation prerequisite is unavailable at runtime — the model route
 * not provisioned, the content not fetchable — the pipeline records the
 * HONEST per-stage truth and the route answers the typed not-served;
 * never a fake success, never a fabricated artifact, never provenance
 * the producing model did not carry. Absent artifacts are ABSENT; a
 * partial set stays honestly partial (the R23-F law).
 *
 * THE CONTENT TRUTH of this deployment: the seeded webflix-catalog's
 * realizations are EMBED/EXTERNAL playback (browser-side at the
 * provider) — no server-fetchable audio or video stream exists for
 * them, so the audio/video-gated stages record their honest
 * prerequisite-missing truths and the derivable set is the
 * source-provided semantic index (+ the model-gated text embedding when
 * the runtime is provisioned). Items with NATIVE realizations (the
 * torrent/local lane) carry server-reachable media: the same pipeline
 * derives the full artifact chain for them.
 *
 * Determinism: the injected `Clock` stamps every provenance block; no
 * `Date.now`, no `Math.random`. SQL failures classify through the
 * persistence taxonomy — raw driver errors never escape.
 */

import {
  ModelFabric,
  ModelFabricRegistry,
  createOpenModelProvider,
  MOSS_TRANSCRIBE_DIARIZE_OPEN_MODEL,
  WHISPER_LARGE_V3_TURBO_OPEN_MODEL,
  QWEN25_VL_OPEN_MODEL,
  VIDEOPRISM_OPEN_MODEL,
  BGE_M3_OPEN_MODEL,
  validateMediaIntelligenceArtifacts,
  SOURCE_PROVIDED_MODEL_ID,
  type OpenModelDescriptor,
  type OpenModelExecutorPort,
  type ResolvedOpenModelBinding,
  type MediaIntelligenceArtifacts,
  type TranscriptArtifact,
  type SpeechEventsArtifact,
  type ChaptersScenesArtifact,
  type VisualConceptsArtifact,
  type VideoEmbeddingArtifact,
  type TextEmbeddingArtifact,
  type SearchableMomentsArtifact,
  type CanonicalSemanticIndex,
  type SemanticIndexEntry,
  type ArtifactModelMetadata,
  type MediaIntelligenceStage,
} from "@wfx/model-fabric";
import type { Clock } from "@wfx/experience";
import {
  PostgresMediaIntelligenceStore,
  type DbClient,
  type IntelligenceStageOutcomeRecord,
} from "@wfx/persistence";

// ---------------------------------------------------------------------------
// The model-runtime seam (the ONE way a model actually runs here)
// ---------------------------------------------------------------------------

/** The pipeline stages a model invocation can be routed to. */
export type IntelligenceModelStage =
  | "transcription"
  | "structural-analysis"
  | "video-embeddings"
  | "text-embeddings";

/** One stage invocation routed to a catalog-truth model class. */
export interface IntelligenceModelInvocation {
  /** The pipeline stage (the R23-F chain position). */
  readonly stage: IntelligenceModelStage;
  /** The catalog-truth provider id the stage routed to (provenance truth). */
  readonly modelProviderId: string;
  /** The stage's typed input (documented per stage below). */
  readonly input: unknown;
}

/**
 * THE RUNTIME SEAM: the platform adapter that executes one intelligence
 * model invocation. Production binds the HTTP runtime over the
 * operator's provisioned open-model endpoint; tests inject a
 * deterministic double. Implementations answer typed failures
 * (rejection/throw) — never fake success.
 *
 * STAGE INPUT/OUTPUT CONTRACTS (the pipeline's own protocol with the
 * runtime — the shapes both sides must speak):
 *
 * - `transcription` IN  `{ itemId, externalRef, media: { kind: "audio", source } }`
 *                 OUT `{ language, confidence, segments: [{ startMs, endMs, text, language, speakerLabel? }],
 *                        events: [{ kind: "speaker", label, startMs, endMs } |
 *                                 { kind: "acoustic", event, startMs, endMs, confidence }] }`
 * - `structural-analysis` IN  `{ itemId, externalRef, media: { kind: "video", source } }`
 *                         OUT `{ confidence, units: [{ kind: "chapter"|"scene", startMs, endMs, title?, summary? }],
 *                                detections: [{ name, kind: "concept"|"entity", confidence, startMs?, endMs? }] }`
 * - `video-embeddings` IN  `{ itemId, externalRef, media: { kind: "video", source } }`
 *                     OUT `{ confidence, vector: number[], dimensions }`
 * - `text-embeddings`  IN  `{ itemId, text }`
 *                     OUT `{ confidence, vector: number[], dimensions, language }`
 *
 * Every stage answer carries its own `confidence` truth in [0, 1] (the
 * provenance block's honesty law — an answer without it is rejected,
 * never assigned an invented number).
 */
export interface IntelligenceModelRuntime {
  execute(invocation: IntelligenceModelInvocation): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// The derivation content (what the pipeline can honestly bring to models)
// ---------------------------------------------------------------------------

/** One catalog item's derivation content (the honest prerequisite truth). */
export interface DerivationContent {
  readonly itemId: string;
  readonly externalRef: string;
  readonly connectorId: string;
  readonly title: string;
  readonly creators: readonly string[];
  readonly topics: readonly string[];
  readonly durationMs: number | null;
  /**
   * The server-reachable media source (a NATIVE playback realization's
   * reference) — `null` when the item's realizations are embed/external
   * only (browser-side at the provider; no lawful server-side stream).
   */
  readonly nativeMediaRef: string | null;
  /** The R23-G legal-audio truth (fail-closed: native path only). */
  readonly audioStreamLegallyAvailable: boolean;
}

interface ContentJoinRow {
  item_id: string;
  canonical_title: string | null;
  duration_ms: unknown;
  creators: unknown;
  topics: unknown;
  external_ref: string;
  connector_id: string;
  capabilities: unknown;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function stringList(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Load one item's derivation content: the canonical row + its
 * realization's playback truth. The native-media determination is the
 * honest prerequisite gate — only a `playNative` realization gives the
 * pipeline a server-reachable media source (embed/external playback
 * happens in the viewer's browser at the provider; WebFlix holds no
 * lawful stream to feed the ASR/vision stages).
 */
export async function loadDerivationContent(
  db: DbClient,
  itemId: string,
): Promise<DerivationContent | null> {
  let rows: ContentJoinRow[];
  try {
    rows = await db.query<ContentJoinRow>(
      `SELECT i.id AS item_id, i.canonical_title, i.duration_ms, i.creators, i.topics,
              r.external_ref, r.connector_id, r.capabilities
         FROM entertainment_items i
         JOIN source_realizations r ON r.entertainment_item_id = i.id
        WHERE i.id = $1
        ORDER BY r.connector_id
        LIMIT 1`,
      [itemId],
    );
  } catch {
    return null; // classified upstream by the caller's degrade law
  }
  const row = rows[0];
  if (row === undefined) return null;
  const capabilities = stringList(row.capabilities);
  const native = capabilities.includes("playNative");
  return {
    itemId: row.item_id,
    externalRef: row.external_ref,
    connectorId: row.connector_id,
    title: row.canonical_title ?? row.external_ref,
    creators: stringList(row.creators),
    topics: stringList(row.topics),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    nativeMediaRef: native ? row.external_ref : null,
    audioStreamLegallyAvailable: native,
  };
}

// ---------------------------------------------------------------------------
// The HTTP runtime (the production binding — no SDK, plain fetch)
// ---------------------------------------------------------------------------

/** Options for the HTTP model runtime. */
export interface HttpIntelligenceModelRuntimeOptions {
  /** The operator-provisioned open-model runtime endpoint (absolute http(s) URL). */
  readonly endpoint: string;
  /** The fetch implementation (default: the global `fetch`; tests inject a stub). */
  readonly fetchImpl?: typeof fetch;
  /** Per-invocation timeout in milliseconds (default 60 000 — batch stages are slow). */
  readonly timeoutMs?: number;
}

/**
 * The production model runtime: a plain HTTP client over the operator's
 * provisioned open-model endpoint (`POST {endpoint}` with the invocation
 * JSON; a 200 JSON body is the answer). Typed failures on network
 * errors, non-2xx, non-JSON, and malformed bodies — never a fake
 * success, never a coerced shape.
 */
export function createHttpIntelligenceModelRuntime(
  options: HttpIntelligenceModelRuntimeOptions,
): IntelligenceModelRuntime {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  return {
    async execute(invocation: IntelligenceModelInvocation): Promise<unknown> {
      let response: Response;
      try {
        response = await fetchImpl(options.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            stage: invocation.stage,
            modelProviderId: invocation.modelProviderId,
            input: invocation.input,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (thrown) {
        const reason = thrown instanceof Error ? thrown.name : "network";
        throw new Error(
          `intelligence model runtime: could not reach the provisioned endpoint (${reason}) — the stage fails honestly`,
        );
      }
      if (!response.ok) {
        throw new Error(
          `intelligence model runtime: the provisioned endpoint answered HTTP ${response.status} — the stage fails honestly`,
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          "intelligence model runtime: the provisioned endpoint answered a non-JSON payload — rejected, never coerced",
        );
      }
      try {
        return await response.json();
      } catch {
        throw new Error(
          "intelligence model runtime: the provisioned endpoint answered malformed JSON — rejected, never coerced",
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/** Constructor options — every seam injectable, all deterministic in tests. */
export interface IntelligencePipelineOptions {
  readonly db: DbClient;
  readonly store: PostgresMediaIntelligenceStore;
  readonly clock: Clock;
  /**
   * The model runtime (the injectable seam). `null` = no runtime
   * provisioned — the model-gated stages record their honest
   * not-provisioned truths and the pipeline never fabricates output.
   */
  readonly runtime: IntelligenceModelRuntime | null;
  /** The per-provider invocation timeout for the fabric gateway (default 60 000 ms). */
  readonly fabricTimeoutMs?: number;
}

/** One item's derivation outcome (the honest per-item truth). */
export type DerivationOutcome =
  | { readonly kind: "derived"; readonly itemId: string }
  | { readonly kind: "failed"; readonly itemId: string; readonly detail: string }
  | { readonly kind: "unknown-item"; readonly itemId: string };

/** The catalog pass's summary (diagnostics only — never fails the boot). */
export interface DerivationPassResult {
  readonly derived: number;
  readonly failed: number;
  readonly unknown: number;
  readonly outcomes: readonly DerivationOutcome[];
}

/** The transcript stage's runtime answer shape (the documented contract). */
interface TranscriptionStageOutput {
  language?: unknown;
  confidence?: unknown;
  segments?: unknown;
  events?: unknown;
}

/** The structural-analysis stage's runtime answer shape. */
interface StructuralStageOutput {
  confidence?: unknown;
  units?: unknown;
  detections?: unknown;
}

/** The embedding stages' runtime answer shape. */
interface EmbeddingStageOutput {
  vector?: unknown;
  dimensions?: unknown;
  language?: unknown;
}

/**
 * The derivation pipeline: derives R23-F artifact sets for catalog items
 * through Model Fabric and persists them in the derived-artifact store.
 */
export class IntelligenceDerivationPipeline {
  private readonly db: DbClient;
  private readonly store: PostgresMediaIntelligenceStore;
  private readonly clock: Clock;
  private readonly runtime: IntelligenceModelRuntime | null;
  private readonly fabric: ModelFabric | null;

  constructor(options: IntelligencePipelineOptions) {
    this.db = options.db;
    this.store = options.store;
    this.clock = options.clock;
    this.runtime = options.runtime;

    // The gateway over the R23-G task-routed open models — built ONLY
    // when a runtime is provisioned (an empty registry would answer the
    // typed no-provider error anyway; not building it keeps the honest
    // not-provisioned truth the stages record below).
    if (options.runtime !== null) {
      const registry = new ModelFabricRegistry();
      const executor = asOpenModelExecutor(options.runtime);
      registry.register(
        createOpenModelProvider({
          descriptor: MOSS_TRANSCRIBE_DIARIZE_OPEN_MODEL,
          executor,
        }),
      );
      registry.register(
        createOpenModelProvider({
          descriptor: WHISPER_LARGE_V3_TURBO_OPEN_MODEL,
          executor,
        }),
      );
      registry.register(
        createOpenModelProvider({
          descriptor: QWEN25_VL_OPEN_MODEL,
          executor,
        }),
      );
      this.fabric = new ModelFabric(registry, {
        defaultTimeoutMs: options.fabricTimeoutMs ?? 60_000,
      });
    } else {
      this.fabric = null;
    }
  }

  /**
   * Derive one catalog item's artifact set: the frozen stage chain, each
   * stage's honest outcome recorded, the assembled set validated against
   * the frozen R23-F shapes before it lands in the store (drift is
   * rejected — a set that fails validation is an honest derivation
   * failure, never a coerced save).
   */
  async deriveItem(itemId: string): Promise<DerivationOutcome> {
    const content = await loadDerivationContent(this.db, itemId);
    if (content === null) {
      return { kind: "unknown-item", itemId };
    }

    const stageOutcomes: IntelligenceStageOutcomeRecord[] = [];
    const producedAt = new Date(this.clock.now()).toISOString();
    const mediaAvailable = content.nativeMediaRef !== null;
    const mediaInput = {
      itemId: content.itemId,
      externalRef: content.externalRef,
      media: {
        kind: mediaAvailable ? "video" : "none",
        ...(mediaAvailable ? { source: content.nativeMediaRef } : {}),
      },
    };

    // --- stage: transcription + speech-events (the audio-gated batch route) ---
    let transcript: TranscriptArtifact | undefined;
    let speechEvents: SpeechEventsArtifact | undefined;
    if (!mediaAvailable) {
      stageOutcomes.push({
        stage: "transcription",
        outcome: "skipped-prerequisite-missing",
        detail:
          "no server-fetchable audio realization — this item's playback is embed/external (browser-side at the provider), so no lawful audio stream reaches the pipeline (the R23-G legal-audio gate)",
      });
    } else if (this.fabric === null) {
      stageOutcomes.push(notProvisionedOutcome("transcription"));
    } else {
      const result = await this.fabric.invoke<Record<string, unknown>, TranscriptionStageOutput>(
        "transcription",
        {
          itemId: content.itemId,
          externalRef: content.externalRef,
          media: { kind: "audio", source: content.nativeMediaRef },
        },
        {
          task: "transcription",
          fallbackProviders: [
            MOSS_TRANSCRIBE_DIARIZE_OPEN_MODEL.providerId,
            WHISPER_LARGE_V3_TURBO_OPEN_MODEL.providerId,
          ],
          privacy: "any-cloud",
        },
      );
      if (!result.ok) {
        stageOutcomes.push({
          stage: "transcription",
          outcome: "failed",
          detail: `the batch transcription route failed honestly (${result.error.kind}${"detail" in result.error ? `: ${String((result.error as { detail?: unknown }).detail)}` : ""})`,
        });
      } else {
        const mapped = mapTranscriptionOutput(
          result.value,
          result.trace.providerId,
          producedAt,
        );
        if (mapped === null) {
          stageOutcomes.push({
            stage: "transcription",
            outcome: "failed",
            detail:
              "the transcription route's answer failed the R23-F segment/event shapes — rejected, never coerced",
          });
        } else {
          transcript = mapped.transcript;
          speechEvents = mapped.speechEvents;
          stageOutcomes.push({
            stage: "transcription",
            outcome: "derived",
            detail: `transcript (${mapped.transcript.segments.length} segments) + diarization derived by ${result.trace.providerId}`,
            modelId: result.trace.providerId,
          });
        }
      }
    }

    // --- stage: structural-analysis (the video-gated Qwen2.5-VL route) ---
    let chaptersScenes: ChaptersScenesArtifact | undefined;
    let visualConcepts: VisualConceptsArtifact | undefined;
    if (!mediaAvailable) {
      stageOutcomes.push({
        stage: "structural-analysis",
        outcome: "skipped-prerequisite-missing",
        detail:
          "no server-fetchable video realization — chapter/scene analysis and visual grounding need the item's frames, which embed-only playback never exposes to the pipeline",
      });
    } else if (this.fabric === null) {
      stageOutcomes.push(notProvisionedOutcome("structural-analysis"));
    } else {
      const result = await this.fabric.invoke<Record<string, unknown>, StructuralStageOutput>(
        "summary",
        mediaInput,
        {
          task: "summary",
          fallbackProviders: [QWEN25_VL_OPEN_MODEL.providerId],
          privacy: "any-cloud",
        },
      );
      if (!result.ok) {
        stageOutcomes.push({
          stage: "structural-analysis",
          outcome: "failed",
          detail: `the structural-analysis route failed honestly (${result.error.kind})`,
        });
      } else {
        const mapped = mapStructuralOutput(result.value, result.trace.providerId, producedAt);
        if (mapped === null) {
          stageOutcomes.push({
            stage: "structural-analysis",
            outcome: "failed",
            detail:
              "the structural-analysis route's answer failed the R23-F chapter/detection shapes — rejected, never coerced",
          });
        } else {
          chaptersScenes = mapped.chaptersScenes;
          visualConcepts = mapped.visualConcepts;
          stageOutcomes.push({
            stage: "structural-analysis",
            outcome: "derived",
            detail: `chapters/scenes + visual concepts derived by ${result.trace.providerId}`,
            modelId: result.trace.providerId,
          });
        }
      }
    }

    // --- stage: video-embeddings (VideoPrism — the catalog-only consumer) ---
    let videoEmbedding: VideoEmbeddingArtifact | undefined;
    if (!mediaAvailable) {
      stageOutcomes.push({
        stage: "video-embeddings",
        outcome: "skipped-prerequisite-missing",
        detail:
          "no server-fetchable video realization — the VideoPrism embedding needs the item's visual content, which embed-only playback never exposes to the pipeline",
      });
    } else if (this.runtime === null) {
      stageOutcomes.push(notProvisionedOutcome("video-embeddings"));
    } else {
      try {
        const answer = (await this.runtime.execute({
          stage: "video-embeddings",
          modelProviderId: VIDEOPRISM_OPEN_MODEL.providerId,
          input: mediaInput,
        })) as EmbeddingStageOutput;
        const embedding = mapEmbeddingOutput(answer, VIDEOPRISM_OPEN_MODEL, producedAt);
        if (embedding === null) {
          stageOutcomes.push({
            stage: "video-embeddings",
            outcome: "failed",
            detail:
              "the VideoPrism route's answer failed the embedding-vector shape — rejected, never coerced",
          });
        } else {
          videoEmbedding = { kind: "video-embedding", embedding: embedding.vector, model: embedding.model };
          stageOutcomes.push({
            stage: "video-embeddings",
            outcome: "derived",
            detail: `the semantic video embedding derived by ${VIDEOPRISM_OPEN_MODEL.providerId}`,
            modelId: VIDEOPRISM_OPEN_MODEL.providerId,
          });
        }
      } catch (thrown) {
        stageOutcomes.push({
          stage: "video-embeddings",
          outcome: "failed",
          detail: `the VideoPrism route failed honestly (${describeError(thrown)})`,
        });
      }
    }

    // --- stage: text-embeddings (BGE-M3 — the multilingual text route) ---
    let textEmbedding: TextEmbeddingArtifact | undefined;
    const sourceText = sourceTextOf(content);
    if (this.runtime === null) {
      stageOutcomes.push(notProvisionedOutcome("text-embeddings"));
    } else {
      try {
        const answer = (await this.runtime.execute({
          stage: "text-embeddings",
          modelProviderId: BGE_M3_OPEN_MODEL.providerId,
          input: { itemId: content.itemId, text: sourceText },
        })) as EmbeddingStageOutput;
        const embedding = mapEmbeddingOutput(answer, BGE_M3_OPEN_MODEL, producedAt);
        if (embedding === null || typeof answer.language !== "string" || answer.language.length === 0) {
          stageOutcomes.push({
            stage: "text-embeddings",
            outcome: "failed",
            detail:
              "the BGE-M3 route's answer failed the embedding-vector/language shapes — rejected, never coerced",
          });
        } else {
          textEmbedding = {
            kind: "text-embedding",
            embedding: embedding.vector,
            language: answer.language,
            model: embedding.model,
          };
          stageOutcomes.push({
            stage: "text-embeddings",
            outcome: "derived",
            detail: `the multilingual text embedding derived by ${BGE_M3_OPEN_MODEL.providerId}`,
            modelId: BGE_M3_OPEN_MODEL.providerId,
          });
        }
      } catch (thrown) {
        stageOutcomes.push({
          stage: "text-embeddings",
          outcome: "failed",
          detail: `the BGE-M3 route failed honestly (${describeError(thrown)})`,
        });
      }
    }

    // --- stage: semantic-index (the stage-8 fold — always runs) ---
    const semanticIndex = foldSemanticIndex({
      content,
      producedAt,
      ...(transcript !== undefined ? { transcript } : {}),
      ...(chaptersScenes !== undefined ? { chaptersScenes } : {}),
      ...(textEmbedding !== undefined ? { textEmbedding } : {}),
    });
    stageOutcomes.push({
      stage: "semantic-index",
      outcome: "derived",
      detail: `the canonical semantic index folded (${semanticIndex.entries.length} entries; ${semanticIndex.buildProvenance.length} contributing provenance blocks)`,
    });

    // --- stage: searchable-moments (chapter-grounded when chapters exist) ---
    let searchableMoments: SearchableMomentsArtifact | undefined;
    if (chaptersScenes !== undefined) {
      const chapterMoments = chaptersScenes.units.map((unit) => {
        const description =
          unit.title !== undefined && unit.summary !== undefined
            ? `${unit.title} — ${unit.summary}`
            : (unit.title ?? unit.summary ?? `the ${unit.kind} span`);
        const matched =
          transcript !== undefined
            ? transcript.segments.find(
                (segment) => segment.startMs >= unit.startMs && segment.startMs < unit.endMs,
              )
            : undefined;
        return {
          startMs: unit.startMs,
          endMs: unit.endMs,
          description,
          ...(matched !== undefined ? { matchedText: matched.text } : {}),
        };
      });
      searchableMoments = {
        kind: "searchable-moments",
        moments: chapterMoments,
        model: {
          stage: "semantic-index",
          modelId: SOURCE_PROVIDED_MODEL_ID,
          confidence: 1,
          producedAt,
        },
      };
      stageOutcomes.push({
        stage: "semantic-index",
        outcome: "derived",
        detail: `searchable moments folded from the derived chapter structure (${chapterMoments.length} moments)`,
      });
    } else {
      stageOutcomes.push({
        stage: "semantic-index",
        outcome: "skipped-prerequisite-missing",
        detail:
          "searchable moments need derived chapter structure (or transcript highlights) — honestly absent for this item",
      });
    }

    // --- assemble + validate (drift is rejected, never coerced) ---
    const artifacts: MediaIntelligenceArtifacts = {
      itemId: content.itemId,
      ...(transcript !== undefined ? { transcript } : {}),
      ...(speechEvents !== undefined ? { speechEvents } : {}),
      ...(chaptersScenes !== undefined ? { chaptersScenes } : {}),
      ...(visualConcepts !== undefined ? { visualConcepts } : {}),
      ...(videoEmbedding !== undefined ? { videoEmbedding } : {}),
      ...(textEmbedding !== undefined ? { textEmbedding } : {}),
      ...(searchableMoments !== undefined ? { searchableMoments } : {}),
      semanticIndex,
    };
    const validation = validateMediaIntelligenceArtifacts(artifacts);
    if (!validation.ok) {
      const detail = `the derived artifact set failed the frozen R23-F validation (${validation.problems.join("; ")}) — rejected, never coerced into the store`;
      await this.store.recordFailedDerivation({ itemId, detail, stageOutcomes });
      return { kind: "failed", itemId, detail };
    }

    const modelStages = stageOutcomes.filter((outcome) => outcome.outcome === "derived" && outcome.modelId !== undefined);
    const derivationDetail =
      modelStages.length > 0
        ? `Derived ${modelStages.length} model stage(s) (${modelStages.map((stage) => stage.modelId).join(", ")}) over the source-provided index — partial sets stay honestly partial.`
        : "Derived the source-provided semantic index (the catalog's own metadata truth); the model-gated stages recorded their honest prerequisite truths — the set stays honestly partial, never padded.";
    await this.store.saveDerivedArtifacts({
      itemId,
      artifacts,
      audioStreamLegallyAvailable: content.audioStreamLegallyAvailable,
      stageOutcomes,
      derivationDetail,
    });
    return { kind: "derived", itemId };
  }

  /**
   * The boot-time convergence pass: derive every catalog item (bounded by
   * `limit`), each item's outcome recorded honestly. NEVER throws — a
   * broken item or store failure degrades to that item's honest failed
   * derivation (diagnostics only; the boot never depends on the catalog
   * being derived).
   */
  async deriveCatalog(limit?: number): Promise<DerivationPassResult> {
    let rows: Array<{ item_id: string }>;
    try {
      rows = await this.db.query<{ item_id: string }>(
        `SELECT i.id AS item_id
           FROM entertainment_items i
          ORDER BY i.created_at, i.id
          ${limit !== undefined ? "LIMIT $1" : ""}`,
        limit !== undefined ? [limit] : [],
      );
    } catch {
      // The catalog listing itself failed (the degradation family —
      // e.g. the DB is down): the honest empty pass, never a throw (the
      // boot never depends on the catalog being derived). The items'
      // reads answer their own typed truths against the store.
      return { derived: 0, failed: 0, unknown: 0, outcomes: [] };
    }
    const outcomes: DerivationOutcome[] = [];
    let derived = 0;
    let failed = 0;
    let unknown = 0;
    for (const row of rows) {
      let outcome: DerivationOutcome;
      try {
        outcome = await this.deriveItem(row.item_id);
      } catch (thrown) {
        outcome = { kind: "failed", itemId: row.item_id, detail: describeError(thrown) };
      }
      outcomes.push(outcome);
      if (outcome.kind === "derived") derived += 1;
      else if (outcome.kind === "failed") failed += 1;
      else unknown += 1;
    }
    return { derived, failed, unknown, outcomes };
  }
}

// ---------------------------------------------------------------------------
// The mappers (runtime answers -> frozen R23-F shapes; drift rejected)
// ---------------------------------------------------------------------------

function describeError(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function notProvisionedOutcome(stage: IntelligenceModelStage): IntelligenceStageOutcomeRecord {
  return {
    stage,
    outcome: "failed",
    detail:
      "the open-model runtime is not provisioned (WFX_INTELLIGENCE_MODEL_ENDPOINT is unset) — this model-gated stage stays off honestly rather than fabricating output",
  };
}

/** The honest source-provided provenance block (never a fabricated model). */
function sourceProvidedProvenance(producedAt: string): ArtifactModelMetadata {
  return {
    stage: "source-media",
    modelId: SOURCE_PROVIDED_MODEL_ID,
    confidence: 1,
    producedAt,
  };
}

/** The item's source-provided text (what the text-embedding stage embeds). */
function sourceTextOf(content: DerivationContent): string {
  const parts: string[] = [content.title];
  if (content.creators.length > 0) {
    parts.push(`By ${content.creators.join(", ")}.`);
  }
  if (content.topics.length > 0) {
    parts.push(`Topics: ${content.topics.join(", ")}.`);
  }
  return parts.join(" ");
}

function provenanceOf(
  descriptor: OpenModelDescriptor,
  stage: MediaIntelligenceStage,
  confidence: number,
  producedAt: string,
): ArtifactModelMetadata {
  return {
    stage,
    modelId: descriptor.providerId,
    modelRevision: descriptor.revision,
    confidence,
    producedAt,
  };
}

function mapTranscriptionOutput(
  output: TranscriptionStageOutput,
  providerId: string,
  producedAt: string,
): { transcript: TranscriptArtifact; speechEvents: SpeechEventsArtifact | undefined } | null {
  if (!isRecord(output)) return null;
  const language = output.language;
  const confidence = output.confidence;
  if (typeof language !== "string" || language.length === 0) return null;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) return null;
  if (!Array.isArray(output.segments) || output.segments.length === 0) return null;
  const segments: TranscriptArtifact["segments"][number][] = [];
  for (const raw of output.segments) {
    if (!isRecord(raw)) return null;
    if (
      typeof raw.startMs !== "number" ||
      typeof raw.endMs !== "number" ||
      raw.endMs < raw.startMs ||
      typeof raw.text !== "string" ||
      raw.text.length === 0 ||
      typeof raw.language !== "string" ||
      raw.language.length === 0
    ) {
      return null;
    }
    segments.push({
      startMs: raw.startMs,
      endMs: raw.endMs,
      text: raw.text,
      language: raw.language,
      ...(typeof raw.speakerLabel === "string" && raw.speakerLabel.length > 0
        ? { speakerLabel: raw.speakerLabel }
        : {}),
    });
  }
  const events: SpeechEventsArtifact["events"][number][] = [];
  if (Array.isArray(output.events)) {
    for (const raw of output.events) {
      if (!isRecord(raw)) return null;
      if (
        typeof raw.startMs !== "number" ||
        typeof raw.endMs !== "number" ||
        raw.endMs < raw.startMs
      ) {
        return null;
      }
      if (raw.kind === "speaker") {
        if (typeof raw.label !== "string" || raw.label.length === 0) return null;
        events.push({ kind: "speaker", label: raw.label, startMs: raw.startMs, endMs: raw.endMs });
      } else if (raw.kind === "acoustic") {
        if (
          typeof raw.event !== "string" ||
          raw.event.length === 0 ||
          typeof raw.confidence !== "number" ||
          raw.confidence < 0 ||
          raw.confidence > 1
        ) {
          return null;
        }
        events.push({
          kind: "acoustic",
          event: raw.event,
          startMs: raw.startMs,
          endMs: raw.endMs,
          confidence: raw.confidence,
        });
      } else {
        return null;
      }
    }
  }
  const descriptor = transcriptionDescriptorOf(providerId);
  const transcriptModel = provenanceOf(descriptor, "transcription", confidence, producedAt);
  return {
    transcript: { kind: "transcript", segments, language, model: transcriptModel },
    // The diarization artifact is PRESENT only when the route attributed
    // events (an empty events list is not an artifact — absent stays
    // absent, the R23-F law).
    speechEvents:
      events.length > 0
        ? {
            kind: "speech-events",
            events,
            model: provenanceOf(descriptor, "speech-events", confidence, producedAt),
          }
        : undefined,
  };
}

function transcriptionDescriptorOf(providerId: string): OpenModelDescriptor {
  if (providerId === WHISPER_LARGE_V3_TURBO_OPEN_MODEL.providerId) {
    return WHISPER_LARGE_V3_TURBO_OPEN_MODEL;
  }
  return MOSS_TRANSCRIBE_DIARIZE_OPEN_MODEL;
}

function mapStructuralOutput(
  output: StructuralStageOutput,
  providerId: string,
  producedAt: string,
): { chaptersScenes: ChaptersScenesArtifact; visualConcepts: VisualConceptsArtifact } | null {
  if (!isRecord(output)) return null;
  const confidence = output.confidence;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) return null;
  if (!Array.isArray(output.units) || output.units.length === 0) return null;
  const units: ChaptersScenesArtifact["units"][number][] = [];
  for (const raw of output.units) {
    if (!isRecord(raw)) return null;
    if (raw.kind !== "chapter" && raw.kind !== "scene") return null;
    if (
      typeof raw.startMs !== "number" ||
      typeof raw.endMs !== "number" ||
      raw.endMs < raw.startMs
    ) {
      return null;
    }
    units.push({
      kind: raw.kind,
      startMs: raw.startMs,
      endMs: raw.endMs,
      ...(typeof raw.title === "string" ? { title: raw.title } : {}),
      ...(typeof raw.summary === "string" ? { summary: raw.summary } : {}),
    });
  }
  if (!Array.isArray(output.detections) || output.detections.length === 0) return null;
  const detections: VisualConceptsArtifact["detections"][number][] = [];
  for (const raw of output.detections) {
    if (!isRecord(raw)) return null;
    if (raw.kind !== "concept" && raw.kind !== "entity") return null;
    if (
      typeof raw.name !== "string" ||
      raw.name.length === 0 ||
      typeof raw.confidence !== "number" ||
      raw.confidence < 0 ||
      raw.confidence > 1
    ) {
      return null;
    }
    detections.push({
      name: raw.name,
      kind: raw.kind,
      confidence: raw.confidence,
      ...(typeof raw.startMs === "number" ? { startMs: raw.startMs } : {}),
      ...(typeof raw.endMs === "number" ? { endMs: raw.endMs } : {}),
    });
  }
  const model = provenanceOf(QWEN25_VL_OPEN_MODEL, "structural-analysis", confidence, producedAt);
  return {
    chaptersScenes: { kind: "chapters-scenes", units, model },
    visualConcepts: { kind: "visual-concepts", detections, model },
  };
}

function mapEmbeddingOutput(
  output: EmbeddingStageOutput,
  descriptor: OpenModelDescriptor,
  producedAt: string,
): { vector: { vector: readonly number[]; dimensions: number }; model: ArtifactModelMetadata } | null {
  if (!isRecord(output)) return null;
  if (typeof output.confidence !== "number" || output.confidence < 0 || output.confidence > 1) {
    return null;
  }
  if (!Array.isArray(output.vector) || output.vector.length === 0) return null;
  for (const component of output.vector) {
    if (typeof component !== "number" || !Number.isFinite(component)) return null;
  }
  if (output.dimensions !== output.vector.length) return null;
  return {
    vector: { vector: [...output.vector], dimensions: output.vector.length },
    model: provenanceOf(
      descriptor,
      descriptor === VIDEOPRISM_OPEN_MODEL ? "video-embeddings" : "text-embeddings",
      output.confidence,
      producedAt,
    ),
  };
}

/**
 * The stage-8 fold: the canonical semantic index over EVERYTHING the
 * pipeline derived for the item — the source-provided metadata entries
 * (honest source provenance) + the transcript/chapter entries when those
 * stages derived + the text embedding's provenance on the metadata entry
 * it embeds. The build provenance carries every contributing model.
 */
function foldSemanticIndex(input: {
  readonly content: DerivationContent;
  readonly producedAt: string;
  readonly transcript?: TranscriptArtifact;
  readonly chaptersScenes?: ChaptersScenesArtifact;
  readonly textEmbedding?: TextEmbeddingArtifact;
}): CanonicalSemanticIndex {
  const entries: SemanticIndexEntry[] = [];
  const buildProvenance: ArtifactModelMetadata[] = [sourceProvidedProvenance(input.producedAt)];

  // The source-provided metadata entry (the catalog's own truth).
  entries.push({
    text: sourceTextOf(input.content),
    language: "en",
    span: null,
    source: "metadata",
    ...(input.textEmbedding !== undefined
      ? { embedding: input.textEmbedding.model }
      : {}),
  });

  if (input.transcript !== undefined) {
    for (const segment of input.transcript.segments) {
      entries.push({
        text: segment.text,
        language: segment.language,
        span: { startMs: segment.startMs, endMs: segment.endMs },
        source: "transcript-segment",
      });
    }
    if (!buildProvenance.some((block) => block.modelId === input.transcript?.model.modelId)) {
      buildProvenance.push(input.transcript.model);
    }
  }

  if (input.chaptersScenes !== undefined) {
    for (const unit of input.chaptersScenes.units) {
      const text =
        unit.title !== undefined && unit.summary !== undefined
          ? `${unit.title} — ${unit.summary}`
          : (unit.title ?? unit.summary ?? `the ${unit.kind} span`);
      entries.push({
        text,
        language: "en",
        span: { startMs: unit.startMs, endMs: unit.endMs },
        source: unit.kind === "chapter" ? "chapter" : "scene",
      });
    }
    if (!buildProvenance.some((block) => block.modelId === input.chaptersScenes?.model.modelId)) {
      buildProvenance.push(input.chaptersScenes.model);
    }
  }

  if (input.textEmbedding !== undefined) {
    if (!buildProvenance.some((block) => block.modelId === input.textEmbedding?.model.modelId)) {
      buildProvenance.push(input.textEmbedding.model);
    }
  }

  return {
    kind: "semantic-index",
    itemId: input.content.itemId,
    entries,
    buildProvenance,
  };
}

// ---------------------------------------------------------------------------
// The runtime -> OpenModelExecutorPort adapter (the task-routed stages)
// ---------------------------------------------------------------------------

/**
 * Adapt the pipeline's runtime seam to Model Fabric's
 * `OpenModelExecutorPort` — the seam `createOpenModelProvider` binds, so
 * the task-routed stages (transcription via MOSS/Whisper; structural
 * analysis via Qwen) flow through the REAL fabric gateway with its
 * routing, fallback, timeout, and trace machinery.
 */
function asOpenModelExecutor(runtime: IntelligenceModelRuntime): OpenModelExecutorPort {
  return {
    async execute(
      task: Parameters<OpenModelExecutorPort["execute"]>[0],
      input: unknown,
      binding: ResolvedOpenModelBinding,
    ): Promise<unknown> {
      const stage: IntelligenceModelStage =
        task === "transcription"
          ? "transcription"
          : task === "summary"
            ? "structural-analysis"
            : "transcription"; // unreachable: only those tasks are registered
      return runtime.execute({
        stage,
        modelProviderId: binding.descriptor.providerId,
        input,
      });
    },
  };
}
