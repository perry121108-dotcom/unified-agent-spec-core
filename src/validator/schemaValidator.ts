import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { AgentRole } from '../types/types.js';
import { AI_SOP_STATE_MACHINE } from '../config/agentWorkflowRegistry.js';

export interface HandoffPayload {
  /** Required iff delivery_schema.prompt_externalization === true. */
  prompts_directory_path?: unknown;
  /** Required iff delivery_schema.execution_evidence_required === true. */
  execution_evidence_log?: unknown;
  /** Optional — when set, must be in the source role's allowed_next_stages. */
  next_role?: unknown;
  /** Free-form additional fields are allowed but not validated by this layer. */
  [key: string]: unknown;
}

export interface ValidationResult {
  success: boolean;
  errors: string[];
}

export interface ValidatorOptions {
  /**
   * Root directory used when resolving relative artifact paths and
   * prompts_directory_path. Defaults to process.cwd().
   */
  workspaceRoot?: string;
}

const MIN_EVIDENCE_LOG_LENGTH = 32;

export function validateHandoffData(
  data: unknown,
  role: AgentRole,
  options: ValidatorOptions = {},
): ValidationResult {
  const errors: string[] = [];
  const root = options.workspaceRoot ?? process.cwd();

  const node = AI_SOP_STATE_MACHINE[role];
  if (!node) {
    return { success: false, errors: [`Unknown role: ${String(role)}`] };
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      success: false,
      errors: [`Handoff payload must be a non-null object for role ${role}; got ${describe(data)}.`],
    };
  }

  const payload = data as HandoffPayload;
  const schema = node.delivery_schema;

  // R2 invariant — prompts_directory_path required + must exist on disk.
  if (schema.prompt_externalization) {
    const raw = payload.prompts_directory_path;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      errors.push(
        `[${role}] prompt_externalization=true but prompts_directory_path is missing or not a non-empty string.`,
      );
    } else {
      const absDir = isAbsolute(raw) ? raw : resolve(root, raw);
      if (!existsSync(absDir) || !statSync(absDir).isDirectory()) {
        errors.push(
          `[${role}] prompts_directory_path "${raw}" does not resolve to an existing directory.`,
        );
      }
    }
  }

  // R3 invariant — execution_evidence_log required + non-trivial content.
  if (schema.execution_evidence_required) {
    const raw = payload.execution_evidence_log;
    if (typeof raw !== 'string') {
      errors.push(
        `[${role}] execution_evidence_required=true but execution_evidence_log is missing or not a string.`,
      );
    } else if (raw.trim().length < MIN_EVIDENCE_LOG_LENGTH) {
      errors.push(
        `[${role}] execution_evidence_log is shorter than ${MIN_EVIDENCE_LOG_LENGTH} chars; ` +
          `must contain a real terminal log (commands, stdout/stderr, exit codes).`,
      );
    }
  }

  // Artifact existence check — the contract file declared by delivery_schema
  // must already be present on disk for a Builder→Tester (or downstream)
  // handoff to be valid.
  const absArtifact = isAbsolute(schema.artifact_path)
    ? schema.artifact_path
    : resolve(root, schema.artifact_path);
  if (!existsSync(absArtifact) || !statSync(absArtifact).isFile()) {
    errors.push(
      `[${role}] declared artifact_path "${schema.artifact_path}" does not exist as a file.`,
    );
  }

  // R1 invariant — if payload declares the next role, it must be allowed.
  if (payload.next_role !== undefined) {
    const next = payload.next_role;
    if (typeof next !== 'string') {
      errors.push(`[${role}] next_role must be a string when provided; got ${describe(next)}.`);
    } else if (!(node.allowed_next_stages as readonly string[]).includes(next)) {
      errors.push(
        `[${role}] cross-session unauthorized handoff: next_role "${next}" not in ` +
          `allowed_next_stages [${node.allowed_next_stages.join(', ')}].`,
      );
    }
  }

  return { success: errors.length === 0, errors };
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
