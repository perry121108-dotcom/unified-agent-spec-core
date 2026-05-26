import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promptInlineStragglersRule } from '../../src/linter/rules/promptInlineStragglers.js';
import type { SpecDocument } from '../../src/linter/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(here, 'fixtures');

function loadFixture(name: string): SpecDocument {
  const path = resolve(FIX, name);
  const content = readFileSync(path, 'utf8');
  return {
    path: `tests/linter/fixtures/${name}`,
    displayName: `fixtures/${name}`,
    content,
    lines: content.split(/\r?\n/),
  };
}

describe('R2 Prompt Inline Stragglers', () => {
  it('FAIL: role doc with no prompts/ directive (Pattern A)', () => {
    const doc = loadFixture('r2_bad_no_prompts_dir.md');
    const findings = promptInlineStragglersRule.run(doc);
    const a = findings.find((f) => /prompts\//.test(f.suggestion));
    expect(a).toBeDefined();
    expect(a?.severity).toBe('FAIL');
    expect(a?.ruleId).toBe('R2_PROMPT_INLINE_STRAGGLERS');
  });

  it('FAIL: System Prompt mention without externalization in same paragraph (Pattern B)', () => {
    const doc = loadFixture('r2_bad_system_prompt_inline.md');
    const findings = promptInlineStragglersRule.run(doc);
    const b = findings.find((f) => /同段未要求外部化/.test(f.suggestion));
    expect(b).toBeDefined();
    expect(b?.severity).toBe('FAIL');
  });

  it('WARN: code fence longer than 8 body lines (Pattern C)', () => {
    const doc = loadFixture('r2_bad_long_fence.md');
    const findings = promptInlineStragglersRule.run(doc);
    const c = findings.find((f) => /程式碼圍欄/.test(f.suggestion));
    expect(c).toBeDefined();
    expect(c?.severity).toBe('WARN');
  });

  it('CLEAN: prompts/ + externalization keyword + short fence yields no findings', () => {
    const doc = loadFixture('r2_clean.md');
    const findings = promptInlineStragglersRule.run(doc);
    expect(findings).toHaveLength(0);
  });
});
