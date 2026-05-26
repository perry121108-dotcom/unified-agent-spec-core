/**
 * Phase 1 Strong-Type Blueprint
 * ------------------------------
 * This file declares the contract surface that Phase 2 (codegen + JSON Schema
 * dual core) will lock onto. Declarations only — no runtime behavior.
 *
 * Cross-reference:
 *   R1 Lifecycle Matrix      → `allowed_next_stages`, `termination_condition`
 *   R2 Prompt Inline Strag.  → `DeliverySchema.prompt_externalization`
 *   R3 Evidence Contract     → `DeliverySchema.execution_evidence_required`
 */

export type AgentRole = 'PM' | 'Architect' | 'Builder' | 'Tester' | 'Liaison';

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'rejected';

export interface DeliverySchema {
  /** R2 invariant — every node must declare whether prompts are externalized. */
  prompt_externalization: boolean;
  /** R3 invariant — every node must declare whether machine evidence is mandatory. */
  execution_evidence_required: boolean;
  /** Concrete artifact path (e.g. "shared/tester_input.json"). */
  artifact_path: string;
  /** Semver-style version of the contract; bumped when the schema changes. */
  contract_version: string;
}

export interface WorkflowStateNode {
  /** Role responsible for this node. */
  role: AgentRole;
  /** Task status this node represents. */
  status: TaskStatus;
  /** Files that must exist and be read before entering this node. */
  required_context_files: string[];
  /** Roles that may legally receive handoff from this node (R1 guard). */
  allowed_next_stages: AgentRole[];
  /** Delivery contract enforced at the exit edge of this node. */
  delivery_schema: DeliverySchema;
  /**
   * Free-form termination condition explanation; R1 demands this be non-empty
   * when `allowed_next_stages` could form a cycle.
   */
  termination_condition: string;
}

export interface WorkflowSpec {
  /** Spec identifier (e.g. "ai_sop_toolkit@phase1"). */
  spec_id: string;
  /** Spec semver. */
  version: string;
  /** Ordered list of state nodes; first node is the entry point. */
  nodes: WorkflowStateNode[];
}
