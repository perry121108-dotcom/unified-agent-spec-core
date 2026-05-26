import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMarkdownToHandoff } from '../compiler/specCompiler.js';
import { validateHandoffData } from '../validator/schemaValidator.js';
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
}

export interface GateHookResult {
  exitCode: 0 | 1;
  errors: string[];
  payload: ReturnType<typeof compileMarkdownToHandoff>;
  role: AgentRole;
}

const DEFAULT_ROLE: AgentRole = 'Builder';

/**
 * Pure, testable core of the CLI gate. Does NOT call process.exit — callers
 * (main() below) are responsible for translating exitCode into a real exit.
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
  const worklogMd = readFileSync(worklogPath, 'utf8');
  const payload = compileMarkdownToHandoff(taskMd, worklogMd);

  const role = options.role ?? payload.current_role ?? DEFAULT_ROLE;

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
      // eslint-disable-next-line no-console
      console.error(`[gateHook][FAIL] ${err}`);
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
