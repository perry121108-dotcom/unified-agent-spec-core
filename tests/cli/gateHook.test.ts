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

const VALID_LOG = `$ npm test
> vitest run
 Test Files  5 passed (5)
      Tests  26 passed (26)
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

describe('runGate — programmatic core (no process.exit)', () => {
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

  it('FAIL: short evidence log (<32 chars) triggers R3 error and exitCode 1', () => {
    const ws = setupWorkspace({
      currentRole: 'Builder',
      nextRole: 'Tester',
      evidence: 'too short',
      includePrompts: true,
    });
    workspaces.push(ws);
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(1);
    expect(res.errors.some((e) => /shorter than/.test(e))).toBe(true);
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
