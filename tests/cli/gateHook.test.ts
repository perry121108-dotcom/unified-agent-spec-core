import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';
import { pathToFileURL } from 'node:url';
import { runGate } from '../../src/cli/gateHook.js';

const PROJECT_ROOT = resolve(__dirname, '..', '..');
const GATE_SCRIPT = resolve(PROJECT_ROOT, 'src/cli/gateHook.ts');

/**
 * Absolute file:// URL of the tsx ESM loader inside this project's
 * node_modules. We pass this — not the bare `tsx` specifier — to Node's
 * `--import` so child-process resolution does not depend on the spawned
 * process's `cwd` having access to a `node_modules/tsx` package. The exports
 * map of tsx pins its `.` entry to `./dist/loader.mjs`, so this path is the
 * documented public surface.
 */
const TSX_LOADER_URL = pathToFileURL(
  resolve(PROJECT_ROOT, 'node_modules/tsx/dist/loader.mjs'),
).href;

/**
 * Spawn the gateHook TS source as a real child process via Node's native binary
 * (`process.execPath`) with the `--import <tsx-loader>` hook, completely
 * avoiding `shell: true` and the `tsx.cmd` shim. This eliminates the Node
 * DEP0190 informational warning on Windows and makes argv escape semantics
 * platform-uniform across Windows/macOS/Linux.
 */
function spawnGateScript(cwd: string) {
  return spawnSync(execPath, ['--import', TSX_LOADER_URL, GATE_SCRIPT], {
    cwd,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

/**
 * Phase-10-compliant synthetic vitest log. The semantic oracle requires:
 *   - canonical `Tests N passed (N)` summary line
 *   - exactly N `✓ tests/...` per-case markers
 *   - at least one `tests/.../*.test.ts` path reference
 * Per-case marker count (3) === declared total (3).
 */
const VALID_LOG = `$ npm test
> vitest run

 RUN  v1.6.1 D:/tmp/gate-fixture

 ✓ tests/cli/gateHook.test.ts > runGate — sample assertion A 1ms
 ✓ tests/cli/gateHook.test.ts > runGate — sample assertion B 0ms
 ✓ tests/cli/gateHook.test.ts > runGate — sample assertion C 1ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  120ms
exit 0`;

function writeWorklog(opts: {
  currentRole?: string;
  nextRole?: string;
  evidence?: string;
  includePrompts?: boolean;
}): string {
  const next = opts.nextRole !== undefined ? `- next_role: ${opts.nextRole}\n` : '';
  const current = opts.currentRole !== undefined ? `- **角色**：${opts.currentRole}\n` : '';
  const evidenceBlock =
    opts.evidence !== undefined
      ? `\n### \`<Execution_Evidence>\`\n\n\`\`\`\n${opts.evidence}\n\`\`\`\n`
      : '';
  const promptsHint = opts.includePrompts ? `- 所有 prompt 字串置於 \`prompts/\` 目錄\n` : '';
  return `# WORKLOG\n\n## 2026-05-26T05:55:00Z — Gate test\n\n${current}${next}${promptsHint}${evidenceBlock}`;
}

function setupWorkspace(opts: {
  currentRole?: string;
  nextRole?: string;
  evidence?: string;
  includePrompts?: boolean;
  artifactRole?: 'Builder' | 'Tester' | 'PM' | 'Architect' | 'Liaison' | 'none';
}): string {
  const ws = mkdtempSync(join(tmpdir(), 'uasc-gate-'));
  writeFileSync(join(ws, 'TASK.md'), '# TASK\n- [/] something\n', 'utf8');
  writeFileSync(join(ws, 'WORKLOG.md'), writeWorklog(opts), 'utf8');
  if (opts.includePrompts) mkdirSync(join(ws, 'prompts'), { recursive: true });
  mkdirSync(join(ws, 'shared'), { recursive: true });
  // Builder's delivery_schema.artifact_path = shared/tester_input.json
  const artifactRole = opts.artifactRole ?? 'Builder';
  if (artifactRole !== 'none') {
    const artifactByRole: Record<string, string> = {
      PM: 'shared/pm_out.json',
      Architect: 'shared/architect_out.json',
      Builder: 'shared/tester_input.json',
      Tester: 'shared/tester_out.json',
      Liaison: 'shared/liaison_out.json',
    };
    writeFileSync(join(ws, artifactByRole[artifactRole] as string), '{}', 'utf8');
  }
  return ws;
}

let workspaces: string[] = [];
afterEach(() => {
  for (const w of workspaces) rmSync(w, { recursive: true, force: true });
  workspaces = [];
});
beforeEach(() => {
  workspaces = [];
});

describe('runGate — programmatic core PASS path', () => {
  it('PASS: valid Builder→Tester payload → exitCode 0', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(0);
    expect(res.errors).toEqual([]);
    expect(res.role).toBe('Builder');
    // Stamping should have happened.
    const stamped = JSON.parse(readFileSync(join(ws, 'shared/tester_input.json'), 'utf8'));
    expect(stamped.latest_compiled_payload?.gate_role).toBe('Builder');
    expect(stamped.latest_compiled_payload?.next_role).toBe('Tester');
  });

});

describe('runGate — programmatic core FAIL paths (evidence)', () => {
  it('FAIL: short evidence log (<32 chars) is rejected — R3 or Phase 10 forgery oracle, exitCode 1', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: 'too short',
      includePrompts: true,
    });
    workspaces.push(ws);
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(1);
    // After Phase 10 the semantic oracle fires FIRST on short+structureless
    // evidence (correctly classifying it as forgery). R3 length check fires
    // only when evidence has Vitest fingerprint but body < 32 chars. Either
    // signal proves the gate rejected short evidence.
    expect(
      res.errors.some((e) => /shorter than/.test(e) || /CRITICAL_FORGERY/.test(e)),
    ).toBe(true);
  });

  it('FAIL: missing Execution_Evidence block triggers R3 error and exitCode 1', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      includePrompts: true,
    });
    workspaces.push(ws);
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(1);
    expect(res.errors.some((e) => /execution_evidence_log/.test(e))).toBe(true);
  });

});

describe('runGate — programmatic core FAIL paths (schema)', () => {
  it('FAIL: unauthorized next_role (Builder→PM) triggers R1 cross-session error', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'PM',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(1);
    expect(res.errors.some((e) => /cross-session unauthorized handoff/.test(e))).toBe(true);
  });

  it('FAIL: missing prompts/ directory triggers R2 error and exitCode 1', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: false, // no prompts dir + no prompts hint in WORKLOG
    });
    workspaces.push(ws);
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(1);
    expect(
      res.errors.some(
        (e) => /prompts_directory_path/.test(e) || /existing directory/.test(e),
      ),
    ).toBe(true);
  });

});

describe('runGate — programmatic core boundary conditions', () => {
  it('FAIL: TASK.md / WORKLOG.md missing in workspace', () => {
    const ws = mkdtempSync(join(tmpdir(), 'uasc-empty-gate-'));
    workspaces.push(ws);
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(1);
    expect(res.errors[0]).toMatch(/missing governance files/);
  });

  it('BOUNDARY: artifact file absent → exitCode 1 even with valid evidence', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
      artifactRole: 'none',
    });
    workspaces.push(ws);
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(1);
    expect(res.errors.some((e) => /artifact_path .* does not exist/.test(e))).toBe(true);
  });
});

const TASK_WITH_PLAN_PHASE12 =
  '# TASK\n- [x] ARCH_PLAN phase-12: build the gate\n- [/] T12.1\n';

describe('runGate — Phase 12 archPlan PASS paths', () => {
  it('PRE-FLIGHT PASS: src/ mutation declared via injected mutationsOverride + checked ARCH_PLAN in TASK.md → falls through to existing semantic gate', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    // Re-write TASK.md to include the checked ARCH_PLAN bullet so the
    // pre-flight gate releases.
    writeFileSync(join(ws, 'TASK.md'), TASK_WITH_PLAN_PHASE12, 'utf8');

    const res = runGate({
      workspaceRoot: ws,
      mutationsOverride: ['src/cli/gateHook.ts'],
      disableShadowWarrior: true, // Phase 14 isolation: this test focuses on Phase 12 archPlan
    });
    expect(res.exitCode).toBe(0);
    expect(res.errors).toEqual([]);
  });

  it('PRE-FLIGHT PASSTHROUGH: pure-docs mutation (TASK.md + WORKLOG.md) → does NOT trip ARCH_PLAN even without plan; standard handoff flow proceeds', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    // No ARCH_PLAN in TASK.md, but only docs are "mutated" — zero-misfire.

    const res = runGate({
      workspaceRoot: ws,
      mutationsOverride: ['TASK.md', 'WORKLOG.md', 'README.md'],
    });
    expect(res.exitCode).toBe(0);
    expect(res.errors).toEqual([]);
  });

  it('PRE-FLIGHT GRACEFUL DEGRADATION: when mutationsOverride is unset and workspaceRoot is not a git repo (mkdtempSync fixture), getWorkspaceMutations returns [] and the gate passes through transparently', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    // No mutationsOverride supplied — exercises the real getWorkspaceMutations
    // path. The tmp fixture is NOT a git repo, so git diff exits non-zero
    // and the merged path list is empty → ARCH_PLAN check is vacuous.
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(0);
    expect(res.errors).toEqual([]);
  });
});

describe('runGate — Phase 12 archPlan BLOCK paths', () => {
  it('PRE-FLIGHT BLOCK: src/ mutation injected but no ARCH_PLAN in TASK.md → exitCode 1, [ILLEGAL_MUTATION] error, no stamp written', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    // Default setupWorkspace TASK.md is `# TASK\n- [/] something\n` — no plan.

    const res = runGate({
      workspaceRoot: ws,
      mutationsOverride: ['src/cli/gateHook.ts', 'src/validator/archPlanValidator.ts'],
    });
    expect(res.exitCode).toBe(1);
    expect(res.errors[0]).toMatch(/\[ILLEGAL_MUTATION\]/);
    expect(res.errors[0]).toContain('src/cli/gateHook.ts');
    expect(res.errors[0]).toContain('ARCH_PLAN');
    // Critical: NO stamp written despite VALID_LOG being present — the
    // pre-flight aborted before the oracle even ran.
    const stamped = JSON.parse(
      readFileSync(join(ws, 'shared/tester_input.json'), 'utf8'),
    );
    expect(stamped.latest_compiled_payload).toBeUndefined();
  });
});

const TASK_WITH_PLAN_PHASE13 =
  '# TASK\n- [x] ARCH_PLAN phase-13: dogfood the new geometric gate\n- [/] T13.1\n';

/** Builds an artificially nested slop fixture: `function a(){{{{{{}}}}}}`. */
function deepSlopFixture(): string {
  return 'function evil() {{{{{{}}}}}}\n'; // 6 opens = depth-6 violation
}

describe('runGate — Phase 13 codeSlop PASS paths', () => {
  it('CODE_SLOP PASS: changed .ts file within geometric limits → standard handoff flow proceeds', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    writeFileSync(join(ws, 'TASK.md'), TASK_WITH_PLAN_PHASE13, 'utf8');
    writeFileSync(join(ws, 'clean.ts'), 'function a() { return 1; }\n', 'utf8');

    const res = runGate({
      workspaceRoot: ws,
      mutationsOverride: ['clean.ts'],
    });
    expect(res.exitCode).toBe(0);
    expect(res.errors).toEqual([]);
  });

  it('CODE_SLOP SCOPE: only .ts/.js mutations are scanned — README.md path is ignored even when it has many braces', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    writeFileSync(join(ws, 'TASK.md'), TASK_WITH_PLAN_PHASE13, 'utf8');
    writeFileSync(
      join(ws, 'README.md'),
      '# Notes\n```\n{{{{{{}}}}}}}}\n```\n',
      'utf8',
    );

    const res = runGate({
      workspaceRoot: ws,
      mutationsOverride: ['README.md'],
    });
    expect(res.exitCode).toBe(0);
    expect(res.errors).toEqual([]);
  });
});

describe('runGate — Phase 13 codeSlop BLOCK paths', () => {
  it('CODE_SLOP BLOCK: changed .ts file exceeds nesting depth → exitCode 1, [CODE_SLOP_DETECTED] error, no stamp', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    writeFileSync(join(ws, 'TASK.md'), TASK_WITH_PLAN_PHASE13, 'utf8');
    writeFileSync(join(ws, 'slop.ts'), deepSlopFixture(), 'utf8');

    const res = runGate({
      workspaceRoot: ws,
      mutationsOverride: ['slop.ts'],
    });
    expect(res.exitCode).toBe(1);
    expect(res.errors[0]).toMatch(/\[CODE_SLOP_DETECTED\]/);
    expect(res.errors[0]).toContain('slop.ts');
    const stamped = JSON.parse(
      readFileSync(join(ws, 'shared/tester_input.json'), 'utf8'),
    );
    expect(stamped.latest_compiled_payload).toBeUndefined();
  });

  it('CODE_SLOP ORDER: when both archPlan and codeSlop would fail, archPlan wins (intent before geometry)', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src/slop.ts'), deepSlopFixture(), 'utf8');

    const res = runGate({
      workspaceRoot: ws,
      mutationsOverride: ['src/slop.ts'],
    });
    expect(res.exitCode).toBe(1);
    expect(res.errors[0]).toMatch(/\[ILLEGAL_MUTATION\]/);
    expect(res.errors[0]).not.toMatch(/\[CODE_SLOP_DETECTED\]/);
  });
});

const SANDBOX_TASK_WITH_APPROVAL =
  '# TASK\n- [x] ARCH_PLAN phase-17: ship sandbox oracle\n- [x] APPROVE_HIGH_RISK: phase-17: vetted by human\n- [x] APPROVE_OUTBOUND_ACCESS: phase-17: vetted egress\n';

const HIGH_DANGER_OUTBOUND = JSON.stringify({
  sandbox: {
    allow_outbound: true,
    allowed_paths: ['./src/*'],
    danger_rating: 'high',
  },
});

const LOW_DANGER = JSON.stringify({
  sandbox: {
    allow_outbound: false,
    allowed_paths: ['./src/*'],
    danger_rating: 'low',
  },
});

describe('runGate — Phase 17 sandbox PASS paths', () => {
  it('SANDBOX PASS: low-danger manifest + clean TASK.md → gate releases (no approvals needed)', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    const res = runGate({
      workspaceRoot: ws,
      agentGovernanceOverride: LOW_DANGER,
    });
    expect(res.exitCode, `errors=${res.errors.join('|')}`).toBe(0);
  });

  it('SANDBOX SKIP: no agent-governance.json present → gate transparently passes through', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(0);
    expect(res.errors).toEqual([]);
  });
});

describe('runGate — Phase 17 sandbox BLOCK paths', () => {
  it('SANDBOX BLOCK: high-danger + outbound manifest WITHOUT APPROVE bullets → exitCode 1 [SANDBOX_CAPABILITY_VIOLATION]', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    // Default setupWorkspace TASK.md has no APPROVE bullets at all.
    const res = runGate({
      workspaceRoot: ws,
      agentGovernanceOverride: HIGH_DANGER_OUTBOUND,
    });
    expect(res.exitCode).toBe(1);
    expect(res.errors[0]).toMatch(/\[SANDBOX_CAPABILITY_VIOLATION\]/);
    expect(res.errors[0]).toContain('APPROVE_HIGH_RISK');
    expect(res.errors[0]).toContain('APPROVE_OUTBOUND_ACCESS');
    const stamped = JSON.parse(
      readFileSync(join(ws, 'shared/tester_input.json'), 'utf8'),
    );
    expect(stamped.latest_compiled_payload).toBeUndefined();
  });

});

describe('runGate — Phase 17 sandbox APPROVE-bullet resume path', () => {
  it('SANDBOX RESUME: high-danger + outbound manifest + matching APPROVE bullets in TASK.md → gate releases', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    writeFileSync(join(ws, 'TASK.md'), SANDBOX_TASK_WITH_APPROVAL, 'utf8');
    const res = runGate({
      workspaceRoot: ws,
      agentGovernanceOverride: HIGH_DANGER_OUTBOUND,
    });
    expect(res.exitCode, `errors=${res.errors.join('|')}`).toBe(0);
  });
});

describe('gateHook — subprocess hard-block (process.exit verification)', () => {
  it('exits with code 1 when run as a script against a defective workspace', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: 'too short',
      includePrompts: true,
    });
    workspaces.push(ws);

    const out = spawnGateScript(ws);
    expect(out.status, `stderr=${out.stderr}`).toBe(1);
    expect(out.stderr).toMatch(/\[gateHook\]\[FAIL\]/);
  });

  it('exits with code 0 when run as a script against a fully-valid workspace', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);

    const out = spawnGateScript(ws);
    expect(out.status, `stderr=${out.stderr}`).toBe(0);
    expect(out.stdout).toMatch(/\[gateHook\] PASS role=Builder next=Tester/);
  });
});

describe('runGate — Phase 14 shadow-warrior gate', () => {
  const SHADOW_TASK_WITH_PLAN =
    '# TASK\n- [x] ARCH_PLAN phase-14-shadow: dogfood shadow warrior\n- [/] T14.1\n';
  const FIXED_SHA = '1234567890abcdef1234567890abcdef12345678';
  const FIXED_NOW = new Date(Date.UTC(2026, 4, 27, 23, 0, 0));

  it('SHADOW PASS: valid token derived from current SHA + minute + file fingerprint → runGate exitCode 0', async () => {
    const oracle = await import('../../src/validator/shadowWarriorOracle.js');
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    writeFileSync(join(ws, 'TASK.md'), SHADOW_TASK_WITH_PLAN, 'utf8');
    const fileContent = 'export const greet = () => "hi";\n';
    writeFileSync(join(ws, 'src-file.ts'), fileContent, 'utf8');
    // Move under src/ so filterCodeMutations keeps it
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src/greet.ts'), fileContent, 'utf8');

    const fingerprint = oracle.computeMutationFingerprint({
      cwd: ws,
      paths: ['src/greet.ts'],
    });
    const salt = oracle.computeTemporalSalt(
      FIXED_SHA,
      oracle.getMinuteTimestamp(FIXED_NOW),
    );
    const token = oracle.computeShadowToken(salt, fingerprint);

    const evidenceWithToken =
      `shadow_token: ${token}\n` + VALID_LOG;
    const wlPath = join(ws, 'WORKLOG.md');
    const wl = readFileSync(wlPath, 'utf8').replace(VALID_LOG, evidenceWithToken);
    writeFileSync(wlPath, wl, 'utf8');

    const res = runGate({
      workspaceRoot: ws,
      mutationsOverride: ['src/greet.ts'],
      shadowNow: FIXED_NOW,
      shadowShaOverride: FIXED_SHA,
    });
    expect(res.exitCode, `errors=${res.errors.join('|')}`).toBe(0);
  });

  it('SHADOW BLOCK: missing shadow_token line in evidence with src/ mutation → exitCode 1 [SHADOW_TOKEN_FORGERY]', async () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG, // no shadow_token embedded
      includePrompts: true,
    });
    workspaces.push(ws);
    writeFileSync(join(ws, 'TASK.md'), SHADOW_TASK_WITH_PLAN, 'utf8');
    mkdirSync(join(ws, 'src'), { recursive: true });
    writeFileSync(join(ws, 'src/touched.ts'), 'export const x = 1;\n', 'utf8');

    const res = runGate({
      workspaceRoot: ws,
      mutationsOverride: ['src/touched.ts'],
      shadowNow: FIXED_NOW,
      shadowShaOverride: FIXED_SHA,
    });
    expect(res.exitCode).toBe(1);
    expect(res.errors[0]).toMatch(/\[SHADOW_TOKEN_FORGERY\]/);
    expect(res.errors[0]).toMatch(/No `shadow_token/);
    const stamped = JSON.parse(
      readFileSync(join(ws, 'shared/tester_input.json'), 'utf8'),
    );
    expect(stamped.latest_compiled_payload).toBeUndefined();
  });

  it('SHADOW BLOCK: stale token (from 10 minutes ago) outside acceptance window → exitCode 1', async () => {
    const oracle = await import('../../src/validator/shadowWarriorOracle.js');
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG,
      includePrompts: true,
    });
    workspaces.push(ws);
    writeFileSync(join(ws, 'TASK.md'), SHADOW_TASK_WITH_PLAN, 'utf8');
    mkdirSync(join(ws, 'src'), { recursive: true });
    const fileContent = 'export const y = 2;\n';
    writeFileSync(join(ws, 'src/stale.ts'), fileContent, 'utf8');

    const tenMinutesAgo = new Date(FIXED_NOW.getTime() - 10 * 60_000);
    const fingerprint = oracle.computeMutationFingerprint({
      cwd: ws,
      paths: ['src/stale.ts'],
    });
    const staleSalt = oracle.computeTemporalSalt(
      FIXED_SHA,
      oracle.getMinuteTimestamp(tenMinutesAgo),
    );
    const staleToken = oracle.computeShadowToken(staleSalt, fingerprint);

    const evidenceWithStaleToken = `shadow_token: ${staleToken}\n` + VALID_LOG;
    const wlPath = join(ws, 'WORKLOG.md');
    const wl = readFileSync(wlPath, 'utf8').replace(VALID_LOG, evidenceWithStaleToken);
    writeFileSync(wlPath, wl, 'utf8');

    const res = runGate({
      workspaceRoot: ws,
      mutationsOverride: ['src/stale.ts'],
      shadowNow: FIXED_NOW,
      shadowShaOverride: FIXED_SHA,
    });
    expect(res.exitCode).toBe(1);
    expect(res.errors[0]).toMatch(/\[SHADOW_TOKEN_FORGERY\]/);
  });

  it('SHADOW PASSTHROUGH: pure-docs mutation (no src/tests changes) does NOT require shadow_token', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: VALID_LOG, // intentionally no shadow_token
      includePrompts: true,
    });
    workspaces.push(ws);
    // Pure-docs mutations only — filterCodeMutations returns [] → shadow gate skips
    const res = runGate({
      workspaceRoot: ws,
      mutationsOverride: ['README.md', 'WORKLOG.md'],
      shadowNow: FIXED_NOW,
      shadowShaOverride: FIXED_SHA,
    });
    expect(res.exitCode).toBe(0);
    expect(res.errors).toEqual([]);
  });
});
