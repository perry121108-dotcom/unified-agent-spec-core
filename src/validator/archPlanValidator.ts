/**
 * archPlanValidator — Phase 12 Pre-flight Architecture Plan Gate
 *
 * Threat model
 *   An AI Builder agent skips the design phase and starts mutating source code
 *   "while thinking out loud." Phase 10/11 oracles only catch this AFTER the
 *   mutation has happened (via fabricated test evidence). Phase 12 inverts the
 *   sequence — before any test log is even scrutinized, we demand the agent
 *   have first checked-off an `- [x] ARCH_PLAN` bullet in TASK.md anchoring
 *   the work to a vetted design intent.
 *
 * Detection contract
 *   `assertArchPlanConsistency(modifiedPaths, taskMdContent)` accepts the raw
 *   working-tree change set and the current TASK.md body. It filters the
 *   change set down to genuine code mutations (paths under `src/` or `tests/`
 *   and not ending in `.md`), then enforces:
 *
 *     - If filtered set is empty ⇒ zero-misfire passthrough. Pure-docs commits
 *       (README, TASK, WORKLOG, package.json, .github/*, etc.) never trip
 *       this gate, so governance flows never deadlock themselves.
 *
 *     - If filtered set is non-empty AND TASK.md contains a checked
 *       `- [x] ARCH_PLAN` bullet (case-insensitive on both the X and the
 *       keyword) ⇒ passthrough. The agent has declared intent.
 *
 *     - Otherwise ⇒ throw `Error('[ILLEGAL_MUTATION] ...')` listing the
 *       offending paths. The caller (`runGate`) renders the high-contrast
 *       banner and exits 1 WITHOUT writing any compliance stamp, so the agent
 *       can simply append the missing ARCH_PLAN bullet and re-run.
 *
 * Why this validator is one tiny file
 *   The whole "before / after" sequencing decision lives in `gateHook.ts`.
 *   This module is a pure, side-effect-free, dependency-free predicate so it
 *   is trivially testable and reusable (e.g. from a git pre-commit hook).
 */

/**
 * Directories whose contents are treated as genuine source / test code. A
 * change anywhere under these prefixes is "a mutation" for Phase 12 purposes.
 * Everything outside these prefixes — README.md, TASK.md, WORKLOG.md,
 * package.json, package-lock.json, .gitignore, .github/**, shared/**,
 * prompts/**, inputs/**, reports/**, etc. — is considered pure documentation
 * or runtime artifact and never trips the pre-flight gate.
 */
const CODE_DIRECTORY_PREFIXES = ['src/', 'tests/'] as const;

/**
 * Even within `src/` and `tests/`, files whose path ends in `.md` are
 * documentation (e.g. embedded design notes, fixture readmes) and never
 * constitute "code mutation."
 */
function endsInMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * Returns true iff `path` represents a genuine source / test mutation that
 * Phase 12 should police. Path separators are normalized so Windows-style
 * paths (`src\foo\bar.ts`) classify identically to POSIX paths.
 */
function isCodeMutation(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (endsInMarkdown(normalized)) return false;
  return CODE_DIRECTORY_PREFIXES.some((d) => normalized.startsWith(d));
}

/**
 * Public helper exported for unit tests. Filters a raw working-tree change
 * set down to the paths Phase 12 polices. Order-preserving and dedup-safe.
 */
export function filterCodeMutations(modifiedPaths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of modifiedPaths) {
    if (!isCodeMutation(p)) continue;
    const key = p.replace(/\\/g, '/');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Detects the canonical checked plan marker. Matches both `[x]` and `[X]`
 * (case-insensitive on the X) and `ARCH_PLAN` / `arch_plan` etc. (case-
 * insensitive on the keyword). The `- ` list-marker prefix is required so a
 * stray prose mention of "ARCH_PLAN" inside a paragraph does not falsely
 * green-light a real mutation.
 */
const CHECKED_ARCH_PLAN = /-\s+\[x\]\s+ARCH_PLAN/i;

/**
 * Returns true iff the supplied TASK.md body contains at least one
 * checked-off `- [x] ARCH_PLAN` bullet, case-insensitive.
 */
export function hasCheckedArchPlan(taskMdContent: string): boolean {
  return CHECKED_ARCH_PLAN.test(taskMdContent);
}

/**
 * Hard pre-flight gate. Throws `Error('[ILLEGAL_MUTATION] ...')` iff the
 * working-tree change set contains genuine code mutations but TASK.md has no
 * checked ARCH_PLAN bullet. The error message lists the offending paths so
 * the agent can immediately see which mutations triggered the block.
 */
export function assertArchPlanConsistency(
  modifiedPaths: string[],
  taskMdContent: string,
): void {
  const codePaths = filterCodeMutations(modifiedPaths);
  if (codePaths.length === 0) return; // zero-misfire: pure-docs commits sail through

  if (hasCheckedArchPlan(taskMdContent)) return; // intent declared → release

  throw new Error(
    `[ILLEGAL_MUTATION] Code modifications detected in [${codePaths.join(', ')}] ` +
      `but no approved [- [x] ARCH_PLAN] was found in TASK.md.`,
  );
}
