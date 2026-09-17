/**
 * @wfx/app-web — the Web adapter ENVIRONMENT seam (R07).
 *
 * The ONE place the web adapter touches browser globals. Everything the
 * platform bundle constructs is derived from a `WebEnvironment` — the real
 * browser environment when one exists, an honestly-absent one when it does
 * not (a server render pass, a test). NO platform port in this package
 * reads a global directly: they receive the environment (or a snapshot of
 * its probes) at construction, so every capability decision is inspectable,
 * injectable, and deterministic under test.
 *
 * HONESTY LAW (the R01 capability truth law, adapter side): an absent
 * facility is reported as ABSENT — never emulated, never guessed. A server
 * render pass has no `document`, no `localStorage`, no `Notification`, no
 * `navigator.share`; the environment says so, and the capability bundle
 * built from it declares only what that boot context truthfully provides.
 * The browser build of the same adapter probes the real facilities and
 * declares them.
 *
 * Determinism: `detectWebEnvironment()` reads the globals ONCE per call and
 * never mutates them; tests inject a fake environment (a plain object) and
 * run fully offline.
 */

/** The subset of the DOM `Document` the adapter's ports consume. */
export interface DocumentLike {
  /** The document's current visibility state. */
  readonly visibilityState: "visible" | "hidden" | "prerender" | "unloaded";
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  /** Element factory (the contained-surface mount uses it). */
  createElement(tagName: "iframe"): HTMLIFrameElementLike;
  /** The mount root for contained surfaces. */
  readonly body: HTMLElementLike;
}

/** The subset of `HTMLIFrameElement` the contained-surface mount consumes. */
export interface HTMLIFrameElementLike {
  src: string;
  sandbox: DOMTokenListLike | null;
  referrerPolicy: string;
  allow: string;
  title: string;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** The subset of `DOMTokenList` the mount consumes. */
export interface DOMTokenListLike {
  add(...tokens: string[]): void;
}

/** The subset of `HTMLElement` the mount consumes. */
export interface HTMLElementLike {
  appendChild(child: HTMLIFrameElementLike): unknown;
  removeChild(child: HTMLIFrameElementLike): unknown;
}

/** The subset of `Window` the adapter's ports consume. */
export interface WindowLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** The subset of `Storage` the storage port consumes. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

/**
 * The subset of the Web Notifications API the port consumes: the permission
 * reader plus the constructor that shows one real notification.
 */
export interface NotificationApiLike {
  readonly permission: "default" | "granted" | "denied";
  requestPermission(): Promise<NotificationPermissionState>;
}

/** The permission states the Web Notifications API answers. */
export type NotificationPermissionState = "default" | "granted" | "denied";

/** One constructed notification (the delivered evidence). */
export interface ConstructedNotificationLike {
  close(): void;
}

/** The notification constructor signature. */
export type NotificationConstructorLike = new (
  title: string,
  options?: { readonly body?: string; readonly tag?: string; readonly data?: unknown },
) => ConstructedNotificationLike;

/** The subset of `Navigator` the adapter's ports consume. */
export interface NavigatorLike {
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
  readonly language?: string;
}

/** The subset of the IndexedDB factory the storage port consumes. */
export type IndexedDbFactoryLike = (name: string, version?: number) => IDBRequestLike<IDBDatabaseLike>;

/** The minimal request shape (event-target with a result). */
export interface IDBRequestLike<T> {
  onsuccess: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  readonly result: T;
}

/** The minimal database shape the blob backend consumes. */
export interface IDBDatabaseLike {
  readonly objectStoreNames: DOMStringListLike;
  createObjectStore(name: string): unknown;
  transaction(storeName: string, mode: "readonly" | "readwrite"): IDBTransactionLike;
  close(): void;
}

/** The minimal string-list shape. */
export interface DOMStringListLike {
  contains(name: string): boolean;
}

/** The minimal transaction shape. */
export interface IDBTransactionLike {
  objectStore(name: string): IDBObjectStoreLike;
}

/** The minimal object-store shape. */
export interface IDBObjectStoreLike {
  get(key: string): IDBRequestLike<unknown>;
  put(value: { readonly key: string; readonly bytes: Uint8Array }): IDBRequestLike<unknown>;
  delete(key: string): IDBRequestLike<unknown>;
}

/**
 * The environment the platform bundle is constructed from. Every facility
 * reference is `null` when the facility is ABSENT in this boot context (a
 * server render pass) — the bundle built from it then declares only what is
 * real.
 */
export interface WebEnvironment {
  readonly document: DocumentLike | null;
  readonly window: WindowLike | null;
  readonly localStorage: StorageLike | null;
  readonly indexedDB: IndexedDbFactoryLike | null;
  readonly navigator: NavigatorLike | null;
  /** The permission reader of the Web Notifications API. */
  readonly notificationApi: NotificationApiLike | null;
  /** The constructor that shows one real notification. */
  readonly notificationCtor: NotificationConstructorLike | null;
}

/**
 * The frozen probe snapshot of one environment: which facilities exist.
 * Captured ONCE at bundle construction; the capability levels are derived
 * from it (never re-probed — the runtime consumes the declaration).
 */
export interface WebEnvironmentSnapshot {
  readonly hasDocument: boolean;
  readonly hasLocalStorage: boolean;
  readonly hasIndexedDb: boolean;
  readonly hasWebShare: boolean;
  readonly hasNotificationApi: boolean;
}

/** Probe one environment into its capability snapshot (pure). */
export function snapshotWebEnvironment(environment: WebEnvironment): WebEnvironmentSnapshot {
  return {
    hasDocument: environment.document !== null,
    hasLocalStorage: environment.localStorage !== null,
    hasIndexedDb: environment.indexedDB !== null,
    hasWebShare: environment.navigator?.share !== undefined,
    hasNotificationApi: environment.notificationApi !== null && environment.notificationCtor !== null,
  };
}

/**
 * Detect the REAL web environment of this process. In a browser this is the
 * live global facility; in a server render pass (or any non-browser host)
 * every facility is honestly absent. Defensive against half-provisioned
 * globals (each facility is probed and validated independently).
 */
export function detectWebEnvironment(): WebEnvironment {
  const globals = globalThis as {
    document?: unknown;
    window?: unknown;
    localStorage?: unknown;
    indexedDB?: unknown;
    navigator?: unknown;
    Notification?: unknown;
  };
  const notification =
    isNotificationApi(globals.Notification) ? globals.Notification : null;
  return {
    document: isDocument(globals.document) ? globals.document : null,
    window: isWindow(globals.window) ? globals.window : null,
    localStorage: isStorage(globals.localStorage) ? globals.localStorage : null,
    indexedDB: isIndexedDbFactory(globals.indexedDB) ? globals.indexedDB : null,
    navigator: isNavigator(globals.navigator) ? globals.navigator : null,
    notificationApi: notification,
    notificationCtor: notification,
  };
}

// ---------------------------------------------------------------------------
// Facility type guards (a half-provisioned global is absent, never trusted)
// ---------------------------------------------------------------------------

function isDocument(value: unknown): value is DocumentLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<DocumentLike>;
  return (
    typeof candidate.visibilityState === "string" &&
    typeof candidate.addEventListener === "function" &&
    typeof candidate.createElement === "function" &&
    typeof candidate.body === "object" &&
    candidate.body !== null
  );
}

function isWindow(value: unknown): value is WindowLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WindowLike>;
  return typeof candidate.addEventListener === "function";
}

function isStorage(value: unknown): value is StorageLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StorageLike>;
  return (
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function"
  );
}

function isIndexedDbFactory(value: unknown): value is IndexedDbFactoryLike {
  return typeof value === "function";
}

function isNavigator(value: unknown): value is NavigatorLike {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<NavigatorLike>;
  return candidate.share === undefined || typeof candidate.share === "function";
}

function isNotificationApi(
  value: unknown,
): value is NotificationApiLike & NotificationConstructorLike {
  if (typeof value !== "function") return false;
  const candidate = value as Partial<NotificationApiLike>;
  return (
    (candidate.permission === "default" ||
      candidate.permission === "granted" ||
      candidate.permission === "denied") &&
    typeof candidate.requestPermission === "function"
  );
}
