import type { LintFinding, RuleModule, SpecDocument } from '../types.js';

const ROLE_KEYWORDS = [
  'Builder', 'Tester', 'Architect', 'PM', 'Liaison',
  '代理人', '角色', 'agent', 'Agent', 'LLM', 'Prompt', 'prompt', '提示詞',
];
const PROMPT_DIR_PATTERNS = [
  /prompts\//,
  /`prompts`/,
  /提示詞外部化/,
  /Prompt 外部化/i,
  /外部化.*Prompt/i,
  /externali[sz]e.*prompt/i,
];
const SYSTEM_PROMPT_PATTERNS = [/system prompt/i, /系統提示詞/, /System Prompt/];
const EXTERNAL_TOKENS = [
  'prompts/', '外部化', 'externali', '去字串化', 'load from file', '讀取自', '檔案讀取', 'readFile',
];
const FENCE_LINE_THRESHOLD = 8;

function fileMentionsRoles(doc: SpecDocument): boolean {
  return ROLE_KEYWORDS.some((k) => doc.content.includes(k));
}

function fileMentionsPromptsDir(doc: SpecDocument): boolean {
  return PROMPT_DIR_PATTERNS.some((re) => re.test(doc.content));
}

interface FenceBlock {
  startLine: number; // 1-indexed line of the opening fence
  endLine: number; // 1-indexed line of the closing fence
  bodyLines: number; // number of content lines between fences (excluding the fences themselves)
  type: 'fence' | 'quote';
}

function findFenceBlocks(doc: SpecDocument): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  let openLine = -1;
  for (let i = 0; i < doc.lines.length; i++) {
    const ln = doc.lines[i] ?? '';
    if (/^\s*```/.test(ln)) {
      if (openLine === -1) {
        openLine = i;
      } else {
        blocks.push({
          startLine: openLine + 1,
          endLine: i + 1,
          bodyLines: i - openLine - 1,
          type: 'fence',
        });
        openLine = -1;
      }
    }
  }
  return blocks;
}

function findQuoteBlocks(doc: SpecDocument): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  let start = -1;
  let count = 0;
  const flush = (endIdx: number) => {
    if (start !== -1 && count > 0) {
      blocks.push({
        startLine: start + 1,
        endLine: endIdx,
        bodyLines: count,
        type: 'quote',
      });
    }
    start = -1;
    count = 0;
  };
  for (let i = 0; i < doc.lines.length; i++) {
    const ln = doc.lines[i] ?? '';
    if (/^\s*>/.test(ln)) {
      if (start === -1) start = i;
      count++;
    } else {
      flush(i);
    }
  }
  flush(doc.lines.length);
  return blocks;
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

  // Pattern A — role-responsibility document but no prompts/ externalization requirement.
  if (fileMentionsRoles(doc) && !fileMentionsPromptsDir(doc)) {
    findings.push({
      ruleId: 'R2_PROMPT_INLINE_STRAGGLERS',
      severity: 'FAIL',
      file: doc.path,
      line: 1,
      snippet: (doc.lines[0] ?? '').trim().slice(0, 200),
      suggestion:
        '檔案描述代理人角色/提示詞，但全文未要求 `prompts/` 目錄或提示詞外部化；請補上「所有 System Prompt 必須外置於 `prompts/`」條款。',
    });
  }

  // Pattern B — System Prompt mention without governance in the same paragraph.
  for (let i = 0; i < doc.lines.length; i++) {
    const ln = doc.lines[i] ?? '';
    if (SYSTEM_PROMPT_PATTERNS.some((re) => re.test(ln))) {
      const para = paragraphAround(doc, i).toLowerCase();
      const governed = EXTERNAL_TOKENS.some((t) => para.includes(t.toLowerCase()));
      if (!governed) {
        findings.push({
          ruleId: 'R2_PROMPT_INLINE_STRAGGLERS',
          severity: 'FAIL',
          file: doc.path,
          line: i + 1,
          snippet: ln.trim().slice(0, 200),
          suggestion:
            '此處提到 System Prompt 但同段未要求外部化（缺少 `prompts/` / 外部化 / load from file 等關鍵字）。',
        });
      }
    }
  }

  // Pattern C — long fenced or quote blocks suspected of hard-coding prompts.
  const blocks = [...findFenceBlocks(doc), ...findQuoteBlocks(doc)];
  for (const b of blocks) {
    if (b.bodyLines > FENCE_LINE_THRESHOLD) {
      findings.push({
        ruleId: 'R2_PROMPT_INLINE_STRAGGLERS',
        severity: 'WARN',
        file: doc.path,
        line: b.startLine,
        snippet: (doc.lines[b.startLine - 1] ?? '').trim().slice(0, 200),
        suggestion: `偵測到長度 ${b.bodyLines} 行的 ${b.type === 'fence' ? '程式碼圍欄' : '引號區塊'}（>${FENCE_LINE_THRESHOLD}），疑似內嵌 Prompt；請評估抽出至 \`prompts/\` 目錄。`,
      });
    }
  }

  return findings;
}

export const promptInlineStragglersRule: RuleModule = {
  id: 'R2_PROMPT_INLINE_STRAGGLERS',
  title: 'Prompt Inline Stragglers — 提示詞外部化漏勾',
  description:
    '攔截：(A) 角色職責文件未要求 `prompts/` 目錄；(B) System Prompt 提及但同段未強制外部化；(C) 內嵌 >8 行的程式碼圍欄或引號區塊疑似硬編碼 Prompt。',
  run,
};
