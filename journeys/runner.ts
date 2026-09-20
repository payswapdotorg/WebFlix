/**
 * @wfx/journeys — the golden-journey runner (R16).
 *
 * ONE run = boot the deterministic product (web fixtures mode) → launch
 * an isolated agent-browser session → execute every encoded journey in
 * catalog order (the frozen protocol per journey: navigate →
 * networkidle → fresh snapshot → assert) → capture PASS/FAIL evidence
 * (screenshots, snapshots, failure captures, page errors) → write the
 * manifest + summary → exit red on ANY journey failure (these are
 * checks, not theater).
 *
 * CLI (bun journeys/runner.ts):
 *   --list                    print the journey catalog and exit
 *   --filter J01,J21          run a subset (comma-separated ids)
 *   --ci                      the CI configuration (strict; same set)
 *   --base-url <url>          consume an ALREADY-RUNNING product
 *                             (the runner still resets the acquisition
 *                             drive state for determinism)
 *   --evidence-dir <path>     where artifacts land (default evidence/r16)
 *
 * Layering law honored: this runner consumes the product as a user —
 * zero imports from any @wfx package. (The console is this CLI's output
 * interface — the file-level no-console disable is the honest form.)
 */

/* eslint-disable no-console */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AssertionError, bindAssertions, createJournal } from "./lib/assertions";
import { Browser, BrowserError } from "./lib/browser";
import type { Journey, JourneyContext } from "./lib/journeys";
import {
  bootWebFixturesProduct,
  resetAcquisitionFixtureState,
  resetAuthFixtureState,
  resetSourceAuthFixtureState,
  type ProductHandle,
} from "./lib/product";
import { buildManifest, renderSummary, runIsGreen, type JourneyResult, type LimitationRecord, type RunManifest } from "./lib/report";
import { JOURNEY_LIMITATIONS, WEB_JOURNEYS } from "./web/index";
import { narrationsOf } from "./web/journey-description";

/** The repo root (journeys/ lives at its top level). */
const REPO_ROOT = resolve(fileURLToPath(new URL(import.meta.url)), "../..");

/** The default evidence directory (the rNN convention). */
const DEFAULT_EVIDENCE_DIR = "evidence/r16";

interface CliOptions {
  readonly list: boolean;
  readonly filter: readonly string[] | null;
  readonly ci: boolean;
  readonly baseUrl: string | null;
  readonly evidenceDir: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    list: false,
    filter: null,
    ci: false,
    baseUrl: null,
    evidenceDir: DEFAULT_EVIDENCE_DIR,
  };
  const mutable = { ...options } as { -readonly [K in keyof CliOptions]: CliOptions[K] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    switch (arg) {
      case "--list":
        mutable.list = true;
        break;
      case "--ci":
        mutable.ci = true;
        break;
      case "--filter":
        mutable.filter = (argv[index + 1] ?? "").split(",").map((id) => id.trim().toUpperCase()).filter((id) => id.length > 0);
        index += 1;
        break;
      case "--base-url":
        mutable.baseUrl = argv[index + 1] ?? null;
        index += 1;
        break;
      case "--evidence-dir":
        mutable.evidenceDir = argv[index + 1] ?? DEFAULT_EVIDENCE_DIR;
        index += 1;
        break;
      default:
        throw new Error(`journeys: unknown argument '${arg}' (usage: --list | --filter J01,J02 | --ci | --base-url <url> | --evidence-dir <path>)`);
    }
  }
  return mutable;
}

/** The git facts for the manifest (loud failure when unavailable). */
function gitFacts(): { commit: string; branch: string } {
  const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: REPO_ROOT }).stdout.toString().trim();
  const branch = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd: REPO_ROOT }).stdout.toString().trim();
  if (commit.length === 0) {
    throw new Error("journeys: could not read the git commit (run inside the repository)");
  }
  return { commit, branch };
}

/** List the catalog (the --list output). */
function printCatalog(): void {
  console.log("WebFlix golden journeys — the encoded catalog");
  for (const journey of WEB_JOURNEYS) {
    console.log(`  ${journey.id}  ${journey.title}  [ci: ${journey.ci ? "yes" : "no"}]`);
  }
  console.log(`  (+ ${JOURNEY_LIMITATIONS.length} explicitly-listed not-run/reach-limit entries)`);
}

async function main(): Promise<number> {
  const options = parseArgs(Bun.argv.slice(2));
  if (options.list) {
    printCatalog();
    return 0;
  }

  const { commit, branch } = gitFacts();
  const evidenceDirAbs = join(REPO_ROOT, options.evidenceDir);
  // A fresh evidence directory per run (the committed artifacts are the
  // delivered run; re-runs replace them wholesale — no stale artifacts).
  rmSync(evidenceDirAbs, { recursive: true, force: true });
  mkdirSync(evidenceDirAbs, { recursive: true });
  const serverLogFile = join(evidenceDirAbs, "web-dev-server.log");

  const startedAt = new Date();
  console.log(`journeys: ${WEB_JOURNEYS.length} encoded journeys · evidence → ${options.evidenceDir}`);

  // 1. The deterministic product (boot or consume).
  let product: ProductHandle | null = null;
  let baseUrl: string;
  if (options.baseUrl !== null) {
    baseUrl = options.baseUrl;
    // Determinism even against an existing server: reset the scripted
    // acquisition drive state so J21–J26 assert the sequence from step 0,
    // the scripted source-auth state so J28 starts from signed-in, and
    // the scripted identity persona so J36 starts from signed-out.
    resetAcquisitionFixtureState();
    resetSourceAuthFixtureState();
    resetAuthFixtureState();
    console.log(`journeys: consuming the running product at ${baseUrl} (acquisition + source-auth + identity drive state reset)`);
  } else {
    product = await bootWebFixturesProduct({
      repoRoot: REPO_ROOT,
      logFile: serverLogFile,
    });
    baseUrl = product.baseUrl;
    console.log(`journeys: product booted (web fixtures mode) at ${baseUrl}`);
  }

  // 2. The isolated browser session (one per run — the isolation law).
  const sessionId = `wfx-journeys-${Date.now()}`;
  const browser = await Browser.launch({ session: sessionId });
  console.log(`journeys: browser session ${sessionId}`);
  // Determinism: a FIXED viewport (1280×800 — every run the same layout
  // math) and the fixture provider URLs (fixture.invalid) network-blocked
  // — the provider frames fail instantly instead of hanging on DNS (the
  // journeys assert the DOM grammar, never provider content).
  await browser.prepareSession();

  // 3. Run every (filtered) journey.
  const selected = options.filter === null
    ? WEB_JOURNEYS
    : WEB_JOURNEYS.filter((journey) => options.filter!.includes(journey.id));
  const unknown = options.filter === null
    ? []
    : options.filter.filter((id) => !WEB_JOURNEYS.some((journey) => journey.id === id));
  if (unknown.length > 0) {
    throw new Error(`journeys: unknown journey ids in --filter: ${unknown.join(", ")}`);
  }
  if (options.filter !== null) {
    // The acquisition lifecycle journeys are ORDER-DEPENDENT BY DESIGN:
    // J21 drives the scripted sequence from step 0 and J22–J24 continue
    // it; a filter that splits the chain would fail on cursor state.
    const chain = ["J21", "J22", "J23", "J24", "J26"];
    const present = chain.filter((id) => options.filter!.includes(id));
    if (present.length > 0 && present.length < chain.length) {
      throw new Error(
        `journeys: --filter splits the scripted-acquisition chain (J21→J24, J26 are order-dependent: J21 drives the sequence from step 0). Include the full chain (${chain.join(",")}) or none of it.`,
      );
    }
  }

  const results: JourneyResult[] = [];
  try {
    for (const journey of selected) {
      results.push(await runJourney(journey, browser, baseUrl, evidenceDirAbs, options.evidenceDir));
      const last = results[results.length - 1]!;
      const mark = last.status === "pass" ? "PASS" : last.status === "fail" ? "FAIL" : "NOT-RUN";
      console.log(`  ${mark}  ${last.id} ${last.title} (${last.assertions.length} assertions, ${last.durationMs}ms)`);
    }
  } finally {
    await browser.close().catch(() => undefined);
    if (product !== null) {
      await product.stop();
    }
  }

  // 4. The manifest + summary.
  const finishedAt = new Date();
  const limitations = options.filter === null ? JOURNEY_LIMITATIONS : relevantLimitations(options.filter);
  const manifest: RunManifest = buildManifest({
    commit,
    branch,
    environment: {
      mode: "web-fixtures",
      webUrl: baseUrl,
      ci: options.ci,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      determinism: [
        "the scripted acquisition drive state was reset before the run (J21–J26 assert the scripted sequence from step 0)",
        "the scripted source-auth state was reset before the run (J28 drives expiry → recovery from the signed-in start)",
        "the scripted identity persona was reset before the run (J36 drives register → authenticated → sign-out from the signed-out start)",
        `one isolated agent-browser session per run (${sessionId})`,
        "a fixed 1280×800 viewport (every run the same layout math — clicks never depend on window size)",
        "the fixture provider URLs (fixture.invalid) are network-blocked — the provider frames fail instantly and deterministically (the journeys assert the DOM containment grammar, never provider content)",
        "the product booted in its documented deterministic fixtures mode (WFX_DEV_FIXTURES=1, port 3101)",
        "journeys run in fixed catalog order; acquisition-driving journeys (J21–J26) are order-dependent by design",
      ],
    },
    journeys: results,
    limitations,
  });

  const manifestPath = join(evidenceDirAbs, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const summaryPath = join(evidenceDirAbs, "summary.md");
  writeFileSync(summaryPath, renderSummary(manifest));

  console.log("");
  console.log(renderSummary(manifest));
  console.log(`journeys: manifest → ${options.evidenceDir}/manifest.json`);
  return runIsGreen(manifest) ? 0 : 1;
}

/** The limitations relevant to a filtered run (never silently dropped). */
function relevantLimitations(filter: readonly string[]): readonly LimitationRecord[] {
  const relevant = JOURNEY_LIMITATIONS.filter((limitation) => filter.includes(limitation.journeyId));
  if (relevant.length === JOURNEY_LIMITATIONS.length || relevant.length === 0) {
    return relevant.length === 0 ? [] : JOURNEY_LIMITATIONS;
  }
  return relevant;
}

/** Execute one journey with full evidence capture. */
async function runJourney(
  journey: Journey,
  browser: Browser,
  baseUrl: string,
  evidenceDirAbs: string,
  evidenceDirRel: string,
): Promise<JourneyResult> {
  const startedAt = Date.now();
  const artifacts: string[] = [];
  const journal = createJournal();
  const assert = bindAssertions(journal, browser);

  const screenshot = async (name: string): Promise<string> => {
    const abs = join(evidenceDirAbs, `${name}.png`);
    await browser.screenshot(abs);
    const rel = `${evidenceDirRel}/${name}.png`;
    artifacts.push(rel);
    return rel;
  };
  const saveSnapshot = async (name: string): Promise<string> => {
    const text = await browser.snapshotInteractive();
    const abs = join(evidenceDirAbs, `${name}.snapshot.txt`);
    writeFileSync(abs, text);
    const rel = `${evidenceDirRel}/${name}.snapshot.txt`;
    artifacts.push(rel);
    return rel;
  };
  const context: JourneyContext = {
    assert,
    browser,
    baseUrl,
    screenshot,
    saveSnapshot,
    evidenceDir: evidenceDirRel,
  };

  let status: JourneyResult["status"] = "pass";
  let failure: string | null = null;
  let pageErrors: readonly string[] = [];
  try {
    await journey.run(context);
    // The final protocol snapshot (evidence) + page-error collection.
    await saveSnapshot(slug(`${journey.id}-${journey.title}`));
    pageErrors = await browser.pageErrors();
    if (pageErrors.length > 0) {
      status = "fail";
      failure = `${pageErrors.length} uncaught page error(s) during the journey: ${pageErrors[0] ?? ""}`;
    }
  } catch (thrown) {
    status = "fail";
    if (thrown instanceof AssertionError) {
      failure = thrown.message;
    } else if (thrown instanceof BrowserError) {
      failure = `harness/browser failure: ${thrown.message}`;
    } else {
      failure = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
    }
    // FAILURE EVIDENCE: screenshot + snapshot + console log, always.
    try {
      const name = slug(`${journey.id}-FAILURE`);
      const abs = join(evidenceDirAbs, `${name}.png`);
      await browser.screenshot(abs);
      artifacts.push(`${evidenceDirRel}/${name}.png`);
      const text = await browser.snapshotInteractive();
      writeFileSync(join(evidenceDirAbs, `${name}.snapshot.txt`), text);
      artifacts.push(`${evidenceDirRel}/${name}.snapshot.txt`);
      const logs = await browser.consoleLogs();
      if (logs.length > 0) {
        writeFileSync(join(evidenceDirAbs, `${name}.console.txt`), `${logs.join("\n")}\n`);
        artifacts.push(`${evidenceDirRel}/${name}.console.txt`);
      }
    } catch {
      // Failure-evidence capture is best-effort; the failure itself stands.
    }
    try {
      pageErrors = await browser.pageErrors();
    } catch {
      pageErrors = [];
    }
  }

  // Narrations (actions performed / observed result) ride along.
  const narrations = narrationsOf(context);
  if (narrations.length > 0) {
    writeFileSync(join(evidenceDirAbs, `${slug(`${journey.id}-${journey.title}`)}.narration.txt`), `${narrations.map((line) => `- ${line}`).join("\n")}\n`);
    artifacts.push(`${evidenceDirRel}/${slug(`${journey.id}-${journey.title}`)}.narration.txt`);
  }

  return {
    id: journey.id,
    title: journey.title,
    status,
    reason: null,
    failure,
    assertions: journal.records(),
    artifacts,
    pageErrors,
    durationMs: Date.now() - startedAt,
  };
}

/** A stable artifact-name slug. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// The entry (exit code is the CI gate's signal).
try {
  process.exitCode = await main();
} catch (thrown) {
  console.error(`journeys: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
  process.exitCode = 1;
}
