/**
 * R07 test helpers — deterministic, in-memory fakes of the WEB ENVIRONMENT.
 *
 * TEST-ONLY (never imported by production paths): fakes of the browser
 * facilities the platform bundle probes (document, localStorage,
 * navigator, Notification), plus the controlled-environment runner the
 * boot-law tests need. Everything is synchronous and deterministic — no
 * network, no timers, no real browser.
 */

import type {
  DocumentLike,
  HTMLElementLike,
  HTMLIFrameElementLike,
  NotificationApiLike,
  NotificationConstructorLike,
  NotificationPermissionState,
  StorageLike,
  WebEnvironment,
} from "../src/platform/environment";

// ---------------------------------------------------------------------------
// Fake localStorage
// ---------------------------------------------------------------------------

/** An in-memory localStorage double (namespaced by the port). */
export class FakeLocalStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  /** When set, the next setItem throws this (quota/security simulation). */
  nextSetError: unknown = null;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.nextSetError !== null) {
      const error = this.nextSetError;
      this.nextSetError = null;
      throw error;
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Fake document (DOM mount of the contained surface)
// ---------------------------------------------------------------------------

/** One recorded iframe (assertion surface). */
export interface RecordedFrame {
  src: string;
  sandbox: string[];
  title: string;
  attached: boolean;
  loadHandlers: ((event: Event) => void)[];
}

/** An in-memory document double with an iframe factory. */
export class FakeDocument implements DocumentLike {
  visibilityState: DocumentLike["visibilityState"] = "visible";
  readonly frames: RecordedFrame[] = [];
  private readonly listeners = new Map<string, ((event: Event) => void)[]>();

  addEventListener(type: string, listener: (event: Event) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((entry) => entry !== listener));
  }

  /** Fire one DOM event (the test pump: visibilitychange / pagehide). */
  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }

  createElement(tagName: "iframe"): HTMLIFrameElementLike {
    void tagName;
    const frame: RecordedFrame = { src: "", sandbox: [], title: "", attached: false, loadHandlers: [] };
    this.frames.push(frame);
    const sandboxTokens = {
      add: (...tokens: string[]) => {
        frame.sandbox.push(...tokens);
      },
    };
    const element = {
      sandbox: sandboxTokens,
      referrerPolicy: "",
      allow: "",
      addEventListener: (type: string, listener: (event: Event) => void) => {
        if (type === "load") frame.loadHandlers.push(listener);
      },
      removeEventListener: () => undefined,
    } as unknown as HTMLIFrameElementLike;
    Object.defineProperty(element, "src", {
      get: () => frame.src,
      set: (value: string) => {
        frame.src = value;
      },
    });
    Object.defineProperty(element, "title", {
      get: () => frame.title,
      set: (value: string) => {
        frame.title = value;
      },
    });
    return element;
  }

  readonly body: HTMLElementLike = {
    appendChild: (child: HTMLIFrameElementLike) => {
      const frame = this.frames.find((entry) => entry.src === child.src && !entry.attached);
      if (frame !== undefined) frame.attached = true;
      return child;
    },
    removeChild: (child: HTMLIFrameElementLike) => {
      const frame = this.frames.find((entry) => entry.attached && entry.src === child.src);
      if (frame !== undefined) frame.attached = false;
      return child;
    },
  };
}

// ---------------------------------------------------------------------------
// Fake Notification API
// ---------------------------------------------------------------------------

/** The recorded delivery (assertion surface). */
export interface RecordedNotification {
  title: string;
  body?: string;
  tag?: string;
}

/**
 * An in-memory Notification API double: the instance is the PERMISSION
 * READER; `toConstructor()` yields the NOTIFICATION CONSTRUCTOR bound to
 * the same state (the real global plays both roles; the split keeps the
 * per-test state inspectable).
 */
export class FakeNotificationApi implements NotificationApiLike {
  permission: NotificationPermissionState = "default";
  nextRequestPermission: NotificationPermissionState | Error = "granted";
  nextConstructorError: unknown = null;
  readonly constructed: RecordedNotification[] = [];

  async requestPermission(): Promise<NotificationPermissionState> {
    if (this.nextRequestPermission instanceof Error) throw this.nextRequestPermission;
    const answer = this.nextRequestPermission;
    this.permission = answer;
    return answer;
  }

  /** The constructor bound to this instance's state (the delivery recorder). */
  toConstructor(): NotificationConstructorLike {
    // The alias is the constructor-binding pattern: the returned function
    // must be `new`-able (never an arrow), and its own `this` is the NEW
    // notification — the API instance is captured here.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const api = this;
    return function FakeNotification(
      this: unknown,
      title: string,
      options?: { readonly body?: string; readonly tag?: string; readonly data?: unknown },
    ) {
      if (api.nextConstructorError !== null) {
        const error = api.nextConstructorError;
        api.nextConstructorError = null;
        throw error;
      }
      api.constructed.push({
        title,
        ...(options?.body !== undefined ? { body: options.body } : {}),
        ...(options?.tag !== undefined ? { tag: options.tag } : {}),
      });
      return { close: (): void => undefined };
    } as unknown as NotificationConstructorLike;
  }
}

// ---------------------------------------------------------------------------
// Environment builders
// ---------------------------------------------------------------------------

/** The SERVER-RENDER environment: every browser facility honestly absent. */
export function makeServerEnvironment(): WebEnvironment {
  return {
    document: null,
    window: null,
    localStorage: null,
    indexedDB: null,
    navigator: null,
    notificationApi: null,
    notificationCtor: null,
  };
}

/** A full BROWSER environment over the given fakes. */
export function makeBrowserEnvironment(overrides: {
  readonly document?: FakeDocument;
  readonly localStorage?: FakeLocalStorage;
  readonly notificationApi?: FakeNotificationApi | null;
  readonly share?: (data: {
    readonly title?: string;
    readonly text?: string;
    readonly url?: string;
  }) => Promise<void>;
  readonly canShare?: (data: {
    readonly title?: string;
    readonly text?: string;
    readonly url?: string;
  }) => boolean;
}): WebEnvironment {
  const document = overrides.document ?? new FakeDocument();
  const storage = overrides.localStorage ?? new FakeLocalStorage();
  const notification =
    overrides.notificationApi === null
      ? null
      : (overrides.notificationApi ?? new FakeNotificationApi());
  return {
    document,
    window: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    localStorage: storage,
    indexedDB: null,
    navigator: {
      ...(overrides.share !== undefined ? { share: overrides.share } : {}),
      ...(overrides.canShare !== undefined ? { canShare: overrides.canShare } : {}),
      language: "en-US",
    },
    notificationApi: notification,
    notificationCtor: notification !== null ? notification.toConstructor() : null,
  };
}

// ---------------------------------------------------------------------------
// Controlled environment (the boot-law runner)
// ---------------------------------------------------------------------------

const ENV_NAMES = ["WFX_DEV_FIXTURES", "WFX_API_BASE", "NODE_ENV", "WFX_LOCALE"] as const;

/** The mutable env view (process.env's NODE_ENV is typed read-only). */
function envRecord(): Record<string, string | undefined> {
  return process.env as unknown as Record<string, string | undefined>;
}

/** Run an async body with a controlled env, restoring the real one after. */
export async function withEnv(
  overrides: Record<string, string>,
  body: () => Promise<void>,
): Promise<void> {
  const env = envRecord();
  const saved = new Map<string, string | undefined>();
  for (const name of ENV_NAMES) saved.set(name, env[name]);
  try {
    for (const name of ENV_NAMES) delete env[name];
    for (const [name, value] of Object.entries(overrides)) env[name] = value;
    await body();
  } finally {
    for (const name of ENV_NAMES) {
      const value = saved.get(name);
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Fetch stubbing (the REAL ServerPort under deterministic transport)
// ---------------------------------------------------------------------------

/** One recorded fetch call (assertion surface). */
export interface RecordedFetch {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

/** A deterministic global-fetch stub: records calls, answers per responder. */
export class FetchStub {
  readonly calls: RecordedFetch[] = [];
  private readonly original: typeof fetch = globalThis.fetch;

  constructor(private readonly respond: (call: RecordedFetch) => Response | Promise<Response>) {}

  install(): void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers: Record<string, string> = {};
      const rawHeaders = init?.headers;
      if (rawHeaders !== undefined) {
        if (rawHeaders instanceof Headers) {
          rawHeaders.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (typeof rawHeaders === "object" && rawHeaders !== null && !Array.isArray(rawHeaders)) {
          for (const [key, value] of Object.entries(rawHeaders)) headers[key] = String(value);
        }
      }
      const call: RecordedFetch = {
        url,
        method: init?.method ?? "GET",
        headers,
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      };
      this.calls.push(call);
      return this.respond(call);
    }) as typeof fetch;
  }

  restore(): void {
    globalThis.fetch = this.original;
  }
}

/**
 * Run an async body with the stub installed; always restored. Answers the
 * recorded calls AND the body's own result.
 */
export async function withFetchStub<T>(
  respond: (call: RecordedFetch) => Response | Promise<Response>,
  body: () => Promise<T>,
): Promise<{ calls: RecordedFetch[]; result: T }> {
  const stub = new FetchStub(respond);
  stub.install();
  try {
    const result = await body();
    return { calls: stub.calls, result };
  } finally {
    stub.restore();
  }
}
