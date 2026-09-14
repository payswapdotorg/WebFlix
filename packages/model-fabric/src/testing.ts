/**
 * @wfx/model-fabric — TEST FIXTURES (WFX-030, Lane A).
 *
 * TEST FIXTURES ONLY — NEVER REGISTER AS PRODUCTION PROVIDERS.
 *
 * Three in-memory provider doubles for exercising the fabric machinery:
 *
 * - `makeEchoProvider(id, opts)`   — resolves with `input` transformed by a
 *   stub function (default: identity). Declares chosen
 *   capabilities/privacy/costs.
 * - `makeFailingProvider(id, opts)`— always fails: `reject` (async
 *   rejection), `sync-throw` (synchronous throw out of `invoke`), or `hang`
 *   (never settles — the fabric's timeout path).
 * - `makeSlowProvider(id, ms)`     — sleeps `ms`, then resolves with `input`:
 *   choose `ms` above the invocation timeout to force timeouts, below it to
 *   test slow-but-successful attempts.
 *
 * Every fixture carries `isTestFixture: true` and a `calls` log
 * (`{ task, input }` per invocation) so tests can assert exactly which
 * providers saw which inputs — e.g. that a local-only policy never lets a
 * cloud provider see the input. No I/O of any kind (no network, no
 * filesystem); the only timers are the deliberate sleep/hang used to
 * exercise timeout paths.
 */

import type { ModelTask } from "@wfx/domain";

import type { ModelProviderPrivacy, RegisteredModelProvider } from "./registry";
import { MODEL_TASKS } from "./types";

// ---------------------------------------------------------------------------
// Shared fixture surface
// ---------------------------------------------------------------------------

/** One recorded fixture invocation. */
export interface FixtureProviderCall {
  task: ModelTask;
  input: unknown;
}

/** Registration options shared by every fixture factory. */
export interface FixtureRegistrationOptions {
  /**
   * Tasks the fixture declares. Default: EVERY frozen ModelTask (override to
   * exercise capability filtering).
   */
  capabilities?: readonly ModelTask[];
  /** Where the fixture "runs". Default: `'local'`. */
  privacy?: ModelProviderPrivacy;
  /**
   * Declared costs per task (`undefined` for unlisted tasks = undeclared).
   * Default: none.
   */
  costs?: Partial<Record<ModelTask, number>>;
}

/** The fixture base: a full `RegisteredModelProvider` plus test observability. */
export interface FixtureProvider extends RegisteredModelProvider {
  /** Brand: this object is a TEST FIXTURE, never a production provider. */
  readonly isTestFixture: true;
  /** Every invocation the fixture received, in order. */
  readonly calls: readonly FixtureProviderCall[];
}

/**
 * Shared fixture plumbing: registration metadata (id, capabilities, privacy,
 * costs) and the invocation call log. Subclasses implement `invoke`.
 */
abstract class FixtureProviderBase implements FixtureProvider {
  readonly isTestFixture = true as const;
  readonly privacy: ModelProviderPrivacy;
  private readonly declaredCapabilities: readonly ModelTask[];
  private readonly declaredCosts: Partial<Record<ModelTask, number>>;
  private readonly callLog: FixtureProviderCall[] = [];

  protected constructor(
    readonly id: string,
    options: FixtureRegistrationOptions = {},
  ) {
    this.declaredCapabilities = options.capabilities ?? [...MODEL_TASKS];
    this.privacy = options.privacy ?? "local";
    this.declaredCosts = options.costs ?? {};
  }

  get capabilities(): ModelTask[] {
    return [...this.declaredCapabilities];
  }

  get calls(): readonly FixtureProviderCall[] {
    return this.callLog;
  }

  costPerOperation(task: ModelTask): number | undefined {
    return this.declaredCosts[task];
  }

  /** Record one invocation for test assertions. */
  protected record(task: ModelTask, input: unknown): void {
    this.callLog.push({ task, input });
  }

  abstract invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut>;
}

// ---------------------------------------------------------------------------
// makeEchoProvider
// ---------------------------------------------------------------------------

/** Options for {@link makeEchoProvider}. */
export interface EchoProviderOptions extends FixtureRegistrationOptions {
  /**
   * The stub transformation applied to the input; the return value is what
   * `invoke` resolves with. Default: identity. The return type must match
   * the caller's `TOut` by test construction.
   */
  transform?: (input: unknown) => unknown;
}

/** The echo provider TEST FIXTURE: succeeds with `transform(input)`. */
export type EchoProvider = FixtureProvider;

class EchoProviderImpl extends FixtureProviderBase implements EchoProvider {
  private readonly transform: (input: unknown) => unknown;

  constructor(id: string, options: EchoProviderOptions = {}) {
    super(id, options);
    this.transform = options.transform ?? ((input: unknown) => input);
  }

  async invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut> {
    this.record(task, input);
    return this.transform(input) as TOut;
  }
}

/** Create the echo provider TEST FIXTURE (in-memory, no I/O). NEVER production. */
export function makeEchoProvider(id: string, options: EchoProviderOptions = {}): EchoProvider {
  return new EchoProviderImpl(id, options);
}

// ---------------------------------------------------------------------------
// makeFailingProvider
// ---------------------------------------------------------------------------

/** How the failing fixture fails. */
export type FailingProviderMode = "reject" | "sync-throw" | "hang";

/** Options for {@link makeFailingProvider}. */
export interface FailingProviderOptions extends FixtureRegistrationOptions {
  /**
   * Failure mode. Default `'reject'` (async rejection → provider-error).
   * `'sync-throw'` throws synchronously out of `invoke` (→ provider-error).
   * `'hang'` never settles (→ timeout at the fabric).
   */
  failure?: FailingProviderMode;
  /** The failure message. Default: `"fixture: deliberate provider failure"`. */
  errorMessage?: string;
}

/** The failing provider TEST FIXTURE: always fails, never succeeds. */
export interface FailingProvider extends FixtureProvider {
  /** The configured failure mode. */
  readonly failureMode: FailingProviderMode;
}

class FailingProviderImpl extends FixtureProviderBase implements FailingProvider {
  readonly failureMode: FailingProviderMode;
  private readonly errorMessage: string;

  constructor(id: string, options: FailingProviderOptions = {}) {
    super(id, options);
    this.failureMode = options.failure ?? "reject";
    this.errorMessage = options.errorMessage ?? "fixture: deliberate provider failure";
  }

  invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut> {
    this.record(task, input);
    switch (this.failureMode) {
      case "sync-throw":
        throw new Error(this.errorMessage);
      case "hang":
        return new Promise<TOut>(() => {});
      case "reject":
      default:
        return Promise.reject(new Error(this.errorMessage));
    }
  }
}

/** Create the failing provider TEST FIXTURE (no I/O). NEVER production. */
export function makeFailingProvider(
  id: string,
  options: FailingProviderOptions = {},
): FailingProvider {
  return new FailingProviderImpl(id, options);
}

// ---------------------------------------------------------------------------
// makeSlowProvider
// ---------------------------------------------------------------------------

/** The slow provider TEST FIXTURE: sleeps `delayMs`, then resolves with the input. */
export interface SlowProvider extends FixtureProvider {
  /** The configured delay in milliseconds. */
  readonly delayMs: number;
}

/** Options for {@link makeSlowProvider}: registration options only. */
export type SlowProviderOptions = FixtureRegistrationOptions;

/** Sleep for `ms` (the only timer the fixtures ever arm). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class SlowProviderImpl extends FixtureProviderBase implements SlowProvider {
  readonly delayMs: number;

  constructor(id: string, delayMs: number, options: SlowProviderOptions = {}) {
    super(id, options);
    this.delayMs = delayMs;
  }

  async invoke<TIn, TOut>(task: ModelTask, input: TIn): Promise<TOut> {
    this.record(task, input);
    await sleep(this.delayMs);
    return input as unknown as TOut;
  }
}

/**
 * Create the slow provider TEST FIXTURE (no I/O beyond the sleep timer).
 * `delayMs` above the invocation timeout forces timeouts; below it yields a
 * slow success. NEVER production.
 */
export function makeSlowProvider(
  id: string,
  delayMs: number,
  options: SlowProviderOptions = {},
): SlowProvider {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error(
      `makeSlowProvider: delayMs must be a finite non-negative number, got ${delayMs}`,
    );
  }
  return new SlowProviderImpl(id, delayMs, options);
}
