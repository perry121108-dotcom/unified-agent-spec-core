/**
 * codeSlopLinter — Phase 13 Deterministic Code Slop Oracle
 *
 * Threat model
 *   An AI Builder agent floods the codebase with "AI slop" — sprawling
 *   functions, deeply-nested control flow, and lazily-expanded boilerplate
 *   that is technically syntactically valid but operationally toxic. Phase 12
 *   guards INTENT (was there a plan?). Phase 13 guards GEOMETRY (does the
 *   resulting code respect physical density limits?).
 *
 * Invariants (rigid, deterministic, no per-project knobs)
 *   - MAX_NESTING_DEPTH = 4: any `{` that would push the open-brace stack to
 *     depth ≥ 5 is recorded as `MAX_DEPTH_EXCEEDED`.
 *   - MAX_BLOCK_LINES = 60: any matching `{...}` pair whose interior has
 *     more than 60 effective lines (non-whitespace AND non-pure-comment) is
 *     recorded as `MAX_BLOCK_LINES_EXCEEDED`.
 *
 * Scope
 *   Only files whose path ends in `.ts` or `.js` are scanned. The caller
 *   (`gateHook.runGate`) passes the result of `getWorkspaceMutations()`, so
 *   only files the agent actually changed are inspected — a full-repo audit
 *   is intentionally NOT performed (the previous Phase-1-11 code base is
 *   grandfathered until it is touched).
 *
 * String / comment escape contract
 *   A character-level state machine walks each file once. Inside `//`,
 *   block comments, `'...'`, `"..."`, and `` `...` `` regions, all `{` and `}`
 *   are inert — they do not push/pop the depth stack and they do not start
 *   or end blocks. This eliminates false positives on `console.log("{")`
 *   and similar idioms. Per spec, template-literal substitutions (`${...}`)
 *   are treated as opaque (the entire backtick literal is skipped) to keep
 *   the state machine small and predictable.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Cap on `{}` nesting depth. Depth ≥ MAX+1 triggers a violation. */
export const MAX_NESTING_DEPTH = 4;

/** Cap on effective lines strictly INSIDE a `{...}` pair. */
export const MAX_BLOCK_LINES = 60;

/** Path suffixes (case-insensitive) the linter actually scans. */
export const SCANNABLE_EXTENSIONS = ['.ts', '.js'] as const;

export type SlopViolationType = 'MAX_DEPTH_EXCEEDED' | 'MAX_BLOCK_LINES_EXCEEDED';

export interface SlopViolation {
  filePath: string;
  type: SlopViolationType;
  detail: string;
}

export interface SlopReport {
  scannedFiles: string[];
  violations: SlopViolation[];
}

/** Returns true iff the path's extension is one the linter is allowed to scan. */
export function isScannableSource(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return SCANNABLE_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}

/* -------------------------------------------------------------------------- */
/* Char-level state machine                                                   */
/* -------------------------------------------------------------------------- */

type ScanMode =
  | 'NORMAL'
  | 'LINE_COMMENT'
  | 'BLOCK_COMMENT'
  | 'STR_SINGLE'
  | 'STR_DOUBLE'
  | 'STR_BACKTICK';

interface ScanState {
  mode: ScanMode;
  openLines: number[]; // stack of 0-based line indexes where `{` was seen
  effectiveLine: boolean[]; // index = 0-based line; true once line has code or string content
  violations: SlopViolation[];
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r';
}

function enterContextualMode(ch: string, next: string): ScanMode | null {
  if (ch === '/' && next === '/') return 'LINE_COMMENT';
  if (ch === '/' && next === '*') return 'BLOCK_COMMENT';
  if (ch === "'") return 'STR_SINGLE';
  if (ch === '"') return 'STR_DOUBLE';
  if (ch === '`') return 'STR_BACKTICK';
  return null;
}

function stringTerminatorFor(mode: ScanMode): string | null {
  if (mode === 'STR_SINGLE') return "'";
  if (mode === 'STR_DOUBLE') return '"';
  if (mode === 'STR_BACKTICK') return '`';
  return null;
}

function handleOpenBrace(state: ScanState, line: number, filePath: string): void {
  state.openLines.push(line);
  if (state.openLines.length > MAX_NESTING_DEPTH) {
    state.violations.push({
      filePath,
      type: 'MAX_DEPTH_EXCEEDED',
      detail:
        `Brace nesting depth ${state.openLines.length} exceeds limit ` +
        `${MAX_NESTING_DEPTH} at line ${line + 1}`,
    });
  }
}

function handleCloseBrace(state: ScanState, line: number, filePath: string): void {
  const openLine = state.openLines.pop();
  if (openLine === undefined) return; // unbalanced; lint cannot blame agent
  let effective = 0;
  for (let l = openLine + 1; l <= line - 1; l++) {
    if (state.effectiveLine[l]) effective += 1;
  }
  if (effective > MAX_BLOCK_LINES) {
    state.violations.push({
      filePath,
      type: 'MAX_BLOCK_LINES_EXCEEDED',
      detail:
        `Block spanning lines ${openLine + 1}..${line + 1} has ${effective} ` +
        `effective lines (limit ${MAX_BLOCK_LINES})`,
    });
  }
}

/**
 * Returns the number of EXTRA characters to advance (0 or 1). The outer loop
 * always advances by 1 itself, so returning 1 here means "consume 2 chars
 * total" (the current char and its lookahead).
 */
function stepNormal(
  ch: string,
  next: string,
  line: number,
  state: ScanState,
  filePath: string,
): number {
  const entered = enterContextualMode(ch, next);
  if (entered === 'LINE_COMMENT' || entered === 'BLOCK_COMMENT') {
    state.mode = entered;
    return 1; // consume the two-char opener `//` or `/*`
  }
  if (entered !== null) {
    state.mode = entered;
    state.effectiveLine[line] = true; // the quote itself is code
    return 0;
  }
  if (!isWhitespace(ch)) state.effectiveLine[line] = true;
  if (ch === '{') handleOpenBrace(state, line, filePath);
  else if (ch === '}') handleCloseBrace(state, line, filePath);
  return 0;
}

function stepStringMode(
  ch: string,
  state: ScanState,
  line: number,
): { advance: number; exit: boolean } {
  state.effectiveLine[line] = true;
  if (ch === '\\') return { advance: 1, exit: false }; // skip escape target
  const terminator = stringTerminatorFor(state.mode);
  if (terminator !== null && ch === terminator) return { advance: 0, exit: true };
  return { advance: 0, exit: false };
}

/**
 * Single-pass char walker. Public so unit tests can drive a tightly-scoped
 * fixture string without round-tripping through the filesystem.
 */
export function scanFileContent(content: string, filePath: string): SlopViolation[] {
  const lineCount = content.split('\n').length;
  const state: ScanState = {
    mode: 'NORMAL',
    openLines: [],
    effectiveLine: new Array<boolean>(lineCount).fill(false),
    violations: [],
  };
  let line = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i] ?? '';
    const next = content[i + 1] ?? '';
    if (ch === '\n') {
      if (state.mode === 'LINE_COMMENT') state.mode = 'NORMAL';
      line += 1;
      continue;
    }
    if (state.mode === 'NORMAL') {
      i += stepNormal(ch, next, line, state, filePath);
      continue;
    }
    if (state.mode === 'LINE_COMMENT') {
      // Inert until newline (newline reset is handled at the top of the loop).
      // Comment chars never mark the line as effective.
      continue;
    }
    if (state.mode === 'BLOCK_COMMENT') {
      if (ch === '*' && next === '/') {
        state.mode = 'NORMAL';
        i += 1;
      }
      continue;
    }
    const step = stepStringMode(ch, state, line);
    i += step.advance;
    if (step.exit) state.mode = 'NORMAL';
  }
  return state.violations;
}

/* -------------------------------------------------------------------------- */
/* File-set orchestration                                                     */
/* -------------------------------------------------------------------------- */

/** Tiny seam so tests can swap in an in-memory file source. */
export type FileReader = (absolutePath: string) => string;

const defaultFileReader: FileReader = (p) => readFileSync(p, 'utf8');

/**
 * Public entry. Filters `modifiedPaths` down to `.ts`/`.js` files, reads each
 * one (resolved against `workspaceRoot`), and concatenates per-file
 * violations into a single report. Files that fail to read (e.g. deletes
 * surfaced by `git diff --name-only HEAD`) are silently skipped — `git`
 * already documented their non-existence to us.
 */
export function analyzeCodeSlop(
  modifiedPaths: string[],
  workspaceRoot: string,
  fileReader: FileReader = defaultFileReader,
): SlopReport {
  const scannedFiles = modifiedPaths.filter(isScannableSource);
  const violations: SlopViolation[] = [];
  for (const relPath of scannedFiles) {
    const abs = resolve(workspaceRoot, relPath);
    let content: string;
    try {
      content = fileReader(abs);
    } catch {
      continue;
    }
    violations.push(...scanFileContent(content, relPath));
  }
  return { scannedFiles, violations };
}

/**
 * Renders a `[CODE_SLOP_DETECTED]` error message that lists every violation
 * with file path and detail. The Pre-flight catcher uses this verbatim so the
 * agent sees exactly which file/line tripped the geometric guard.
 */
export function formatSlopError(report: SlopReport): string {
  const bullets = report.violations
    .map((v) => `  - ${v.filePath} [${v.type}]: ${v.detail}`)
    .join('\n');
  return (
    `[CODE_SLOP_DETECTED] ${report.violations.length} density violation(s) ` +
    `across ${report.scannedFiles.length} scanned source file(s):\n${bullets}`
  );
}
