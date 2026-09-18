/**
 * @wfx/journeys — the assertion vocabulary (R16).
 *
 * THE HONESTY LAW, ENCODED: an encoded journey is a CHECK, not theater.
 * Every assertion binds to an expected state from
 * docs/validation/webflix-golden-journeys.md, records what was EXPECTED
 * and what was OBSERVED, and a failed assertion throws the typed
 * {@link AssertionError} so the runner captures failure evidence and
 * marks the journey FAILED. A journey that cannot fail is not a check —
 * this module is why every journey can.
 *
 * Assertion records accumulate on the journey context; the report layer
 * serializes them into the evidence manifest (journey id, description,
 * expected, observed, pass/fail — the journey doc's evidence format).
 *
 * PURE RECORD KEEPING + typed failure: unit-tested over recorded
 * outcomes without a browser (the browser methods are injected as a
 * narrow reading interface).
 */

/** One recorded assertion (the manifest's atomic evidence unit). */
export interface AssertionRecord {
  /** What the golden journey expects (bound to the doc's expected state). */
  readonly description: string;
  /** The expected observation (rendered verbatim in the manifest). */
  readonly expected: string;
  /** The observed value at run time. */
  readonly observed: string;
  /** Whether observed satisfied expected. */
  readonly pass: boolean;
}

/** The typed failure of one assertion — fail-fast per journey. */
export class AssertionError extends Error {
  readonly record: AssertionRecord;
  constructor(record: AssertionRecord) {
    super(
      `journey assertion failed: ${record.description}\n  expected: ${record.expected}\n  observed: ${record.observed}`,
    );
    this.name = "AssertionError";
    this.record = record;
  }
}

/** The narrow read surface assertions need (implemented by the browser driver). */
export interface PageReader {
  tryText(selector: string): Promise<string | null>;
  tryHtml(selector: string): Promise<string | null>;
  tryAttr(selector: string, attribute: string): Promise<string | null>;
  count(selector: string): Promise<number>;
}

/** The assertion journal one journey records into. */
export interface AssertionJournal {
  /** Record one assertion (throws on failure — fail-fast journey semantics). */
  check(record: AssertionRecord): void;
  /** The assertions recorded so far. */
  records(): readonly AssertionRecord[];
}

/** An in-memory journal (one per journey). */
export function createJournal(): AssertionJournal {
  const entries: AssertionRecord[] = [];
  return {
    check(record: AssertionRecord): void {
      entries.push(record);
      if (!record.pass) {
        throw new AssertionError(record);
      }
    },
    records(): readonly AssertionRecord[] {
      return [...entries];
    },
  };
}

/** The assertion helpers bound to one journal + page reader. */
export interface Assert extends PageReader {
  /** The journal (the runner reads the records for the manifest). */
  readonly journal: AssertionJournal;
  /** Record one custom boolean assertion. */
  that(description: string, expected: string, observed: string, pass: boolean): void;
  /** The element exists and is in the DOM. */
  visible(selector: string, description: string): Promise<void>;
  /** The element does not exist (honest absence). */
  absent(selector: string, description: string): Promise<void>;
  /** The element's visible text contains the expected fragment. */
  textContains(selector: string, fragment: string, description: string): Promise<void>;
  /** The element's visible text equals the expected text (trimmed). */
  textEquals(selector: string, expected: string, description: string): Promise<void>;
  /** The element's attribute equals the expected value. */
  attrEquals(selector: string, attribute: string, expected: string, description: string): Promise<void>;
  /** The element's innerHTML contains the fragment (grammar checks). */
  htmlContains(selector: string, fragment: string, description: string): Promise<void>;
  /** The element's innerHTML does NOT contain the fragment (anti-theater). */
  htmlOmits(selector: string, fragment: string, description: string): Promise<void>;
  /** At least N elements match. */
  countAtLeast(selector: string, minimum: number, description: string): Promise<void>;
  /** Exactly N elements match. */
  countExactly(selector: string, expected: number, description: string): Promise<void>;
}

/** Bind the assertion vocabulary to one journal + page reader. */
export function bindAssertions(journal: AssertionJournal, page: PageReader): Assert {
  const that = (
    description: string,
    expected: string,
    observed: string,
    pass: boolean,
  ): void => {
    journal.check({ description, expected, observed, pass });
  };
  return {
    journal,
    tryText: (selector) => page.tryText(selector),
    tryHtml: (selector) => page.tryHtml(selector),
    tryAttr: (selector, attribute) => page.tryAttr(selector, attribute),
    count: (selector) => page.count(selector),
    that,
    async visible(selector, description): Promise<void> {
      const observed = await page.count(selector);
      that(description, `${selector} present in the DOM`, `${observed} matching element(s)`, observed > 0);
    },
    async absent(selector, description): Promise<void> {
      const observed = await page.count(selector);
      that(description, `${selector} absent from the DOM`, `${observed} matching element(s)`, observed === 0);
    },
    async textContains(selector, fragment, description): Promise<void> {
      const observed = await page.tryText(selector);
      that(
        description,
        `text of ${selector} contains "${fragment}"`,
        observed === null ? "<element absent>" : `"${observed}"`,
        observed !== null && observed.includes(fragment),
      );
    },
    async textEquals(selector, expected, description): Promise<void> {
      const observed = await page.tryText(selector);
      that(
        description,
        `text of ${selector} is exactly "${expected}"`,
        observed === null ? "<element absent>" : `"${observed}"`,
        observed !== null && observed.trim() === expected,
      );
    },
    async attrEquals(selector, attribute, expected, description): Promise<void> {
      const observed = await page.tryAttr(selector, attribute);
      that(
        description,
        `${attribute} of ${selector} is "${expected}"`,
        observed === null ? "<attribute absent>" : `"${observed}"`,
        observed === expected,
      );
    },
    async htmlContains(selector, fragment, description): Promise<void> {
      const observed = await page.tryHtml(selector);
      that(
        description,
        `innerHTML of ${selector} contains "${fragment}"`,
        observed === null ? "<element absent>" : `<${observed.length} chars of html>`,
        observed !== null && observed.includes(fragment),
      );
    },
    async htmlOmits(selector, fragment, description): Promise<void> {
      const observed = await page.tryHtml(selector);
      that(
        description,
        `innerHTML of ${selector} omits "${fragment}"`,
        observed === null ? "<element absent>" : `<${observed.length} chars of html>`,
        observed !== null && !observed.includes(fragment),
      );
    },
    async countAtLeast(selector, minimum, description): Promise<void> {
      const observed = await page.count(selector);
      that(description, `${selector} matches >= ${minimum}`, `${observed} matching element(s)`, observed >= minimum);
    },
    async countExactly(selector, expected, description): Promise<void> {
      const observed = await page.count(selector);
      that(description, `${selector} matches exactly ${expected}`, `${observed} matching element(s)`, observed === expected);
    },
  };
}
