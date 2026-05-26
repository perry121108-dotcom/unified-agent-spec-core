import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceContractRule } from '../../src/linter/rules/evidenceContract.js';
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

describe('R3 Evidence Contract', () => {
  it('FAIL: subjective Pass definition without machine evidence', () => {
    const doc = loadFixture('r3_bad_subjective.md');
    const findings = evidenceContractRule.run(doc);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.every((f) => f.ruleId === 'R3_EVIDENCE_CONTRACT')).toBe(true);
    expect(findings.every((f) => f.severity === 'FAIL')).toBe(true);
  });

  it('CLEAN: definition cites Execution_Evidence + exit code + shared/*.json', () => {
    const doc = loadFixture('r3_clean_hard_evidence.md');
    const findings = evidenceContractRule.run(doc);
    expect(findings).toHaveLength(0);
  });

  it('BOUNDARY: "Pass" outside acceptance-definition context is ignored', () => {
    const doc = loadFixture('r3_boundary_pass_outside_definition.md');
    const findings = evidenceContractRule.run(doc);
    expect(findings).toHaveLength(0);
  });
});
