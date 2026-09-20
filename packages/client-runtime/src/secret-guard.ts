/**
 * @wfx/client-runtime — the client read-model secret guard (R22).
 *
 * THE LAW (docs/plans/2026-09-20-webflix-major-journey-hardening-plan.md,
 * R22-B/R22-C): secret material must NEVER appear in a client read model
 * or rendered UI after submission — the account-creation journey model
 * never carries the password or the one-time session token, and the BYOM
 * management view never carries the provider key (the key exists only in
 * the bind command on its way IN; the transport seals it server-side and
 * answers the secret-free handle ONLY).
 *
 * This module is the MACHINE CHECK of that law: a structural walk that
 * names every offending field path. It is the client-side twin of the
 * persistence layer's `assertNoCredentialMaterial` boundary guard — same
 * discipline, this side of the transport. Adapters call it on any state
 * they are about to render; the shared read models are built secret-free
 * BY CONSTRUCTION and the guard is the belt-and-suspenders proof.
 *
 * The check is FIELD-NAME-based (exact matches): opaque handles the
 * service intentionally returns (`keyId` — the sealed key's id, never the
 * key) are NOT secret material; a field literally named `key`, `secret`,
 * `apiKey`, `password`, `credential`, or `sealedSecret` is.
 */

import { isRecord } from "@wfx/domain";

import { RuntimeError } from "./errors";

/** Field names that must NEVER appear on a client read model (the secret law). */
export const FORBIDDEN_SECRET_FIELD_NAMES: readonly string[] = [
  "password",
  "passwordHash",
  "secret",
  "apiKey",
  "credential",
  "sealedSecret",
  "key",
  "token",
];

function walk(value: unknown, path: string, problems: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, problems));
    return;
  }
  if (isRecord(value)) {
    for (const [field, child] of Object.entries(value)) {
      if (FORBIDDEN_SECRET_FIELD_NAMES.includes(field)) {
        problems.push(`${path}.${field}: secret material where a client read model must be secret-free`);
      }
      walk(child, `${path}.${field}`, problems);
    }
  }
}

/**
 * Assert a claimed client read model (or view) carries NO secret material.
 * Throws the typed `RuntimeError` (`invalid-input`) naming every offending
 * field path — a leak is a LOUD programmer error, never a silent
 * pass-through (the same law the API boundary keeps).
 */
export function assertNoSecretMaterial(value: unknown, label: string): void {
  const problems: string[] = [];
  walk(value, label, problems);
  if (problems.length > 0) {
    throw new RuntimeError("invalid-input", problems.join("; "));
  }
}
