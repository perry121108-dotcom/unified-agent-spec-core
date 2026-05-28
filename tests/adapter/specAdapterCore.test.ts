import { describe, it, expect } from 'vitest';
import {
  AgentRule,
  AgentSpecIR,
  categorizeRule,
  exportToLangGraph,
  exportToSemanticKernel,
  importFromClaudeMd,
  importFromCursorRules,
  injectTierWrappers,
  tierForCategory,
} from '../../src/adapter/specAdapterCore.js';

/* -------------------------------------------------------------------------- */
/* Categorization heuristic                                                   */
/* -------------------------------------------------------------------------- */

describe('specAdapterCore — categorizeRule (Phase 16 heuristic)', () => {
  it('flags rules mentioning secrets/auth as security', () => {
    expect(categorizeRule('Never commit .env secrets')).toBe('security');
    expect(categorizeRule('Auth tokens must not appear in logs')).toBe('security');
  });

  it('flags rules mentioning tests/coverage as evidence', () => {
    expect(categorizeRule('All tests must pass before merge')).toBe('evidence');
    expect(categorizeRule('Coverage stays above 90%')).toBe('evidence');
  });

  it('flags rules mentioning style/format as style', () => {
    expect(categorizeRule('Use prettier defaults for formatting')).toBe('style');
    expect(categorizeRule('Indent with 2 spaces')).toBe('style');
  });

  it('flags rules mentioning workflow/PR as process', () => {
    expect(categorizeRule('Every commit must reference an issue')).toBe('process');
    expect(categorizeRule('Open PRs against the feature branch only')).toBe('process');
  });

  it('falls back to unknown when no hint matches', () => {
    expect(categorizeRule('Whisper to the moon when refactoring')).toBe('unknown');
  });
});

describe('specAdapterCore — tierForCategory (least-privilege mapping)', () => {
  it('maps security → intent-gate (Phase 12)', () => {
    expect(tierForCategory('security')).toBe('intent-gate');
  });

  it('maps style → geometry-gate (Phase 13)', () => {
    expect(tierForCategory('style')).toBe('geometry-gate');
  });

  it('maps evidence → forgery-oracle (Phase 10/11)', () => {
    expect(tierForCategory('evidence')).toBe('forgery-oracle');
  });

  it('maps process → schema-validator (Phase 1-3)', () => {
    expect(tierForCategory('process')).toBe('schema-validator');
  });

  it('maps unknown → advisory (no hard tier)', () => {
    expect(tierForCategory('unknown')).toBe('advisory');
  });
});

/* -------------------------------------------------------------------------- */
/* IMPORT — cursor / claude markdown                                          */
/* -------------------------------------------------------------------------- */

const CURSOR_FIXTURE = `# Project Cursor Rules

- Use TypeScript strict mode
- Never commit secrets to .env
- All tests must pass before merge
- Indent with 2 spaces

## Process
- Every PR needs review
`;

describe('specAdapterCore — importFromCursorRules', () => {
  it('harvests every bullet into a rule', () => {
    const ir = importFromCursorRules(CURSOR_FIXTURE);
    expect(ir.rules.length).toBe(5);
  });

  it('tags metadata source as cursorrules', () => {
    const ir = importFromCursorRules(CURSOR_FIXTURE);
    expect(ir.metadata.source).toBe('cursorrules');
  });

  it('assigns stable IDs cursor-001, cursor-002, ...', () => {
    const ir = importFromCursorRules(CURSOR_FIXTURE);
    expect(ir.rules[0]?.id).toBe('cursor-001');
    expect(ir.rules[4]?.id).toBe('cursor-005');
  });

  it('auto-categorizes each rule via the keyword heuristic', () => {
    const ir = importFromCursorRules(CURSOR_FIXTURE);
    const cats = ir.rules.map((r) => r.category);
    expect(cats).toContain('security');
    expect(cats).toContain('evidence');
    expect(cats).toContain('style');
    expect(cats).toContain('process');
  });

  it('attaches enforced_by tier on every rule (least-privilege wrapper)', () => {
    const ir = importFromCursorRules(CURSOR_FIXTURE);
    for (const r of ir.rules) {
      expect(r.enforced_by).toBeDefined();
    }
  });

  it('returns empty rules on empty input', () => {
    expect(importFromCursorRules('').rules).toEqual([]);
  });
});

describe('specAdapterCore — importFromClaudeMd', () => {
  it('parses CLAUDE.md bullet structure identical to cursorrules', () => {
    const ir = importFromClaudeMd(CURSOR_FIXTURE);
    expect(ir.rules.length).toBe(5);
    expect(ir.metadata.source).toBe('claude-md');
    expect(ir.rules[0]?.id).toBe('claude-001');
  });

  it('handles CRLF line endings', () => {
    const crlf = CURSOR_FIXTURE.replace(/\n/g, '\r\n');
    expect(importFromClaudeMd(crlf).rules.length).toBe(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Tier wrapper idempotency                                                   */
/* -------------------------------------------------------------------------- */

describe('specAdapterCore — injectTierWrappers (idempotency)', () => {
  it('re-categorizing an IR produces stable output (idempotent)', () => {
    const once = injectTierWrappers(importFromCursorRules(CURSOR_FIXTURE));
    const twice = injectTierWrappers(once);
    expect(JSON.stringify(once.rules)).toBe(JSON.stringify(twice.rules));
  });

  it('overwrites stale enforced_by tier on hand-edited IR', () => {
    const handEdited: AgentSpecIR = {
      metadata: {
        name: 'manual',
        source: 'unknown',
        generated_at: '2026-01-01T00:00:00Z',
      },
      rules: [
        {
          id: 'manual-001',
          text: 'Never commit secrets',
          category: 'style', // wrong — should be security
          severity: 'info',
          enforced_by: 'geometry-gate', // wrong — should be intent-gate
        },
      ],
    };
    const fixed = injectTierWrappers(handEdited);
    expect(fixed.rules[0]?.category).toBe('security');
    expect(fixed.rules[0]?.enforced_by).toBe('intent-gate');
  });
});

/* -------------------------------------------------------------------------- */
/* EXPORT — LangGraph                                                         */
/* -------------------------------------------------------------------------- */

describe('specAdapterCore — exportToLangGraph', () => {
  it('emits one node per rule', () => {
    const ir = importFromCursorRules(CURSOR_FIXTURE);
    const graph = exportToLangGraph(ir);
    const ruleNodes = graph.nodes.filter((n) => n.type === 'rule');
    expect(ruleNodes.length).toBe(5);
  });

  it('emits role nodes + edges from allowed_next adjacency lists', () => {
    const ir: AgentSpecIR = {
      metadata: {
        name: 'tiny',
        source: 'agent-core',
        generated_at: '2026-05-28T00:00:00Z',
      },
      rules: [],
      roles: [
        { name: 'Builder', allowed_next: ['Tester'] },
        { name: 'Tester', allowed_next: ['Builder'] },
      ],
    };
    const graph = exportToLangGraph(ir);
    const roleNodes = graph.nodes.filter((n) => n.type === 'role');
    expect(roleNodes.length).toBe(2);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'role:Builder', to: 'role:Tester' },
        { from: 'role:Tester', to: 'role:Builder' },
      ]),
    );
  });

  it('handles IRs with no roles (rule-only payloads)', () => {
    const ir = importFromCursorRules(CURSOR_FIXTURE);
    const graph = exportToLangGraph(ir);
    expect(graph.edges).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* EXPORT — Semantic Kernel                                                   */
/* -------------------------------------------------------------------------- */

describe('specAdapterCore — exportToSemanticKernel', () => {
  it('emits one plugin function per rule with tier + severity params', () => {
    const ir = importFromCursorRules(CURSOR_FIXTURE);
    const plugin = exportToSemanticKernel(ir);
    expect(plugin.functions.length).toBe(5);
    for (const fn of plugin.functions) {
      expect(fn.parameters.tier).toBeDefined();
      expect(fn.parameters.severity).toBeDefined();
    }
  });

  it('uses rule.id as the function name (stable across re-runs)', () => {
    const ir = importFromCursorRules(CURSOR_FIXTURE);
    const plugin = exportToSemanticKernel(ir);
    expect(plugin.functions.map((f) => f.name)).toEqual([
      'cursor-001',
      'cursor-002',
      'cursor-003',
      'cursor-004',
      'cursor-005',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Round-trip idempotency                                                     */
/* -------------------------------------------------------------------------- */

describe('specAdapterCore — round-trip idempotency (cursor → IR → SK → re-derive IR)', () => {
  it('rule ids and texts survive an IR → Semantic Kernel → minimal IR re-derivation', () => {
    const original = importFromCursorRules(CURSOR_FIXTURE);
    const plugin = exportToSemanticKernel(original);
    // Re-derive a minimal IR from the SK plugin (id / text mapping only)
    const reDerived: AgentRule[] = plugin.functions.map((f) => ({
      id: f.name,
      text: f.description,
      category: 'unknown',
      severity: f.parameters.severity,
      enforced_by: f.parameters.tier,
    }));
    expect(reDerived.map((r) => r.id)).toEqual(
      original.rules.map((r) => r.id),
    );
    expect(reDerived.map((r) => r.text)).toEqual(
      original.rules.map((r) => r.text),
    );
  });

  it('IR → LangGraph rule nodes carry the same data shape (no field loss)', () => {
    const ir = importFromCursorRules(CURSOR_FIXTURE);
    const graph = exportToLangGraph(ir);
    for (let i = 0; i < ir.rules.length; i++) {
      const node = graph.nodes.find((n) => n.id === ir.rules[i]?.id);
      expect(node).toBeDefined();
      expect(node?.data.text).toBe(ir.rules[i]?.text);
      expect(node?.data.category).toBe(ir.rules[i]?.category);
      expect(node?.data.enforced_by).toBe(ir.rules[i]?.enforced_by);
    }
  });
});
