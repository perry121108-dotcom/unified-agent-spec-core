/**
 * sandboxOracle — Phase 17 Declarative Capability Sandbox & Asymmetric Approval
 *
 * Threat model (Phase 17, beyond Phase 10-16)
 *   An AI agent who has passed every code-quality and evidence gate could
 *   still execute Skills that overreach their declared scope — calling
 *   outbound HTTP from a Skill claimed to be "filesystem-only," touching
 *   paths outside the declared allowlist, or invoking "high danger" Skills
 *   (delete, exec, network) without explicit human authorization.
 *
 * Defense
 *   Projects declare a Capability Manifest in `agent-governance.json`:
 *
 *     "sandbox": {
 *       "allow_outbound": false,
 *       "allowed_paths": ["./src/*"],
 *       "danger_rating": "high"
 *     }
 *
 *   Pre-flight reads the manifest and computes which APPROVE_* bullets
 *   TASK.md MUST contain (checked-off, e.g. `- [x] APPROVE_HIGH_RISK ...`).
 *   Missing approvals ⇒ throw `[SANDBOX_CAPABILITY_VIOLATION]` and exit 1.
 *
 *   Mapping (mutex on capability surface):
 *     - danger_rating === "high"  ⇒ require APPROVE_HIGH_RISK
 *     - allow_outbound === true   ⇒ require APPROVE_OUTBOUND_ACCESS
 *
 *   Bullets must follow the canonical form (case-insensitive on x):
 *     `- [x] APPROVE_<CAPABILITY> [: <slug>]: <intent>`
 *
 * Lifecycle (asymmetric approval flow)
 *   Without an APPROVE bullet for every required capability, `runGate`
 *   suspends (exits 1, writes NO compliance stamp). The human reviewer
 *   appends the bullet to TASK.md (out-of-band, requires human keystroke),
 *   then the agent re-runs the gate. This is the canonical "resume" path —
 *   no auto-resume, no machine-only approval.
 *
 * Zero external deps. Pure JSON + markdown parsing.
 */

import { existsSync, readFileSync } from 'node:fs';

export type DangerRating = 'low' | 'medium' | 'high';

export interface CapabilityManifest {
  allow_outbound: boolean;
  allowed_paths: string[];
  danger_rating: DangerRating;
}

/** Map from required-capability ID to its canonical APPROVE_* token. */
export const CAPABILITY_APPROVALS = {
  HIGH_RISK: 'APPROVE_HIGH_RISK',
  OUTBOUND: 'APPROVE_OUTBOUND_ACCESS',
} as const;

/** Per-rule audit summary that the integration banner can render. */
export interface SandboxAuditResult {
  manifest_present: boolean;
  required_approvals: string[];
  granted_approvals: string[];
  missing_approvals: string[];
}

/* -------------------------------------------------------------------------- */
/* Manifest parsing                                                           */
/* -------------------------------------------------------------------------- */

function isString(x: unknown): x is string {
  return typeof x === 'string';
}

function isBool(x: unknown): x is boolean {
  return typeof x === 'boolean';
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every(isString);
}

function isValidDanger(x: unknown): x is DangerRating {
  return x === 'low' || x === 'medium' || x === 'high';
}

/**
 * Parse a candidate sandbox object into a typed `CapabilityManifest`. Returns
 * null if any field is missing or malformed — callers treat null as "no
 * manifest declared" (gate skips).
 */
export function parseSandboxManifest(raw: unknown): CapabilityManifest | null {
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!isBool(obj.allow_outbound)) return null;
  if (!isStringArray(obj.allowed_paths)) return null;
  if (!isValidDanger(obj.danger_rating)) return null;
  return {
    allow_outbound: obj.allow_outbound,
    allowed_paths: obj.allowed_paths,
    danger_rating: obj.danger_rating,
  };
}

/**
 * Extract `manifest.sandbox` from an `agent-governance.json` body. Returns
 * null when the file is missing, not JSON, or has no `sandbox` field.
 */
export function readSandboxFromGovernanceJson(jsonText: string): CapabilityManifest | null {
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parseSandboxManifest(parsed.sandbox);
  } catch {
    return null;
  }
}

export function readSandboxFromPath(absPath: string): CapabilityManifest | null {
  if (!existsSync(absPath)) return null;
  try {
    return readSandboxFromGovernanceJson(readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Approval bullet extraction                                                 */
/* -------------------------------------------------------------------------- */

const APPROVE_BULLET = /-\s+\[x\]\s+APPROVE_([A-Z_]+)/gi;

/** Returns the set of granted approval tokens (e.g. `APPROVE_HIGH_RISK`). */
export function findGrantedApprovals(taskMdContent: string): Set<string> {
  const granted = new Set<string>();
  const re = new RegExp(APPROVE_BULLET.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(taskMdContent)) !== null) {
    if (m[1]) granted.add(`APPROVE_${m[1].toUpperCase()}`);
  }
  return granted;
}

/**
 * Maps a manifest to the set of APPROVE_* tokens that MUST be checked-off in
 * TASK.md for the gate to release. The mapping is intentionally narrow —
 * the only triggers are `danger_rating === "high"` and `allow_outbound === true`.
 */
export function determineRequiredApprovals(manifest: CapabilityManifest): string[] {
  const required: string[] = [];
  if (manifest.danger_rating === 'high') required.push(CAPABILITY_APPROVALS.HIGH_RISK);
  if (manifest.allow_outbound) required.push(CAPABILITY_APPROVALS.OUTBOUND);
  return required;
}

/* -------------------------------------------------------------------------- */
/* Audit + hard enforcement                                                   */
/* -------------------------------------------------------------------------- */

export function auditSandbox(
  manifest: CapabilityManifest | null,
  taskMdContent: string,
): SandboxAuditResult {
  if (manifest === null) {
    return {
      manifest_present: false,
      required_approvals: [],
      granted_approvals: [],
      missing_approvals: [],
    };
  }
  const required = determineRequiredApprovals(manifest);
  const grantedSet = findGrantedApprovals(taskMdContent);
  const missing = required.filter((r) => !grantedSet.has(r));
  return {
    manifest_present: true,
    required_approvals: required,
    granted_approvals: Array.from(grantedSet),
    missing_approvals: missing,
  };
}

/**
 * Hard sandbox gate. Throws `Error('[SANDBOX_CAPABILITY_VIOLATION] ...')`
 * iff the manifest demands approvals that TASK.md does not grant. Returns
 * void on success (no-op when manifest is null or all approvals present).
 */
export function enforceSandbox(
  manifest: CapabilityManifest | null,
  taskMdContent: string,
): void {
  const audit = auditSandbox(manifest, taskMdContent);
  if (audit.missing_approvals.length === 0) return;
  throw new Error(
    `[SANDBOX_CAPABILITY_VIOLATION] Capability Manifest demands ` +
      `${audit.missing_approvals.length} unrelinquished approval(s) ` +
      `[${audit.missing_approvals.join(', ')}] but TASK.md does not contain ` +
      `the corresponding checked-off bullet(s). Append ` +
      audit.missing_approvals.map((a) => `\`- [x] ${a}: <slug>: <intent>\``).join(', ') +
      ' to TASK.md (out-of-band, human signature required) and re-run.',
  );
}
