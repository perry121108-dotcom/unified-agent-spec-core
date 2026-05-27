import { describe, it, expect } from 'vitest';
import {
  validateLogStructure,
  analyzeLogStructure,
  unwrapEvidenceBody,
  getStrategy,
  VitestStrategy,
  PytestStrategy,
  JestStrategy,
  CargoStrategy,
} from '../../src/validator/semanticValidator.js';

/* -------------------------------------------------------------------------- */
/* Phase 10 fixtures (Vitest)                                                 */
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

/** No runner fingerprint at all — neither summary nor ✓. */
const NON_VITEST_TEXT = `
$ git status
On branch main
nothing to commit, working tree clean
`;

/* -------------------------------------------------------------------------- */
/* Phase 11 fixtures (Pytest)                                                 */
/* -------------------------------------------------------------------------- */

const REAL_PYTEST_BLOCK = `
============================= test session starts ==============================
platform linux -- Python 3.12.0, pytest-8.0.0, pluggy-1.4.0
collected 4 items

tests/test_alpha.py::test_one PASSED                                     [ 25%]
tests/test_alpha.py::test_two PASSED                                     [ 50%]
tests/test_beta.py::test_three PASSED                                    [ 75%]
tests/test_beta.py::test_four PASSED                                     [100%]

============================== 4 passed in 0.12s ===============================
`;

const REAL_PYTEST_CRLF = REAL_PYTEST_BLOCK.replace(/\n/g, '\r\n');

/** Pytest forgery: declared 4 but only 2 PASSED lines. */
const FORGED_PYTEST_OFF_BY_TWO = `
============================= test session starts ==============================
collected 4 items

tests/test_alpha.py::test_one PASSED                                     [ 50%]
tests/test_alpha.py::test_two PASSED                                     [100%]

============================== 4 passed in 0.05s ===============================
`;

/** Pytest pure-summary forgery: declared 9 but ZERO PASSED lines. */
const FORGED_PYTEST_EMPTY = `
============================= test session starts ==============================
collected 9 items

============================== 9 passed in 0.01s ===============================
`;

/* -------------------------------------------------------------------------- */
/* Phase 11 fixtures (Jest)                                                   */
/* -------------------------------------------------------------------------- */

const REAL_JEST_BLOCK = `
PASS  src/__tests__/alpha.test.ts
  alpha module
    ✓ adds two numbers (3 ms)
    ✓ multiplies two numbers (1 ms)

PASS  src/__tests__/beta.test.ts
  beta module
    ✓ formats a date (2 ms)

Test Suites: 2 passed, 2 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        0.85 s
Ran all test suites.
`;

const REAL_JEST_CRLF = REAL_JEST_BLOCK.replace(/\n/g, '\r\n');

/** Jest forgery: declared 3 but only 1 ✓ marker. */
const FORGED_JEST_OFF_BY_TWO = `
PASS  src/__tests__/alpha.test.ts
  alpha module
    ✓ adds two numbers (3 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
`;

/** Jest pure-summary forgery: declared 5 but ZERO ✓ markers. */
const FORGED_JEST_EMPTY = `
PASS  src/__tests__/empty.test.ts

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
`;

/* -------------------------------------------------------------------------- */
/* Phase 11 fixtures (Cargo)                                                  */
/* -------------------------------------------------------------------------- */

const REAL_CARGO_BLOCK = `
   Compiling unified-agent-spec-core v0.6.0
    Finished test [unoptimized + debuginfo] target(s) in 1.23s
     Running unittests src/lib.rs (target/debug/deps/lib-abcdef0123456789)

running 3 tests
test parser::tests::detects_anchor ... ok
test parser::tests::counts_ticks ... ok
test parser::tests::extracts_declared ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
`;

const REAL_CARGO_CRLF = REAL_CARGO_BLOCK.replace(/\n/g, '\r\n');

/** Cargo forgery: declared 5 but only 1 `... ok` line. */
const FORGED_CARGO_OFF_BY_FOUR = `
running 5 tests
test parser::tests::detects_anchor ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
`;

/** Cargo pure-summary forgery: declared 7 but ZERO ok lines. */
const FORGED_CARGO_EMPTY = `
running 7 tests

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
`;

/* -------------------------------------------------------------------------- */
/* Phase 10 — Vitest baseline (15 cases, preserved verbatim)                  */
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

/* -------------------------------------------------------------------------- */
/* Phase 11 — Factory mutex & strategy identification                         */
/* -------------------------------------------------------------------------- */

describe('semanticValidator — getStrategy factory (Phase 11 mutex)', () => {
  it('routes a Vitest log to VitestStrategy', () => {
    expect(getStrategy(REAL_VITEST_BLOCK).name).toBe('vitest');
  });

  it('routes a Pytest log to PytestStrategy (and not Vitest, despite shared `Tests` keyword absence)', () => {
    expect(getStrategy(REAL_PYTEST_BLOCK).name).toBe('pytest');
  });

  it('routes a Jest log to JestStrategy (ahead of Vitest, since both emit ✓ but only Jest has `Test Suites:`)', () => {
    expect(getStrategy(REAL_JEST_BLOCK).name).toBe('jest');
  });

  it('routes a Cargo test log to CargoStrategy', () => {
    expect(getStrategy(REAL_CARGO_BLOCK).name).toBe('cargo');
  });

  it('throws [CRITICAL_FORGERY] Unknown… when no runner anchor is present', () => {
    expect(() => getStrategy(NON_VITEST_TEXT)).toThrowError(
      /CRITICAL_FORGERY.*Unknown or unsupported/,
    );
  });

  it('mutex: Jest text does NOT also satisfy Vitest detect (no `Test Files` line, no `Tests  N passed (N)` form)', () => {
    expect(VitestStrategy.detect(REAL_JEST_BLOCK)).toBe(false);
    expect(JestStrategy.detect(REAL_JEST_BLOCK)).toBe(true);
  });

  it('mutex: Vitest text does NOT satisfy Jest detect (no `Test Suites:` anchor)', () => {
    expect(JestStrategy.detect(REAL_VITEST_BLOCK)).toBe(false);
    expect(VitestStrategy.detect(REAL_VITEST_BLOCK)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 11 — Pytest strategy                                                 */
/* -------------------------------------------------------------------------- */

describe('semanticValidator — PytestStrategy (Phase 11)', () => {
  it('PASS: real pytest block (4 PASSED ≡ "===== 4 passed =====") passes cleanly', () => {
    const report = validateLogStructure(REAL_PYTEST_BLOCK);
    expect(report.strategy).toBe('pytest');
    expect(report.scanned_check_marks).toBe(4);
    expect(report.declared_passed_total).toBe(4);
    expect(report.test_files_referenced.length).toBeGreaterThanOrEqual(2);
  });

  it('PASS: CRLF line endings do not break the Pytest validator', () => {
    expect(() => validateLogStructure(REAL_PYTEST_CRLF)).not.toThrow();
  });

  it('FORGED: pytest off-by-two (2 PASSED vs declared 4) is rejected', () => {
    expect(() => validateLogStructure(FORGED_PYTEST_OFF_BY_TWO)).toThrowError(
      /CRITICAL_FORGERY.*pytest/,
    );
  });

  it('FORGED: pytest pure-summary (0 PASSED vs declared 9) is rejected', () => {
    expect(() => validateLogStructure(FORGED_PYTEST_EMPTY)).toThrowError(
      /CRITICAL_FORGERY/,
    );
  });

  it('PytestStrategy.extractDeclaredPassed parses the canonical summary line', () => {
    expect(PytestStrategy.extractDeclaredPassed(REAL_PYTEST_BLOCK)).toBe(4);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 11 — Jest strategy                                                   */
/* -------------------------------------------------------------------------- */

describe('semanticValidator — JestStrategy (Phase 11)', () => {
  it('PASS: real jest block (3 ✓ ≡ "Tests: 3 passed") passes cleanly', () => {
    const report = validateLogStructure(REAL_JEST_BLOCK);
    expect(report.strategy).toBe('jest');
    expect(report.scanned_check_marks).toBe(3);
    expect(report.declared_passed_total).toBe(3);
    expect(report.test_files_referenced.length).toBeGreaterThanOrEqual(2);
  });

  it('PASS: CRLF line endings do not break the Jest validator', () => {
    expect(() => validateLogStructure(REAL_JEST_CRLF)).not.toThrow();
  });

  it('FORGED: jest off-by-two (1 ✓ vs declared 3) is rejected', () => {
    expect(() => validateLogStructure(FORGED_JEST_OFF_BY_TWO)).toThrowError(
      /CRITICAL_FORGERY.*jest/,
    );
  });

  it('FORGED: jest pure-summary (0 ✓ vs declared 5) is rejected', () => {
    expect(() => validateLogStructure(FORGED_JEST_EMPTY)).toThrowError(
      /CRITICAL_FORGERY/,
    );
  });

  it('JestStrategy.countScannedTicks accepts both U+2713 (✓) and U+2714 (✔)', () => {
    const mixed = `
Test Suites: 1 passed, 1 total
  ✓ alpha
  ✔ beta
Tests:       2 passed, 2 total
`;
    expect(JestStrategy.countScannedTicks(mixed)).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 11 — Cargo strategy                                                  */
/* -------------------------------------------------------------------------- */

describe('semanticValidator — CargoStrategy (Phase 11)', () => {
  it('PASS: real cargo block (3 `... ok` ≡ "test result: ok. 3 passed") passes cleanly', () => {
    const report = validateLogStructure(REAL_CARGO_BLOCK);
    expect(report.strategy).toBe('cargo');
    expect(report.scanned_check_marks).toBe(3);
    expect(report.declared_passed_total).toBe(3);
    expect(report.test_files_referenced.length).toBe(3);
  });

  it('PASS: CRLF line endings do not break the Cargo validator', () => {
    expect(() => validateLogStructure(REAL_CARGO_CRLF)).not.toThrow();
  });

  it('FORGED: cargo off-by-four (1 ok-line vs declared 5) is rejected', () => {
    expect(() => validateLogStructure(FORGED_CARGO_OFF_BY_FOUR)).toThrowError(
      /CRITICAL_FORGERY.*cargo/,
    );
  });

  it('FORGED: cargo pure-summary (0 ok-lines vs declared 7) is rejected', () => {
    expect(() => validateLogStructure(FORGED_CARGO_EMPTY)).toThrowError(
      /CRITICAL_FORGERY/,
    );
  });

  it('CargoStrategy.collectTestFileRefs surfaces the qualified Rust test paths', () => {
    const refs = CargoStrategy.collectTestFileRefs(REAL_CARGO_BLOCK);
    expect(refs).toEqual(
      expect.arrayContaining([
        'parser::tests::detects_anchor',
        'parser::tests::counts_ticks',
        'parser::tests::extracts_declared',
      ]),
    );
  });
});
