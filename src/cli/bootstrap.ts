import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_SOP_STATE_MACHINE } from '../config/agentWorkflowRegistry.js';
import {
  loadFeatureSpec,
  compileFeatureSpecToAcceptanceCriteria,
  type FeatureSpec,
} from '../compiler/specCompiler.js';

export interface BootstrapSummary {
  /** Workspace-relative paths that runBootstrap created OR confirmed existed. */
  created: string[];
  /** Workspace-relative paths that were already present and left untouched. */
  skipped: string[];
  /** Workspace-relative paths whose existing content was extended in-place
   *  (e.g. TASK.md augmented with an upstream FeatureSpec AC block). */
  augmented: string[];
}

export interface BootstrapOptions {
  /**
   * Absolute or workspace-relative path to an upstream `FeatureSpec.json`
   * produced by market-research-ai (or any compatible producer). When supplied,
   * runBootstrap will compile the spec's `suggested_specifications` and
   * `risk_pain_points` arrays into a Markdown AC block and inject it into the
   * scaffolded TASK.md — even if TASK.md already exists and is therefore
   * normally untouched.
   */
  featureSpecPath?: string;
}

const TASK_TEMPLATE = `# TASK

> 沙盒：本目錄
> 狀態圖例：\`[ ]\` 待辦 ｜ \`[/]\` 進行中 ｜ \`[x]\` 完成（測試＋WORKLOG 雙綠才可勾選）

## Phase 1 — Project Bootstrap

- [/] **T1** 透過 \`agent-core init\` 完成治理層注入
- [ ] **T2** 在 \`WORKLOG.md\` 補上首次任務的 \`<Execution_Evidence>\`
- [ ] **T3** 執行 \`agent-core check\` 驗證強型別不變式
`;

const WORKLOG_TEMPLATE = (timestamp: string): string => `# WORKLOG

## ${timestamp} — Bootstrap session

- **角色**：Builder
- next_role: Tester
- 所有 System Prompt 必須外置於 \`prompts/\` 目錄（agent-core 自舉所植入的鐵律）。
- prompts_directory_path: prompts

### \`<Execution_Evidence>\`

\`\`\`
$ agent-core init
[agent-core] init complete @ <cwd>
  + TASK.md
  + WORKLOG.md
  + agent-governance.json
  + shared/
  + prompts/
  + .github/workflows/agent-core-gate.yml
\`\`\`

> 啟動專案後，請在 \`<Execution_Evidence>\` 區塊中替換為真實的 terminal log（指令、stdout/stderr、exit code），\`agent-core check\` 才會通過 R3 不變式。
`;

interface GovernanceFile {
  spec_id: string;
  spec_version: string;
  bootstrapped_at: string;
  invariants: {
    prompt_externalization: boolean;
    execution_evidence_required: boolean;
    min_evidence_log_chars: number;
  };
  state_machine: typeof AI_SOP_STATE_MACHINE;
}

const SPEC_VERSION = '0.5.0';
const SPEC_ID = 'unified-agent-spec-core@phase6';
export const CI_WORKFLOW_RELATIVE_PATH = '.github/workflows/agent-core-gate.yml';

function buildGovernance(timestamp: string): GovernanceFile {
  return {
    spec_id: SPEC_ID,
    spec_version: SPEC_VERSION,
    bootstrapped_at: timestamp,
    invariants: {
      prompt_externalization: true,
      execution_evidence_required: true,
      min_evidence_log_chars: 32,
    },
    state_machine: AI_SOP_STATE_MACHINE,
  };
}

/**
 * Resolve the CI workflow template. Tries (1) `<thisDir>/../templates/…` so
 * both the dev path (src/cli → src/templates) and the built path
 * (dist/cli → dist/templates) work, and (2) a dev fallback into `src/templates`
 * when the package was built without copying assets (defence-in-depth).
 */
export function loadCiWorkflowTemplate(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(thisDir, '..', 'templates', 'ci-workflow.tpl.yml'),
    resolve(thisDir, '..', '..', 'src', 'templates', 'ci-workflow.tpl.yml'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  throw new Error(
    `[agent-core] ci-workflow template not found. Searched:\n  - ${candidates.join('\n  - ')}`,
  );
}

/**
 * Self-bootstrapping engine — idempotent governance scaffolding.
 *
 * Creates (without overwriting existing files):
 *   - shared/                                    empty directory for handoff JSON files
 *   - prompts/                                   externalized System Prompt directory
 *   - .github/workflows/                         GitHub Actions workflows directory
 *   - .github/workflows/agent-core-gate.yml      cloud hard-block CI workflow
 *   - TASK.md                                    ordered task list (Builder starts at T1=[/])
 *   - WORKLOG.md                                 initial worklog with `<Execution_Evidence>` placeholder
 *   - agent-governance.json                      machine-readable mirror of AI_SOP_STATE_MACHINE
 *   - shared/tester_input.json                   minimal seed so subsequent gate runs can stamp
 *
 * When `opts.featureSpecPath` is supplied, the suggested specifications + risk
 * pain points are compiled into a Markdown AC block and **appended to TASK.md
 * in-place** (even when TASK.md already existed). This is the only operation
 * that can mutate a pre-existing file, and it is itself idempotent — the
 * injected block is uniquely marker-fenced and skipped if already present.
 */
export function runBootstrap(targetPath: string, opts: BootstrapOptions = {}): BootstrapSummary {
  const root = resolve(targetPath);
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const augmented: string[] = [];

  const ensureDir = (rel: string): void => {
    const abs = join(root, rel);
    if (existsSync(abs)) {
      skipped.push(`${rel}/`);
    } else {
      mkdirSync(abs, { recursive: true });
      created.push(`${rel}/`);
    }
  };

  const writeIfMissing = (rel: string, content: string): void => {
    const abs = join(root, rel);
    if (existsSync(abs)) {
      skipped.push(rel);
      return;
    }
    const parent = dirname(abs);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    writeFileSync(abs, content, 'utf8');
    created.push(rel);
  };

  ensureDir('shared');
  ensureDir('prompts');
  ensureDir('.github');
  ensureDir('.github/workflows');

  const ts = new Date().toISOString();
  writeIfMissing('TASK.md', TASK_TEMPLATE);
  writeIfMissing('WORKLOG.md', WORKLOG_TEMPLATE(ts));
  writeIfMissing('agent-governance.json', JSON.stringify(buildGovernance(ts), null, 2) + '\n');
  writeIfMissing(
    'shared/tester_input.json',
    JSON.stringify(
      { bootstrap: { spec_version: SPEC_VERSION, bootstrapped_at: ts } },
      null,
      2,
    ) + '\n',
  );
  writeIfMissing(CI_WORKFLOW_RELATIVE_PATH, loadCiWorkflowTemplate());

  if (opts.featureSpecPath) {
    const specAbs = resolve(root, opts.featureSpecPath);
    const spec: FeatureSpec = loadFeatureSpec(specAbs);
    const acBlock = compileFeatureSpecToAcceptanceCriteria(spec);
    const taskAbs = join(root, 'TASK.md');
    const before = existsSync(taskAbs) ? readFileSync(taskAbs, 'utf8') : TASK_TEMPLATE;
    if (before.includes('<!-- agent-core:feature-spec-ac:begin -->')) {
      // Already injected — keep TASK.md untouched to remain idempotent.
      skipped.push('TASK.md#feature-spec-ac');
    } else {
      const next = before.replace(/\s*$/, '\n') + '\n' + acBlock + '\n';
      writeFileSync(taskAbs, next, 'utf8');
      augmented.push('TASK.md');
    }
  }

  return { created, skipped, augmented };
}
