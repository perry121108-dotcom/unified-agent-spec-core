import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compileMarkdownToHandoff } from '../compiler/specCompiler.js';
import { validateHandoffData } from '../validator/schemaValidator.js';
import { validateLogStructure } from '../validator/semanticValidator.js';
import {
  assertArchPlanConsistency,
  filterCodeMutations,
} from '../validator/archPlanValidator.js';
import { analyzeCodeSlop, formatSlopError } from '../linter/codeSlopLinter.js';
import { verifyShadowToken } from '../validator/shadowWarriorOracle.js';
import {
  enforceSandbox,
  readSandboxFromGovernanceJson,
  readSandboxFromPath,
} from '../validator/sandboxOracle.js';
import type { AgentRole } from '../types/types.js';

export interface GateHookOptions {
  /** Project root containing TASK.md / WORKLOG.md / shared/. Defaults to process.cwd(). */
  workspaceRoot?: string;
  /** Override the role to validate against; falls through to current_role else 'Builder'. */
  role?: AgentRole;
  /**
   * Phase 12+13 test seam: inject the working-tree change set directly
   * instead of shelling out to git. Production callers leave this undefined.
   */
  mutationsOverride?: string[];
  /**
   * Phase 14 test seam: skip the shadow-warrior gate entirely. Production
   * code never sets this; existing tests for the other tiers use it to
   * isolate the gate under test.
   */
  disableShadowWarrior?: boolean;
  /** Phase 14 test seam: pin "now" to a deterministic Date for replay tests. */
  shadowNow?: Date;
  /** Phase 14 test seam: pin HEAD SHA so tests do not depend on real git state. */
  shadowShaOverride?: string;
  /**
   * Phase 17 test seam: inject the raw `agent-governance.json` text directly
   * instead of reading from disk. Production callers leave this undefined.
   */
  agentGovernanceOverride?: string;
}

export interface GateHookResult {
  exitCode: 0 | 1;
  errors: string[];
  payload: ReturnType<typeof compileMarkdownToHandoff>;
  role: AgentRole;
}

type CompiledPayload = ReturnType<typeof compileMarkdownToHandoff>;

const DEFAULT_ROLE: AgentRole = 'Builder';

/* -------------------------------------------------------------------------- */
/* Zero-shell git workspace mutation collector                                */
/* -------------------------------------------------------------------------- */

function safeGitCapture(args: string[], cwd: string): string {
  try {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
    if (r.error || r.status !== 0) return '';
    return r.stdout ?? '';
  } catch {
    return '';
  }
}

function parseUntrackedLines(porcelainOutput: string): string[] {
  return porcelainOutput
    .split('\n')
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).trim())
    .filter((s) => s.length > 0);
}

function parseTrackedLines(diffOutput: string): string[] {
  return diffOutput
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * `git diff --name-only HEAD` + `git status --porcelain`, both via spawnSync
 * with arg arrays (no shell). Returns the deduplicated, order-preserving
 * union. Falls back to `[]` when cwd is not a git working tree so the
 * Phase-1-through-11 test suite (which uses `mkdtempSync` fixtures) still
 * runs unmodified.
 */
export function getWorkspaceMutations(cwd: string = process.cwd()): string[] {
  const tracked = parseTrackedLines(safeGitCapture(['diff', '--name-only', 'HEAD'], cwd));
  const untracked = parseUntrackedLines(safeGitCapture(['status', '--porcelain'], cwd));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...tracked, ...untracked]) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Pre-flight gates (Phase 12 archPlan + Phase 13 codeSlop + Phase 17 sandbox)*/
/* -------------------------------------------------------------------------- */

function loadSandboxManifest(
  root: string,
  override: string | undefined,
): ReturnType<typeof readSandboxFromPath> {
  if (override !== undefined) {
    return readSandboxFromGovernanceJson(override);
  }
  return readSandboxFromPath(resolve(root, 'agent-governance.json'));
}

/**
 * Phase 12 + Phase 13 + Phase 17 fused Pre-flight stage. Runs intent gate
 * first (archPlan), then geometric gate (codeSlop), then declarative sandbox
 * approval gate. First failure wins; we do NOT try to surface multiple
 * structural issues at once since the agent should fix them one at a time.
 * Returns `null` on pass, the error message on block.
 */
function runPreflightGates(
  mutations: string[],
  taskMd: string,
  root: string,
  options: GateHookOptions,
): string | null {
  try {
    assertArchPlanConsistency(mutations, taskMd);
  } catch (e) {
    return (e as Error).message;
  }
  const slopReport = analyzeCodeSlop(mutations, root);
  if (slopReport.violations.length > 0) {
    return formatSlopError(slopReport);
  }
  try {
    const manifest = loadSandboxManifest(root, options.agentGovernanceOverride);
    enforceSandbox(manifest, taskMd);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Post-facto gates                                                           */
/* -------------------------------------------------------------------------- */

function runSemanticOracleStep(payload: CompiledPayload): string | null {
  const evidence = payload.execution_evidence_log ?? '';
  if (evidence.length === 0) return null;
  try {
    validateLogStructure(evidence);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
}

/**
 * Phase 14 — Shadow-Warrior Tier 3.5 (temporal salt + mutation fingerprint).
 *
 * Verifies the `shadow_token` line embedded in the evidence body matches a
 * fresh sha256( salt :: fingerprint ) for the current HEAD SHA, the current
 * minute-stamp (±1 minute window), and the sha256 of the code-mutation set.
 *
 * Short-circuits in three benign cases so the gate stays compatible with
 * pre-Phase-14 fixtures and with pure-docs commits:
 *   - `disableShadowWarrior` test seam is set
 *   - no code mutations under src/ or tests/ (no replay risk)
 *   - no evidence body (semantic oracle already short-circuited)
 */
function runShadowWarriorStep(
  payload: CompiledPayload,
  mutations: string[],
  root: string,
  options: GateHookOptions,
): string | null {
  if (options.disableShadowWarrior) return null;
  const codePaths = filterCodeMutations(mutations);
  if (codePaths.length === 0) return null;
  const evidence = payload.execution_evidence_log ?? '';
  if (evidence.length === 0) return null;
  try {
    verifyShadowToken({
      cwd: root,
      mutations: codePaths,
      evidenceText: evidence,
      now: options.shadowNow,
      shaOverride: options.shadowShaOverride,
    });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function stampCompliance(
  root: string,
  payload: CompiledPayload,
  role: AgentRole,
): string | null {
  const path = resolve(root, 'shared/tester_input.json');
  if (!existsSync(path)) return null;
  try {
    const current = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    current.latest_compiled_payload = {
      compiled_at: new Date().toISOString(),
      gate_role: role,
      source_section: payload.source_section,
      next_role: payload.next_role,
      prompts_directory_path: payload.prompts_directory_path,
      evidence_log_chars: payload.execution_evidence_log?.length ?? 0,
    };
    writeFileSync(path, JSON.stringify(current, null, 2) + '\n', 'utf8');
    return null;
  } catch (e) {
    return `[gateHook] could not stamp tester_input.json: ${(e as Error).message}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Governance pre-check + result helpers                                      */
/* -------------------------------------------------------------------------- */

function checkGovernanceFiles(root: string): string | null {
  const taskPath = resolve(root, 'TASK.md');
  const worklogPath = resolve(root, 'WORKLOG.md');
  if (!existsSync(taskPath) || !existsSync(worklogPath)) {
    return (
      `[gateHook] missing governance files: ` +
      `TASK.md=${existsSync(taskPath)} WORKLOG.md=${existsSync(worklogPath)}`
    );
  }
  return null;
}

function emptyErrResult(message: string, role: AgentRole): GateHookResult {
  return { exitCode: 1, errors: [message], payload: {}, role };
}

function withErrResult(
  message: string,
  payload: CompiledPayload,
  role: AgentRole,
): GateHookResult {
  return { exitCode: 1, errors: [message], payload, role };
}

/* -------------------------------------------------------------------------- */
/* Main entry — thin orchestrator                                             */
/* -------------------------------------------------------------------------- */

/**
 * Pure, testable core. Does NOT call process.exit — callers translate
 * exitCode into a real exit. Pipeline:
 *   1. Governance file presence
 *   2. Pre-flight gates (Phase 12 archPlan + Phase 13 codeSlop)
 *   3. Markdown → handoff compilation
 *   4. Semantic forgery oracle (Phase 10/11)
 *   5. JSON schema validation (Phase 2/3/6)
 *   6. Compliance stamp to shared/tester_input.json
 */
export function runGate(options: GateHookOptions = {}): GateHookResult {
  const root = resolve(options.workspaceRoot ?? process.cwd());
  const defaultRole = options.role ?? DEFAULT_ROLE;

  const govErr = checkGovernanceFiles(root);
  if (govErr) return emptyErrResult(govErr, defaultRole);

  const taskMd = readFileSync(resolve(root, 'TASK.md'), 'utf8');
  const mutations = options.mutationsOverride ?? getWorkspaceMutations(root);

  const preflightErr = runPreflightGates(mutations, taskMd, root, options);
  if (preflightErr) return emptyErrResult(preflightErr, defaultRole);

  const worklogMd = readFileSync(resolve(root, 'WORKLOG.md'), 'utf8');
  const payload = compileMarkdownToHandoff(taskMd, worklogMd);
  const role = options.role ?? payload.current_role ?? DEFAULT_ROLE;

  const oracleErr = runSemanticOracleStep(payload);
  if (oracleErr) return withErrResult(oracleErr, payload, role);

  const shadowErr = runShadowWarriorStep(payload, mutations, root, options);
  if (shadowErr) return withErrResult(shadowErr, payload, role);

  const schemaResult = validateHandoffData(payload as unknown, role, { workspaceRoot: root });
  if (!schemaResult.success) return { exitCode: 1, errors: schemaResult.errors, payload, role };

  const stampErr = stampCompliance(root, payload, role);
  if (stampErr) return withErrResult(stampErr, payload, role);

  return { exitCode: 0, errors: [], payload, role };
}

/* -------------------------------------------------------------------------- */
/* CLI banner renderers (extracted so main() body stays under the slop limit) */
/* -------------------------------------------------------------------------- */

/* eslint-disable no-console */

function bannerLine(): void {
  console.error('================================================================');
}

function renderIllegalMutationBanner(err: string): void {
  console.error('');
  bannerLine();
  console.error('=== ILLEGAL MUTATION DETECTED - HARD BLOCK ===');
  bannerLine();
  console.error(err);
  bannerLine();
  console.error('  No compliance stamp written to shared/tester_input.json.');
  console.error('  Append `- [x] ARCH_PLAN <slug>: <intent>` to TASK.md and re-run.');
  bannerLine();
}

function renderForgeryBanner(err: string): void {
  console.error('');
  bannerLine();
  console.error('  [gateHook][FAIL] SEMANTIC FORGERY DETECTED — HARD BLOCK');
  bannerLine();
  console.error(err);
  bannerLine();
  console.error('  No compliance stamp written to shared/tester_input.json.');
  console.error('  Re-run your test suite and paste the FULL verbose log.');
  bannerLine();
}

function renderCodeSlopBanner(err: string): void {
  console.error('');
  bannerLine();
  console.error('=== CODE SLOP DETECTED - HARD BLOCK ===');
  bannerLine();
  console.error(err);
  bannerLine();
  console.error('  No compliance stamp written to shared/tester_input.json.');
  console.error('  Reduce nesting depth ≤ 4 and block effective-lines ≤ 60, then re-run.');
  bannerLine();
}

function renderShadowTokenBanner(err: string): void {
  console.error('');
  bannerLine();
  console.error('=== SHADOW TOKEN FORGERY DETECTED - HARD BLOCK ===');
  bannerLine();
  console.error(err);
  bannerLine();
  console.error('  No compliance stamp written to shared/tester_input.json.');
  console.error('  Re-compute shadow_token via shadowWarriorOracle and embed within 1 minute.');
  bannerLine();
}

function renderSandboxBanner(err: string): void {
  console.error('');
  bannerLine();
  console.error('=== SANDBOX CAPABILITY VIOLATION - HUMAN APPROVAL REQUIRED ===');
  bannerLine();
  console.error(err);
  bannerLine();
  console.error('  No compliance stamp written to shared/tester_input.json.');
  console.error('  Append the listed APPROVE_* bullets to TASK.md by hand and re-run.');
  bannerLine();
}

function renderErrorBanner(err: string): void {
  if (err.startsWith('[ILLEGAL_MUTATION]')) return renderIllegalMutationBanner(err);
  if (err.startsWith('[CRITICAL_FORGERY]')) return renderForgeryBanner(err);
  if (err.startsWith('[CODE_SLOP_DETECTED]')) return renderCodeSlopBanner(err);
  if (err.startsWith('[SHADOW_TOKEN_FORGERY]')) return renderShadowTokenBanner(err);
  if (err.startsWith('[SANDBOX_CAPABILITY_VIOLATION]')) return renderSandboxBanner(err);
  console.error(`[gateHook][FAIL] ${err}`);
}

function main(): void {
  const res = runGate();
  if (res.exitCode === 0) {
    console.log(`[gateHook] PASS role=${res.role} next=${res.payload.next_role ?? '(none)'}`);
  } else {
    for (const err of res.errors) renderErrorBanner(err);
  }
  process.exit(res.exitCode);
}

/* eslint-enable no-console */

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
