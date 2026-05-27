import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compileMarkdownToHandoff } from '../compiler/specCompiler.js';
import { validateHandoffData } from '../validator/schemaValidator.js';
import { validateLogStructure } from '../validator/semanticValidator.js';
import { assertArchPlanConsistency } from '../validator/archPlanValidator.js';
import type { AgentRole } from '../types/types.js';

export interface GateHookOptions {
  /** Project root containing TASK.md / WORKLOG.md / shared/. Defaults to process.cwd(). */
  workspaceRoot?: string;
  /**
   * Override the role to validate against. If omitted, the gate hook reads
   * `current_role` from the compiled payload; if still missing, it falls back
   * to 'Builder' (the most common Phase-1/2/3 sender).
   */
  role?: AgentRole;
  /**
   * Phase 12 test seam: inject the working-tree change set directly instead
   * of shelling out to git. Production code never sets this — `runGate` calls
   * `getWorkspaceMutations(workspaceRoot)` by default. Tests use it to
   * simulate Pre-flight scenarios without needing a real git repo in tmpdir.
   */
  mutationsOverride?: string[];
}

export interface GateHookResult {
  exitCode: 0 | 1;
  errors: string[];
  payload: ReturnType<typeof compileMarkdownToHandoff>;
  role: AgentRole;
}

const DEFAULT_ROLE: AgentRole = 'Builder';

/**
 * Zero-shell working-tree change-set collector. Runs `git diff --name-only
 * HEAD` for tracked mutations + `git status --porcelain` filtered to `??`
 * entries for untracked files. Both calls use `spawnSync` with an argument
 * array (NOT `shell: true` and NOT `execSync('git ...')`), eliminating the
 * Windows DEP0190 informational warning and platform-specific quoting hazards
 * that motivated the Phase 8 refactor.
 *
 * Graceful degradation: if the cwd is not inside a git working tree (e.g.
 * inside a vitest `mkdtempSync` fixture), git exits non-zero and we return
 * an empty array — which causes the downstream Pre-flight gate to be a
 * passthrough. This keeps the entire Phase-1-through-11 test suite running
 * unmodified.
 */
export function getWorkspaceMutations(cwd: string = process.cwd()): string[] {
  const safeGit = (args: string[]): string => {
    try {
      const r = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        shell: false,
      });
      if (r.error || r.status !== 0) return '';
      return r.stdout ?? '';
    } catch {
      return '';
    }
  };

  const trackedRaw = safeGit(['diff', '--name-only', 'HEAD']);
  const trackedPaths = trackedRaw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // `git status --porcelain` emits one line per file with a 2-char status
  // prefix + 1 space + path. We extract only the `??` (untracked) rows; the
  // tracked rows are already covered by `git diff --name-only HEAD` above.
  const statusRaw = safeGit(['status', '--porcelain']);
  const untrackedPaths = statusRaw
    .split('\n')
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .filter((s) => s.length > 0);

  // Order-preserving dedup so the produced list is deterministic across runs.
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const p of [...trackedPaths, ...untrackedPaths]) {
    if (seen.has(p)) continue;
    seen.add(p);
    merged.push(p);
  }
  return merged;
}

/**
 * Pure, testable core of the CLI gate. Does NOT call process.exit — callers
 * (main() below) are responsible for translating exitCode into a real exit.
 *
 * Phase 12 inserts a Pre-flight Architecture Plan Gate as the very first
 * substantive check (immediately after TASK.md is read, before anything
 * else). If any source/test mutation is present in the working tree but
 * TASK.md has no `- [x] ARCH_PLAN` bullet, the gate aborts with an
 * `[ILLEGAL_MUTATION]` error before the semantic forgery oracle or schema
 * validator can even run. No compliance stamp is written on Pre-flight
 * failure, so the agent can append the missing plan and re-run.
 */
export function runGate(options: GateHookOptions = {}): GateHookResult {
  const root = resolve(options.workspaceRoot ?? process.cwd());
  const taskPath = resolve(root, 'TASK.md');
  const worklogPath = resolve(root, 'WORKLOG.md');

  if (!existsSync(taskPath) || !existsSync(worklogPath)) {
    return {
      exitCode: 1,
      errors: [
        `[gateHook] missing governance files: TASK.md=${existsSync(taskPath)} WORKLOG.md=${existsSync(worklogPath)}`,
      ],
      payload: {},
      role: options.role ?? DEFAULT_ROLE,
    };
  }

  const taskMd = readFileSync(taskPath, 'utf8');

  // Phase 12 — Pre-flight Architecture Plan Gate.
  //
  // Runs FIRST, before any handoff compilation or oracle work, so that an
  // agent who modified source without declaring intent gets blocked as
  // early as possible. On `[ILLEGAL_MUTATION]` we bail with a populated
  // errors array and an empty payload — no stamping, no further validation.
  try {
    const mutations = options.mutationsOverride ?? getWorkspaceMutations(root);
    assertArchPlanConsistency(mutations, taskMd);
  } catch (e) {
    return {
      exitCode: 1,
      errors: [(e as Error).message],
      payload: {},
      role: options.role ?? DEFAULT_ROLE,
    };
  }

  const worklogMd = readFileSync(worklogPath, 'utf8');
  const payload = compileMarkdownToHandoff(taskMd, worklogMd);

  const role = options.role ?? payload.current_role ?? DEFAULT_ROLE;

  // Phase 10 — Semantic & Adversarial Sub-gate.
  //
  // Run the deterministic oracle BEFORE schemaValidator. Reason: schema R3 only
  // proves the evidence log clears a minimum length (≥32 chars), which a forger
  // trivially satisfies with `Tests 75 passed (75)`. The structural sub-gate
  // proves the per-case `✓` track sums to the declared aggregate — pure-summary
  // forgery cannot pass. On forgery, abort BEFORE any stamping happens.
  const evidenceForOracle = payload.execution_evidence_log ?? '';
  if (evidenceForOracle.length > 0) {
    try {
      validateLogStructure(evidenceForOracle);
    } catch (e) {
      return {
        exitCode: 1,
        errors: [(e as Error).message],
        payload,
        role,
      };
    }
  }

  const result = validateHandoffData(payload as unknown, role, { workspaceRoot: root });

  if (!result.success) {
    return { exitCode: 1, errors: result.errors, payload, role };
  }

  // Success path — stamp the latest compiled state into shared/tester_input.json
  // (non-destructive: only touch `latest_compiled_payload` so the existing
  //  Phase-handoff contents stay intact).
  const handoffJsonPath = resolve(root, 'shared/tester_input.json');
  if (existsSync(handoffJsonPath)) {
    try {
      const current = JSON.parse(readFileSync(handoffJsonPath, 'utf8')) as Record<string, unknown>;
      current.latest_compiled_payload = {
        compiled_at: new Date().toISOString(),
        gate_role: role,
        source_section: payload.source_section,
        next_role: payload.next_role,
        prompts_directory_path: payload.prompts_directory_path,
        evidence_log_chars: payload.execution_evidence_log?.length ?? 0,
      };
      writeFileSync(handoffJsonPath, JSON.stringify(current, null, 2) + '\n', 'utf8');
    } catch (e) {
      return {
        exitCode: 1,
        errors: [`[gateHook] could not stamp tester_input.json: ${(e as Error).message}`],
        payload,
        role,
      };
    }
  }

  return { exitCode: 0, errors: [], payload, role };
}

function main(): void {
  const res = runGate();
  if (res.exitCode === 0) {
    // eslint-disable-next-line no-console
    console.log(`[gateHook] PASS role=${res.role} next=${res.payload.next_role ?? '(none)'}`);
  } else {
    for (const err of res.errors) {
      if (err.startsWith('[ILLEGAL_MUTATION]')) {
        // Phase 12 — Pre-flight Architecture Plan Gate violation. The agent
        // mutated source without first declaring intent. No compliance stamp
        // was written; appending `- [x] ARCH_PLAN <slug>: <intent>` to
        // TASK.md and re-running this gate is the documented unblock path.
        // eslint-disable-next-line no-console
        console.error('');
        // eslint-disable-next-line no-console
        console.error('================================================================');
        // eslint-disable-next-line no-console
        console.error('=== ILLEGAL MUTATION DETECTED - HARD BLOCK ===');
        // eslint-disable-next-line no-console
        console.error('================================================================');
        // eslint-disable-next-line no-console
        console.error(err);
        // eslint-disable-next-line no-console
        console.error('================================================================');
        // eslint-disable-next-line no-console
        console.error('  No compliance stamp written to shared/tester_input.json.');
        // eslint-disable-next-line no-console
        console.error('  Append `- [x] ARCH_PLAN <slug>: <intent>` to TASK.md and re-run.');
        // eslint-disable-next-line no-console
        console.error('================================================================');
      } else if (err.startsWith('[CRITICAL_FORGERY]')) {
        // High-contrast banner for semantic forgery — the Phase 10 deterministic
        // oracle rejected the evidence body. No compliance stamp was written.
        // eslint-disable-next-line no-console
        console.error('');
        // eslint-disable-next-line no-console
        console.error('================================================================');
        // eslint-disable-next-line no-console
        console.error('  [gateHook][FAIL] SEMANTIC FORGERY DETECTED — HARD BLOCK');
        // eslint-disable-next-line no-console
        console.error('================================================================');
        // eslint-disable-next-line no-console
        console.error(err);
        // eslint-disable-next-line no-console
        console.error('================================================================');
        // eslint-disable-next-line no-console
        console.error('  No compliance stamp written to shared/tester_input.json.');
        // eslint-disable-next-line no-console
        console.error('  Re-run your test suite and paste the FULL verbose log.');
        // eslint-disable-next-line no-console
        console.error('================================================================');
      } else {
        // eslint-disable-next-line no-console
        console.error(`[gateHook][FAIL] ${err}`);
      }
    }
  }
  process.exit(res.exitCode);
}

const invokedDirect = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirect) {
  main();
}
