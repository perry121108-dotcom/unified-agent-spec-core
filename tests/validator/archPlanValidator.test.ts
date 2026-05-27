import { describe, it, expect } from 'vitest';
import {
  assertArchPlanConsistency,
  filterCodeMutations,
  hasCheckedArchPlan,
} from '../../src/validator/archPlanValidator.js';

/* -------------------------------------------------------------------------- */
/* TASK.md fixture bodies                                                     */
/* -------------------------------------------------------------------------- */

const TASK_WITH_CHECKED_PLAN = `# TASK

## Phase 12

- [x] ARCH_PLAN phase-12: build the pre-flight gate itself
- [/] T12.1 ...
`;

const TASK_WITH_UNCHECKED_PLAN = `# TASK

## Phase 12

- [ ] ARCH_PLAN phase-12: not yet committed to
- [/] T12.1 ...
`;

const TASK_WITHOUT_PLAN = `# TASK

## Phase 12

- [/] T12.1 ...
- [/] T12.2 ...
`;

const TASK_WITH_LOWERCASE_KEYWORD = `# TASK
- [X] arch_plan phase-12: case-insensitive on both X and keyword
`;

const TASK_WITH_PROSE_MENTION = `# TASK

This phase will eventually require an ARCH_PLAN entry but none yet.

- [/] T12.1 ...
`;

/* -------------------------------------------------------------------------- */
/* filterCodeMutations — path classifier unit tests                           */
/* -------------------------------------------------------------------------- */

describe('archPlanValidator — filterCodeMutations (Phase 12 path classifier)', () => {
  it('classifies src/**/*.ts as code mutations', () => {
    expect(filterCodeMutations(['src/cli/gateHook.ts'])).toEqual(['src/cli/gateHook.ts']);
  });

  it('classifies tests/**/*.ts as code mutations', () => {
    expect(filterCodeMutations(['tests/validator/archPlanValidator.test.ts'])).toEqual([
      'tests/validator/archPlanValidator.test.ts',
    ]);
  });

  it('excludes TASK.md, WORKLOG.md, README.md at repo root', () => {
    expect(filterCodeMutations(['TASK.md', 'WORKLOG.md', 'README.md'])).toEqual([]);
  });

  it('excludes package.json, package-lock.json, .gitignore', () => {
    expect(
      filterCodeMutations(['package.json', 'package-lock.json', '.gitignore']),
    ).toEqual([]);
  });

  it('excludes shared/tester_input.json and other shared/* runtime artifacts', () => {
    expect(
      filterCodeMutations(['shared/tester_input.json', 'shared/pm_out.json']),
    ).toEqual([]);
  });

  it('excludes .github/workflows/*.yml — workflows live outside src/tests', () => {
    expect(filterCodeMutations(['.github/workflows/ci.yml'])).toEqual([]);
  });

  it('excludes .md files even when they sit inside src/ or tests/', () => {
    expect(
      filterCodeMutations(['src/templates/README.md', 'tests/fixtures/notes.md']),
    ).toEqual([]);
  });

  it('normalizes Windows-style backslashes so they classify identically to POSIX', () => {
    expect(filterCodeMutations(['src\\cli\\gateHook.ts'])).toEqual(['src/cli/gateHook.ts']);
  });

  it('dedups repeated paths', () => {
    expect(
      filterCodeMutations([
        'src/cli/gateHook.ts',
        'src/cli/gateHook.ts',
        'src/cli/gateHook.ts',
      ]),
    ).toEqual(['src/cli/gateHook.ts']);
  });
});

/* -------------------------------------------------------------------------- */
/* hasCheckedArchPlan — TASK.md scanner unit tests                            */
/* -------------------------------------------------------------------------- */

describe('archPlanValidator — hasCheckedArchPlan (Phase 12 plan scanner)', () => {
  it('detects a canonical `- [x] ARCH_PLAN ...` bullet', () => {
    expect(hasCheckedArchPlan(TASK_WITH_CHECKED_PLAN)).toBe(true);
  });

  it('refuses an unchecked `- [ ] ARCH_PLAN ...` bullet', () => {
    expect(hasCheckedArchPlan(TASK_WITH_UNCHECKED_PLAN)).toBe(false);
  });

  it('refuses TASK bodies with no ARCH_PLAN bullet at all', () => {
    expect(hasCheckedArchPlan(TASK_WITHOUT_PLAN)).toBe(false);
  });

  it('case-insensitive on both `[X]` and `arch_plan`', () => {
    expect(hasCheckedArchPlan(TASK_WITH_LOWERCASE_KEYWORD)).toBe(true);
  });

  it('refuses prose-only mentions of ARCH_PLAN without a `- ` list-marker prefix', () => {
    expect(hasCheckedArchPlan(TASK_WITH_PROSE_MENTION)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* assertArchPlanConsistency — integration hard gate                          */
/* -------------------------------------------------------------------------- */

describe('archPlanValidator — assertArchPlanConsistency (Phase 12 hard gate)', () => {
  it('PASS: only README.md modified → zero-misfire passthrough', () => {
    expect(() =>
      assertArchPlanConsistency(['README.md'], TASK_WITHOUT_PLAN),
    ).not.toThrow();
  });

  it('PASS: only TASK.md / WORKLOG.md modified → zero-misfire passthrough', () => {
    expect(() =>
      assertArchPlanConsistency(['TASK.md', 'WORKLOG.md'], TASK_WITHOUT_PLAN),
    ).not.toThrow();
  });

  it('PASS: empty change set → vacuous passthrough', () => {
    expect(() => assertArchPlanConsistency([], TASK_WITHOUT_PLAN)).not.toThrow();
  });

  it('PASS: src/ mutation + checked ARCH_PLAN → release', () => {
    expect(() =>
      assertArchPlanConsistency(
        ['src/cli/gateHook.ts'],
        TASK_WITH_CHECKED_PLAN,
      ),
    ).not.toThrow();
  });

  it('PASS: tests/ mutation + checked ARCH_PLAN → release', () => {
    expect(() =>
      assertArchPlanConsistency(
        ['tests/validator/archPlanValidator.test.ts'],
        TASK_WITH_CHECKED_PLAN,
      ),
    ).not.toThrow();
  });

  it('PASS: mixed docs + src/ + checked ARCH_PLAN → release', () => {
    expect(() =>
      assertArchPlanConsistency(
        ['TASK.md', 'README.md', 'src/cli/gateHook.ts'],
        TASK_WITH_CHECKED_PLAN,
      ),
    ).not.toThrow();
  });

  it('FAIL: src/ mutation + no ARCH_PLAN bullet → [ILLEGAL_MUTATION]', () => {
    expect(() =>
      assertArchPlanConsistency(['src/cli/gateHook.ts'], TASK_WITHOUT_PLAN),
    ).toThrowError(/\[ILLEGAL_MUTATION\]/);
  });

  it('FAIL: tests/ mutation + only unchecked plan → [ILLEGAL_MUTATION]', () => {
    expect(() =>
      assertArchPlanConsistency(
        ['tests/validator/archPlanValidator.test.ts'],
        TASK_WITH_UNCHECKED_PLAN,
      ),
    ).toThrowError(/\[ILLEGAL_MUTATION\]/);
  });

  it('FAIL: untracked brand-new file under src/ + no plan → [ILLEGAL_MUTATION]', () => {
    // The validator does not distinguish "tracked diff" vs. "untracked new
    // file" — that distinction is made upstream by getWorkspaceMutations.
    // From the validator's perspective, a path is a path.
    expect(() =>
      assertArchPlanConsistency(
        ['src/validator/somethingNew.ts'],
        TASK_WITHOUT_PLAN,
      ),
    ).toThrowError(/\[ILLEGAL_MUTATION\]/);
  });

  it('FAIL: error message embeds the offending code paths', () => {
    try {
      assertArchPlanConsistency(
        ['src/cli/gateHook.ts', 'tests/foo.test.ts'],
        TASK_WITHOUT_PLAN,
      );
      throw new Error('expected throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('[ILLEGAL_MUTATION]');
      expect(msg).toContain('src/cli/gateHook.ts');
      expect(msg).toContain('tests/foo.test.ts');
      expect(msg).toContain('ARCH_PLAN');
      expect(msg).toContain('TASK.md');
    }
  });

  it('FAIL: docs + src/ mixed change set still trips on the src/ mutation when no plan', () => {
    expect(() =>
      assertArchPlanConsistency(
        ['TASK.md', 'src/cli/gateHook.ts'],
        TASK_WITHOUT_PLAN,
      ),
    ).toThrowError(/\[ILLEGAL_MUTATION\]/);
  });

  it('PASS: case-insensitive ARCH_PLAN keyword accepted (uppercase [X], lowercase arch_plan)', () => {
    expect(() =>
      assertArchPlanConsistency(
        ['src/cli/gateHook.ts'],
        TASK_WITH_LOWERCASE_KEYWORD,
      ),
    ).not.toThrow();
  });
});
