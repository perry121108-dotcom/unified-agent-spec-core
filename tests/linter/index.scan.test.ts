import { describe, it, expect } from 'vitest';
import { scanDirectory, RULES } from '../../src/linter/index.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..');
const FIX = resolve(here, 'fixtures');

describe('Linter end-to-end on synthetic fixtures', () => {
  it('catches every synthetic defect fixture (100% capture rate)', () => {
    const { findings, totalFiles } = scanDirectory(FIX, ROOT);
    expect(totalFiles).toBeGreaterThanOrEqual(10);

    const expectFailFilePart = (part: string) => {
      const hits = findings.filter((f) => f.file.includes(part));
      expect(hits.length, `expected at least one finding in ${part}`).toBeGreaterThanOrEqual(1);
    };

    expectFailFilePart('r1_bad_handoff_no_contract');
    expectFailFilePart('r1_bad_bidirectional');
    expectFailFilePart('r2_bad_no_prompts_dir');
    expectFailFilePart('r2_bad_system_prompt_inline');
    expectFailFilePart('r2_bad_long_fence');
    expectFailFilePart('r3_bad_subjective');

    // No findings for the curated clean fixtures.
    const cleanFiles = [
      'r1_clean.md',
      'r1_boundary_no_handoff.md',
      'r2_clean.md',
      'r3_clean_hard_evidence.md',
      'r3_boundary_pass_outside_definition.md',
    ];
    for (const f of cleanFiles) {
      const hits = findings.filter((x) => x.file.endsWith(f));
      expect(hits, `clean fixture ${f} should have zero findings, got ${JSON.stringify(hits)}`).toHaveLength(0);
    }
  });

  it('exposes all three rule modules', () => {
    expect(RULES.map((r) => r.id).sort()).toEqual([
      'R1_LIFECYCLE_MATRIX',
      'R2_PROMPT_INLINE_STRAGGLERS',
      'R3_EVIDENCE_CONTRACT',
    ]);
  });
});
