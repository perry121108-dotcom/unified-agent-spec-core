import { describe, it, expect } from 'vitest';
import {
  compileMarkdownToHandoff,
  extractLatestWorklogSection,
  extractExecutionEvidence,
  extractNextRole,
  extractCurrentRole,
  extractPromptsDirectoryPath,
} from '../../src/compiler/specCompiler.js';

const VALID_WORKLOG = `# WORKLOG

## 2026-05-01T00:00:00Z — Earlier entry

- **角色**：PM
- earlier content irrelevant

## 2026-05-26T05:55:00Z — Builder Session 啟動

- **角色**：Builder
- next_role: Tester
- prompts_directory_path: prompts

### \`<Execution_Evidence>\`

\`\`\`
$ npm test
> vitest run
 Test Files  5 passed (5)
      Tests  26 passed (26)
exit 0
\`\`\`

end of section.
`;

const TASK_MD_BASIC = `# TASK

- [/] T3.1 build compiler
- [/] T3.2 build gate hook
`;

describe('specCompiler — section extraction', () => {
  it('picks the LATEST `## ` section, not the earliest', () => {
    const section = extractLatestWorklogSection(VALID_WORKLOG);
    expect(section).not.toBeNull();
    expect(section?.title).toMatch(/Builder Session 啟動/);
    expect(section?.body).toContain('Tester');
    expect(section?.body).not.toContain('Earlier entry');
  });

  it('returns null when no `## ` heading exists', () => {
    expect(extractLatestWorklogSection('# only h1\n\nbody text')).toBeNull();
  });
});

describe('specCompiler — field extractors', () => {
  it('extracts next_role from inline field syntax', () => {
    expect(extractNextRole('blah\nnext_role: Tester\nblah')).toBe('Tester');
    expect(extractNextRole('next-role = Architect')).toBe('Architect');
  });

  it('rejects unknown roles in next_role field', () => {
    expect(extractNextRole('next_role: Wizard')).toBeUndefined();
  });

  it('extracts current_role from `**角色**：X` convention', () => {
    expect(extractCurrentRole('- **角色**：Builder')).toBe('Builder');
    expect(extractCurrentRole('- **角色**: Tester')).toBe('Tester');
  });

  it('extracts execution evidence from fenced block after marker', () => {
    const ev = extractExecutionEvidence(
      'preface\n<Execution_Evidence>\n\n```text\nhello\nworld\n```\nafter',
    );
    expect(ev).toBe('hello\nworld');
  });

  it('returns undefined when Execution_Evidence marker is missing', () => {
    expect(extractExecutionEvidence('no marker here, just text')).toBeUndefined();
  });

  it('extracts prompts_directory_path explicitly or via prompts/ hint', () => {
    expect(extractPromptsDirectoryPath('prompts_directory_path: my_prompts')).toBe('my_prompts');
    expect(extractPromptsDirectoryPath('all live under `prompts/`')).toBe('prompts');
    expect(extractPromptsDirectoryPath('totally unrelated text')).toBeUndefined();
  });
});

describe('specCompiler — end-to-end compile', () => {
  it('compiles a fully-valid WORKLOG into a complete handoff payload', () => {
    const out = compileMarkdownToHandoff(TASK_MD_BASIC, VALID_WORKLOG);
    expect(out.current_role).toBe('Builder');
    expect(out.next_role).toBe('Tester');
    expect(out.prompts_directory_path).toBe('prompts');
    expect(out.execution_evidence_log).toContain('Tests  26 passed');
    expect(out.execution_evidence_log?.length ?? 0).toBeGreaterThanOrEqual(32);
    expect(out.source_section).toMatch(/Builder Session/);
  });

  it('returns an empty object when WORKLOG has no `## ` sections', () => {
    expect(compileMarkdownToHandoff(TASK_MD_BASIC, '')).toEqual({});
  });
});
