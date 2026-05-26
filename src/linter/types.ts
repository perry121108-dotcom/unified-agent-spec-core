export type Severity = 'FAIL' | 'WARN';

export type RuleId =
  | 'R1_LIFECYCLE_MATRIX'
  | 'R2_PROMPT_INLINE_STRAGGLERS'
  | 'R3_EVIDENCE_CONTRACT';

export interface LintFinding {
  ruleId: RuleId;
  severity: Severity;
  file: string;
  line: number;
  snippet: string;
  suggestion: string;
}

export interface SpecDocument {
  /** Absolute or workspace-relative path. */
  path: string;
  /** Display name used in reports (basename + parent dir for disambiguation). */
  displayName: string;
  /** Full file content as a single string. */
  content: string;
  /** Pre-split lines (1-indexed when accessed as `lines[lineNumber-1]`). */
  lines: string[];
}

export interface RuleModule {
  id: RuleId;
  title: string;
  description: string;
  run: (doc: SpecDocument) => LintFinding[];
}
