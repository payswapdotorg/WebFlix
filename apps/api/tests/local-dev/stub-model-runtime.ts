/**
 * R26-W4 re-entry verification — the STUB OPEN-MODEL RUNTIME endpoint
 * (verification-only): answers the documented IntelligenceModelRuntime
 * stage contracts deterministically over plain HTTP, so the live harness
 * can boot with WFX_INTELLIGENCE_MODEL_ENDPOINT=http://localhost:3103
 * and the REAL HTTP executor + Model Fabric routing + derivation
 * pipeline run end-to-end over the wire.
 *
 * Run: bun tests/local-dev/stub-model-runtime.ts   (port 3103)
 */
const PORT = 3103;

Bun.serve({
  port: PORT,
  async fetch(request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "method-not-allowed" }, { status: 405 });
    }
    const body = (await request.json()) as { stage?: string; modelProviderId?: string };
    switch (body.stage) {
      case "transcription":
        return Response.json({
          language: "en",
          confidence: 0.94,
          segments: [
            { startMs: 0, endMs: 6400, text: "The storm front crosses the ridge at dusk.", language: "en", speakerLabel: "Narrator" },
            { startMs: 6500, endMs: 15200, text: "We follow the chase team through the open plains.", language: "en", speakerLabel: "Field Reporter" },
          ],
          events: [
            { kind: "speaker", label: "Narrator", startMs: 0, endMs: 6400 },
            { kind: "acoustic", event: "thunder", startMs: 9000, endMs: 10000, confidence: 0.86 },
          ],
        });
      case "structural-analysis":
        return Response.json({
          confidence: 0.88,
          units: [
            { kind: "chapter", startMs: 0, endMs: 6400, title: "Storm front", summary: "The storm front crosses the ridge at dusk." },
            { kind: "chapter", startMs: 6500, endMs: 15200, title: "The chase", summary: "Following the chase team through the plains." },
          ],
          detections: [
            { name: "storm cloud", kind: "concept", confidence: 0.97, startMs: 0, endMs: 6400 },
            { name: "plains", kind: "concept", confidence: 0.9 },
          ],
        });
      case "video-embeddings":
        return Response.json({ confidence: 0.9, vector: [0.12, -0.34, 0.56], dimensions: 3 });
      case "text-embeddings":
        return Response.json({ confidence: 0.91, vector: [0.22, -0.14, 0.41], dimensions: 3, language: "en" });
      default:
        return Response.json({ error: "unknown-stage", detail: body.stage }, { status: 400 });
    }
  },
});

console.log(`[stub-model-runtime] serving the documented stage contracts on http://localhost:${PORT}`);
