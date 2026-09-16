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

// ---------------------------------------------------------------------------
// R02 — the auth + profile body parsers
// ---------------------------------------------------------------------------

/** Bounds for the auth/profile bodies (garbage stays bounded). */
const MAX_EMAIL = 254; // RFC 5321 practical bound
const MAX_PASSWORD = 1_000; // the scrypt DoS guard (passwords.ts)
const MIN_PASSWORD = 10; // the scrypt policy (passwords.ts)
const MAX_DISPLAY_NAME = 128; // bounded generously; the service re-validates at 64
const MAX_AVATAR_SEED = 128;

/** Loose-but-honest email shape check (the identity service re-validates). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A parsed `POST /auth/register` body. */
export interface RegisterBody {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
}

/** Parse and validate one register body. */
export function parseRegisterBody(input: unknown): ParseResult<RegisterBody> {
  if (!isRecord(input)) {
    return { ok: false, problems: ["body: expected a register JSON object {email, password}"] };
  }
  const problems: string[] = [];

  const email = input.email;
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim().toLowerCase())) {
    problems.push("email: expected a valid email address");
  } else if (email.trim().length > MAX_EMAIL) {
    problems.push(`email: longer than ${MAX_EMAIL} characters`);
  }
  const password = input.password;
  if (
    typeof password !== "string" ||
    password.length < MIN_PASSWORD ||
    password.length > MAX_PASSWORD
  ) {
    problems.push(`password: expected between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters`);
  }
  let displayName: string | undefined;
  if (input.displayName !== undefined) {
    if (typeof input.displayName !== "string" || input.displayName.trim().length === 0) {
      problems.push("displayName: when present, expected a non-empty string");
    } else if (input.displayName.length > MAX_DISPLAY_NAME) {
      problems.push(`displayName: longer than ${MAX_DISPLAY_NAME} characters`);
    } else {
      displayName = input.displayName.trim();
    }
  }

  if (
    problems.length > 0 ||
    typeof email !== "string" ||
    typeof password !== "string"
  ) {
    return { ok: false, problems };
  }
  const body: RegisterBody = {
    email: email.trim().toLowerCase(),
    password,
    ...(displayName !== undefined ? { displayName } : {}),
  };
  return { ok: true, value: body };
}

/** A parsed `POST /auth/login` body. */
export interface LoginBody {
  readonly email: string;
  readonly password: string;
}

/** Parse and validate one login body. */
export function parseLoginBody(input: unknown): ParseResult<LoginBody> {
  if (!isRecord(input)) {
    return { ok: false, problems: ["body: expected a login JSON object {email, password}"] };
  }
  const problems: string[] = [];

  const email = input.email;
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim().toLowerCase())) {
    problems.push("email: expected a valid email address");
  } else if (email.trim().length > MAX_EMAIL) {
    problems.push(`email: longer than ${MAX_EMAIL} characters`);
  }
  const password = input.password;
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD) {
    problems.push("password: expected a non-empty string");
  }

  if (problems.length > 0 || typeof email !== "string" || typeof password !== "string") {
    return { ok: false, problems };
  }
  return { ok: true, value: { email: email.trim().toLowerCase(), password } };
}

/**
 * A parsed `PUT /profiles` body — CREATE (`displayName` + optional
 * `avatarSeed`) or RENAME (`profileId` + `displayName`; presence of
 * `profileId` selects the rename semantics).
 */
export interface ProfileMutationBody {
  readonly kind: "create" | "rename";
  readonly displayName: string;
  readonly avatarSeed?: string;
  readonly profileId?: string;
}

/** Parse and validate one profile create/rename body. */
export function parseProfileMutationBody(input: unknown): ParseResult<ProfileMutationBody> {
  if (!isRecord(input)) {
    return {
      ok: false,
      problems: ["body: expected a profile JSON object {displayName[, avatarSeed]} to create or {profileId, displayName} to rename"],
    };
  }
  const problems: string[] = [];

  const displayName = input.displayName;
  if (
    typeof displayName !== "string" ||
    displayName.trim().length === 0 ||
    displayName.length > MAX_DISPLAY_NAME
  ) {
    problems.push(`displayName: expected 1..${MAX_DISPLAY_NAME} characters`);
  }
  let avatarSeed: string | undefined;
  if (input.avatarSeed !== undefined) {
    if (
      typeof input.avatarSeed !== "string" ||
      input.avatarSeed.trim().length === 0 ||
      input.avatarSeed.length > MAX_AVATAR_SEED
    ) {
      problems.push(`avatarSeed: when present, expected 1..${MAX_AVATAR_SEED} characters`);
    } else {
      avatarSeed = input.avatarSeed.trim();
    }
  }
  let profileId: string | undefined;
  if (input.profileId !== undefined) {
    if (typeof input.profileId !== "string" || input.profileId.trim().length === 0) {
      problems.push("profileId: when present, expected a non-empty string");
    } else {
      profileId = input.profileId.trim();
    }
  }

  if (problems.length > 0 || typeof displayName !== "string") {
    return { ok: false, problems };
  }

  const body: ProfileMutationBody = {
    kind: profileId !== undefined ? "rename" : "create",
    displayName: displayName.trim(),
    ...(avatarSeed !== undefined ? { avatarSeed } : {}),
    ...(profileId !== undefined ? { profileId } : {}),
  };
  return { ok: true, value: body };
}
