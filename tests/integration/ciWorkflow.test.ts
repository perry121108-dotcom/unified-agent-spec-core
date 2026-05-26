import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runBootstrap,
  loadCiWorkflowTemplate,
  CI_WORKFLOW_RELATIVE_PATH,
} from '../../src/cli/bootstrap.js';

let workspaces: string[] = [];
beforeEach(() => {
  workspaces = [];
});
afterEach(() => {
  for (const ws of workspaces) rmSync(ws, { recursive: true, force: true });
  workspaces = [];
});

function newWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'uasc-ci-'));
  workspaces.push(ws);
  return ws;
}

describe('Phase 6 — CI workflow scaffolding', () => {
  it('runBootstrap creates .github/workflows directory inside the target', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    expect(statSync(join(ws, '.github')).isDirectory()).toBe(true);
    expect(statSync(join(ws, '.github', 'workflows')).isDirectory()).toBe(true);
  });

  it('runBootstrap emits agent-core-gate.yml at the canonical CI workflow path', () => {
    const ws = newWorkspace();
    const summary = runBootstrap(ws);
    const wfPath = join(ws, CI_WORKFLOW_RELATIVE_PATH);
    expect(existsSync(wfPath)).toBe(true);
    expect(summary.created).toEqual(expect.arrayContaining([CI_WORKFLOW_RELATIVE_PATH]));
  });

  it('emitted workflow has the agent-core-gate name and triggers on push + pull_request', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    const yml = readFileSync(join(ws, CI_WORKFLOW_RELATIVE_PATH), 'utf8');
    expect(yml).toMatch(/^name:\s*agent-core-gate/m);
    expect(yml).toMatch(/^on:/m);
    expect(yml).toMatch(/push:/);
    expect(yml).toMatch(/pull_request:/);
    expect(yml).toMatch(/branches:[\s\S]*?-\s*main/);
    expect(yml).toMatch(/-\s*'feature\/\*'/);
  });

  it('emitted workflow invokes `agent-core check` as the hard gate step', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    const yml = readFileSync(join(ws, CI_WORKFLOW_RELATIVE_PATH), 'utf8');
    expect(yml).toMatch(/actions\/checkout@v4/);
    expect(yml).toMatch(/actions\/setup-node@v4/);
    expect(yml).toMatch(/agent-core\s+check/);
  });

  it('runBootstrap is idempotent for the CI workflow — second run does not overwrite a user edit', () => {
    const ws = newWorkspace();
    runBootstrap(ws);
    const wfPath = join(ws, CI_WORKFLOW_RELATIVE_PATH);
    const customContent = '# customized by downstream team — DO NOT TOUCH\nname: custom-gate\n';
    writeFileSync(wfPath, customContent, 'utf8');
    const second = runBootstrap(ws);
    expect(readFileSync(wfPath, 'utf8')).toBe(customContent);
    expect(second.skipped).toEqual(expect.arrayContaining([CI_WORKFLOW_RELATIVE_PATH]));
  });

  it('loadCiWorkflowTemplate returns the canonical template content (non-empty, parseable as YAML-ish)', () => {
    const tpl = loadCiWorkflowTemplate();
    expect(tpl.length).toBeGreaterThan(100);
    expect(tpl).toMatch(/name:\s*agent-core-gate/);
    expect(tpl).toMatch(/jobs:[\s\S]*?agent-core-check:/);
  });
});
