import type { LintFinding, RuleModule, SpecDocument } from '../types.js';

const SUBJECTIVE_PATTERNS = [
  /\bPass\b/i,
  /\bDone\b/i,
  /完成/,
  /通過/,
  /驗收/,
  /合格/,
];
const HARD_EVIDENCE_PATTERNS = [
  /<Execution_Evidence>/i,
  /Execution_Evidence/,
  /Terminal\s*Log/i,
  /終端機.*(Log|輸出|證據)/,
  /exit\s*code/i,
  /screenshot/i,
  /截圖/,
  /shared\/[A-Za-z0-9_-]+_out\.json/,
  /shared\/[A-Za-z0-9_-]+\.json/,
  /stdout/i,
  /stderr/i,
  /coverage/i,
  /覆蓋率/,
];
const DEFINITION_CUES = [
  '定義', '條件', '門檻', '驗收', 'AC', 'Acceptance', '標準', 'criteria', 'Criteria',
  '唯一合法條件', '前提', '才可', '才能', 'only when', 'iff',
];

function isDefinitionContext(line: string, prev: string, next: string): boolean {
  const blob = `${prev}\n${line}\n${next}`;
  return DEFINITION_CUES.some((c) => blob.includes(c));
}

function isInsideFence(doc: SpecDocument, lineIdx0: number): boolean {
  let open = false;
  for (let i = 0; i < lineIdx0; i++) {
    if (/^\s*```/.test(doc.lines[i] ?? '')) open = !open;
  }
  return open;
}

function paragraphAround(doc: SpecDocument, lineIdx0: number): string {
  let start = lineIdx0;
  let end = lineIdx0;
  while (start > 0 && (doc.lines[start - 1] ?? '').trim() !== '') start--;
  while (end < doc.lines.length - 1 && (doc.lines[end + 1] ?? '').trim() !== '') end++;
  return doc.lines.slice(start, end + 1).join('\n');
}

function run(doc: SpecDocument): LintFinding[] {
  const findings: LintFinding[] = [];

  for (let i = 0; i < doc.lines.length; i++) {
    const ln = doc.lines[i] ?? '';
    // Skip markdown headings — a heading by itself is a section title, not an
    // acceptance-criterion body. The actual evidence requirement, if any,
    // lives in the section's body and will be evaluated on those lines.
    if (/^\s{0,3}#{1,6}\s/.test(ln)) continue;
    // Skip lines inside fenced code blocks — illustrative examples, not
    // normative acceptance text.
    if (isInsideFence(doc, i)) continue;
    const subjective = SUBJECTIVE_PATTERNS.some((re) => re.test(ln));
    if (!subjective) continue;

    const prev = doc.lines[i - 1] ?? '';
    const next = doc.lines[i + 1] ?? '';
    if (!isDefinitionContext(ln, prev, next)) continue;

    const para = paragraphAround(doc, i);
    const hasHardEvidence = HARD_EVIDENCE_PATTERNS.some((re) => re.test(para));
    if (hasHardEvidence) continue;

    findings.push({
      ruleId: 'R3_EVIDENCE_CONTRACT',
      severity: 'FAIL',
      file: doc.path,
      line: i + 1,
      snippet: ln.trim().slice(0, 200),
      suggestion:
        '此條 Pass/完成/通過 定義缺少硬指標機器證據；請補上 <Execution_Evidence> / Terminal Log / exit code / screenshot path / `shared/*_out.json` 任一項。',
    });
  }

  return findings;
}

export const evidenceContractRule: RuleModule = {
  id: 'R3_EVIDENCE_CONTRACT',
  title: 'Evidence Contract — 機器證據契約不變式',
  description:
    '攔截：任務 Pass / Done / 完成 / 通過 的定義段落中，未含 <Execution_Evidence> / Terminal Log / exit code / screenshot / shared/*.json 等硬指標。',
  run,
};
