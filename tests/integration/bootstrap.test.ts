import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  statSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';
import { pathToFileURL } from 'node:url';
import { runBootstrap } from '../../src/cli/bootstrap.js';
import { runGate } from '../../src/cli/gateHook.js';

const PROJECT_ROOT = resolve(__dirname, '..', '..');
const BIN_SCRIPT = resolve(PROJECT_ROOT, 'src/bin/agent-core.ts');

/**
 * Absolute file:// URL of the tsx ESM loader inside this project's
 * node_modules. Passing this to `--import` (rather than the bare `tsx`
 * specifier) decouples resolution from the spawned process's `cwd`, which
 * matters because integration tests run agent-core under a freshly-created
 * tmpdir that has no `node_modules` of its own.
 */
const TSX_LOADER_URL = pathToFileURL(
  resolve(PROJECT_ROOT, 'node_modules/tsx/dist/loader.mjs'),
).href;

const VALID_WORKLOG_BODY = `# WORKLOG

## 2026-05-26T07:00:00Z — Real bootstrap session

- **角色**：Builder
- next_role: Tester
- 所有 System Prompt 必須外置於 \`prompts/\` 目錄

### \`<Execution_Evidence>\`

\`\`\`
$ npm test
> vitest run
 Test Files  8 passed (8)
      Tests  57 passed (57)
exit 0
\`\`\`
`;

const INVALID_WORKLOG_BODY = `# WORKLOG

## 2026-05-26T07:00:00Z — Short log violation

- **角色**：Builder
- next_role: Tester

### \`<Execution_Evidence>\`

\`\`\`
ok
\`\`\`
`;

let workspaces: string[] = [];
beforeEach(() => {
  workspaces = [];
});
afterEach(() => {
  for (const ws of workspaces) rmSync(ws, { recursive: true, force: true });
  workspaces = [];
});

function newWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'uasc-bootstrap-'));
  workspaces.push(ws);
  return ws;
}

describe('runBootstrap — scaffolding artifacts', () => {
  it('creates shared/ and prompts/ directories', () => {
    const ws = newWorkspace();
    const summary = runBootstrap(ws);
    expect(statSync(join(ws, 'shared')).isDirectory()).toBe(true);
    expect(statSync(join(ws, 'prompts')).isDirectory()).toBe(true);
    expect(summary.created).toEqual(expect.arrayContaining(['shared/', 'prompts/']));
  });

  it('writes a TASK.md skeleton with at least one [/] in_progress task', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    const task = readFileSync(join(ws, 'TASK.md'), 'utf8');
    expect(task).toMatch(/^# TASK/m);
    expect(task).toMatch(/\[\/\]/);
    expect(task).toMatch(/agent-core init/);
  });

  it('writes a WORKLOG.md skeleton with <Execution_Evidence> placeholder', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    const log = readFileSync(join(ws, 'WORKLOG.md'), 'utf8');
    expect(log).toMatch(/<Execution_Evidence>/);
    expect(log).toMatch(/\*\*角色\*\*：Builder/);
    expect(log).toMatch(/next_role:\s*Tester/);
  });

  it('writes agent-governance.json with the strong-typed invariant trio', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    const governance = JSON.parse(readFileSync(join(ws, 'agent-governance.json'), 'utf8'));
    expect(governance.spec_version).toBe('0.5.0');
    expect(governance.invariants.prompt_externalization).toBe(true);
    expect(governance.invariants.execution_evidence_required).toBe(true);
    expect(governance.invariants.min_evidence_log_chars).toBe(32);
    expect(Object.keys(governance.state_machine).sort()).toEqual([
      'Architect',
      'Builder',
      'Liaison',
      'PM',
      'Tester',
    ]);
  });

  it('seeds shared/tester_input.json with bootstrap metadata', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    const seed = JSON.parse(readFileSync(join(ws, 'shared/tester_input.json'), 'utf8'));
    expect(seed.bootstrap?.spec_version).toBe('0.5.0');
  });

  it('is idempotent — re-running does not overwrite existing files', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    const customTask = '# CUSTOM TASK — preserved by user';
    writeFileSync(join(ws, 'TASK.md'), customTask, 'utf8');
    const second = runBootstrap(ws);
    expect(readFileSync(join(ws, 'TASK.md'), 'utf8')).toBe(customTask);
    expect(second.skipped).toEqual(expect.arrayContaining(['TASK.md']));
  });
});

describe('runBootstrap + runGate — cross-repo E2E', () => {
  it('FAIL: bootstrap + intentionally-short Execution_Evidence → runGate exitCode 1', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    writeFileSync(join(ws, 'WORKLOG.md'), INVALID_WORKLOG_BODY, 'utf8');
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(1);
    expect(res.errors.some((e) => /shorter than/.test(e))).toBe(true);
    // No stamp on the seeded shared/tester_input.json — non-destructive.
    const after = JSON.parse(readFileSync(join(ws, 'shared/tester_input.json'), 'utf8'));
    expect(after.latest_compiled_payload).toBeUndefined();
  });

  it('PASS: bootstrap + compliant WORKLOG → runGate exitCode 0 + stamps latest_compiled_payload', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    writeFileSync(join(ws, 'WORKLOG.md'), VALID_WORKLOG_BODY, 'utf8');
    const res = runGate({ workspaceRoot: ws });
    expect(res.exitCode).toBe(0);
    expect(res.errors).toEqual([]);
    const after = JSON.parse(readFileSync(join(ws, 'shared/tester_input.json'), 'utf8'));
    expect(after.bootstrap?.spec_version).toBe('0.5.0'); // bootstrap seed preserved
    expect(after.latest_compiled_payload?.gate_role).toBe('Builder');
    expect(after.latest_compiled_payload?.next_role).toBe('Tester');
    expect(after.latest_compiled_payload?.evidence_log_chars).toBeGreaterThanOrEqual(32);
  });
});

describe('agent-core CLI — bin subprocess invocation', () => {
  /**
   * Invoke the agent-core bin TS source via Node's native binary
   * (`process.execPath`) plus the `--import <tsx-loader>` ESM hook. This
   * intentionally avoids `shell: true` + the `tsx.cmd` shim — eliminating
   * the Windows DEP0190 informational warning and making argv handling
   * platform-uniform. The loader is referenced by absolute file:// URL so
   * resolution is independent of the spawned process's tmpdir cwd.
   */
  function runBin(args: string[], cwd: string) {
    return spawnSync(execPath, ['--import', TSX_LOADER_URL, BIN_SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      shell: false,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
  }

  it('subprocess: `agent-core init` exits 0 and reports scaffolded files', () => {
    const ws = newWorkspace();
    const out = runBin(['init'], ws);
    expect(out.status, `stderr=${out.stderr}`).toBe(0);
    expect(out.stdout).toMatch(/\[agent-core\] init complete/);
    expect(existsSync(join(ws, 'TASK.md'))).toBe(true);
    expect(existsSync(join(ws, 'agent-governance.json'))).toBe(true);
  });

  it('subprocess: `agent-core check` against defective bootstrap exits 1', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    writeFileSync(join(ws, 'WORKLOG.md'), INVALID_WORKLOG_BODY, 'utf8');
    const out = runBin(['check'], ws);
    expect(out.status, `stderr=${out.stderr}`).toBe(1);
    expect(out.stderr).toMatch(/\[agent-core\]\[FAIL\]/);
  });

  it('subprocess: `agent-core check` against compliant bootstrap exits 0', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    writeFileSync(join(ws, 'WORKLOG.md'), VALID_WORKLOG_BODY, 'utf8');
    const out = runBin(['check'], ws);
    expect(out.status, `stderr=${out.stderr}`).toBe(0);
    expect(out.stdout).toMatch(/\[agent-core\] check PASS role=Builder next=Tester/);
  });

  it('subprocess: unknown subcommand exits 2 with usage to stderr', () => {
    const ws = newWorkspace();
    const out = runBin(['nope'], ws);
    expect(out.status, `stderr=${out.stderr}`).toBe(2);
    expect(out.stderr).toMatch(/unknown subcommand: nope/);
  });
});
