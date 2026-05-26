import type { LintFinding, RuleModule, SpecDocument } from '../types.js';

const ROLE_TOKENS = ['Builder', 'Tester', 'Architect', 'PM', 'Liaison'] as const;
const HANDOFF_TOKENS = ['交棒', '交接', '移交', '交給', 'handover', 'Handover', 'hand off', 'hand-off', '➔', '➜', '→', '->'];
const CONTRACT_PATTERNS = [
  /shared\/[A-Za-z0-9_-]+\.json/,
  /tester_input\.json/i,
  /builder_out\.json/i,
  /\.status_[a-z]+/i,
];
const TERMINATION_TOKENS = [
  '終止條件', '終止', '上限', '重試上限', '最多', 'retry limit', 'max retries', 'termination', 'terminate',
];

interface RoleEdge {
  from: string;
  to: string;
  line: number;
}

function findRoleEdges(doc: SpecDocument): RoleEdge[] {
  const edges: RoleEdge[] = [];
  const arrow = /\[?([A-Z][a-zA-Z]+)\]?\s*(?:➔|➜|→|->|—>)\s*\[?([A-Z][a-zA-Z]+)\]?/g;
  for (let i = 0; i < doc.lines.length; i++) {
    const line = doc.lines[i] ?? '';
    let m: RegExpExecArray | null;
    arrow.lastIndex = 0;
    while ((m = arrow.exec(line)) !== null) {
      const from = m[1];
      const to = m[2];
      if (!from || !to) continue;
      if (ROLE_TOKENS.includes(from as typeof ROLE_TOKENS[number]) && ROLE_TOKENS.includes(to as typeof ROLE_TOKENS[number])) {
        edges.push({ from, to, line: i + 1 });
      }
    }
  }
  return edges;
}

function mentionsHandoff(doc: SpecDocument): boolean {
  return HANDOFF_TOKENS.some((t) => doc.content.includes(t));
}

function mentionsContract(doc: SpecDocument): boolean {
  return CONTRACT_PATTERNS.some((re) => re.test(doc.content));
}

function mentionsTermination(doc: SpecDocument): boolean {
  return TERMINATION_TOKENS.some((t) => doc.content.toLowerCase().includes(t.toLowerCase()));
}

function findFirstHandoffLine(doc: SpecDocument): number {
  for (let i = 0; i < doc.lines.length; i++) {
    const ln = doc.lines[i] ?? '';
    if (HANDOFF_TOKENS.some((t) => ln.includes(t))) return i + 1;
  }
  return 1;
}

function run(doc: SpecDocument): LintFinding[] {
  const findings: LintFinding[] = [];

  // Pattern A — handoff mentioned without delivery contract.
  if (mentionsHandoff(doc) && !mentionsContract(doc)) {
    const line = findFirstHandoffLine(doc);
    findings.push({
      ruleId: 'R1_LIFECYCLE_MATRIX',
      severity: 'FAIL',
      file: doc.path,
      line,
      snippet: (doc.lines[line - 1] ?? '').trim().slice(0, 200),
      suggestion:
        '此檔案敘述角色交棒，但缺少結構化交接契約檔（如 `shared/tester_input.json`）。請在交棒段落明確指名交接資料檔路徑。',
    });
  }

  // Pattern B — bidirectional role transition without termination condition.
  const edges = findRoleEdges(doc);
  if (edges.length > 0 && !mentionsTermination(doc)) {
    const seen = new Map<string, RoleEdge>();
    for (const e of edges) {
      const reverse = `${e.to}->${e.from}`;
      const forward = `${e.from}->${e.to}`;
      const opposite = seen.get(reverse);
      if (opposite) {
        findings.push({
          ruleId: 'R1_LIFECYCLE_MATRIX',
          severity: 'FAIL',
          file: doc.path,
          line: e.line,
          snippet: (doc.lines[e.line - 1] ?? '').trim().slice(0, 200),
          suggestion: `偵測到 ${e.from} ↔ ${e.to} 雙向流轉但未定義終止條件或重試上限；請補上 "termination" / "重試上限 ≤ N" 等明確限制。`,
        });
        break;
      }
      seen.set(forward, e);
    }
  }

  return findings;
}

export const lifecycleMatrixRule: RuleModule = {
  id: 'R1_LIFECYCLE_MATRIX',
  title: 'Lifecycle Matrix — 角色狀態轉移死循環',
  description:
    '攔截：(A) 描述角色交棒但缺少交接資料契約檔；(B) 角色雙向流轉而無終止條件或重試上限。',
  run,
};
