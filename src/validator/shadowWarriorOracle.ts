/**
 * shadowWarriorOracle — Phase 14 Temporal Salt + Mutation Fingerprint Gate
 *
 * Threat model (Phase 14, beyond Phase 10/11/13)
 *   An AI agent who *understands* the deterministic forgery oracle can no
 *   longer cheaply fabricate a Vitest log — but it could still REPLAY a real,
 *   previously-passing log captured from a prior commit (or stolen from the
 *   git history of a sibling repo). The semantic oracle, schema validator,
 *   and codeSlop gate would all green-light such a replay because the
 *   pasted log is, in fact, internally consistent — it just is not bound to
 *   the commit being audited right now.
 *
 * Defense
 *   Every legitimate evidence block must contain a `shadow_token` whose
 *   value is sha256( sha256( HEAD_SHA :: minute_stamp ) :: file_fingerprint )
 *   where:
 *     - HEAD_SHA          = `git rev-parse HEAD` of the current working tree
 *     - minute_stamp      = ISO `YYYY-MM-DD_HH:mm` in UTC
 *     - file_fingerprint  = sha256( sorted "path::contents" concatenation
 *                                   of the code-mutation set returned by
 *                                   filterCodeMutations(getWorkspaceMutations()) )
 *
 *   The two hashes are then concatenated with `::` and re-hashed. The
 *   `shadow_token: <hex>` line embedded in <Execution_Evidence> must equal
 *   this computation for at least one minute within the accepted window.
 *
 * Replay outcomes
 *   - Stale commit ⇒ HEAD_SHA changes ⇒ token mismatch
 *   - Stale minute (>window) ⇒ minute_stamp drifts ⇒ token mismatch
 *   - Mutated code after token generation ⇒ fingerprint changes ⇒ mismatch
 *   - Missing shadow_token line ⇒ explicit "no token" forgery error
 *
 * Zero external deps
 *   Only Node.js `node:crypto` + `node:fs` + `node:child_process` + `node:path`.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Hex (lower-case) sha256 capture of `shadow_token: <hex>` lines. */
export const SHADOW_TOKEN_PATTERN = /shadow_token:\s*([0-9a-f]{64})/i;

const ABSENT_SHA_SENTINEL = 'NO_GIT_HEAD';
const DEFAULT_MINUTE_WINDOW = 1;

export function getCurrentCommitSha(cwd: string = process.cwd()): string {
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      shell: false,
    });
    if (r.error || r.status !== 0) return ABSENT_SHA_SENTINEL;
    const out = (r.stdout ?? '').trim();
    return out.length > 0 ? out : ABSENT_SHA_SENTINEL;
  } catch {
    return ABSENT_SHA_SENTINEL;
  }
}

export function getMinuteTimestamp(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const y = date.getUTCFullYear();
  const mo = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  return `${y}-${mo}-${d}_${h}:${mi}`;
}

export function computeTemporalSalt(sha: string, minuteStamp: string): string {
  return createHash('sha256').update(`${sha}::${minuteStamp}`).digest('hex');
}

function safeReadFile(absPath: string, reader: (p: string) => string): string {
  try {
    return reader(absPath);
  } catch {
    return '<unreadable>';
  }
}

export interface FingerprintOptions {
  cwd: string;
  /** Paths (relative to cwd) of code files included in the fingerprint. */
  paths: string[];
  /** Optional test seam — swap in an in-memory file source. */
  reader?: (p: string) => string;
}

export function computeMutationFingerprint(opts: FingerprintOptions): string {
  const reader = opts.reader ?? ((p: string) => readFileSync(p, 'utf8'));
  // Deterministic ordering — sort by path before concatenation so multiple
  // runs over the same change set produce byte-identical input to sha256.
  const sorted = [...opts.paths].sort();
  const chunks: string[] = [];
  for (const rel of sorted) {
    const abs = resolve(opts.cwd, rel);
    const content = safeReadFile(abs, reader);
    chunks.push(`${rel}::${content}`);
  }
  return createHash('sha256').update(chunks.join('\n----\n')).digest('hex');
}

export function computeShadowToken(salt: string, fingerprint: string): string {
  return createHash('sha256').update(`${salt}::${fingerprint}`).digest('hex');
}

export function extractShadowToken(evidenceText: string): string | null {
  const m = SHADOW_TOKEN_PATTERN.exec(evidenceText);
  if (!m || !m[1]) return null;
  return m[1].toLowerCase();
}

export interface ShadowVerifyOptions {
  cwd: string;
  /** Code-mutation set (already filtered to src/tests). */
  mutations: string[];
  /** Evidence body text (between <Execution_Evidence> tags). */
  evidenceText: string;
  /** Treat this Date as "now" — for deterministic tests. */
  now?: Date;
  /** Accept tokens valid in this many minutes BEFORE `now`. Default 1. */
  acceptedMinuteWindow?: number;
  /** File source seam (production: readFileSync utf8). */
  reader?: (p: string) => string;
  /** SHA override — for tests that don't have a real git HEAD. */
  shaOverride?: string;
}

function buildExpectedTokensWindow(
  sha: string,
  fingerprint: string,
  now: Date,
  windowMinutes: number,
): string[] {
  const tokens: string[] = [];
  for (let offset = 0; offset <= windowMinutes; offset++) {
    const candidate = new Date(now.getTime() - offset * 60_000);
    const salt = computeTemporalSalt(sha, getMinuteTimestamp(candidate));
    tokens.push(computeShadowToken(salt, fingerprint));
  }
  return tokens;
}

/**
 * Hard shadow-warrior gate. Throws `Error('[SHADOW_TOKEN_FORGERY] ...')` on
 * any of:
 *
 *   - Missing `shadow_token:` line in the evidence body.
 *   - Token present but does not match any expected token in the minute
 *     window (replay, fingerprint drift, or fabrication).
 *
 * Returns void on success.
 */
export function verifyShadowToken(opts: ShadowVerifyOptions): void {
  const claimed = extractShadowToken(opts.evidenceText);
  if (claimed === null) {
    throw new Error(
      '[SHADOW_TOKEN_FORGERY] No `shadow_token: <hex>` line found in the ' +
        '<Execution_Evidence> block. Replay-protection is mandatory under ' +
        'Phase 14 — the agent must embed a freshly-computed token derived ' +
        'from the current HEAD SHA, the current minute-stamp, and the ' +
        'sha256 fingerprint of the changed source files.',
    );
  }
  const sha = opts.shaOverride ?? getCurrentCommitSha(opts.cwd);
  const fingerprint = computeMutationFingerprint({
    cwd: opts.cwd,
    paths: opts.mutations,
    reader: opts.reader,
  });
  const window = opts.acceptedMinuteWindow ?? DEFAULT_MINUTE_WINDOW;
  const now = opts.now ?? new Date();
  const accepted = buildExpectedTokensWindow(sha, fingerprint, now, window);
  if (accepted.includes(claimed)) return;

  throw new Error(
    `[SHADOW_TOKEN_FORGERY] shadow_token mismatch — either a replay of an ` +
      `old log, a fingerprint drift (code mutated after the token was ` +
      `generated), or fabrication. Expected token derivable from current ` +
      `HEAD SHA (${sha.slice(0, 12)}...), the current minute-stamp ` +
      `(within ${window + 1} minute window), and the sha256 of the ` +
      `${opts.mutations.length} changed source file(s).`,
  );
}
