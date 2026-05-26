import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lifecycleMatrixRule } from '../../src/linter/rules/lifecycleMatrix.js';
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

describe('R1 Lifecycle Matrix', () => {
  it('FAIL: handoff mentioned without delivery contract (Pattern A)', () => {
    const doc = loadFixture('r1_bad_handoff_no_contract.md');
    const findings = lifecycleMatrixRule.run(doc);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const a = findings.find((f) => /交接契約檔/.test(f.suggestion));
    expect(a).toBeDefined();
    expect(a?.severity).toBe('FAIL');
    expect(a?.ruleId).toBe('R1_LIFECYCLE_MATRIX');
  });

  it('FAIL: bidirectional role flow without termination (Pattern B)', () => {
    const doc = loadFixture('r1_bad_bidirectional.md');
    const findings = lifecycleMatrixRule.run(doc);
    const b = findings.find((f) => /雙向流轉/.test(f.suggestion));
    expect(b).toBeDefined();
    expect(b?.severity).toBe('FAIL');
  });

  it('CLEAN: explicit contract + termination condition yields no findings', () => {
    const doc = loadFixture('r1_clean.md');
    const findings = lifecycleMatrixRule.run(doc);
    expect(findings).toHaveLength(0);
  });

  it('BOUNDARY: file with no handoff and no role transition is silent', () => {
    const doc = loadFixture('r1_boundary_no_handoff.md');
    const findings = lifecycleMatrixRule.run(doc);
    expect(findings).toHaveLength(0);
  });
});
