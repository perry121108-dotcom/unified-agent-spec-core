/**
 * semanticValidator — Phase 10 + Phase 11 Deterministic Multi-Framework Oracle
 *
 * Phase 10 (Vitest only): hard mathematical invariant — count of `✓` per-case
 * markers MUST equal the aggregate `Tests N passed (N)` total.
 *
 * Phase 11 (Strategy Pattern): generalized the oracle across four test
 * runners (Vitest / Pytest / Jest / Cargo) via the `TestParserStrategy`
 * interface and a mutex-safe `getStrategy()` factory. Each runner contributes:
 *   - detect()                — exclusive anchor; the matrix is engineered
 *                                so at most one strategy claims any given log
 *   - countScannedTicks()     — per-case pass marker count
 *   - extractDeclaredPassed() — aggregate "N passed" number; -1 if absent
 *   - collectTestFileRefs()   — pure-summary forgery defense (claims of
 *                                passed tests with zero file references)
 *
 * Threat model and failure mode unchanged from Phase 10 — any mismatch, or
 * absence of any recognizable runner fingerprint, throws an Error whose
 * message begins with `[CRITICAL_FORGERY]`. The caller (`runGate`) catches
 * this, prints a high-contrast diagnostic, and exits 1 without writing any
 * compliance stamp.
 *
 * Encoding/EOL contract
 *   Accepts both `\n` and `\r\n` line endings transparently.
 */

const EVIDENCE_OPEN_MARKER = /<Execution_Evidence>/i;
const EVIDENCE_CLOSE_MARKER = /<\/Execution_Evidence>/i;

/**
 * Extract the innermost `<Execution_Evidence>...</Execution_Evidence>` body
 * ONLY when both markers are present as a properly-paired wrapper. A solo
 * open marker WITHOUT a matching close is treated as a stray reference
 * (e.g. a test name describing itself, or quoted doc text) and the original
 * input is returned UNCHANGED — gateHook already feeds us the inner fenced
 * content via specCompiler.extractExecutionEvidence, so the typical call
 * site has no markers at all. Refusing to truncate on solo markers avoids
 * silently dropping legitimate `✓` lines that appear before stray mentions.
 */
export function unwrapEvidenceBody(evidenceText: string): string {
  const openMatch = EVIDENCE_OPEN_MARKER.exec(evidenceText);
  if (!openMatch) return evidenceText;
  const afterOpen = evidenceText.slice(openMatch.index + openMatch[0].length);
  const closeMatch = EVIDENCE_CLOSE_MARKER.exec(afterOpen);
  if (!closeMatch) {
    // Open without close ⇒ stray mention, not a wrapper. Pass through unchanged.
    return evidenceText;
  }
  return afterOpen.slice(0, closeMatch.index);
}

/**
 * Normalize CRLF → LF so downstream regex line scans are platform-uniform.
 */
function normalizeEol(s: string): string {
  return s.replace(/\r\n/g, '\n');
}

export interface SemanticReport {
  /** Strategy that won mutex detection (e.g. "vitest", "pytest"). */
  strategy: string;
  /** Number of per-case pass markers actually counted in the body. */
  scanned_check_marks: number;
  /** The integer extracted from the runner's declared-passed summary line. */
  declared_passed_total: number;
  /** Runner-shaped file / test references gathered from the body. */
  test_files_referenced: string[];
  /** Inner body of the <Execution_Evidence>...</Execution_Evidence> region. */
  inner_body_chars: number;
}

/* -------------------------------------------------------------------------- */
/* Strategy Pattern (Phase 11)                                                */
/* -------------------------------------------------------------------------- */

export interface TestParserStrategy {
  /** Stable identifier, surfaced in diagnostics. */
  name: string;
  /** Returns true iff this strategy's exclusive anchor is present. */
  detect(text: string): boolean;
  /** Counts per-case pass markers in the body. */
  countScannedTicks(text: string): number;
  /** Returns the declared passed total, or -1 if no summary line is present. */
  extractDeclaredPassed(text: string): number;
  /** Returns runner-shaped file/test references for pure-summary forgery defense. */
  collectTestFileRefs(text: string): string[];
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function extractFirstInt(text: string, re: RegExp): number {
  const m = re.exec(text);
  if (!m || m[1] === undefined) return -1;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? -1 : n;
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

/* ---- Vitest (Phase 10 baseline; behavior preserved bit-for-bit) ---------- */

const VITEST_SUMMARY = /(?:^|\n)\s*Tests\s+(\d+)\s+passed\s*\(\d+\)/i;
const VITEST_TICK = /^\s*✓\s+\S.*$/gm;
const VITEST_FILE_REF = /tests\/[A-Za-z0-9_\-./]+\.test\.ts/g;
const VITEST_DETECT_FILES = /Test Files\s+\d+/;

export const VitestStrategy: TestParserStrategy = {
  name: 'vitest',
  detect(text) {
    // Vitest's signature is either the "Test Files N passed" line, or the
    // canonical `Tests  N passed (N)` form with the parenthetical count.
    // Both are absent from Jest, Pytest, and Cargo output — mutex preserved.
    return VITEST_DETECT_FILES.test(text) || VITEST_SUMMARY.test(text);
  },
  countScannedTicks(text) {
    return countMatches(text, VITEST_TICK);
  },
  extractDeclaredPassed(text) {
    return extractFirstInt(text, new RegExp(VITEST_SUMMARY.source, 'i'));
  },
  collectTestFileRefs(text) {
    return uniq(text.match(VITEST_FILE_REF) ?? []);
  },
};

/* ---- Pytest -------------------------------------------------------------- */

const PYTEST_DETECT = /test session starts/;
const PYTEST_TICK = /^.*PASSED.*$/gm;
// Pytest closing summary, e.g. `===== 4 passed in 0.12s =====` or with mixed
// counts `===== 3 passed, 1 skipped in 0.20s =====`. We tolerate any trailing
// pre-`=` chatter so long as the leading `=+ N passed` segment is intact.
const PYTEST_SUMMARY = /=+\s+(\d+)\s+passed[^=]*=+/;
const PYTEST_FILE_REF = /[A-Za-z0-9_\-./]+\.py::[A-Za-z0-9_]+/g;

export const PytestStrategy: TestParserStrategy = {
  name: 'pytest',
  detect(text) {
    return PYTEST_DETECT.test(text);
  },
  countScannedTicks(text) {
    return countMatches(text, PYTEST_TICK);
  },
  extractDeclaredPassed(text) {
    return extractFirstInt(text, PYTEST_SUMMARY);
  },
  collectTestFileRefs(text) {
    return uniq(text.match(PYTEST_FILE_REF) ?? []);
  },
};

/* ---- Jest ---------------------------------------------------------------- */

const JEST_DETECT = /Test Suites:/;
// Jest uses U+2713 (✓) in default reporter; some custom reporters use U+2714 (✔).
const JEST_TICK = /^\s*[✓✔]\s+\S.*$/gm;
const JEST_SUMMARY = /Tests:\s+(\d+)\s+passed/;
const JEST_FILE_REF = /[A-Za-z0-9_\-./]+\.(?:test|spec)\.[jt]sx?/g;

export const JestStrategy: TestParserStrategy = {
  name: 'jest',
  detect(text) {
    return JEST_DETECT.test(text);
  },
  countScannedTicks(text) {
    return countMatches(text, JEST_TICK);
  },
  extractDeclaredPassed(text) {
    return extractFirstInt(text, JEST_SUMMARY);
  },
  collectTestFileRefs(text) {
    return uniq(text.match(JEST_FILE_REF) ?? []);
  },
};

/* ---- Cargo test ---------------------------------------------------------- */

const CARGO_DETECT = /running \d+ tests?/;
const CARGO_TICK = /^test\s+.*\s+\.\.\.\s+ok$/gm;
const CARGO_SUMMARY = /test result:\s+ok\.\s+(\d+)\s+passed/;
// For cargo, the "file ref" surrogate is the qualified Rust test path
// (module::submodule::test_name) captured from the per-case track itself.
const CARGO_TEST_REF = /^test\s+([A-Za-z0-9_:]+)\s+\.\.\.\s+ok$/gm;

export const CargoStrategy: TestParserStrategy = {
  name: 'cargo',
  detect(text) {
    return CARGO_DETECT.test(text);
  },
  countScannedTicks(text) {
    return countMatches(text, CARGO_TICK);
  },
  extractDeclaredPassed(text) {
    return extractFirstInt(text, CARGO_SUMMARY);
  },
  collectTestFileRefs(text) {
    const re = new RegExp(CARGO_TEST_REF.source, 'gm');
    const refs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[1]) refs.push(m[1]);
    }
    return uniq(refs);
  },
};

/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Detection runs in mutex order: Jest → Pytest → Cargo → Vitest. Jest must
 * run before Vitest because both emit ✓ check marks; only Jest has the
 * `Test Suites:` anchor — that anchor is what makes the matrix mutually
 * exclusive. Pytest and Cargo have non-overlapping anchors. Vitest is the
 * final fall-through.
 *
 * If no anchor matches, the entire log is presumed fabricated and we throw
 * `[CRITICAL_FORGERY] Unknown or unsupported test runner log structure.`
 */
const STRATEGIES: readonly TestParserStrategy[] = [
  JestStrategy,
  PytestStrategy,
  CargoStrategy,
  VitestStrategy,
];

export function getStrategy(evidenceText: string): TestParserStrategy {
  const inner = normalizeEol(unwrapEvidenceBody(evidenceText));
  for (const s of STRATEGIES) {
    if (s.detect(inner)) return s;
  }
  throw new Error(
    '[CRITICAL_FORGERY] Unknown or unsupported test runner log structure.',
  );
}

/* -------------------------------------------------------------------------- */
/* Legacy analyze (Vitest-bound; kept for back-compat with Phase 10 tests)    */
/* -------------------------------------------------------------------------- */

/**
 * Pure analytical pass — no exceptions thrown. Returns a structured report
 * the caller can inspect; mathematical equality is NOT enforced here.
 *
 * Phase 10 contract preserved: defaults to Vitest counting semantics. If the
 * canonical `Tests N passed (N)` summary line is absent, returns
 * `declared_passed_total = -1` as a sentinel.
 */
export function analyzeLogStructure(evidenceText: string): SemanticReport {
  const inner = normalizeEol(unwrapEvidenceBody(evidenceText));
  return {
    strategy: 'vitest',
    scanned_check_marks: VitestStrategy.countScannedTicks(inner),
    declared_passed_total: VitestStrategy.extractDeclaredPassed(inner),
    test_files_referenced: VitestStrategy.collectTestFileRefs(inner),
    inner_body_chars: inner.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Strategy-aware hard gate (Phase 11)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Hard semantic gate. Detects which runner the log was produced by, then
 * enforces the per-runner mathematical invariant. Throws
 * `Error('[CRITICAL_FORGERY] ...')` on any of:
 *
 *   0. No runner anchor matches at all
 *      ⇒ unknown / unsupported / fabricated structure.
 *
 *   1. Detected runner has neither a summary line nor any per-case markers
 *      ⇒ no legitimate fingerprint → presumed fabricated.
 *
 *   2. The summary line is present but the per-case marker count does not
 *      exactly match the declared passed total ⇒ math invariant broken.
 *
 *   3. The summary declares ≥ 1 passed test but no runner-shaped file/test
 *      reference is present anywhere in the body ⇒ pure-summary forgery.
 *
 * Returns the {@link SemanticReport} on success so the caller may surface
 * counts in success diagnostics.
 */
export function validateLogStructure(evidenceText: string): SemanticReport {
  const inner = normalizeEol(unwrapEvidenceBody(evidenceText));
  const strategy = getStrategy(inner); // throws [CRITICAL_FORGERY] Unknown… if none match

  const scanned = strategy.countScannedTicks(inner);
  const declared = strategy.extractDeclaredPassed(inner);
  const fileRefs = strategy.collectTestFileRefs(inner);

  const report: SemanticReport = {
    strategy: strategy.name,
    scanned_check_marks: scanned,
    declared_passed_total: declared,
    test_files_referenced: fileRefs,
    inner_body_chars: inner.length,
  };

  const hasSummary = declared >= 0;
  const hasAnyTick = scanned > 0;

  if (!hasSummary && !hasAnyTick) {
    throw new Error(
      `[CRITICAL_FORGERY] Evidence log matrix mismatch or structure artificial. ` +
        `Runner=${strategy.name}. Neither a passed-count summary line ` +
        `nor any per-case markers were found in the evidence body.`,
    );
  }

  if (hasSummary) {
    if (scanned !== declared) {
      throw new Error(
        `[CRITICAL_FORGERY] Evidence log matrix mismatch or structure artificial. ` +
          `Runner=${strategy.name}. Summary line declares ${declared} passed tests ` +
          `but only ${scanned} per-case markers were scanned in the evidence body. ` +
          `Per-case track MUST sum to the declared aggregate.`,
      );
    }
    if (declared >= 1 && fileRefs.length === 0) {
      throw new Error(
        `[CRITICAL_FORGERY] Evidence log matrix mismatch or structure artificial. ` +
          `Runner=${strategy.name}. Summary claims ${declared} passed tests but no ` +
          `runner-shaped file/test reference is present in the body.`,
      );
    }
  }

  return report;
}
