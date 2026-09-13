/**
 * @wfx/connectors — the connector registry (WFX-003).
 *
 * The registry is the single place that answers "which sources exist and
 * what can each of them actually do?". It supports two registration shapes:
 *
 * - an INSTANCE (anything assignable to the frozen `SourceConnector`,
 *   typically a `BaseConnector` subclass) — registered with the descriptor
 *   it carries, validated strictly;
 * - a DESCRIPTOR ONLY — a known-but-not-connected source. This keeps the
 *   capability matrix honest ("this source exists, its capabilities are
 *   declared, but no live instance is wired") without faking an instance.
 *
 * `get`/`all`/`withCapability` return INSTANCES only; `capabilityMatrix()`
 * covers every registration, marking `hasInstance` so the UI can tell
 * "known source" from "connected source". Duplicate ids throw — ids are
 * stable identities, never slots to be overwritten.
 */

import type { Capability, ConnectorDescriptor, SourceConnector } from "@wfx/domain";

import { CAPABILITIES, defineDescriptor, DescriptorValidationError } from "./descriptor";

/** Thrown when registering a connector id that is already registered. */
export class DuplicateConnectorError extends Error {
  public readonly id: string;

  constructor(id: string) {
    super(`connector '${id}' is already registered — connector ids are stable and must be unique`);
    this.name = "DuplicateConnectorError";
    this.id = id;
  }
}

/**
 * One row of the capability matrix: a source's id × capability truth table.
 * `capabilities` has an entry for EVERY frozen capability (true = declared)
 * so the UI can render honest availability without guessing.
 * Rows are frozen.
 */
export interface CapabilityMatrixRow {
  id: string;
  displayName: string;
  version: string;
  auth: ConnectorDescriptor["auth"];
  capabilities: Readonly<Record<Capability, boolean>>;
  /** true when a live instance is registered; false for descriptor-only rows. */
  hasInstance: boolean;
}

interface Registration {
  descriptor: ConnectorDescriptor;
  instance: SourceConnector | undefined;
}

/**
 * The connector registry. Register instances or descriptors, query by id or
 * capability, and render the capability matrix for the UI.
 */
export class ConnectorRegistry {
  private readonly registrations = new Map<string, Registration>();

  /** Number of registrations (instances + descriptor-only rows). */
  size(): number {
    return this.registrations.size;
  }

  /**
   * Register a connector instance (anything with a `descriptor()` method
   * returning a valid descriptor) or a bare `ConnectorDescriptor`.
   *
   * @throws DescriptorValidationError when the (carried or passed) descriptor
   *         fails strict validation.
   * @throws DuplicateConnectorError when the id is already registered.
   */
  register(source: SourceConnector | ConnectorDescriptor): this {
    // Duck-typing: instances expose descriptor(); plain descriptors do not.
    const carriesDescriptor =
      typeof (source as { descriptor?: unknown } | null | undefined)?.descriptor === "function";

    let descriptor: ConnectorDescriptor;
    let instance: SourceConnector | undefined;

    if (carriesDescriptor) {
      instance = source as SourceConnector;
      try {
        descriptor = defineDescriptor(instance.descriptor());
      } catch (cause) {
        if (cause instanceof DescriptorValidationError) throw cause;
        throw new DescriptorValidationError(
          `connector instance's descriptor() threw: ${String(cause)}`,
        );
      }
    } else {
      // Rejections for non-objects / malformed descriptors come from
      // defineDescriptor's strict validation.
      descriptor = defineDescriptor(source);
    }

    if (this.registrations.has(descriptor.id)) {
      throw new DuplicateConnectorError(descriptor.id);
    }

    this.registrations.set(descriptor.id, { descriptor, instance });
    return this;
  }

  /** The live instance registered under `id`, or `undefined` (unknown id or descriptor-only row). */
  get(id: string): SourceConnector | undefined {
    return this.registrations.get(id)?.instance;
  }

  /** All live instances, in registration order. */
  all(): SourceConnector[] {
    const instances: SourceConnector[] = [];
    for (const registration of this.registrations.values()) {
      if (registration.instance !== undefined) instances.push(registration.instance);
    }
    return instances;
  }

  /** Live instances whose descriptor declares `cap`, in registration order. */
  withCapability(cap: Capability): SourceConnector[] {
    return this.all().filter((connector) =>
      connector.descriptor().capabilities.includes(cap),
    );
  }

  /**
   * The id × capability truth table covering EVERY registration
   * (descriptor-only rows included), sorted by id for deterministic
   * rendering. Rows and their capability records are frozen.
   */
  capabilityMatrix(): CapabilityMatrixRow[] {
    const rows: CapabilityMatrixRow[] = [];
    const ids = [...this.registrations.keys()].sort();
    for (const id of ids) {
      const registration = this.registrations.get(id);
      if (registration === undefined) continue; // unreachable; satisfies noUncheckedIndexedAccess
      const declared = new Set<string>(registration.descriptor.capabilities);
      const capabilities = {} as Record<Capability, boolean>;
      for (const cap of CAPABILITIES) {
        capabilities[cap] = declared.has(cap);
      }
      const row: CapabilityMatrixRow = {
        id: registration.descriptor.id,
        displayName: registration.descriptor.displayName,
        version: registration.descriptor.version,
        auth: registration.descriptor.auth,
        capabilities: Object.freeze(capabilities),
        hasInstance: registration.instance !== undefined,
      };
      rows.push(Object.freeze(row));
    }
    return rows;
  }
}
