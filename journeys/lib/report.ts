/**
 * @wfx/journeys — the evidence manifest (R16).
 *
 * The journey doc's evidence format, serialized: every run records the
 * build/commit, the environment, per-journey id/status/assertions/
 * artifacts/page errors, and the explicit limitations listing (journeys
 * that cannot run in this configuration are LISTED with their procedure
 * — never silently skipped).
 *
 * PURE functions over records: unit-tested without a browser or server.
 * The runner supplies the records; this module guarantees the stable
 * schema, deterministic ordering, and the summary numbers the CI gate
 * reads (any FAIL — exit nonzero; the runner enforces it from the same
 * records).
 */

import type { AssertionRecord } from "./assertions";

/** The manifest schema version (stability contract for tooling). */
export const MANIFEST_SCHEMA = "wfx-journey-manifest/1" as const;

/** One journey's terminal outcome. */
export type JourneyStatus = "pass" | "fail" | "not-run";

/** One executed journey's result record. */
export interface JourneyResult {
  /** The exact journey id (J01–J32 — the catalog's ids, verbatim). */
  readonly id: string;
  /** The journey title (the catalog's name, verbatim). */
  readonly title: string;
  /** pass | fail | not-run (not-run is ALWAYS accompanied by a reason). */
  readonly status: JourneyStatus;
  /** For not-run: the exact reason + the local/manual procedure. */
  readonly reason: string | null;
  /** For fail: the first failed assertion's message. */
  readonly failure: string | null;
  /** The assertions recorded (in execution order). */
  readonly assertions: readonly AssertionRecord[];
  /** Evidence artifact paths (screenshots, snapshots, failure captures). */
  readonly artifacts: readonly string[];
  /** Uncaught page errors observed during the journey (failure evidence). */
  readonly pageErrors: readonly string[];
  /** Wall-clock duration in ms. */
  readonly durationMs: number;
}

/** One explicit limitation entry (never a silent skip). */
export interface LimitationRecord {
  /** The journey id that cannot run (or run fully) in this configuration. */
  readonly journeyId: string;
  /** local-only | desktop-procedure | configuration-limit | known-defect. */
  readonly kind:
    | "local-only"
    | "desktop-procedure"
    | "configuration-limit"
    | "known-defect";
  /** What cannot be exercised here. */
  readonly note: string;
  /** The exact procedure to obtain the evidence instead. */
  readonly procedure: string;
}

/** The environment block of the manifest. */
export interface RunEnvironment {
  /** The boot mode the journeys consumed. */
  readonly mode: "web-fixtures";
  /** The base URL of the running web adapter. */
  readonly webUrl: string;
  /** Whether this run is the CI-feasible configuration. */
  readonly ci: boolean;
  /** ISO timestamp of run start. */
  readonly startedAt: string;
  /** ISO timestamp of run end. */
  readonly finishedAt: string;
  /** The harness's determinism notes (fixture resets, session identity). */
  readonly determinism: readonly string[];
}

/** The run manifest (the committed evidence contract). */
export interface RunManifest {
  readonly schema: typeof MANIFEST_SCHEMA;
  /** The commit the product under test was built from. */
  readonly commit: string;
  /** The branch the run executed on. */
  readonly branch: string;
  readonly environment: RunEnvironment;
  readonly summary: {
    readonly total: number;
    readonly encoded: number;
    readonly passed: number;
    readonly failed: number;
    readonly notRun: number;
  };
  readonly journeys: readonly JourneyResult[];
  readonly limitations: readonly LimitationRecord[];
}

/** The inputs to {@link buildManifest}. */
export interface ManifestInput {
  readonly commit: string;
  readonly branch: string;
  readonly environment: RunEnvironment;
  readonly journeys: readonly JourneyResult[];
  readonly limitations: readonly LimitationRecord[];
}

/** Build the manifest (deterministic: journeys in given order, stable numbers). */
export function buildManifest(input: ManifestInput): RunManifest {
  const encoded = input.journeys.filter((journey) => journey.status !== "not-run").length;
  const passed = input.journeys.filter((journey) => journey.status === "pass").length;
  const failed = input.journeys.filter((journey) => journey.status === "fail").length;
  const notRun = input.journeys.filter((journey) => journey.status === "not-run").length;
  return {
    schema: MANIFEST_SCHEMA,
    commit: input.commit,
    branch: input.branch,
    environment: input.environment,
    summary: {
      total: input.journeys.length,
      encoded,
      passed,
      failed,
      notRun,
    },
    journeys: [...input.journeys],
    limitations: [...input.limitations],
  };
}

/** Render the human-readable summary page (the committed summary.md). */
export function renderSummary(manifest: RunManifest): string {
  const lines: string[] = [];
  lines.push("# WebFlix Golden Journey Run — Evidence Summary");
  lines.push("");
  lines.push(`- commit: \`${manifest.commit}\``);
  lines.push(`- branch: \`${manifest.branch}\``);
  lines.push(
    `- environment: ${manifest.environment.mode} @ ${manifest.environment.webUrl}${manifest.environment.ci ? " (CI configuration)" : ""}`,
  );
  lines.push(`- window: ${manifest.environment.startedAt} → ${manifest.environment.finishedAt}`);
  lines.push("");
  lines.push(
    `**${manifest.summary.passed} passed · ${manifest.summary.failed} failed · ${manifest.summary.notRun} not-run (listed with procedures) · ${manifest.summary.total} total**`,
  );
  lines.push("");
  lines.push("| Journey | Title | Status | Assertions | Artifacts |");
  lines.push("|---|---|---|---:|---:|");
  for (const journey of manifest.journeys) {
    const status =
      journey.status === "pass"
        ? "PASS"
        : journey.status === "fail"
          ? "**FAIL**"
          : "not-run";
    lines.push(
      `| ${journey.id} | ${journey.title} | ${status} | ${journey.assertions.length} | ${journey.artifacts.length} |`,
    );
  }
  if (manifest.limitations.length > 0) {
    lines.push("");
    lines.push("## Explicit limitations (never silent skips)");
    lines.push("");
    for (const limitation of manifest.limitations) {
      lines.push(`- **${limitation.journeyId}** (${limitation.kind}): ${limitation.note}`);
      lines.push(`  - procedure: ${limitation.procedure}`);
    }
  }
  if (manifest.journeys.some((journey) => journey.status === "fail")) {
    lines.push("");
    lines.push("## Failures");
    lines.push("");
    for (const journey of manifest.journeys.filter((journey) => journey.status === "fail")) {
      lines.push(`- **${journey.id} ${journey.title}**: ${journey.failure ?? "unspecified failure"}`);
      for (const error of journey.pageErrors) {
        lines.push(`  - page error: ${error}`);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** The runner's exit decision: any executed journey failure → red. */
export function runIsGreen(manifest: RunManifest): boolean {
  return manifest.summary.failed === 0;
}
