/**
 * @wfx/app-api — request-body parsers for the POST transport endpoints
 * (WFX-055A).
 *
 * The frozen contract POSTs JSON bodies: `POST /experience/actions`
 * carries a `UserAction`, `POST /experience/library` carries a
 * `LibraryCommand` (`POST /experience/events` carries an
 * `EntertainmentEvent` — validated with the domain's own frozen
 * `validateEntertainmentEvent`, not re-implemented here).
 *
 * These parsers are the SERVER-side garbage channel: anything that is not
 * unmistakably the frozen shape becomes a typed list of problems, and the
 * route answers ONE 400 naming every problem at once (the 052 convention
 * — one round fixes everything). Well-formed-but-unroutable inputs are
 * NOT this module's concern: they flow to the connector, which answers
 * the honest failed/unsupported receipt.
 *
 * Determinism: pure parsing, no clock, no randomness, no environment.
 */

import type { LibraryCommand, UserAction } from "@wfx/domain";
import { isRecord } from "@wfx/domain";

/** The closed `UserAction.type` vocabulary (runtime mirror of the frozen union). */
const USER_ACTION_TYPES: readonly string[] = [
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
];

/** Bounds that keep garbage bounded (the frozen contract has no lengths). */
const MAX_CONNECTOR_ID = 128;
const MAX_EXTERNAL_REF = 512;
const MAX_TITLE = 512;

/** The typed parse outcome. */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Parse and validate one `UserAction` body. */
export function parseUserAction(input: unknown): ParseResult<UserAction> {
  if (!isRecord(input)) {
    return { ok: false, problems: ["body: expected a UserAction JSON object"] };
  }
  const problems: string[] = [];

  const type = input.type;
  if (typeof type !== "string" || !USER_ACTION_TYPES.includes(type)) {
    problems.push(`action.type: expected one of ${USER_ACTION_TYPES.join(" | ")}`);
  }
  const connectorId = input.connectorId;
  if (typeof connectorId !== "string" || connectorId.trim().length === 0) {
    problems.push("action.connectorId: expected a non-empty string");
  } else if (connectorId.length > MAX_CONNECTOR_ID) {
    problems.push(`action.connectorId: longer than ${MAX_CONNECTOR_ID} characters`);
  }
  const externalRef = input.externalRef;
  if (typeof externalRef !== "string" || externalRef.trim().length === 0) {
    problems.push("action.externalRef: expected a non-empty string");
  } else if (externalRef.length > MAX_EXTERNAL_REF) {
    problems.push(`action.externalRef: longer than ${MAX_EXTERNAL_REF} characters`);
  }
  if (input.payload !== undefined && !isRecord(input.payload)) {
    problems.push("action.payload: when present, expected a JSON object");
  }

  if (problems.length > 0 || typeof type !== "string" || typeof connectorId !== "string" || typeof externalRef !== "string") {
    return { ok: false, problems };
  }

  const action: UserAction = { type: type as UserAction["type"], connectorId, externalRef };
  if (isRecord(input.payload)) {
    action.payload = input.payload;
  }
  return { ok: true, value: action };
}

/** Parse and validate one `LibraryCommand` body. */
export function parseLibraryCommand(input: unknown): ParseResult<LibraryCommand> {
  if (!isRecord(input)) {
    return { ok: false, problems: ["body: expected a LibraryCommand JSON object"] };
  }
  const problems: string[] = [];

  const op = input.op;
  if (op !== "add" && op !== "remove") {
    problems.push("command.op: expected 'add' or 'remove'");
  }
  const externalRef = input.externalRef;
  if (typeof externalRef !== "string" || externalRef.trim().length === 0) {
    problems.push("command.externalRef: expected a non-empty string");
  } else if (externalRef.length > MAX_EXTERNAL_REF) {
    problems.push(`command.externalRef: longer than ${MAX_EXTERNAL_REF} characters`);
  }
  if (input.title !== undefined && typeof input.title !== "string") {
    problems.push("command.title: when present, expected a string");
  } else if (typeof input.title === "string" && input.title.length > MAX_TITLE) {
    problems.push(`command.title: longer than ${MAX_TITLE} characters`);
  }
  if (input.metadata !== undefined && !isRecord(input.metadata)) {
    problems.push("command.metadata: when present, expected a JSON object");
  }

  if (problems.length > 0 || (op !== "add" && op !== "remove") || typeof externalRef !== "string") {
    return { ok: false, problems };
  }

  const command: LibraryCommand = { op, externalRef };
  if (typeof input.title === "string") {
    command.title = input.title;
  }
  if (isRecord(input.metadata)) {
    command.metadata = input.metadata;
  }
  return { ok: true, value: command };
}
