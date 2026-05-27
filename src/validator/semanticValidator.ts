/**
 * semanticValidator — Phase 10 Deterministic Oracle
 *
 * Companion to `prompts/adversarial_auditor.txt`. Where the auditor persona
 * does heuristic forensics, this module does the **mathematical** part:
 * it parses an `<Execution_Evidence>` block and enforces a single hard
 * invariant — the number of `✓` per-case markers in the body MUST exactly
 * equal the aggregate `Tests N passed` total reported in the summary line.
 *
 * Threat model
 *   An AI Builder agent pastes a plausible-looking but never-actually-run
 *   "Tests 75 passed (75)" summary into WORKLOG. Without per-case enumeration
 *   the claim is trivially fabricated. This oracle requires the structural
 *   per-case track and proves it sums to the declared aggregate.
 *
 * Failure mode
 *   On any mismatch (or absence of the canonical Vitest fingerprint), throws
 *   `Error` whose message begins with `[CRITICAL_FORGERY]`. The caller
 *   (`runGate`) catches this, prints a high-contrast diagnostic, and exits 1
 *   without writing any compliance stamp.
 *
 * Encoding/EOL contract
 *   Accepts both `\n` and `\r\n` line endings transparently. Tolerant of
 *   Unicode `✓` (U+2713) and `❯` (U+276F) glyphs in their canonical form.
 */

const EVIDENCE_OPEN_MARKER = /<Execution_Evidence>/i;
const EVIDENCE_CLOSE_MARKER = /<\/Execution_Evidence>/i;

/**
 * Canonical vitest aggregate summary line. Matches both:
 *   "      Tests  75 passed (75)"
 *   "Tests   1 passed (1)"
 * with arbitrary leading whitespace and possible ANSI escape residue.
 *
 * Extracts the first declared count (the one before "passed").
 */
const SUMMARY_PATTERN = /(?:^|\n)\s*Tests\s+(\d+)\s+passed\s*\(\d+\)/i;

/**
 * Per-case marker line. Vitest verbose emits one such line per assertion:
 *   " ✓ tests/cli/gateHook.test.ts > runGate — programmatic core ... 1ms"
 * We accept the case marker followed by anything (test name is human prose),
 * with leading whitespace tolerance. We DO NOT require a trailing `<N>ms`
 * here because some reporters elide timing on 0-duration cases; the strict
 * timing checks are the auditor persona's job, not this oracle's.
 */
const CHECK_MARK_LINE = /^\s*✓\s+\S/;

/**
 * Per-file path inside an evidence body. Used as a corroborating signal that
 * the log references genuine test files (vs. a pure summary fabrication).
 */
const TEST_FILE_PATH_PATTERN = /tests\/[A-Za-z0-9_\-./]+\.test\.ts/g;

export interface SemanticReport {
  /** Number of `✓` markers actually counted in the body. */
  scanned_check_marks: number;
  /** The integer extracted from `Tests N passed (N)`. */
  declared_passed_total: number;
  /** Distinct `tests/...test.ts` paths referenced anywhere in the body. */
  test_files_referenced: string[];
  /** Inner body of the <Execution_Evidence>...</Execution_Evidence> region. */
  inner_body_chars: number;
}

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

/**
 * Pure analytical pass — no exceptions thrown. Returns a structured report
 * the caller can inspect; mathematical equality is NOT enforced here. Tests
 * use this to verify counting accuracy independently of throw semantics.
 *
 * If the canonical `Tests N passed (N)` summary line is absent, returns
 * `declared_passed_total = -1` as a sentinel — the caller decides how to
 * treat absence.
 */
export function analyzeLogStructure(evidenceText: string): SemanticReport {
  const inner = normalizeEol(unwrapEvidenceBody(evidenceText));
  const lines = inner.split('\n');

  let scanned = 0;
  for (const ln of lines) {
    if (CHECK_MARK_LINE.test(ln)) scanned += 1;
  }

  const summaryMatch = SUMMARY_PATTERN.exec(inner);
  const declared =
    summaryMatch && summaryMatch[1] !== undefined
      ? parseInt(summaryMatch[1], 10)
      : -1;

  const filesMatches = inner.match(TEST_FILE_PATH_PATTERN) ?? [];
  const distinctFiles = Array.from(new Set(filesMatches));

  return {
    scanned_check_marks: scanned,
    declared_passed_total: declared,
    test_files_referenced: distinctFiles,
    inner_body_chars: inner.length,
  };
}

/**
 * Hard semantic gate. Throws `Error('[CRITICAL_FORGERY] ...')` on any of:
 *
 *   1. Both the canonical summary line AND every `✓` marker are absent
 *      ⇒ no legitimate Vitest fingerprint at all → presumed fabricated.
 *
 *   2. The summary line is present but the per-case `✓` count does not
 *      exactly match the declared `passed` total ⇒ math invariant broken.
 *
 *   3. The summary declares ≥ 1 passed test but no `tests/.../*.test.ts`
 *      path is referenced anywhere in the body ⇒ pure-summary forgery.
 *
 * Returns the {@link SemanticReport} on success so the caller may surface
 * counts in success diagnostics (e.g., stamping `scanned_check_marks`).
 */
export function validateLogStructure(evidenceText: string): SemanticReport {
  const report = analyzeLogStructure(evidenceText);

  const hasSummary = report.declared_passed_total >= 0;
  const hasAnyCheckMark = report.scanned_check_marks > 0;

  if (!hasSummary && !hasAnyCheckMark) {
    throw new Error(
      '[CRITICAL_FORGERY] Evidence log matrix mismatch or structure artificial. ' +
        'No Vitest fingerprint detected — neither a `Tests N passed (N)` summary ' +
        'line nor any `✓` per-case markers were found in the evidence body.',
    );
  }

  if (hasSummary) {
    if (report.scanned_check_marks !== report.declared_passed_total) {
      throw new Error(
        `[CRITICAL_FORGERY] Evidence log matrix mismatch or structure artificial. ` +
          `Summary line declares ${report.declared_passed_total} passed tests but ` +
          `only ${report.scanned_check_marks} canonical '✓ tests/...' per-case markers ` +
          `were scanned in the evidence body. Per-case track MUST sum to the declared aggregate.`,
      );
    }

    if (report.declared_passed_total >= 1 && report.test_files_referenced.length === 0) {
      throw new Error(
        `[CRITICAL_FORGERY] Evidence log matrix mismatch or structure artificial. ` +
          `Summary claims ${report.declared_passed_total} passed tests but no ` +
          `'tests/<path>.test.ts' file reference is present in the body.`,
      );
    }
  }

  return report;
}
