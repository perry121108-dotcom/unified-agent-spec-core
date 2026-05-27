import { describe, it, expect } from 'vitest';
import {
  scanFileContent,
  analyzeCodeSlop,
  formatSlopError,
  isScannableSource,
  MAX_NESTING_DEPTH,
  MAX_BLOCK_LINES,
  type FileReader,
} from '../../src/linter/codeSlopLinter.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function makeFileReader(files: Record<string, string>): FileReader {
  return (absolutePath: string) => {
    const norm = absolutePath.replace(/\\/g, '/');
    for (const [key, content] of Object.entries(files)) {
      if (norm.endsWith(key)) return content;
    }
    throw new Error(`fake file reader miss: ${norm}`);
  };
}

function deepBraces(levels: number): string {
  // Builds an artificially nested source: `function a(){{{...}}}`.
  // 4 levels → `{{{{}}}}` → max depth 4 (passes); 5 levels → fails.
  const open = '{'.repeat(levels);
  const close = '}'.repeat(levels);
  return `function a() ${open}${close}`;
}

function blockWithEffectiveLines(n: number): string {
  // Builds a function whose body has exactly `n` effective lines (numbered
  // const decls), padded with blank lines and pure-comment lines that MUST
  // be excluded from the count.
  const codeLines = Array.from({ length: n }, (_, i) => `  const x${i} = ${i};`);
  const padding = [
    '',
    '  // a pure-comment line that must NOT count',
    '',
    '  // another pure-comment line',
    '',
  ];
  return `function fat() {\n${codeLines.join('\n')}\n${padding.join('\n')}\n}`;
}

/* -------------------------------------------------------------------------- */
/* isScannableSource                                                          */
/* -------------------------------------------------------------------------- */

describe('codeSlopLinter — isScannableSource (extension filter)', () => {
  it('accepts .ts and .js paths', () => {
    expect(isScannableSource('src/foo.ts')).toBe(true);
    expect(isScannableSource('src/foo.js')).toBe(true);
  });

  it('rejects .md, .json, .yml, no-extension paths', () => {
    expect(isScannableSource('README.md')).toBe(false);
    expect(isScannableSource('package.json')).toBe(false);
    expect(isScannableSource('.github/workflows/ci.yml')).toBe(false);
    expect(isScannableSource('Makefile')).toBe(false);
  });

  it('normalizes Windows backslash paths', () => {
    expect(isScannableSource('src\\cli\\gateHook.ts')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* scanFileContent — depth invariant                                          */
/* -------------------------------------------------------------------------- */

describe('codeSlopLinter — scanFileContent depth invariant', () => {
  it(`PASS: nested depth equal to limit (${MAX_NESTING_DEPTH}) is accepted`, () => {
    const violations = scanFileContent(deepBraces(MAX_NESTING_DEPTH), 'x.ts');
    const depthHits = violations.filter((v) => v.type === 'MAX_DEPTH_EXCEEDED');
    expect(depthHits).toEqual([]);
  });

  it(`FAIL: nested depth one beyond limit (${MAX_NESTING_DEPTH + 1}) raises MAX_DEPTH_EXCEEDED`, () => {
    const violations = scanFileContent(deepBraces(MAX_NESTING_DEPTH + 1), 'deep.ts');
    const depthHits = violations.filter((v) => v.type === 'MAX_DEPTH_EXCEEDED');
    expect(depthHits.length).toBeGreaterThanOrEqual(1);
    expect(depthHits[0]?.detail).toMatch(/exceeds limit/);
  });
});

/* -------------------------------------------------------------------------- */
/* scanFileContent — block effective-line invariant                           */
/* -------------------------------------------------------------------------- */

describe('codeSlopLinter — scanFileContent block effective-lines invariant', () => {
  it(`PASS: block with exactly ${MAX_BLOCK_LINES} effective lines is accepted`, () => {
    const violations = scanFileContent(blockWithEffectiveLines(MAX_BLOCK_LINES), 'fat.ts');
    const blockHits = violations.filter((v) => v.type === 'MAX_BLOCK_LINES_EXCEEDED');
    expect(blockHits).toEqual([]);
  });

  it(`FAIL: block with ${MAX_BLOCK_LINES + 1} effective lines is rejected`, () => {
    const violations = scanFileContent(blockWithEffectiveLines(MAX_BLOCK_LINES + 1), 'fat.ts');
    const blockHits = violations.filter((v) => v.type === 'MAX_BLOCK_LINES_EXCEEDED');
    expect(blockHits.length).toBeGreaterThanOrEqual(1);
    expect(blockHits[0]?.detail).toMatch(/effective lines/);
  });

  it('blank lines and pure-comment lines are NOT counted as effective', () => {
    const padded = `function a() {\n` + '\n//comment\n//comment\n'.repeat(100) + `}`;
    const violations = scanFileContent(padded, 'padded.ts');
    expect(violations).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* scanFileContent — string / comment escape                                  */
/* -------------------------------------------------------------------------- */

describe('codeSlopLinter — string / comment escape (false-positive defense)', () => {
  it('braces inside a double-quoted string do NOT push depth', () => {
    const src = `function a() { const s = "{{{{{{{{{{{}}}}}}}}}}}}"; }`;
    expect(scanFileContent(src, 'str.ts')).toEqual([]);
  });

  it('braces inside a single-quoted string do NOT push depth', () => {
    const src = `function a() { const s = '{{{{{{{{{{}}}}}}}}}}'; }`;
    expect(scanFileContent(src, 'str.ts')).toEqual([]);
  });

  it('braces inside a backtick template literal do NOT push depth (template hole opaque per spec)', () => {
    const src = `function a() { const s = \`{{{{{\${x.y.z.w.v}}}}}}\`; }`;
    expect(scanFileContent(src, 'tpl.ts')).toEqual([]);
  });

  it('braces inside a line comment do NOT push depth', () => {
    const src = `function a() { // {{{{{}}}}}\n}`;
    expect(scanFileContent(src, 'lc.ts')).toEqual([]);
  });

  it('braces inside a block comment do NOT push depth', () => {
    const src = `function a() {\n/* {{{{{}}}}} */\n}`;
    expect(scanFileContent(src, 'bc.ts')).toEqual([]);
  });

  it('escaped quote in a string does not prematurely terminate the string', () => {
    const src = `function a() { const s = "\\"{{{{{}}}}}\\""; }`;
    expect(scanFileContent(src, 'esc.ts')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* CRLF compatibility                                                         */
/* -------------------------------------------------------------------------- */

describe('codeSlopLinter — CRLF line ending compatibility', () => {
  it('CRLF and LF produce identical results for the depth check', () => {
    const lf = deepBraces(MAX_NESTING_DEPTH + 1);
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(scanFileContent(lf, 'x.ts').length).toBe(scanFileContent(crlf, 'x.ts').length);
  });
});

/* -------------------------------------------------------------------------- */
/* analyzeCodeSlop — file-set orchestration                                   */
/* -------------------------------------------------------------------------- */

describe('codeSlopLinter — analyzeCodeSlop file-set orchestration', () => {
  it('skips non-.ts/.js paths entirely (zero file reads, zero violations)', () => {
    const reader: FileReader = () => {
      throw new Error('should not be called for non-scannable extensions');
    };
    const report = analyzeCodeSlop(
      ['README.md', 'package.json', '.github/workflows/ci.yml'],
      '/fake/root',
      reader,
    );
    expect(report.scannedFiles).toEqual([]);
    expect(report.violations).toEqual([]);
  });

  it('silently skips files that fail to read (e.g. deleted files reported by git diff)', () => {
    const reader: FileReader = () => {
      throw new Error('ENOENT');
    };
    const report = analyzeCodeSlop(['src/gone.ts'], '/fake/root', reader);
    expect(report.scannedFiles).toEqual(['src/gone.ts']);
    expect(report.violations).toEqual([]);
  });

  it('aggregates violations across multiple files in a single report', () => {
    const reader = makeFileReader({
      'src/clean.ts': 'function a() { return 1; }',
      'src/deep.ts': deepBraces(MAX_NESTING_DEPTH + 2),
      'src/fat.ts': blockWithEffectiveLines(MAX_BLOCK_LINES + 5),
    });
    const report = analyzeCodeSlop(
      ['src/clean.ts', 'src/deep.ts', 'src/fat.ts'],
      '/fake/root',
      reader,
    );
    expect(report.scannedFiles.length).toBe(3);
    const deepHits = report.violations.filter((v) => v.filePath === 'src/deep.ts');
    const fatHits = report.violations.filter((v) => v.filePath === 'src/fat.ts');
    const cleanHits = report.violations.filter((v) => v.filePath === 'src/clean.ts');
    expect(deepHits.length).toBeGreaterThanOrEqual(1);
    expect(fatHits.length).toBeGreaterThanOrEqual(1);
    expect(cleanHits).toEqual([]);
  });

  it('returns clean report when all scanned files are within geometric limits', () => {
    const reader = makeFileReader({
      'src/a.ts': `function a() { return 1; }`,
      'src/b.ts': `function b() { return 2; }`,
    });
    const report = analyzeCodeSlop(['src/a.ts', 'src/b.ts'], '/fake/root', reader);
    expect(report.violations).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* formatSlopError — diagnostic message                                       */
/* -------------------------------------------------------------------------- */

describe('codeSlopLinter — formatSlopError diagnostic', () => {
  it('renders [CODE_SLOP_DETECTED] header with per-violation bullets including file path and type', () => {
    const reader = makeFileReader({
      'src/deep.ts': deepBraces(MAX_NESTING_DEPTH + 1),
    });
    const report = analyzeCodeSlop(['src/deep.ts'], '/fake/root', reader);
    const msg = formatSlopError(report);
    expect(msg).toContain('[CODE_SLOP_DETECTED]');
    expect(msg).toContain('src/deep.ts');
    expect(msg).toContain('MAX_DEPTH_EXCEEDED');
  });
});
