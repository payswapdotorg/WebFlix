/**
 * @wfx/journeys — the agent-browser driver (R16).
 *
 * THE BROWSER-VALIDATION PROTOCOL, ENCODED AS CODE. Every method is one
 * `agent-browser` CLI command over the SAME named session (the isolation
 * law: a journey run never shares a browser with another agent or a human
 * tab). The protocol the journey doc freezes is the DEFAULT here:
 *
 *   open <url>  ->  wait --load networkidle  ->  snapshot -i
 *   (fresh snapshot after every navigation / DOM-changing interaction)
 *
 * Honesty laws kept by the driver:
 * - A command that fails answers the typed {@link BrowserError} with the
 *   command line, exit code, and stderr — never a swallowed failure that
 *   lets a journey "pass" because the browser said no.
 * - `tryText`/`tryHtml`/`tryAttr` distinguish "the element is absent" (a
 *   legitimate observation — asserted as absence) from "the command
 *   failed" (a harness error). Assertions consume the former; the runner
 *   treats the latter as a journey infrastructure failure.
 * - NOTHING in this module imports from any @wfx package: the harness is
 *   a USER of the product (layering law — journeys consume the running
 *   product over HTTP + the browser, never private imports).
 *
 * Determinism: one session per run (unique name), a generous idle
 * timeout via AGENT_BROWSER_IDLE_TIMEOUT_MS (the browser must outlive a
 * slow journey), and no viewport mutation (the product's own layout).
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { runProc, type ProcResult } from "./proc";

/** The typed failure of one browser command. */
export class BrowserError extends Error {
  readonly command: string;
  readonly exitCode: number;
  readonly stderr: string;
  constructor(command: string, exitCode: number, stderr: string) {
    super(`agent-browser command failed (${exitCode}): ${command}\n${stderr.trim()}`);
    this.name = "BrowserError";
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** Options for {@link Browser.launch}. */
export interface BrowserOptions {
  /** The named session (isolation law — unique per journey run). */
  readonly session: string;
  /** Override the agent-browser binary (default: `agent-browser` on PATH). */
  readonly binary?: string;
  /** Per-command timeout in ms (default: 30_000). */
  readonly timeoutMs?: number;
}

/** The load-event kinds the CLI waits on. */
export type LoadKind = "networkidle" | "load" | "domcontentloaded";

/** The driver over one agent-browser session. */
export class Browser {
  private readonly binary: string;
  private readonly timeoutMs: number;
  /** The last interactive snapshot text (evidence; refreshed per protocol). */
  private lastSnapshot = "";

  private constructor(
    readonly session: string,
    options: BrowserOptions,
  ) {
    this.binary = options.binary ?? "agent-browser";
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Verify the CLI is present and prepare the session. */
  static async launch(options: BrowserOptions): Promise<Browser> {
    const browser = new Browser(options.session, options);
    const version = await browser.run(["--version"], 15_000);
    if (version.exitCode !== 0) {
      throw new BrowserError(
        "agent-browser --version",
        version.exitCode,
        version.stderr ||
          "agent-browser is not installed (CI installs it with `npm i -g agent-browser && agent-browser install --with-deps`)",
      );
    }
    return browser;
  }

  /**
   * Prepare the session's deterministic environment: a FIXED viewport
   * (1280×800 — every run the same layout math), and the fixture provider
   * URLs blocked (see {@link blockFixtureProviderUrls}). Staged on
   * about:blank BEFORE the first real navigation.
   */
  async prepareSession(): Promise<void> {
    await this.exec(["open"]);
    await this.exec(["set", "viewport", "1280", "800"]);
    await this.blockFixtureProviderUrls();
  }

  /** One raw CLI invocation bound to this session's environment. */
  private async run(args: readonly string[], timeoutMs?: number): Promise<ProcResult> {
    return runProc(this.binary, args, {
      timeoutMs: timeoutMs ?? this.timeoutMs,
      env: {
        AGENT_BROWSER_SESSION: this.session,
        // The browser must outlive long journeys (default daemon idle
        // timeout is one hour; runs are comfortably shorter).
        AGENT_BROWSER_IDLE_TIMEOUT_MS: "3600000",
      },
    });
  }

  /** Run one command, throwing the typed error on nonzero exit. */
  private async exec(args: readonly string[], timeoutMs?: number): Promise<string> {
    const result = await this.run(args, timeoutMs);
    if (result.exitCode !== 0) {
      throw new BrowserError(args.join(" "), result.exitCode, result.stderr);
    }
    return result.stdout;
  }

  // -- The frozen protocol ------------------------------------------------

  /**
   * Navigate to a URL (the protocol's first step).
   *
   * The CLI's `open` waits for the page's LOAD event — which an aborted
   * provider iframe (the fixture.invalid route block) can leave pending
   * even though the page is fully rendered. A LOAD-WAIT timeout is
   * therefore TOLERATED (the navigation itself dispatched; the protocol's
   * networkidle wait and the journey's assertions remain the truth gate —
   * a genuinely broken page fails there). A hard navigation failure
   * (net::ERR…) stays fatal.
   */
  async open(url: string): Promise<void> {
    const result = await this.run(["open", url], 40_000);
    if (result.exitCode !== 0) {
      if (/Navigation failed|net::ERR|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/i.test(result.stderr)) {
        throw new BrowserError(`open ${url}`, result.exitCode, result.stderr);
      }
      // A load-wait timeout on an otherwise-dispatched navigation: the
      // content render is verified by the protocol's next steps.
    }
  }

  /** Wait for a load event (the protocol's second step). */
  async waitLoad(kind: LoadKind): Promise<void> {
    await this.exec(["wait", "--load", kind]);
  }

  /**
   * The protocol's third step: a fresh interactive snapshot. Returns the
   * a11y tree text (kept as evidence) — assertions elsewhere consume the
   * DOM selectors, but the snapshot is the journey doc's required step.
   */
  async snapshotInteractive(): Promise<string> {
    const out = await this.exec(["snapshot", "-i"]);
    this.lastSnapshot = out;
    return out;
  }

  /** The full navigation protocol in one call: open → networkidle → snapshot. */
  async navigate(url: string): Promise<string> {
    await this.open(url);
    await this.waitLoad("networkidle");
    return this.snapshotInteractive();
  }

  // -- Interaction ---------------------------------------------------------

  /** Click an element by CSS selector or @ref. */
  async click(selector: string): Promise<void> {
    await this.exec(["click", selector]);
  }

  /** Click an element by accessible name (role/text locators). */
  async clickRole(role: string, name: string): Promise<void> {
    await this.exec(["find", "role", role, "click", "--name", name]);
  }

  /** Clear and fill an input. */
  async fill(selector: string, text: string): Promise<void> {
    await this.exec(["fill", selector, text]);
  }

  /** Press one key at the current focus. */
  async press(key: string): Promise<void> {
    await this.exec(["press", key]);
  }

  /** Wait for an element to appear (bounded). */
  async waitSelector(selector: string, timeoutMs = 15_000): Promise<void> {
    await this.exec(["wait", selector], timeoutMs);
  }

  /** Wait for text to appear on the page (bounded). */
  async waitText(text: string, timeoutMs = 15_000): Promise<void> {
    await this.exec(["wait", "--text", text], timeoutMs);
  }

  /**
   * Navigation-SAFE text wait: poll the element's visible text with FRESH
   * evaluations until it contains the fragment. `wait --text` polls one
   * page context and can go stale when the page RELOADS mid-poll (the
   * classic acquisition-drive race: click → POST → reload while the wait
   * command is already polling the old context — it then never sees the
   * new text and times out). Each poll here is an independent command
   * against whatever page is live, so a mid-poll navigation costs one
   * null observation and the next poll reads the reloaded DOM.
   */
  async pollTextContains(selector: string, fragment: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastObserved: string | null = null;
    let lastError: string | null = null;
    while (Date.now() < deadline) {
      try {
        const observed = await this.tryText(selector);
        if (observed !== null && observed.includes(fragment)) {
          return;
        }
        lastObserved = observed;
      } catch (thrown) {
        lastError = thrown instanceof Error ? thrown.message : String(thrown);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new BrowserError(
      `pollTextContains "${fragment}" in ${selector}`,
      -1,
      `timed out after ${timeoutMs}ms; last observed: ${lastObserved ?? "<absent>"}${lastError === null ? "" : `; last poll error: ${lastError}`}`,
    );
  }

  /** A fixed settle delay (last resort; used only after DOM-mutating clicks). */
  async settle(ms = 400): Promise<void> {
    await this.exec(["wait", String(ms)], ms + this.timeoutMs);
  }

  /**
   * Navigation-SAFE truthy-eval wait: poll a JS expression with FRESH
   * evaluations until it answers truthy (bounded). The telemetry trace
   * reads race the command round trip on loaded boxes — a single read
   * after a fixed settle flakes exactly like the play-click race the
   * R24-W2 lane hardened (the deterministic ready-wait); a bounded poll
   * observes the marker whenever the round trip completes. Throws the
   * typed BrowserError with the last observed value on timeout.
   */
  async pollEvalTruthy(expression: string, timeoutMs = 20_000): Promise<true> {
    const deadline = Date.now() + timeoutMs;
    let lastObserved: unknown = null;
    let lastError: string | null = null;
    while (Date.now() < deadline) {
      try {
        const observed = await this.eval<boolean>(expression);
        if (observed === true) {
          return true;
        }
        lastObserved = observed;
      } catch (thrown) {
        lastError = thrown instanceof Error ? thrown.message : String(thrown);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new BrowserError(
      `pollEvalTruthy ${expression.slice(0, 80)}`,
      -1,
      `timed out after ${timeoutMs}ms; last observed: ${String(lastObserved)}${lastError === null ? "" : `; last poll error: ${lastError}`}`,
    );
  }

  // -- Reading -------------------------------------------------------------

  /** The visible text of an element (null when absent). */
  async tryText(selector: string): Promise<string | null> {
    const result = await this.run(["get", "text", selector]);
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  }

  /** The innerHTML of an element (null when absent). */
  async tryHtml(selector: string): Promise<string | null> {
    const result = await this.run(["get", "html", selector]);
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  }

  /**
   * The OUTER html of the first element matching a selector (null when
   * absent) — read through the page's own serializer so the ROOT
   * element's attributes (e.g. `data-wfx-acquisition-state`) are visible
   * to the state parsers (innerHTML hides them).
   */
  async outerHtml(selector: string): Promise<string | null> {
    return this.eval<string | null>(
      `(() => { const element = document.querySelector(${JSON.stringify(selector)}); return element === null ? null : element.outerHTML; })()`,
    );
  }

  /**
   * Wait until a client island is INTERACTIVE (React has attached its
   * event handlers). A server-rendered button's text exists before
   * hydration, but a click dispatched pre-hydration is a silent no-op —
   * the classic dev-mode trap this harness must never hit. The React
   * props marker on the element appears exactly when the client
   * runtime has mounted it.
   */
  async waitForInteractive(selector: string, timeoutMs = 20_000): Promise<void> {
    await this.exec(
      [
        "wait",
        "--fn",
        `(() => { const element = document.querySelector(${JSON.stringify(selector)}); return element !== null && Object.keys(element).some((key) => key.startsWith("__reactProps")); })()`,
      ],
      timeoutMs,
    );
  }

  /** One attribute of an element (null when element or attribute is absent). */
  async tryAttr(selector: string, attribute: string): Promise<string | null> {
    const result = await this.run(["get", "attr", selector, attribute]);
    if (result.exitCode !== 0) return null;
    const value = result.stdout.trim();
    return value.length === 0 ? null : value;
  }

  /** The count of elements matching a selector (0 when none). */
  async count(selector: string): Promise<number> {
    const result = await this.run(["get", "count", selector]);
    if (result.exitCode !== 0) {
      throw new BrowserError(
        `get count ${selector}`,
        result.exitCode,
        result.stderr,
      );
    }
    const parsed = Number.parseInt(result.stdout.trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** The current page URL. */
  async url(): Promise<string> {
    const out = await this.exec(["get", "url"]);
    return out.trim();
  }

  /** Evaluate JavaScript in the page (the result is JSON-decoded when possible). */
  async eval<T>(expression: string): Promise<T> {
    const out = await this.exec(["eval", expression]);
    const trimmed = out.trim();
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return trimmed as unknown as T;
    }
  }

  /** Uncaught page errors so far this session (the failure-evidence channel). */
  async pageErrors(): Promise<readonly string[]> {
    const result = await this.run(["errors"]);
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  /** Console log lines so far this session (failure evidence; not a gate). */
  async consoleLogs(): Promise<readonly string[]> {
    const result = await this.run(["console"]);
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  // -- Evidence ------------------------------------------------------------

  /** Capture a screenshot to an absolute path (creating parent dirs). */
  async screenshot(path: string): Promise<void> {
    mkdirSync(dirname(path), { recursive: true });
    await this.exec(["screenshot", path], 45_000);
    if (!existsSync(path)) {
      throw new BrowserError(
        `screenshot ${path}`,
        -1,
        "the screenshot command reported success but wrote no file",
      );
    }
  }

  /** The most recent interactive snapshot (evidence text). */
  currentSnapshot(): string {
    return this.lastSnapshot;
  }

  /**
   * Click an interactive island control ROBUSTLY: scroll the element into
   * view (a button whose center is below the fold receives NOTHING — the
   * click dispatches at viewport coordinates and misses), wait for the
   * island's hydration (a pre-hydration click is a silent no-op), then
   * click. Every client-island control in a journey goes through here.
   */
  async clickInteractive(selector: string): Promise<void> {
    await this.exec(["scrollintoview", selector]);
    await this.waitForInteractive(selector);
    await this.exec(["click", selector]);
  }

  /**
   * Block the fixture transport's unreachable provider URLs at the
   * network layer (the fixtures-mode realizations point at
   * `fixture.invalid` — a reserved TLD that never resolves). Without the
   * block, the browser's DNS lookup can hang past the harness timeouts
   * (flaky); with it, the provider frames fail INSTANTLY and
   * deterministically — exactly the honest fixture behavior the journeys
   * assert (the DOM containment grammar, never provider content).
   */
  async blockFixtureProviderUrls(): Promise<void> {
    await this.exec(["network", "route", "*fixture.invalid*", "--abort"]);
  }

  /** Close this session's browser. */
  async close(): Promise<void> {
    await this.exec(["close"]);
  }
}
