import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateHandoffData } from '../../src/validator/schemaValidator.js';
import { AI_SOP_STATE_MACHINE } from '../../src/config/agentWorkflowRegistry.js';

/**
 * Each test runs against a temporary workspace root so we can fabricate
 * artifact files and a prompts/ directory on demand. This keeps the real
 * sandbox state independent from validator tests.
 */
let WORKSPACE: string;
const LONG_LOG = [
  '$ npm test',
  '> vitest run',
  '',
  ' Test Files  4 passed (4)',
  '      Tests  13 passed (13)',
  'exit 0',
].join('\n');

function ensureArtifact(role: keyof typeof AI_SOP_STATE_MACHINE): void {
  const rel = AI_SOP_STATE_MACHINE[role].delivery_schema.artifact_path;
  const abs = join(WORKSPACE, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, '{}', 'utf8');
}

beforeAll(() => {
  WORKSPACE = mkdtempSync(join(tmpdir(), 'uasc-validator-'));
  mkdirSync(join(WORKSPACE, 'prompts'), { recursive: true });
  // Materialize every role's artifact path so they can be tested independently.
  (Object.keys(AI_SOP_STATE_MACHINE) as Array<keyof typeof AI_SOP_STATE_MACHINE>).forEach(
    ensureArtifact,
  );
});

afterAll(() => {
  rmSync(WORKSPACE, { recursive: true, force: true });
});

describe('validateHandoffData — happy paths', () => {
  it('PASS: Builder handoff with prompts dir + evidence log + valid next_role', () => {
    const result = validateHandoffData(
      {
        prompts_directory_path: 'prompts',
        execution_evidence_log: LONG_LOG,
        next_role: 'Tester',
      },
      'Builder',
      { workspaceRoot: WORKSPACE },
    );
    expect(result).toEqual({ success: true, errors: [] });
  });

  it('PASS: Tester handoff with prompts dir + evidence log (no next_role)', () => {
    const result = validateHandoffData(
      {
        prompts_directory_path: 'prompts',
        execution_evidence_log: LONG_LOG,
      },
      'Tester',
      { workspaceRoot: WORKSPACE },
    );
    expect(result.success).toBe(true);
  });

  it('PASS: PM handoff cleanly accepts allowed next_role=Architect', () => {
    const result = validateHandoffData(
      {
        prompts_directory_path: 'prompts',
        execution_evidence_log: LONG_LOG,
        next_role: 'Architect',
      },
      'PM',
      { workspaceRoot: WORKSPACE },
    );
    expect(result.success).toBe(true);
  });
});

describe('validateHandoffData — evidence contract failures', () => {
  it('FAIL: missing execution_evidence_log (R3 invariant)', () => {
    const result = validateHandoffData(
      { prompts_directory_path: 'prompts' },
      'Builder',
      { workspaceRoot: WORKSPACE },
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => /execution_evidence_log/.test(e))).toBe(true);
  });

  it('FAIL: execution_evidence_log too short (under 32 chars)', () => {
    const result = validateHandoffData(
      {
        prompts_directory_path: 'prompts',
        execution_evidence_log: 'ok',
      },
      'Builder',
      { workspaceRoot: WORKSPACE },
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => /shorter than/.test(e))).toBe(true);
  });

  it('FAIL: execution_evidence_log of wrong type', () => {
    const result = validateHandoffData(
      {
        prompts_directory_path: 'prompts',
        execution_evidence_log: 12345,
      },
      'Builder',
      { workspaceRoot: WORKSPACE },
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => /execution_evidence_log/.test(e))).toBe(true);
  });
});

describe('validateHandoffData — prompts externalization failures', () => {
  it('FAIL: missing prompts_directory_path (R2 invariant)', () => {
    const result = validateHandoffData(
      { execution_evidence_log: LONG_LOG },
      'Builder',
      { workspaceRoot: WORKSPACE },
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => /prompts_directory_path/.test(e))).toBe(true);
  });

  it('FAIL: prompts_directory_path points to a non-existent folder', () => {
    const result = validateHandoffData(
      {
        prompts_directory_path: 'no_such_dir_xyz',
        execution_evidence_log: LONG_LOG,
      },
      'Builder',
      { workspaceRoot: WORKSPACE },
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => /does not resolve to an existing directory/.test(e))).toBe(
      true,
    );
  });
});

describe('validateHandoffData — lifecycle / handoff failures', () => {
  it('FAIL: Builder → PM is cross-session unauthorized handoff (R1 invariant)', () => {
    const result = validateHandoffData(
      {
        prompts_directory_path: 'prompts',
        execution_evidence_log: LONG_LOG,
        next_role: 'PM',
      },
      'Builder',
      { workspaceRoot: WORKSPACE },
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => /cross-session unauthorized handoff/.test(e))).toBe(true);
  });

  it('FAIL: artifact_path file missing on disk', () => {
    // Use a fresh empty workspace where no artifact has been created.
    const empty = mkdtempSync(join(tmpdir(), 'uasc-empty-'));
    mkdirSync(join(empty, 'prompts'), { recursive: true });
    const result = validateHandoffData(
      {
        prompts_directory_path: 'prompts',
        execution_evidence_log: LONG_LOG,
      },
      'Builder',
      { workspaceRoot: empty },
    );
    expect(result.success).toBe(false);
    expect(
      result.errors.some((e) => /artifact_path .* does not exist/.test(e)),
    ).toBe(true);
    rmSync(empty, { recursive: true, force: true });
  });
});

describe('validateHandoffData — boundary cases', () => {
  it('FAIL: payload is null', () => {
    const result = validateHandoffData(null, 'Builder', { workspaceRoot: WORKSPACE });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/must be a non-null object/);
  });

  it('FAIL: payload is an array', () => {
    const result = validateHandoffData([], 'Builder', { workspaceRoot: WORKSPACE });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/must be a non-null object/);
  });

  it('FAIL: next_role of wrong type still rejected', () => {
    const result = validateHandoffData(
      {
        prompts_directory_path: 'prompts',
        execution_evidence_log: LONG_LOG,
        next_role: 42,
      },
      'Builder',
      { workspaceRoot: WORKSPACE },
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => /next_role must be a string/.test(e))).toBe(true);
  });
});
