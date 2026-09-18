/**
 * @wfx/persistence — transform operation records with append-only state
 * history (R06).
 *
 * Migration 0011's `transform_operations` + `transform_operation_states`:
 * the durable backing of the EXPLICIT transformation state machine the R06
 * spec mandates — never implicit background magic. Each row is one
 * submitted transform (kind + target + options + the EXPLICIT state
 * queued | running | succeeded | failed | cancelled). Every state
 * transition is APPENDED to `transform_operation_states` — never an
 * overwrite — so the operation's lifecycle is honest audit truth.
 *
 * LAWS:
 * - STATE MACHINE: `queued` is the only legal initial state; transitions
 *   are queued → running → succeeded | failed | cancelled. The store
 *   enforces the legal transitions and records each one with the injected
 *   clock (epoch ms → ISO).
 * - APPEND-ONLY HISTORY: `transitionState` INSERTs a new row into
 *   `transform_operation_states` and UPDATEs the operation's `state`
 *   snapshot. The history table is the audit truth; the snapshot column
 *   is the read-model projection. The history is NEVER deleted.
 * - PROGRESS: optional [0, 1]; only set on `running` and `succeeded`
 *   transitions (where the fabric reports it).
 * - RESULT REFERENCE: set only on `succeeded` — the transform's output
 *   reference (the fabric's trace id, a typed handle the API surface
 *   hands back).
 * - ERROR DETAIL: set only on `failed` — the typed failure summary
 *   (never the input; bounded message).
 * - PROFILE ISOLATION: rows are scoped to the effective profile (the
 *   migration-0007 pattern); a profile never sees another profile's
 *   operations.
 *
 * THE EVENT-SINK LAW (R04, preserved): nothing here touches `event_outbox`
 * or `watch_history` — transforms are explicit user actions with their
 * own audit trail, never engagement events.
 */

import { classifyDriverError } from "./classify";
import { PersistenceError } from "./errors";
import { epochMsToIso, toIsoTimestamp, type DbClient } from "./sql";
import type { Clock, IdGen } from "@wfx/experience";

/** Prefix for transform-operation ids minted by this store. */
export const TRANSFORM_OPERATION_ID_PREFIX = "wfxtx_";

/** Prefix for transform-operation-state-history ids. */
export const TRANSFORM_STATE_HISTORY_ID_PREFIX = "wfxtxs_";

/** The closed vocabulary of transform-operation states. */
export type TransformOperationState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/** Every state value, in union order. */
export const TRANSFORM_OPERATION_STATES: readonly TransformOperationState[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];

/** Runtime membership check against the state union. */
export function isTransformOperationState(
  x: unknown,
): x is TransformOperationState {
  return (
    typeof x === "string" &&
    (TRANSFORM_OPERATION_STATES as readonly string[]).includes(
      x as TransformOperationState,
    )
  );
}

/** The closed vocabulary of transform-operation kinds (mirrors the fabric). */
export type TransformOperationKind =
  | "transcript"
  | "translation"
  | "subtitle"
  | "summary"
  | "speech"
  | "transcribe"
  | "dubbing"
  | "commentary";

/** Every kind value, in declaration order. */
export const TRANSFORM_OPERATION_KINDS: readonly TransformOperationKind[] = [
  "transcript",
  "translation",
  "subtitle",
  "summary",
  "speech",
  "transcribe",
  "dubbing",
  "commentary",
];

/** Runtime membership check against the kind union. */
export function isTransformOperationKind(
  x: unknown,
): x is TransformOperationKind {
  return (
    typeof x === "string" &&
    (TRANSFORM_OPERATION_KINDS as readonly string[]).includes(
      x as TransformOperationKind,
    )
  );
}

/** A stored transform-operation record (the snapshot read-model). */
export interface TransformOperationRecord {
  /** Canonical operation id (`wfxtx_` + 26-char ULID body). */
  readonly id: string;
  readonly userId: string;
  readonly profileId: string | null;
  readonly kind: TransformOperationKind;
  /** The target item/media reference (typed; opaque to the store). */
  readonly targetRef: string;
  /** The transform options (the fabric's task input minus the secret bits). */
  readonly options: Record<string, unknown>;
  readonly state: TransformOperationState;
  /** Optional progress [0, 1] — present on running/succeeded transitions. */
  readonly progress: number | null;
  /** The transform's output reference (set on success). */
  readonly resultRef: string | null;
  /** The typed failure summary (set on failure — bounded, never the input). */
  readonly errorDetail: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One entry in the append-only state history. */
export interface TransformOperationStateHistoryEntry {
  readonly id: string;
  readonly operationId: string;
  readonly state: TransformOperationState;
  readonly progress: number | null;
  readonly detail: string | null;
  readonly transitionedAt: string;
}

/** Constructor dependencies. */
export interface TransformOperationStoreOptions {
  readonly db: DbClient;
  readonly clock: Clock;
  readonly ids: IdGen;
}

interface OperationSqlRow {
  id: string;
  user_id: string;
  profile_id: string | null;
  kind: string;
  target_ref: string;
  options: unknown;
  state: string;
  progress: number | null;
  result_ref: string | null;
  error_detail: string | null;
  created_at: unknown;
  updated_at: unknown;
}

interface StateHistorySqlRow {
  id: string;
  operation_id: string;
  state: string;
  progress: number | null;
  detail: string | null;
  transitioned_at: unknown;
}

function mapOperation(row: OperationSqlRow): TransformOperationRecord {
  const optionsRaw = row.options;
  let options: Record<string, unknown>;
  if (optionsRaw !== null && typeof optionsRaw === "object" && !Array.isArray(optionsRaw)) {
    options = optionsRaw as Record<string, unknown>;
  } else if (typeof optionsRaw === "string") {
    // Some drivers return jsonb columns as the JSON text (PGlite path).
    try {
      const parsed: unknown = JSON.parse(optionsRaw);
      options =
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      options = {};
    }
  } else {
    options = {};
  }
  return {
    id: row.id,
    userId: row.user_id,
    profileId: row.profile_id,
    kind: row.kind as TransformOperationKind,
    targetRef: row.target_ref,
    options,
    state: row.state as TransformOperationState,
    progress: row.progress,
    resultRef: row.result_ref,
    errorDetail: row.error_detail,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function mapStateHistory(row: StateHistorySqlRow): TransformOperationStateHistoryEntry {
  return {
    id: row.id,
    operationId: row.operation_id,
    state: row.state as TransformOperationState,
    progress: row.progress,
    detail: row.detail,
    transitionedAt: toIsoTimestamp(row.transitioned_at),
  };
}

/**
 * The legal state transitions (the EXPLICIT state machine).
 *   queued → running, cancelled
 *   running → succeeded, failed, cancelled
 *   succeeded → (terminal)
 *   failed → (terminal)
 *   cancelled → (terminal)
 */
function isLegalTransition(
  from: TransformOperationState,
  to: TransformOperationState,
): boolean {
  switch (from) {
    case "queued":
      return to === "running" || to === "cancelled";
    case "running":
      return to === "succeeded" || to === "failed" || to === "cancelled";
    case "succeeded":
    case "failed":
    case "cancelled":
      return false;
  }
}

/** The durable transform-operation store with append-only state history. */
export class PostgresTransformOperationStore {
  private readonly db: DbClient;
  private readonly clock: Clock;
  private readonly ids: IdGen;

  constructor(options: TransformOperationStoreOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.ids = options.ids;
  }

  /**
   * Create a new transform operation in `queued` state. The initial state
   * transition is recorded in the history table atomically. Returns the
   * freshly-created record (state = queued, progress null, result null).
   */
  async createOperation(input: {
    userId: string;
    profileId: string | null;
    kind: TransformOperationKind;
    targetRef: string;
    options?: Record<string, unknown>;
  }): Promise<TransformOperationRecord> {
    const problems: string[] = [];
    if (typeof input.userId !== "string" || input.userId.length === 0) {
      problems.push("userId: expected a non-empty string");
    }
    if (!isTransformOperationKind(input.kind)) {
      problems.push(
        `kind: expected one of ${TRANSFORM_OPERATION_KINDS.join(" | ")}, got ${JSON.stringify(input.kind)}`,
      );
    }
    if (
      typeof input.targetRef !== "string" ||
      input.targetRef.trim().length === 0 ||
      input.targetRef.length > 512
    ) {
      problems.push(
        `targetRef: expected 1..512 characters, got ${JSON.stringify(input.targetRef)}`,
      );
    }
    if (problems.length > 0) {
      throw new PersistenceError("invalid-input", problems.join("; "), {
        operation: "transformOperations.createOperation",
      });
    }

    const id = `${TRANSFORM_OPERATION_ID_PREFIX}${this.ids.next()}`;
    const nowIso = epochMsToIso(this.clock.now());
    const optionsJson = JSON.stringify(input.options ?? {});

    try {
      const rows = await this.db.query<OperationSqlRow>(
        `INSERT INTO transform_operations
            (id, user_id, profile_id, kind, target_ref, options, state,
             progress, result_ref, error_detail, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued',
                 NULL, NULL, NULL, $7, $7)
         RETURNING *`,
        [
          id,
          input.userId,
          input.profileId,
          input.kind,
          input.targetRef,
          optionsJson,
          nowIso,
        ],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error("createOperation: no row returned");
      }
      // Append the initial state to the history table.
      await this.appendStateHistory(id, "queued", null, null, nowIso);
      return mapOperation(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.createOperation");
    }
  }

  /**
   * Read one operation by id (must be owned by the effective profile).
   * Returns null when not found or not owned (the honest miss).
   */
  async getOperation(
    operationId: string,
    userId: string,
    profileId: string | null,
  ): Promise<TransformOperationRecord | null> {
    try {
      const rows = await this.db.query<OperationSqlRow>(
        `SELECT * FROM transform_operations
          WHERE id = $1 AND user_id = $2
            AND COALESCE(profile_id, 'user:' || user_id) = COALESCE($3, 'user:' || user_id)`,
        [operationId, userId, profileId],
      );
      const row = rows[0];
      return row === undefined ? null : mapOperation(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.getOperation");
    }
  }

  /**
   * List the effective profile's operations, newest first (the audit +
   * recovery surface). Empty list when none — the honest empty answer.
   */
  async listForProfile(
    userId: string,
    profileId: string | null,
  ): Promise<readonly TransformOperationRecord[]> {
    try {
      const rows = await this.db.query<OperationSqlRow>(
        `SELECT * FROM transform_operations
          WHERE user_id = $1 AND COALESCE(profile_id, 'user:' || user_id) = COALESCE($2, 'user:' || user_id)
          ORDER BY created_at DESC, id DESC`,
        [userId, profileId],
      );
      return rows.map(mapOperation);
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.listForProfile");
    }
  }

  /**
   * Transition an operation to a new state. The transition MUST be legal
   * per the explicit state machine (queued → running | cancelled;
   * running → succeeded | failed | cancelled; terminal states are
   * terminal). The transition is APPENDED to the history table (audit
   * truth — never overwritten) and the operation's snapshot column is
   * updated atomically.
   *
   * Optional `progress` (only on running/succeeded) and `detail` (the
   * result reference on succeeded; the error summary on failed).
   */
  async transitionState(input: {
    operationId: string;
    userId: string;
    profileId: string | null;
    to: TransformOperationState;
    progress?: number;
    detail?: string;
  }): Promise<TransformOperationRecord> {
    if (!isTransformOperationState(input.to)) {
      throw new PersistenceError(
        "invalid-input",
        `to: expected a TransformOperationState, got ${JSON.stringify(input.to)}`,
        { operation: "transformOperations.transitionState" },
      );
    }
    if (
      input.progress !== undefined &&
      (typeof input.progress !== "number" ||
        !Number.isFinite(input.progress) ||
        input.progress < 0 ||
        input.progress > 1)
    ) {
      throw new PersistenceError(
        "invalid-input",
        `progress: expected a finite number in [0, 1] when present, got ${JSON.stringify(input.progress)}`,
        { operation: "transformOperations.transitionState" },
      );
    }

    const existing = await this.getOperation(
      input.operationId,
      input.userId,
      input.profileId,
    );
    if (existing === null) {
      throw new PersistenceError(
        "invalid-input",
        `operation '${input.operationId}' not found or not owned by this profile`,
        { operation: "transformOperations.transitionState" },
      );
    }
    if (!isLegalTransition(existing.state, input.to)) {
      throw new PersistenceError(
        "invalid-input",
        `illegal state transition: '${existing.state}' → '${input.to}' is not legal (the explicit state machine)`,
        { operation: "transformOperations.transitionState" },
      );
    }

    const nowIso = epochMsToIso(this.clock.now());

    // Compose the snapshot update — progress only legal on running/succeeded;
    // result_ref only on succeeded; error_detail only on failed.
    const setClauses: string[] = ["state = $2", "updated_at = $3"];
    const params: unknown[] = [input.operationId, input.to, nowIso];
    let paramIdx = 4;
    if (input.to === "running" || input.to === "succeeded") {
      if (input.progress !== undefined) {
        setClauses.push(`progress = $${paramIdx}`);
        params.push(input.progress);
        paramIdx += 1;
      }
    } else {
      // non-running/succeeded: clear progress (snapshot column) —
      // the history row keeps the original.
      setClauses.push(`progress = NULL`);
    }
    if (input.to === "succeeded") {
      setClauses.push(`result_ref = $${paramIdx}`);
      params.push(input.detail ?? null);
      paramIdx += 1;
      setClauses.push(`error_detail = NULL`);
    } else if (input.to === "failed") {
      setClauses.push(`error_detail = $${paramIdx}`);
      params.push(input.detail ?? null);
      paramIdx += 1;
      setClauses.push(`result_ref = NULL`);
    } else {
      // cancelled: leave result/error untouched (terminal without result)
      // — the history row carries the transition reason.
    }

    try {
      const rows = await this.db.query<OperationSqlRow>(
        `UPDATE transform_operations SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
        params,
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error("transitionState: no row returned");
      }
      // Append the transition to the history table.
      await this.appendStateHistory(
        input.operationId,
        input.to,
        input.to === "running" || input.to === "succeeded"
          ? (input.progress ?? null)
          : null,
        input.detail ?? null,
        nowIso,
      );
      return mapOperation(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.transitionState");
    }
  }

  /**
   * The append-only state history for one operation, oldest first.
   * Every transition the operation has ever made — never deleted.
   */
  async listStateHistory(
    operationId: string,
  ): Promise<readonly TransformOperationStateHistoryEntry[]> {
    try {
      const rows = await this.db.query<StateHistorySqlRow>(
        `SELECT * FROM transform_operation_states
          WHERE operation_id = $1 ORDER BY transitioned_at, id`,
        [operationId],
      );
      return rows.map(mapStateHistory);
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.listStateHistory");
    }
  }

  /**
   * DELETE the result of a succeeded transform (the spec's "DELETE for
   * result cleanup where applicable"). The operation row stays (audit
   * truth); the result reference is cleared and a state transition to
   * cancelled is APPENDED (the cleanup is itself an audit event). Throws
   * if the operation is not in the succeeded state.
   */
  async clearResult(input: {
    operationId: string;
    userId: string;
    profileId: string | null;
  }): Promise<TransformOperationRecord> {
    const existing = await this.getOperation(
      input.operationId,
      input.userId,
      input.profileId,
    );
    if (existing === null) {
      throw new PersistenceError(
        "invalid-input",
        `operation '${input.operationId}' not found or not owned by this profile`,
        { operation: "transformOperations.clearResult" },
      );
    }
    if (existing.state !== "succeeded") {
      throw new PersistenceError(
        "invalid-input",
        `clearResult: operation '${input.operationId}' is in state '${existing.state}', expected 'succeeded' (cleanup only applies to successful results)`,
        { operation: "transformOperations.clearResult" },
      );
    }

    const nowIso = epochMsToIso(this.clock.now());
    try {
      const rows = await this.db.query<OperationSqlRow>(
        `UPDATE transform_operations
            SET state = 'cancelled', result_ref = NULL, progress = NULL,
                error_detail = NULL, updated_at = $2
          WHERE id = $1 RETURNING *`,
        [input.operationId, nowIso],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error("clearResult: no row returned");
      }
      await this.appendStateHistory(
        input.operationId,
        "cancelled",
        null,
        "result cleanup",
        nowIso,
      );
      return mapOperation(row);
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.clearResult");
    }
  }

  /** Append one transition to the history table (the audit truth). */
  private async appendStateHistory(
    operationId: string,
    state: TransformOperationState,
    progress: number | null,
    detail: string | null,
    transitionedAtIso: string,
  ): Promise<void> {
    const id = `${TRANSFORM_STATE_HISTORY_ID_PREFIX}${this.ids.next()}`;
    try {
      await this.db.query(
        `INSERT INTO transform_operation_states
            (id, operation_id, state, progress, detail, transitioned_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, operationId, state, progress, detail, transitionedAtIso],
      );
    } catch (thrown) {
      throw classifyDriverError(thrown, "transformOperations.appendStateHistory");
    }
  }
}
