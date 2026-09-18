/**
 * @wfx/journeys — child-process helper (R16).
 *
 * The smallest spawn seam the harness needs: run one command, capture
 * stdout/stderr, enforce a timeout, and answer a typed result. No shell
 * string interpolation — arguments are passed verbatim (no injection
 * surface).
 *
 * Determinism: no environment mutation, no cwd mutation beyond the
 * caller's explicit `cwd`; every call is independent.
 */

import { spawn } from "node:child_process";
import { appendFileSync, openSync } from "node:fs";

/** One completed command run. */
export interface ProcResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Options for {@link runProc}. */
export interface ProcOptions {
  /** Working directory (default: inherit). */
  readonly cwd?: string;
  /** Extra environment entries (merged over the inherited environment). */
  readonly env?: Readonly<Record<string, string>>;
  /** Kill after this many milliseconds (default: 60_000). */
  readonly timeoutMs?: number;
}

/**
 * Run one command to completion and capture its output.
 *
 * On timeout the child is killed (SIGTERM, then SIGKILL after grace) and
 * the result reports exitCode -1 with the timeout note in stderr — the
 * caller decides whether that is a failure (browser command) or a
 * readiness signal (dev-server boot probes use their own polling).
 */
export function runProc(
  command: string,
  args: readonly string[],
  options: ProcOptions = {},
): Promise<ProcResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  return new Promise<ProcResult>((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killed = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);

    const finish = (exitCode: number, note: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout,
        stderr: note === null ? stderr : `${stderr}\n${note}`,
      });
    };

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(-1, `proc: could not run '${command}': ${error.message}`);
    });
    child.on("close", (code) => {
      finish(
        killed ? -1 : (code ?? -1),
        killed ? `proc: timed out after ${timeoutMs}ms` : null,
      );
    });
  });
}

/**
 * A long-lived child (a dev server) handle: the caller owns the lifetime
 * (`stop()`).
 */
export interface BackgroundProc {
  readonly pid: number | undefined;
  /** Read the output captured so far (stdout + stderr). */
  output(): string;
  /** Terminate the child (SIGTERM, then SIGKILL after grace). */
  stop(): Promise<void>;
}

/** Options for {@link startBackgroundProc}. */
export interface BackgroundProcOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Where to tee combined output (best-effort; caller-created). */
  readonly logFile?: string;
}

/** Start a long-running command. Never throws on spawn failure — `output()` carries the reason. */
export function startBackgroundProc(
  command: string,
  args: readonly string[],
  options: BackgroundProcOptions = {},
): BackgroundProc {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  let buffer = "";
  const tee = (text: string): void => {
    buffer += text;
    if (options.logFile !== undefined) {
      try {
        appendFileSync(options.logFile, text);
      } catch {
        // Best-effort logging only.
      }
    }
  };
  child.stdout.on("data", (chunk: Buffer) => {
    tee(chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    tee(chunk.toString("utf8"));
  });
  child.on("error", (error: NodeJS.ErrnoException) => {
    buffer += `\n[start] could not run '${command}': ${error.message}\n`;
  });
  if (options.logFile !== undefined) {
    try {
      openSync(options.logFile, "a");
    } catch {
      // Best-effort logging only.
    }
  }
  return {
    pid: child.pid,
    output: () => buffer,
    stop: async () => {
      if (child.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5_000);
        child.once("close", () => {
          clearTimeout(killTimer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    },
  };
}
