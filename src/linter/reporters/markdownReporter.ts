import type { LintFinding, RuleModule } from '../types.js';

export interface ReportContext {
  generatedAt: string;
  inputRoot: string;
  totalFiles: number;
  rules: RuleModule[];
}

export function renderMarkdownReport(findings: LintFinding[], ctx: ReportContext): string {
  const failCount = findings.filter((f) => f.severity === 'FAIL').length;
  const warnCount = findings.filter((f) => f.severity === 'WARN').length;

  const byRule = new Map<string, LintFinding[]>();
  for (const f of findings) {
    const list = byRule.get(f.ruleId) ?? [];
    list.push(f);
    byRule.set(f.ruleId, list);
  }

  const lines: string[] = [];
  lines.push('# Specification Linter — 第一階段偵察報告');
  lines.push('');
  lines.push(`- **產生時間**：${ctx.generatedAt}`);
  lines.push(`- **掃描範圍**：\`${ctx.inputRoot}\``);
  lines.push(`- **掃描檔案數**：${ctx.totalFiles}`);
  lines.push(`- **Total Findings**：${findings.length}（FAIL=${failCount}, WARN=${warnCount}）`);
  lines.push('');

  lines.push('## 規則總覽');
  lines.push('');
  lines.push('| Rule ID | 名稱 | 命中數 |');
  lines.push('|---|---|---|');
  for (const rule of ctx.rules) {
    const count = byRule.get(rule.id)?.length ?? 0;
    lines.push(`| ${rule.id} | ${rule.title} | ${count} |`);
  }
  lines.push('');

  if (findings.length === 0) {
    lines.push('> 沙盒輸入源未觸發任何規則。Linter 對人工缺陷樣本的攔截率仍須以 Vitest 結果為準。');
    lines.push('');
    return lines.join('\n');
  }

  for (const rule of ctx.rules) {
    const items = byRule.get(rule.id) ?? [];
    if (items.length === 0) continue;
    lines.push(`## ${rule.id} — ${rule.title}`);
    lines.push('');
    lines.push(`> ${rule.description}`);
    lines.push('');
    lines.push('| # | Severity | File | Line | Snippet | Suggestion |');
    lines.push('|---|---|---|---|---|---|');
    items.forEach((f, idx) => {
      const snippet = escapePipe(f.snippet || '(empty)');
      const suggestion = escapePipe(f.suggestion);
      lines.push(`| ${idx + 1} | ${f.severity} | \`${f.file}\` | ${f.line} | ${snippet} | ${suggestion} |`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ⏎ ');
}
