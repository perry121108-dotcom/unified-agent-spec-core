import { readFileSync } from 'node:fs';
import type { AgentRole } from '../types/types.js';

/**
 * Spec Compiler — Markdown 治理檔 → 機讀交接數據物件。
 *
 * 解析合約：
 *   1. WORKLOG.md 以 `## ` 級別標題分隔每一個任務條目；最新條目 = 檔案中**最後**
 *      一個 `## ` 區塊（直到下一個 `## ` 或 EOF）。
 *   2. 角色辨識：在最新區塊內以
 *        - `next_role: <AgentRole>` （建議）
 *        - `next_role: <AgentRole>` （行內欄位形式）
 *        - 或 `**角色**：<AgentRole>` （Phase 1/2 既有 WORKLOG 慣例，作為當前角色）
 *      推導出 `current_role` 與 `next_role`。
 *   3. `<Execution_Evidence>` 區塊：找出緊接在 `<Execution_Evidence>` 文字之後的
 *      第一個 fenced code block（``` ... ```），其內容即 `execution_evidence_log`。
 *   4. `prompts_directory_path`：若最新區塊提到 `prompts/`，則 hint 為 `'prompts'`；
 *      若提到 `prompts_directory_path: <X>`，則使用 <X>。
 *
 *   本編譯器只負責**結構化映射**，不做檔案系統存在性檢查 — 那是 schemaValidator
 *   的職責，遵守單一職責原則。
 */
export interface CompiledHandoff {
  current_role?: AgentRole;
  next_role?: AgentRole;
  prompts_directory_path?: string;
  execution_evidence_log?: string;
  /** Title (text after `## `) of the latest WORKLOG section, for diagnostics. */
  source_section?: string;
}

const VALID_ROLES: ReadonlyArray<AgentRole> = ['PM', 'Architect', 'Builder', 'Tester', 'Liaison'];

function isAgentRole(s: string): s is AgentRole {
  return (VALID_ROLES as readonly string[]).includes(s);
}

export function extractLatestWorklogSection(worklog: string): { title: string; body: string } | null {
  // Split on `^## ` headings. Keep the LAST hit.
  const lines = worklog.split(/\r?\n/);
  let lastStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] ?? '';
    if (/^##\s+/.test(ln)) lastStart = i;
  }
  if (lastStart === -1) return null;
  const titleLine = lines[lastStart] ?? '';
  const title = titleLine.replace(/^##\s+/, '').trim();
  const body = lines.slice(lastStart + 1).join('\n');
  return { title, body };
}

export function extractExecutionEvidence(section: string): string | undefined {
  // Find `<Execution_Evidence>` marker (with or without surrounding emphasis),
  // then the FIRST fenced block after it.
  const markerRe = /<Execution_Evidence>/i;
  const m = markerRe.exec(section);
  if (!m) return undefined;
  const tail = section.slice(m.index + m[0].length);
  const fenceRe = /```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/;
  const fm = fenceRe.exec(tail);
  if (!fm) return undefined;
  return (fm[1] ?? '').trim();
}

export function extractNextRole(section: string): AgentRole | undefined {
  const inline = /next[_\s-]?role\s*[:=]\s*\[?\s*([A-Za-z]+)\s*\]?/i.exec(section);
  if (inline && inline[1]) {
    const cand = inline[1];
    if (isAgentRole(cand)) return cand;
  }
  return undefined;
}

export function extractCurrentRole(section: string): AgentRole | undefined {
  // Phase 1/2 WORKLOG convention: `- **角色**：Builder` or `**角色**: Builder`
  const cn = /\*\*角色\*\*\s*[:：]\s*\[?\s*([A-Za-z]+)\s*\]?/.exec(section);
  if (cn && cn[1] && isAgentRole(cn[1])) return cn[1];
  const en = /\*\*role\*\*\s*[:=]\s*\[?\s*([A-Za-z]+)\s*\]?/i.exec(section);
  if (en && en[1] && isAgentRole(en[1])) return en[1];
  return undefined;
}

export function extractPromptsDirectoryPath(section: string): string | undefined {
  const explicit = /prompts_directory_path\s*[:=]\s*["'`]?([^\s"'`]+)["'`]?/i.exec(section);
  if (explicit && explicit[1]) return explicit[1];
  // Implicit hint — any reference to `prompts/` defaults the path to "prompts".
  if (/\bprompts\//.test(section)) return 'prompts';
  return undefined;
}

export function compileMarkdownToHandoff(
  taskMdContent: string,
  worklogMdContent: string,
): CompiledHandoff {
  const latest = extractLatestWorklogSection(worklogMdContent);
  if (!latest) return {};

  const section = latest.body;
  const result: CompiledHandoff = { source_section: latest.title };

  const current = extractCurrentRole(section);
  if (current) result.current_role = current;

  const next = extractNextRole(section);
  if (next) result.next_role = next;

  const evidence = extractExecutionEvidence(section);
  if (evidence !== undefined) result.execution_evidence_log = evidence;

  // prompts_directory_path may also be hinted by TASK.md (cross-file fallback).
  const promptsDir =
    extractPromptsDirectoryPath(section) ?? extractPromptsDirectoryPath(taskMdContent);
  if (promptsDir) result.prompts_directory_path = promptsDir;

  return result;
}

/* -------------------------------------------------------------------------- */
/* Phase 6 — Market-Research FeatureSpec Bridge                                */
/* -------------------------------------------------------------------------- */

/**
 * Structured upstream payload produced by `market-research-ai` (or any
 * compatible producer). All fields are optional except `feature_id` and at
 * least one of `suggested_specifications` / `risk_pain_points` (validated by
 * {@link loadFeatureSpec}). Strings inside arrays may be plain text or short
 * objects with `{id, statement}` — both are accepted to keep the contract
 * tolerant of upstream schema drift.
 */
export interface FeatureSpec {
  feature_id: string;
  feature_title?: string;
  spec_version?: string;
  generated_at?: string;
  suggested_specifications?: ReadonlyArray<FeatureSpecItem>;
  risk_pain_points?: ReadonlyArray<FeatureSpecItem>;
}

export type FeatureSpecItem = string | { id?: string; statement: string; severity?: string };

const FEATURE_SPEC_AC_BEGIN = '<!-- agent-core:feature-spec-ac:begin -->';
const FEATURE_SPEC_AC_END = '<!-- agent-core:feature-spec-ac:end -->';

function normalizeItem(item: FeatureSpecItem, fallbackId: string): { id: string; statement: string; severity?: string } {
  if (typeof item === 'string') {
    return { id: fallbackId, statement: item.trim() };
  }
  const statement = (item.statement ?? '').trim();
  const out: { id: string; statement: string; severity?: string } = {
    id: (item.id ?? fallbackId).trim() || fallbackId,
    statement,
  };
  if (item.severity) out.severity = item.severity;
  return out;
}

/**
 * Parse + minimally validate a `FeatureSpec.json` file from disk. Throws a
 * descriptive Error on missing file / malformed JSON / missing `feature_id` /
 * empty contract (neither suggested specs nor risk points present).
 */
export function loadFeatureSpec(path: string): FeatureSpec {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`[specCompiler] cannot read FeatureSpec at ${path}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`[specCompiler] FeatureSpec at ${path} is not valid JSON: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`[specCompiler] FeatureSpec at ${path} must be a JSON object.`);
  }
  const obj = parsed as Record<string, unknown>;
  const featureId = obj['feature_id'];
  if (typeof featureId !== 'string' || !featureId.trim()) {
    throw new Error(`[specCompiler] FeatureSpec at ${path} is missing required string field "feature_id".`);
  }
  const suggested = Array.isArray(obj['suggested_specifications'])
    ? (obj['suggested_specifications'] as FeatureSpecItem[])
    : undefined;
  const risks = Array.isArray(obj['risk_pain_points'])
    ? (obj['risk_pain_points'] as FeatureSpecItem[])
    : undefined;
  if ((!suggested || suggested.length === 0) && (!risks || risks.length === 0)) {
    throw new Error(
      `[specCompiler] FeatureSpec at ${path} must contain at least one non-empty array among "suggested_specifications" or "risk_pain_points".`,
    );
  }
  const out: FeatureSpec = { feature_id: featureId.trim() };
  if (typeof obj['feature_title'] === 'string') out.feature_title = obj['feature_title'] as string;
  if (typeof obj['spec_version'] === 'string') out.spec_version = obj['spec_version'] as string;
  if (typeof obj['generated_at'] === 'string') out.generated_at = obj['generated_at'] as string;
  if (suggested) out.suggested_specifications = suggested;
  if (risks) out.risk_pain_points = risks;
  return out;
}

/**
 * Compile a parsed FeatureSpec into a Markdown AC block suitable for direct
 * injection into TASK.md. The block is fenced by HTML comment markers so a
 * second pass can detect prior injection and stay idempotent.
 *
 * Layout:
 *   <!-- agent-core:feature-spec-ac:begin -->
 *   ## Upstream Acceptance Criteria — <feature_title or feature_id>
 *   > Source: market-research FeatureSpec (feature_id=…, spec_version=…)
 *
 *   ### Suggested Specifications (Hard AC)
 *   - [ ] **AC-FS-S1** …
 *
 *   ### Risk / Pain Points (Hard Block)
 *   - [ ] **AC-FS-R1** …
 *   <!-- agent-core:feature-spec-ac:end -->
 */
export function compileFeatureSpecToAcceptanceCriteria(spec: FeatureSpec): string {
  const title = spec.feature_title?.trim() || spec.feature_id;
  const meta = [
    `feature_id=${spec.feature_id}`,
    spec.spec_version ? `spec_version=${spec.spec_version}` : null,
    spec.generated_at ? `generated_at=${spec.generated_at}` : null,
  ]
    .filter((s): s is string => !!s)
    .join(', ');

  const lines: string[] = [];
  lines.push(FEATURE_SPEC_AC_BEGIN);
  lines.push(`## Upstream Acceptance Criteria — ${title}`);
  lines.push('');
  lines.push(`> Source: market-research FeatureSpec (${meta})`);
  lines.push('');

  if (spec.suggested_specifications && spec.suggested_specifications.length > 0) {
    lines.push('### Suggested Specifications (Hard AC)');
    lines.push('');
    spec.suggested_specifications.forEach((raw, idx) => {
      const item = normalizeItem(raw, `AC-FS-S${idx + 1}`);
      lines.push(`- [ ] **${item.id}** ${item.statement}`);
    });
    lines.push('');
  }

  if (spec.risk_pain_points && spec.risk_pain_points.length > 0) {
    lines.push('### Risk / Pain Points (Hard Block)');
    lines.push('');
    spec.risk_pain_points.forEach((raw, idx) => {
      const item = normalizeItem(raw, `AC-FS-R${idx + 1}`);
      const sev = item.severity ? ` _(severity: ${item.severity})_` : '';
      lines.push(`- [ ] **${item.id}**${sev} ${item.statement}`);
    });
    lines.push('');
  }

  lines.push(FEATURE_SPEC_AC_END);
  return lines.join('\n');
}

export const FEATURE_SPEC_AC_MARKERS = Object.freeze({
  begin: FEATURE_SPEC_AC_BEGIN,
  end: FEATURE_SPEC_AC_END,
});
