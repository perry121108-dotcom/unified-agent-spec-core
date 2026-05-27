import { describe, it, expect } from 'vitest';
import {
  validateLogStructure,
  analyzeLogStructure,
  unwrapEvidenceBody,
} from '../../src/validator/semanticValidator.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const REAL_VITEST_BLOCK = `
 RUN  v1.6.1 D:/unified-agent-spec-core

 ✓ tests/cli/gateHook.test.ts > runGate — sample 1 1ms
 ✓ tests/cli/gateHook.test.ts > runGate — sample 2 0ms
 ✓ tests/integration/bootstrap.test.ts > scaffolding A 2ms
 ✓ tests/integration/bootstrap.test.ts > scaffolding B 1ms

 Test Files  2 passed (2)
      Tests  4 passed (4)
   Duration  120ms
`;

const REAL_WITH_EVIDENCE_TAGS = `<Execution_Evidence>
${REAL_VITEST_BLOCK}
</Execution_Evidence>`;

const REAL_WITH_CRLF = REAL_VITEST_BLOCK.replace(/\n/g, '\r\n');

/** Canonical AI-fabrication: pure summary, zero per-case markers. */
const FORGED_PURE_SUMMARY = `
$ npm test
> vitest run
 Test Files  10 passed (10)
      Tests  75 passed (75)
exit 0
`;

/** Off-by-one drift — claims 4 but only 3 ✓ markers. */
const FORGED_OFF_BY_ONE = `
 ✓ tests/x.test.ts > a 1ms
 ✓ tests/x.test.ts > b 1ms
 ✓ tests/x.test.ts > c 1ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
`;

/** Massive inflation — claims 75 but only 2 ✓ markers. */
const FORGED_INFLATED = `
 ✓ tests/x.test.ts > a 1ms
 ✓ tests/x.test.ts > b 1ms

 Test Files  1 passed (1)
      Tests  75 passed (75)
`;

/** Summary present + ≥1 ✓ but ZERO references to any tests/*.test.ts path. */
const FORGED_NO_FILE_REFS = `
 ✓ some unrelated sigil 1ms
 ✓ another decorative line 0ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
`;

/** No vitest fingerprint at all — neither summary nor ✓. */
const NON_VITEST_TEXT = `
$ git status
On branch main
nothing to commit, working tree clean
`;

/* -------------------------------------------------------------------------- */

describe('semanticValidator — unwrapEvidenceBody (Phase 10 text extraction)', () => {
  it('returns input unchanged when no <Execution_Evidence> open marker is present', () => {
    expect(unwrapEvidenceBody('hello world')).toBe('hello world');
  });

  it('extracts the inner region between open and close markers', () => {
    const body = unwrapEvidenceBody(REAL_WITH_EVIDENCE_TAGS);
    expect(body).toContain('Tests  4 passed (4)');
    expect(body).not.toContain('<Execution_Evidence>');
    expect(body).not.toContain('</Execution_Evidence>');
  });

  it('returns input UNCHANGED when an open marker has no closing pair (treats solo marker as stray reference, e.g. inside test names — protects against silent ✓-line loss)', () => {
    const strayMention = `prelude line\n ✓ tests/x.test.ts > describes the <Execution_Evidence> marker 1ms\n ✓ tests/x.test.ts > more 1ms\n Tests  2 passed (2)`;
    const body = unwrapEvidenceBody(strayMention);
    // Whole input is returned — neither truncated nor extracted
    expect(body).toBe(strayMention);
  });
});

describe('semanticValidator — analyzeLogStructure (pure counting)', () => {
  it('counts ✓ markers and parses the declared total on a clean log', () => {
    const r = analyzeLogStructure(REAL_VITEST_BLOCK);
    expect(r.scanned_check_marks).toBe(4);
    expect(r.declared_passed_total).toBe(4);
    expect(r.test_files_referenced).toEqual(
      expect.arrayContaining([
        'tests/cli/gateHook.test.ts',
        'tests/integration/bootstrap.test.ts',
      ]),
    );
  });

  it('returns declared_passed_total = -1 sentinel when no Tests-passed summary exists', () => {
    const r = analyzeLogStructure(' ✓ tests/x.test.ts > a 1ms\n');
    expect(r.declared_passed_total).toBe(-1);
    expect(r.scanned_check_marks).toBe(1);
  });

  it('handles CRLF line endings identically to LF', () => {
    const r = analyzeLogStructure(REAL_WITH_CRLF);
    expect(r.scanned_check_marks).toBe(4);
    expect(r.declared_passed_total).toBe(4);
  });
});

describe('semanticValidator — validateLogStructure (hard gate)', () => {
  it('PASS: real vitest verbose block passes cleanly and returns the report', () => {
    const report = validateLogStructure(REAL_VITEST_BLOCK);
    expect(report.scanned_check_marks).toBe(4);
    expect(report.declared_passed_total).toBe(4);
  });

  it('PASS: same block wrapped in <Execution_Evidence>...</...> tags also passes', () => {
    expect(() => validateLogStructure(REAL_WITH_EVIDENCE_TAGS)).not.toThrow();
  });

  it('PASS: CRLF line endings do not break the validator', () => {
    expect(() => validateLogStructure(REAL_WITH_CRLF)).not.toThrow();
  });

  it('FORGED: pure-summary fabrication (zero ✓ markers, declared 75) is rejected', () => {
    expect(() => validateLogStructure(FORGED_PURE_SUMMARY)).toThrowError(
      /CRITICAL_FORGERY/,
    );
  });

  it('FORGED: off-by-one drift between ✓ count (3) and declared total (4) is rejected', () => {
    expect(() => validateLogStructure(FORGED_OFF_BY_ONE)).toThrowError(
      /CRITICAL_FORGERY/,
    );
  });

  it('FORGED: massive inflation (2 ✓ vs declared 75) is rejected', () => {
    expect(() => validateLogStructure(FORGED_INFLATED)).toThrowError(
      /CRITICAL_FORGERY/,
    );
  });

  it('FORGED: summary + ✓ present but no tests/*.test.ts file references is rejected', () => {
    expect(() => validateLogStructure(FORGED_NO_FILE_REFS)).toThrowError(
      /CRITICAL_FORGERY/,
    );
  });

  it('FORGED: completely non-vitest text (no summary, no ✓) is rejected', () => {
    expect(() => validateLogStructure(NON_VITEST_TEXT)).toThrowError(
      /CRITICAL_FORGERY/,
    );
  });
});

describe('semanticValidator — gateHook end-to-end forgery rejection (smoke)', () => {
  it('forgery error message embeds both scanned count and declared total for diagnostics', () => {
    try {
      validateLogStructure(FORGED_INFLATED);
      throw new Error('expected validateLogStructure to throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('CRITICAL_FORGERY');
      expect(msg).toContain('75');
      expect(msg).toContain('2');
    }
  });
});
