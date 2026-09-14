/**
 * @wfx/experience — in-app browser surface ISOLATION POLICY (WFX-026, Lane C).
 *
 * The security isolation POLICY of the contained browser session — PURE
 * functions only: no network, no DNS, no clock, no randomness. It decides
 * which realization URLs the in-app browser surface may OPEN:
 *
 * - `file://` URLs are ALWAYS rejected (the policy's `blockFileUrls` is the
 *   literal `true` — a frozen law, not a setting).
 * - Private/loopback/reserved network IP literals are ALWAYS rejected
 *   (SSRF guard, PURE IP parsing — see scope below).
 * - Domains outside the provider connector's origin allow-list are rejected
 *   with the typed `isolated-refused` refusal and a reason.
 * - Cookie/storage isolation is ASSERTED here (`restrictCookies: "isolate"`)
 *   and ENFORCED by the host: hosts receive `restrictCookies` in the open
 *   options and MUST honor it (the typed contract is `host.ts`'s
 *   `BrowserOpenOptions` — this module's deliverable).
 *
 * The origin allow-list is PER PROVIDER CONNECTOR ID: a typed map
 * (`ProviderIsolationPolicies`) supplied by the CALLER (the app layer
 * assembles it from connector descriptors — never hardcoded here). A
 * connector with NO entry is refused (fail closed: `no-policy`).
 *
 * SSRF-guard scope (deliberate, lead-visible): only IP LITERALS and the
 * `localhost` name are checked — pure string parsing, NO hostname
 * resolution (a pure function must not touch the network; the WHATWG URL
 * parser has already normalized exotic IPv4 spellings like `0x7f.1`,
 * `0177.0.0.1`, and `2130706433` to dotted decimal). Hostname-based SSRF
 * (internal DNS names, DNS rebinding) is the ALLOW-LIST's job: only
 * allow-listed provider domains ever open in the surface.
 *
 * Browser mode is a UX surface, not a mechanism for defeating provider
 * security (frozen architecture) — this policy governs where the surface
 * may go, never how to make it go where a provider forbids.
 *
 * Error-channel law: a MALFORMED POLICY is caller misuse and throws the
 * typed `ExperienceError` (validated eagerly by the controller); every
 * URL-level refusal is the TYPED `IsolationVerdict` failure — never a
 * thrown crash, never a fake pass.
 */

import { isRecord, previewValue } from "@wfx/domain";

import { ExperienceError } from "../ports";

// ---------------------------------------------------------------------------
// The policy — per provider connector, supplied by the caller
// ---------------------------------------------------------------------------

/**
 * The security isolation policy for one provider connector. The literal
 * `true` fields are frozen LAW (not settings): no configuration of this
 * type can ever permit file URLs, private networks, or shared cookies.
 */
export interface IsolationPolicy {
  /**
   * Origin allow-list for this provider connector: hostnames the surface
   * may open. A host matches by EXACT match or SUFFIX match on a label
   * boundary (`provider.example` covers `watch.provider.example`, never
   * `evilprovider.example`).
   */
  readonly allowedDomains: string[];
  /** `file://` URLs are always rejected. Literal true — the law. */
  readonly blockFileUrls: true;
  /** Private/loopback/reserved IP literals are always rejected. Literal true. */
  readonly blockPrivateNetworks: true;
  /** Hosts MUST isolate cookies/storage per session. Literal "isolate". */
  readonly restrictCookies: "isolate";
}

/**
 * The per-provider-connector origin allow-list map, keyed by connector id.
 * Supplied by the CALLER (the app layer); connectors without an entry are
 * refused fail-closed (`no-policy`).
 */
export type ProviderIsolationPolicies = Readonly<Record<string, IsolationPolicy>>;

/** Why a realization URL was refused by the isolation policy. */
export type IsolationRefusalReason =
  /** The URL does not parse as an absolute URL. */
  | "malformed-url"
  /** `file:` scheme — always blocked (blockFileUrls is law). */
  | "file-url-blocked"
  /** Neither `http:` nor `https:` — a browser surface realizes WEB playback only. */
  | "unsupported-scheme"
  /** Loopback/private/reserved IP literal or localhost (SSRF guard; always blocked). */
  | "private-network-blocked"
  /** The URL's host is not in the connector's allowedDomains. */
  | "domain-not-allowed"
  /** The connector has no isolation policy entry — fail closed. */
  | "no-policy";

/**
 * The verdict of validating one realization URL: allowed (with its parsed
 * host and the governing policy) or the typed `isolated-refused` failure
 * with a machine-readable reason and a human-readable detail.
 */
export type IsolationVerdict =
  | {
      ok: true;
      url: string;
      host: string;
      policy: IsolationPolicy;
    }
  | {
      ok: false;
      kind: "isolated-refused";
      url: string;
      reason: IsolationRefusalReason;
      detail: string;
    };

// ---------------------------------------------------------------------------
// Pure URL parsing (shared with session.ts — the security-critical parser)
// ---------------------------------------------------------------------------

/** A parsed browser-surface URL: lowercase scheme + hostname (no port, no brackets). */
export interface ParsedBrowserUrl {
  /** Lowercase scheme without the colon (`"https"`). */
  readonly scheme: string;
  /**
   * Lowercase hostname: no port, no userinfo, IPv6 WITHOUT brackets
   * (`"::1"`). EMPTY for schemes that carry no host (`file:`, `mailto:`).
   */
  readonly host: string;
}

/** The pure parse result for a candidate URL string. */
export type BrowserUrlParse =
  | { ok: true; parsed: ParsedBrowserUrl }
  | { ok: false; detail: string };

/**
 * Parse a URL string purely (WHATWG `URL` — a deterministic, offline
 * platform standard, the same class `session-builder.ts` uses for dates).
 * The parser normalizes scheme/host case, strips ports and userinfo, and
 * rewrites exotic IPv4 spellings (`0x7f.1`, `2130706433`) to dotted decimal
 * before this function ever sees them.
 *
 * NOTE: an empty `host` is a VALID parse for host-less schemes (`file:`,
 * `mailto:`) — scheme-level policy (`file-url-blocked` /
 * `unsupported-scheme`) fires first; `http`/`https` always carry a host.
 */
export function parseBrowserUrl(url: string): BrowserUrlParse {
  if (typeof url !== "string" || url.trim().length === 0) {
    return { ok: false, detail: `expected a non-empty URL string, got ${previewValue(url)}` };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, detail: `the URL does not parse (expected an absolute web URL)` };
  }
  const host = parsed.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]") && host.length >= 3) {
    return { ok: true, parsed: { scheme: parsed.protocol.replace(/:$/, ""), host: host.slice(1, -1) } };
  }
  return { ok: true, parsed: { scheme: parsed.protocol.replace(/:$/, ""), host } };
}

// ---------------------------------------------------------------------------
// Pure IP parsing — the SSRF guard (no DNS, no network, literals only)
// ---------------------------------------------------------------------------

/** Parse a dotted-decimal IPv4 literal into four octets (null when not one). */
function parseIpv4Literal(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    // WHATWG IPv4 fidelity: "0" or a 1-3 digit number WITHOUT leading zeros.
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
}

/**
 * Parse an IPv6 literal (NO brackets, lowercase, zone id tolerated and
 * stripped) into eight 16-bit groups. Handles `::` compression and embedded
 * dotted-decimal IPv4 tails. Null when not a valid IPv6 literal.
 */
function parseIpv6Literal(host: string): number[] | null {
  const bare = host.split("%")[0] ?? host; // zone ids (link-local) are stripped
  if (bare.length === 0) return null;
  if (bare.split("::").length - 1 > 1) return null; // at most one `::`
  const groups: number[] = [];
  const halves = bare.split("::");
  if (halves.length === 2) {
    if (splitGroups(halves[0] ?? "", groups) === -1) return null;
    const tail: number[] = [];
    if (splitGroups(halves[1] ?? "", tail) === -1) return null;
    const zeros = 8 - groups.length - tail.length;
    if (zeros < 1) return null; // `::` must stand for at least one group
    for (let i = 0; i < zeros; i += 1) groups.push(0);
    groups.push(...tail);
  } else {
    if (splitGroups(bare, groups) === -1) return null;
  }
  if (groups.length !== 8) return null;
  return groups;

  /** Parse a colon-separated half; -1 on any invalid piece. */
  function splitGroups(text: string, into: number[]): number {
    if (text.length === 0) return 0;
    const pieces = text.split(":");
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      if (piece === undefined || piece.length === 0) return -1;
      if (piece.includes(".")) {
        // embedded dotted-decimal IPv4 tail — legal only as the FINAL piece
        if (index !== pieces.length - 1) return -1;
        const v4 = parseIpv4Literal(piece);
        if (v4 === null) return -1;
        into.push(((v4[0] << 8) | v4[1]) & 0xffff, ((v4[2] << 8) | v4[3]) & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return -1;
      into.push(Number.parseInt(piece, 16));
    }
    return 0;
  }
}

/** The 32-bit value of an IPv4 literal, or null (for range math). */
function ipv4Value(host: string): number | null {
  const octets = parseIpv4Literal(host);
  if (octets === null) return null;
  return (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
}

/** Is the 32-bit IPv4 value inside [base, base + bits)? */
function ipv4InRange(value: number, base: number, bits: number): boolean {
  const size = 2 ** (32 - bits);
  return value >= base && value < base + size;
}

/** IPv4 blocks ALWAYS refused: loopback, private, link-local, CGNAT, reserved, special-use. */
const IPV4_BLOCKED_RANGES: readonly (readonly [number, number])[] = [
  [0x00000000, 8], // 0.0.0.0/8 — "this network"
  [0x0a000000, 8], // 10.0.0.0/8 — private
  [0x64400000, 10], // 100.64.0.0/10 — CGNAT shared
  [0x7f000000, 8], // 127.0.0.0/8 — loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 — link-local (cloud metadata)
  [0xac100000, 12], // 172.16.0.0/12 — private
  [0xc0000000, 24], // 192.0.0.0/24 — IETF protocol assignments
  [0xc0000200, 24], // 192.0.2.0/24 — TEST-NET-1
  [0xc0586300, 24], // 192.88.99.0/24 — 6to4 relay anycast (deprecated)
  [0xc0a80000, 16], // 192.168.0.0/16 — private
  [0xc6120000, 15], // 198.18.0.0/15 — benchmarking
  [0xc6336400, 24], // 198.51.100.0/24 — TEST-NET-2
  [0xcb007100, 24], // 203.0.113.0/24 — TEST-NET-3
  [0xe0000000, 4], // 224.0.0.0/4 — multicast
  [0xf0000000, 4], // 240.0.0.0/4 — reserved (incl. 255.255.255.255)
];

/** The 32-bit value embedded in groups 6-7 of an IPv6 address. */
function embeddedIpv4(groups: readonly number[]): number {
  return (((groups[6] ?? 0) << 16) | (groups[7] ?? 0)) >>> 0;
}

/** Is the IPv6 literal (8 parsed groups) a private/loopback/reserved address? */
function isPrivateIpv6(groups: readonly number[]): boolean {
  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;
  // ::/128 unspecified and ::1/128 loopback
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && (groups[7] ?? 0) === 1) return true;
  // ::ffff:0:0/96 — IPv4-mapped (hosts arrive as hex groups; private embedded v4 blocks)
  if (first === 0 && groups.slice(1, 5).every((group) => group === 0) && (groups[5] ?? 0) === 0xffff) {
    return isPrivateIpv4Value(embeddedIpv4(groups));
  }
  // ::/96 — deprecated IPv4-compatible (private embedded v4 blocks)
  if (first === 0 && groups.slice(1, 6).every((group) => group === 0)) {
    if (isPrivateIpv4Value(embeddedIpv4(groups))) return true;
  }
  // 64:ff9b::/96 — NAT64 well-known prefix (private embedded v4 blocks)
  if (first === 0x0064 && second === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    if (isPrivateIpv4Value(embeddedIpv4(groups))) return true;
  }
  // 2002::/16 — 6to4 (embedded IPv4 rides in groups 2-3)
  if (first === 0x2002) {
    const v4 = (((groups[2] ?? 0) << 16) | (groups[3] ?? 0)) >>> 0;
    if (isPrivateIpv4Value(v4)) return true;
  }
  // 2001::/32 — Teredo (server IPv4 rides in the last 32 bits)
  if (first === 0x2001 && second === 0x0000) {
    if (isPrivateIpv4Value(embeddedIpv4(groups))) return true;
  }
  // fe80::/10 — link-local
  if (first >= 0xfe80 && first <= 0xfebf) return true;
  // fc00::/7 — unique local
  if ((first & 0xfe00) === 0xfc00) return true;
  // ff00::/8 — multicast
  if ((first & 0xff00) === 0xff00) return true;
  // 2001:db8::/32 — documentation
  if (first === 0x2001 && second === 0x0db8) return true;
  // 100::/64 — discard-only
  if (first === 0x0100 && groups.slice(1, 4).every((group) => group === 0)) return true;
  return false;
}

/** Is the 32-bit IPv4 value inside any always-blocked range? */
function isPrivateIpv4Value(value: number): boolean {
  return IPV4_BLOCKED_RANGES.some(([base, bits]) => ipv4InRange(value, base, bits));
}

/**
 * Is this URL host a private/loopback/reserved network address? PURE —
 * IP LITERALS and `localhost` only, no DNS (see module doc for scope).
 *
 * @param host lowercase hostname from `parseBrowserUrl` (no port, no
 *             brackets — `"127.0.0.1"`, `"::1"`, `"localhost"`)
 */
export function isPrivateNetworkHost(host: string): boolean {
  if (typeof host !== "string" || host.length === 0) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true; // spec-reserved loopback name
  const v4 = ipv4Value(host);
  if (v4 !== null) return isPrivateIpv4Value(v4);
  if (host.includes(":")) {
    const groups = parseIpv6Literal(host);
    if (groups !== null) return isPrivateIpv6(groups);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Policy validation (caller misuse — typed throw, never a silent pass)
// ---------------------------------------------------------------------------

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Validate one hostname for an allow-list entry: dot-separated labels of
 * letters/digits/hyphens (no leading/trailing hyphen), each 1-63 chars,
 * total <= 253, no colons (IPv6 literals are pointless in an allow-list —
 * private v6 is always blocked and public provider hosts are hostnames).
 */
function hostnameProblems(domain: unknown, field: string): string[] {
  if (typeof domain !== "string" || domain.length === 0) {
    return [`${field}: expected a non-empty hostname string, got ${previewValue(domain)}`];
  }
  if (domain.length > 253) {
    return [`${field}: hostname longer than 253 characters`];
  }
  if (domain.includes(":")) {
    return [`${field}: expected a hostname (no IPv6 literals in allow-lists), got '${domain}'`];
  }
  const problems: string[] = [];
  const labels = domain.toLowerCase().split(".");
  for (const label of labels) {
    if (label.length > 63) {
      problems.push(`${field}: '${domain}' is not a valid hostname (label longer than 63 characters)`);
      break;
    }
    if (!HOSTNAME_LABEL.test(label)) {
      problems.push(
        `${field}: '${domain}' is not a valid hostname (label '${label || "(empty)"}' must be letters/digits/hyphens, no leading/trailing hyphen, no scheme, no path)`,
      );
      break;
    }
  }
  return problems;
}

/**
 * Validate ONE isolation policy. Throws the typed `ExperienceError` listing
 * every problem when malformed — the frozen-literal fields must be exactly
 * `true`/`"isolate"` and every allowed domain must be a valid hostname.
 */
export function assertValidIsolationPolicy(policy: IsolationPolicy, field: string): void {
  if (!isRecord(policy)) {
    throw new ExperienceError(`${field}: expected an IsolationPolicy object`);
  }
  const problems: string[] = [];
  if (policy.blockFileUrls !== true) {
    problems.push(`${field}.blockFileUrls: must be the literal true (file URLs are always blocked)`);
  }
  if (policy.blockPrivateNetworks !== true) {
    problems.push(
      `${field}.blockPrivateNetworks: must be the literal true (private networks are always blocked)`,
    );
  }
  if (policy.restrictCookies !== "isolate") {
    problems.push(`${field}.restrictCookies: must be the literal "isolate" (cookie isolation is the contract)`);
  }
  if (!Array.isArray(policy.allowedDomains)) {
    problems.push(
      `${field}.allowedDomains: expected an array of hostname strings, got ${previewValue(policy.allowedDomains)}`,
    );
  } else {
    policy.allowedDomains.forEach((domain, index) => {
      problems.push(...hostnameProblems(domain, `${field}.allowedDomains[${index}]`));
    });
  }
  if (problems.length > 0) throw new ExperienceError(problems);
}

/**
 * Validate a whole per-connector policy map. Throws the typed
 * `ExperienceError` listing every problem (connector ids must be non-empty;
 * every policy deep-validated). The controller validates ONCE at
 * construction so no malformed policy can ever govern an open.
 */
export function assertValidIsolationPolicies(policies: ProviderIsolationPolicies): void {
  if (!isRecord(policies)) {
    throw new ExperienceError(
      `isolation: expected a ProviderIsolationPolicies map, got ${previewValue(policies)}`,
    );
  }
  for (const [connectorId, policy] of Object.entries(policies)) {
    if (typeof connectorId !== "string" || connectorId.length === 0) {
      throw new ExperienceError(
        `isolation: connector ids must be non-empty strings, got ${previewValue(connectorId)}`,
      );
    }
    assertValidIsolationPolicy(policy, `isolation['${connectorId}']`);
  }
}

// ---------------------------------------------------------------------------
// The verdict — validate one realization URL against the policy
// ---------------------------------------------------------------------------

/**
 * Look up the isolation policy of a provider connector. Pure map read;
 * `undefined` when the connector has no entry (the verdict then refuses
 * fail-closed with `no-policy`).
 */
export function policyForConnector(
  connectorId: string,
  policies: ProviderIsolationPolicies,
): IsolationPolicy | undefined {
  return isRecord(policies) ? policies[connectorId] : undefined;
}

/**
 * Does the URL host match an allow-list domain? EXACT match or SUFFIX match
 * on a label boundary: `provider.example` matches
 * `watch.provider.example` but never `evilprovider.example`.
 */
function hostMatchesAllowedDomain(host: string, domain: string): boolean {
  const normalized = domain.toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}

/**
 * Validate ONE realization URL against ONE (already validated) isolation
 * policy. Gate order (deterministic, short-circuit — the FIRST failure is
 * the recorded reason):
 *
 *   parse -> scheme (file first, then non-web) -> private network -> allow-list
 *
 * Note the deliberate precedence: the SSRF guard fires BEFORE the
 * allow-list — a private IP literal is refused even if a (mis)configured
 * allow-list names it, because `blockPrivateNetworks: true` is law.
 */
export function validateAgainstIsolationPolicy(url: string, policy: IsolationPolicy): IsolationVerdict {
  assertValidIsolationPolicy(policy, "policy");

  const parse = parseBrowserUrl(url);
  if (!parse.ok) {
    return {
      ok: false,
      kind: "isolated-refused",
      url,
      reason: "malformed-url",
      detail: `the realization URL does not parse (${parse.detail})`,
    };
  }
  const { scheme, host } = parse.parsed;

  if (scheme === "file") {
    return {
      ok: false,
      kind: "isolated-refused",
      url,
      reason: "file-url-blocked",
      detail: "file: URLs are always blocked by the isolation policy (blockFileUrls is law)",
    };
  }
  if (scheme !== "http" && scheme !== "https") {
    return {
      ok: false,
      kind: "isolated-refused",
      url,
      reason: "unsupported-scheme",
      detail: `scheme '${scheme}:' is not a web URL — the browser surface realizes http/https playback only`,
    };
  }
  if (host.length === 0) {
    return {
      ok: false,
      kind: "isolated-refused",
      url,
      reason: "malformed-url",
      detail: "the URL carries no host",
    };
  }
  if (isPrivateNetworkHost(host)) {
    return {
      ok: false,
      kind: "isolated-refused",
      url,
      reason: "private-network-blocked",
      detail: `host '${host}' is a private/loopback/reserved network address (SSRF guard; blockPrivateNetworks is law)`,
    };
  }
  if (!policy.allowedDomains.some((domain) => hostMatchesAllowedDomain(host, domain))) {
    return {
      ok: false,
      kind: "isolated-refused",
      url,
      reason: "domain-not-allowed",
      detail: `host '${host}' is not in the connector's allowed domains [${policy.allowedDomains.join(", ")}]`,
    };
  }
  return { ok: true, url, host, policy };
}

/**
 * Validate ONE realization URL for ONE provider connector against the
 * caller-supplied policy map. Connectors without a policy entry are
 * refused fail-closed (`no-policy`); everything else is the typed verdict
 * of `validateAgainstIsolationPolicy`. PURE — no network, no DNS.
 */
export function isolationVerdict(
  url: string,
  connectorId: string,
  policies: ProviderIsolationPolicies,
): IsolationVerdict {
  if (typeof connectorId !== "string" || connectorId.length === 0) {
    throw new ExperienceError(
      `connectorId: expected a non-empty provider connector id, got ${previewValue(connectorId)}`,
    );
  }
  const policy = policyForConnector(connectorId, policies);
  if (policy === undefined) {
    return {
      ok: false,
      kind: "isolated-refused",
      url,
      reason: "no-policy",
      detail: `connector '${connectorId}' has no isolation policy entry — refused fail-closed (the caller must supply the allow-list)`,
    };
  }
  return validateAgainstIsolationPolicy(url, policy);
}
