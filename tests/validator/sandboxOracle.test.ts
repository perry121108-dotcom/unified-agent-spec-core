import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_APPROVALS,
  auditSandbox,
  determineRequiredApprovals,
  enforceSandbox,
  findGrantedApprovals,
  parseSandboxManifest,
  readSandboxFromGovernanceJson,
} from '../../src/validator/sandboxOracle.js';

/* -------------------------------------------------------------------------- */
/* parseSandboxManifest — strict schema gate                                  */
/* -------------------------------------------------------------------------- */

describe('sandboxOracle — parseSandboxManifest (strict schema)', () => {
  it('accepts a fully-populated manifest', () => {
    const m = parseSandboxManifest({
      allow_outbound: true,
      allowed_paths: ['./src/*', './tests/*'],
      danger_rating: 'high',
    });
    expect(m).toEqual({
      allow_outbound: true,
      allowed_paths: ['./src/*', './tests/*'],
      danger_rating: 'high',
    });
  });

  it('rejects missing allow_outbound', () => {
    expect(
      parseSandboxManifest({ allowed_paths: [], danger_rating: 'low' }),
    ).toBeNull();
  });

  it('rejects non-array allowed_paths', () => {
    expect(
      parseSandboxManifest({
        allow_outbound: false,
        allowed_paths: 'src/*',
        danger_rating: 'low',
      }),
    ).toBeNull();
  });

  it('rejects invalid danger_rating values', () => {
    expect(
      parseSandboxManifest({
        allow_outbound: false,
        allowed_paths: [],
        danger_rating: 'critical',
      }),
    ).toBeNull();
  });

  it('returns null for null / non-object inputs', () => {
    expect(parseSandboxManifest(null)).toBeNull();
    expect(parseSandboxManifest('string')).toBeNull();
    expect(parseSandboxManifest(42)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* readSandboxFromGovernanceJson — JSON file body parsing                     */
/* -------------------------------------------------------------------------- */

describe('sandboxOracle — readSandboxFromGovernanceJson', () => {
  it('extracts sandbox section from a well-formed governance JSON', () => {
    const json = JSON.stringify({
      project: 'demo',
      sandbox: {
        allow_outbound: false,
        allowed_paths: ['./src/*'],
        danger_rating: 'medium',
      },
    });
    expect(readSandboxFromGovernanceJson(json)?.danger_rating).toBe('medium');
  });

  it('returns null when JSON has no sandbox field', () => {
    expect(readSandboxFromGovernanceJson('{"project":"demo"}')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(readSandboxFromGovernanceJson('{"sandbox":')).toBeNull();
  });

  it('returns null when sandbox is present but malformed', () => {
    expect(
      readSandboxFromGovernanceJson(
        JSON.stringify({ sandbox: { allow_outbound: 'yes' } }),
      ),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* findGrantedApprovals — markdown bullet harvester                           */
/* -------------------------------------------------------------------------- */

describe('sandboxOracle — findGrantedApprovals (TASK.md harvest)', () => {
  it('extracts `[x] APPROVE_*` bullets case-insensitively on x', () => {
    const md = `# TASK
- [x] APPROVE_HIGH_RISK: phase-17: vetted danger
- [X] APPROVE_OUTBOUND_ACCESS: phase-17: vetted egress
`;
    const granted = findGrantedApprovals(md);
    expect(granted.has('APPROVE_HIGH_RISK')).toBe(true);
    expect(granted.has('APPROVE_OUTBOUND_ACCESS')).toBe(true);
  });

  it('ignores unchecked `[ ]` bullets', () => {
    const md = `- [ ] APPROVE_HIGH_RISK: not yet vetted`;
    expect(findGrantedApprovals(md).size).toBe(0);
  });

  it('returns an empty set when TASK.md has no APPROVE bullets at all', () => {
    expect(findGrantedApprovals('# nothing here').size).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* determineRequiredApprovals — capability → approval mapping                 */
/* -------------------------------------------------------------------------- */

describe('sandboxOracle — determineRequiredApprovals (mutex mapping)', () => {
  it('low danger + no outbound → no approvals required', () => {
    expect(
      determineRequiredApprovals({
        allow_outbound: false,
        allowed_paths: [],
        danger_rating: 'low',
      }),
    ).toEqual([]);
  });

  it('high danger alone → requires APPROVE_HIGH_RISK', () => {
    expect(
      determineRequiredApprovals({
        allow_outbound: false,
        allowed_paths: [],
        danger_rating: 'high',
      }),
    ).toEqual([CAPABILITY_APPROVALS.HIGH_RISK]);
  });

  it('outbound alone → requires APPROVE_OUTBOUND_ACCESS', () => {
    expect(
      determineRequiredApprovals({
        allow_outbound: true,
        allowed_paths: [],
        danger_rating: 'low',
      }),
    ).toEqual([CAPABILITY_APPROVALS.OUTBOUND]);
  });

  it('both high danger AND outbound → requires both bullets', () => {
    const reqs = determineRequiredApprovals({
      allow_outbound: true,
      allowed_paths: [],
      danger_rating: 'high',
    });
    expect(reqs).toContain(CAPABILITY_APPROVALS.HIGH_RISK);
    expect(reqs).toContain(CAPABILITY_APPROVALS.OUTBOUND);
    expect(reqs.length).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* auditSandbox + enforceSandbox — integrated hard gate                       */
/* -------------------------------------------------------------------------- */

describe('sandboxOracle — auditSandbox PASS paths', () => {
  it('null manifest → no requirements, no granted, no missing', () => {
    const audit = auditSandbox(null, '# nothing');
    expect(audit.manifest_present).toBe(false);
    expect(audit.required_approvals).toEqual([]);
    expect(audit.missing_approvals).toEqual([]);
  });

  it('low-danger manifest + empty TASK.md → audit clean, no throw', () => {
    const manifest = {
      allow_outbound: false,
      allowed_paths: [],
      danger_rating: 'low' as const,
    };
    const audit = auditSandbox(manifest, '# nothing');
    expect(audit.required_approvals).toEqual([]);
    expect(audit.missing_approvals).toEqual([]);
    expect(() => enforceSandbox(manifest, '# nothing')).not.toThrow();
  });

  it('high-danger manifest + matching APPROVE bullet → enforce passes', () => {
    const manifest = {
      allow_outbound: false,
      allowed_paths: [],
      danger_rating: 'high' as const,
    };
    const taskMd = '- [x] APPROVE_HIGH_RISK: phase-17: vetted by human';
    expect(() => enforceSandbox(manifest, taskMd)).not.toThrow();
  });
});

describe('sandboxOracle — enforceSandbox BLOCK paths', () => {
  it('high-danger manifest + NO APPROVE bullet → throws SANDBOX_CAPABILITY_VIOLATION', () => {
    const manifest = {
      allow_outbound: false,
      allowed_paths: [],
      danger_rating: 'high' as const,
    };
    expect(() => enforceSandbox(manifest, '# no approvals here')).toThrowError(
      /\[SANDBOX_CAPABILITY_VIOLATION\]/,
    );
  });

  it('outbound + missing approval → throws SANDBOX_CAPABILITY_VIOLATION', () => {
    const manifest = {
      allow_outbound: true,
      allowed_paths: [],
      danger_rating: 'low' as const,
    };
    expect(() => enforceSandbox(manifest, '# no approvals')).toThrowError(
      /APPROVE_OUTBOUND_ACCESS/,
    );
  });

  it('both required, only one approved → throws listing the missing one', () => {
    const manifest = {
      allow_outbound: true,
      allowed_paths: [],
      danger_rating: 'high' as const,
    };
    const partial = '- [x] APPROVE_HIGH_RISK: vetted';
    expect(() => enforceSandbox(manifest, partial)).toThrowError(
      /APPROVE_OUTBOUND_ACCESS/,
    );
  });

  it('error message mentions human signature requirement', () => {
    const manifest = {
      allow_outbound: false,
      allowed_paths: [],
      danger_rating: 'high' as const,
    };
    try {
      enforceSandbox(manifest, '# nothing');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error).message).toContain('human signature');
    }
  });
});
