/**
 * R22-H/I/J — the shared deterministic fixtures (the Desktop lane's
 * tests). ⚠️ TESTS ONLY ⚠️
 *
 * The valid wire shapes the service's documented routes answer, built in
 * the same style the shared runtime's own tests use (the R22-A
 * source-catalog fixtures' shape): full `SourceInfo` rows, secret-free
 * account session views, issued sessions, connect answers, and provider
 * registry rows — every shape structurally valid so the guards accept
 * them, with the override seam the negative cases need.
 */

import type {
  AccountSessionView,
  IssuedAccountSession,
  SourceInfo,
} from "@wfx/client-runtime";

import type { Capability } from "@wfx/domain";

export const R22_T0 = Date.parse("2026-09-20T09:00:00.000Z");
export const R22_API_BASE = new URL("https://experience.webflix.invalid/api");

const ALL_CAPABILITIES: readonly Capability[] = [
  "identity",
  "catalogSearch",
  "metadata",
  "playNative",
  "playEmbed",
  "playBrowser",
  "playExternal",
  "availability",
  "libraryRead",
  "libraryWrite",
  "like",
  "save",
  "follow",
  "comment",
  "download",
  "transform",
  "feedImport",
];

export function capabilities(declared: readonly Capability[]): Record<Capability, boolean> {
  const record = {} as Record<Capability, boolean>;
  for (const capability of ALL_CAPABILITIES) {
    record[capability] = declared.includes(capability);
  }
  return record;
}

/** A valid observed /sources row (the R03 shape + the R22-A extension). */
export function makeSource(overrides: Partial<SourceInfo> = {}): SourceInfo {
  return {
    connectorId: "youtube",
    displayName: "YouTube",
    version: "1.2.0",
    authMode: "oauth",
    capabilities: capabilities([
      "catalogSearch",
      "metadata",
      "playEmbed",
      "playExternal",
      "like",
      "save",
      "libraryRead",
      "libraryWrite",
      "follow",
      "feedImport",
    ]),
    authState: "signedOut",
    requiresAuthorization: true,
    connected: false,
    accountId: null,
    authorizedAt: null,
    lastStateChange: null,
    expiresAt: null,
    availabilityNotes: [],
    lastChecked: new Date(R22_T0).toISOString(),
    ...overrides,
  };
}

/** A valid secret-free account session view (the R22-B shape). */
export function makeSession(overrides: Partial<AccountSessionView> = {}): AccountSessionView {
  return {
    user: {
      id: "wfxusr_r22test",
      email: "viewer@example.com",
      displayName: "Viewer",
      createdAt: new Date(R22_T0).toISOString(),
      updatedAt: new Date(R22_T0).toISOString(),
    },
    profiles: [
      {
        id: "wfxprof_main",
        userId: "wfxusr_r22test",
        displayName: "Main",
        avatarSeed: "seed-main",
        isDefault: true,
        createdAt: new Date(R22_T0).toISOString(),
        updatedAt: new Date(R22_T0).toISOString(),
      },
    ],
    activeProfileId: "wfxprof_main",
    ...overrides,
  };
}

/** A valid issued session (the one-time token + the secret-free view). */
export function makeIssuedSession(
  overrides: Partial<IssuedAccountSession> = {},
): IssuedAccountSession {
  return {
    token: "wfxsess_r22testtoken0000000000000000",
    session: makeSession(),
    ...overrides,
  };
}

/** The `{ authenticated, sources }` envelope the GET /sources route answers. */
export function sourcesEnvelope(
  sources: readonly SourceInfo[],
  authenticated = true,
): { authenticated: boolean; sources: readonly SourceInfo[] } {
  return { authenticated, sources };
}

/** A provider-registry row (the R22-C structural guard's valid shape). */
export function makeProviderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "wfx-first-party",
    privacy: "local",
    capabilities: ["transcription", "translation", "summary", "commentary"],
    byomBound: false,
    costs: { transcription: 0, translation: 0 },
    availability: "available",
    ...overrides,
  };
}
