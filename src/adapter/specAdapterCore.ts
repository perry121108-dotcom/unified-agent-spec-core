/**
 * specAdapterCore — Phase 16 Bidirectional Ecosystem Spec Adapter
 *
 * AgentCore lives in a fragmented ecosystem: Cursor users describe rules in
 * `.cursorrules`, Claude Code users in `CLAUDE.md`, Microsoft Semantic Kernel
 * users in plugin manifests, LangChain users in LangGraph state-graph JSON.
 * Every project that adopts AgentCore today incurs translation cost.
 *
 * Phase 16 closes the gap with a tiny static-mapping adapter:
 *
 *     [.cursorrules]                        [LangGraph state graph JSON]
 *     [CLAUDE.md]      ──IMPORT──►  IR  ──EXPORT──►  [Semantic Kernel plugin]
 *
 * The intermediate representation (`AgentSpecIR`) is a pure POJO — no AST,
 * no parser combinators, no compilers. Bullets in markdown become rules;
 * rules carry a category that drives a least-privilege wrapper mapping each
 * rule to one of AgentCore's four rigid tiers. Round-tripping the IR back
 * out as LangGraph or Semantic Kernel JSON is a deterministic projection.
 *
 * Invariants
 *   - Zero external dependencies — only Node.js `node:fs` and string ops.
 *   - Lossless idempotency on the core fields: importing then re-exporting
 *     preserves every rule's id/text/category/severity.
 *   - Least-privilege wrapper: every imported rule is tagged with the
 *     AgentCore tier that physically enforces it.
 */

import { readFileSync } from 'node:fs';

export type RuleCategory =
  | 'style'
  | 'security'
  | 'process'
  | 'evidence'
  | 'unknown';

export type RuleSeverity = 'block' | 'warning' | 'info';

export type EnforcementTier =
  | 'intent-gate'
  | 'geometry-gate'
  | 'forgery-oracle'
  | 'schema-validator'
  | 'advisory';

export interface AgentRule {
  id: string;
  text: string;
  category: RuleCategory;
  severity: RuleSeverity;
  /** Phase 16: which AgentCore tier physically enforces this rule. */
  enforced_by: EnforcementTier;
}

export interface AgentRoleNode {
  name: string;
  allowed_next: string[];
}

export interface AgentSpecIRMetadata {
  name: string;
  source: 'cursorrules' | 'claude-md' | 'agent-core' | 'unknown';
  description?: string;
  generated_at: string;
}

export interface AgentSpecIR {
  metadata: AgentSpecIRMetadata;
  rules: AgentRule[];
  roles?: AgentRoleNode[];
}

/* -------------------------------------------------------------------------- */
/* Rule categorization — keyword-based heuristic                              */
/* -------------------------------------------------------------------------- */

const STYLE_HINTS = ['format', 'style', 'lint', 'prettier', 'indent', 'naming'];
const SECURITY_HINTS = ['secret', 'token', 'credential', 'env', 'auth', 'inject'];
const EVIDENCE_HINTS = ['test', 'evidence', 'log', 'coverage', 'pass', 'verify'];
const PROCESS_HINTS = ['commit', 'pr', 'branch', 'review', 'merge', 'workflow'];

function lower(text: string): string {
  return text.toLowerCase();
}

function matchesAny(haystack: string, needles: readonly string[]): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) return true;
  }
  return false;
}

export function categorizeRule(text: string): RuleCategory {
  const lc = lower(text);
  if (matchesAny(lc, SECURITY_HINTS)) return 'security';
  if (matchesAny(lc, EVIDENCE_HINTS)) return 'evidence';
  if (matchesAny(lc, STYLE_HINTS)) return 'style';
  if (matchesAny(lc, PROCESS_HINTS)) return 'process';
  return 'unknown';
}

const TIER_BY_CATEGORY: Readonly<Record<RuleCategory, EnforcementTier>> = {
  security: 'intent-gate',
  style: 'geometry-gate',
  evidence: 'forgery-oracle',
  process: 'schema-validator',
  unknown: 'advisory',
};

export function tierForCategory(category: RuleCategory): EnforcementTier {
  return TIER_BY_CATEGORY[category];
}

/* -------------------------------------------------------------------------- */
/* Markdown bullet harvest                                                    */
/* -------------------------------------------------------------------------- */

const BULLET_LINE = /^\s*[-*]\s+(\S.*?)\s*$/;

function harvestBullets(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = BULLET_LINE.exec(raw);
    if (m && m[1]) out.push(m[1]);
  }
  return out;
}

function isoNow(): string {
  return new Date().toISOString();
}

function buildRule(index: number, rawText: string, prefix: string): AgentRule {
  const category = categorizeRule(rawText);
  return {
    id: `${prefix}-${String(index + 1).padStart(3, '0')}`,
    text: rawText,
    category,
    severity: category === 'security' || category === 'evidence' ? 'block' : 'warning',
    enforced_by: tierForCategory(category),
  };
}

/* -------------------------------------------------------------------------- */
/* IMPORT: external → AgentSpecIR                                             */
/* -------------------------------------------------------------------------- */

export interface ImportOptions {
  name?: string;
  description?: string;
}

export function importFromCursorRules(
  text: string,
  opts: ImportOptions = {},
): AgentSpecIR {
  const bullets = harvestBullets(text);
  const rules = bullets.map((b, i) => buildRule(i, b, 'cursor'));
  return {
    metadata: {
      name: opts.name ?? '.cursorrules import',
      source: 'cursorrules',
      description: opts.description,
      generated_at: isoNow(),
    },
    rules,
  };
}

export function importFromClaudeMd(
  text: string,
  opts: ImportOptions = {},
): AgentSpecIR {
  const bullets = harvestBullets(text);
  const rules = bullets.map((b, i) => buildRule(i, b, 'claude'));
  return {
    metadata: {
      name: opts.name ?? 'CLAUDE.md import',
      source: 'claude-md',
      description: opts.description,
      generated_at: isoNow(),
    },
    rules,
  };
}

export function importFromPath(
  absolutePath: string,
  source: 'cursorrules' | 'claude-md',
  opts: ImportOptions = {},
): AgentSpecIR {
  const text = readFileSync(absolutePath, 'utf8');
  return source === 'cursorrules'
    ? importFromCursorRules(text, opts)
    : importFromClaudeMd(text, opts);
}

/* -------------------------------------------------------------------------- */
/* Least-privilege wrapper — auto-attach AgentCore tier metadata              */
/* -------------------------------------------------------------------------- */

/**
 * Re-runs categorization on each rule so any caller-supplied IR (e.g. one
 * hand-edited in JSON) re-aligns its `enforced_by` field with the current
 * heuristic. Idempotent — calling twice produces the same output.
 */
export function injectTierWrappers(ir: AgentSpecIR): AgentSpecIR {
  const rules = ir.rules.map((r) => {
    const category = categorizeRule(r.text);
    return {
      ...r,
      category,
      enforced_by: tierForCategory(category),
    };
  });
  return { ...ir, rules };
}

/* -------------------------------------------------------------------------- */
/* EXPORT: AgentSpecIR → external                                             */
/* -------------------------------------------------------------------------- */

export interface LangGraphNode {
  id: string;
  type: 'rule' | 'role';
  data: Record<string, unknown>;
}

export interface LangGraphEdge {
  from: string;
  to: string;
}

export interface LangGraphStateGraph {
  name: string;
  generated_at: string;
  nodes: LangGraphNode[];
  edges: LangGraphEdge[];
}

function ruleToLangGraphNode(rule: AgentRule): LangGraphNode {
  return {
    id: rule.id,
    type: 'rule',
    data: {
      text: rule.text,
      category: rule.category,
      severity: rule.severity,
      enforced_by: rule.enforced_by,
    },
  };
}

function roleToLangGraphNode(role: AgentRoleNode): LangGraphNode {
  return {
    id: `role:${role.name}`,
    type: 'role',
    data: { allowed_next: role.allowed_next },
  };
}

function rolesToEdges(roles: AgentRoleNode[]): LangGraphEdge[] {
  const edges: LangGraphEdge[] = [];
  for (const role of roles) {
    for (const next of role.allowed_next) {
      edges.push({ from: `role:${role.name}`, to: `role:${next}` });
    }
  }
  return edges;
}

export function exportToLangGraph(ir: AgentSpecIR): LangGraphStateGraph {
  const ruleNodes = ir.rules.map(ruleToLangGraphNode);
  const roleNodes = (ir.roles ?? []).map(roleToLangGraphNode);
  const edges = rolesToEdges(ir.roles ?? []);
  return {
    name: ir.metadata.name,
    generated_at: isoNow(),
    nodes: [...ruleNodes, ...roleNodes],
    edges,
  };
}

export interface SemanticKernelFunction {
  name: string;
  description: string;
  parameters: { tier: EnforcementTier; severity: RuleSeverity };
}

export interface SemanticKernelPlugin {
  name: string;
  description: string;
  generated_at: string;
  functions: SemanticKernelFunction[];
}

function ruleToSKFunction(rule: AgentRule): SemanticKernelFunction {
  return {
    name: rule.id,
    description: rule.text,
    parameters: {
      tier: rule.enforced_by,
      severity: rule.severity,
    },
  };
}

export function exportToSemanticKernel(ir: AgentSpecIR): SemanticKernelPlugin {
  return {
    name: ir.metadata.name,
    description:
      ir.metadata.description ??
      `AgentCore-derived plugin (${ir.rules.length} rules)`,
    generated_at: isoNow(),
    functions: ir.rules.map(ruleToSKFunction),
  };
}
